-- ============================================================
-- BLE Master Upload — Tables + RPCs
-- Run AFTER step_d_permissions.sql
-- Adds: station_master upload system with version history + rollback
-- Developed by Sunny Gupta
-- ============================================================

-- 1. Upload header table — one row per upload (immutable history)
create table if not exists public.master_uploads(
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  source_filename text,
  total_rows integer not null,
  stats jsonb not null default '{}'::jsonb,  -- {added,updated,unchanged,missing_in_upload}
  is_current boolean not null default false
);
create unique index if not exists master_uploads_only_one_current
  on public.master_uploads(is_current) where is_current = true;

-- 2. Station data per upload — immutable snapshot of each upload
create table if not exists public.station_data(
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.master_uploads(id) on delete cascade,
  erp text not null,
  station_name text not null,
  state text not null,
  ble_yes boolean not null default false,
  iso_yes boolean not null default false,
  unique (upload_id, erp)
);
create index if not exists station_data_upload_idx on public.station_data(upload_id);
create index if not exists station_data_erp_idx on public.station_data(erp);

-- 3. RLS — readable by all authenticated, writable only with master_upload permission
alter table public.master_uploads enable row level security;
alter table public.station_data enable row level security;

drop policy if exists master_uploads_select on public.master_uploads;
drop policy if exists master_uploads_insert on public.master_uploads;
drop policy if exists master_uploads_update on public.master_uploads;
drop policy if exists master_uploads_delete on public.master_uploads;
drop policy if exists station_data_select on public.station_data;
drop policy if exists station_data_insert on public.station_data;
drop policy if exists station_data_delete on public.station_data;

create policy master_uploads_select on public.master_uploads for select to authenticated
  using (true);
create policy master_uploads_insert on public.master_uploads for insert to authenticated
  with check (public.has_permission('master_upload'));
create policy master_uploads_update on public.master_uploads for update to authenticated
  using (public.has_permission('master_upload'));
create policy master_uploads_delete on public.master_uploads for delete to authenticated
  using (public.is_admin());

create policy station_data_select on public.station_data for select to authenticated
  using (true);
create policy station_data_insert on public.station_data for insert to authenticated
  with check (public.has_permission('master_upload'));
create policy station_data_delete on public.station_data for delete to authenticated
  using (public.is_admin());

-- 4. RPC: get the CURRENT live master as a single row set
create or replace function public.master_get_current()
returns table(
  erp text,
  station_name text,
  state text,
  ble_yes boolean,
  iso_yes boolean,
  upload_id uuid,
  uploaded_at timestamptz,
  uploaded_by_name text,
  total_stations integer
)
language plpgsql
security definer
stable
set search_path = public
as $func$
declare
  v_current_id uuid;
  v_total integer;
  v_upload_at timestamptz;
  v_uploaded_by text;
begin
  select id, uploaded_at into v_current_id, v_upload_at
    from public.master_uploads where is_current = true limit 1;
  if v_current_id is null then
    /* No master uploaded yet — return empty result */
    return;
  end if;
  select count(*)::int into v_total from public.station_data where upload_id = v_current_id;
  select p.full_name into v_uploaded_by
    from public.master_uploads mu
    left join public.profiles p on p.id = mu.uploaded_by
    where mu.id = v_current_id;
  return query
  select sd.erp, sd.station_name, sd.state, sd.ble_yes, sd.iso_yes,
         v_current_id, v_upload_at, v_uploaded_by, v_total
  from public.station_data sd
  where sd.upload_id = v_current_id
  order by sd.erp;
end;
$func$;
grant execute on function public.master_get_current() to authenticated;

-- 5. RPC: upload a new master version (smart merge with previous current)
-- Takes a JSON array of {erp, station_name, state, ble_yes, iso_yes}
-- Returns the new upload_id and the diff stats
create or replace function public.master_upload_version(
  p_filename text,
  p_rows jsonb        -- array of row objects
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid := auth.uid();
  v_prev_id uuid;
  v_new_id uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_missing integer := 0;
  v_total integer;
  v_missing_erps text[];
  v_row jsonb;
  v_erp text;
  v_prev record;
begin
  if not public.has_permission('master_upload') then
    raise exception 'Not authorized — master upload permission required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Invalid payload — rows must be an array';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then raise exception 'Empty upload'; end if;

  /* Find previous current (for diff) */
  select id into v_prev_id from public.master_uploads where is_current = true limit 1;

  /* Create new upload header (not yet current) */
  insert into public.master_uploads(uploaded_by, source_filename, total_rows, stats, is_current)
  values (v_uid, p_filename, v_total, '{}'::jsonb, false)
  returning id into v_new_id;

  /* Insert station rows + compute diff against previous */
  for v_row in select jsonb_array_elements(p_rows) loop
    v_erp := upper(trim(v_row->>'erp'));
    if v_erp is null or v_erp = '' then continue; end if;
    insert into public.station_data(upload_id, erp, station_name, state, ble_yes, iso_yes)
    values (
      v_new_id,
      v_erp,
      coalesce(v_row->>'station_name',''),
      coalesce(v_row->>'state',''),
      coalesce((v_row->>'ble_yes')::boolean, false),
      coalesce((v_row->>'iso_yes')::boolean, false)
    )
    on conflict (upload_id, erp) do nothing;

    /* Diff against previous version */
    if v_prev_id is not null then
      select * into v_prev from public.station_data
        where upload_id = v_prev_id and erp = v_erp;
      if v_prev.erp is null then
        v_added := v_added + 1;
      elsif v_prev.station_name <> coalesce(v_row->>'station_name','')
         or v_prev.state <> coalesce(v_row->>'state','')
         or v_prev.ble_yes <> coalesce((v_row->>'ble_yes')::boolean, false)
         or v_prev.iso_yes <> coalesce((v_row->>'iso_yes')::boolean, false) then
        v_updated := v_updated + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    else
      v_added := v_added + 1;
    end if;
  end loop;

  /* Find ERPs in previous that are missing in new upload */
  if v_prev_id is not null then
    select array_agg(prev.erp order by prev.erp), count(*)
      into v_missing_erps, v_missing
      from public.station_data prev
      where prev.upload_id = v_prev_id
        and prev.erp not in (
          select sd.erp from public.station_data sd where sd.upload_id = v_new_id
        );

    /* Carry forward missing ERPs into the new snapshot (preserve them unchanged) */
    if coalesce(v_missing, 0) > 0 then
      insert into public.station_data(upload_id, erp, station_name, state, ble_yes, iso_yes)
      select v_new_id, prev.erp, prev.station_name, prev.state, prev.ble_yes, prev.iso_yes
        from public.station_data prev
        where prev.upload_id = v_prev_id
          and prev.erp = any(v_missing_erps)
      on conflict (upload_id, erp) do nothing;
    end if;
  end if;

  /* Update stats on the upload header */
  update public.master_uploads
    set stats = jsonb_build_object(
      'added', v_added,
      'updated', v_updated,
      'unchanged', v_unchanged,
      'missing_in_upload', coalesce(v_missing, 0),
      'missing_erps', to_jsonb(coalesce(v_missing_erps, ARRAY[]::text[]))
    )
    where id = v_new_id;

  return jsonb_build_object(
    'upload_id', v_new_id,
    'added', v_added,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'missing_in_upload', coalesce(v_missing, 0),
    'missing_erps', coalesce(v_missing_erps, ARRAY[]::text[]),
    'total_rows', v_total
  );
end;
$func$;
grant execute on function public.master_upload_version(text, jsonb) to authenticated;

-- 6. RPC: activate a specific upload (makes it the live current master)
-- Used after upload preview confirmation AND for rollback
create or replace function public.activate_master_upload(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if not public.has_permission('master_upload') then
    raise exception 'Not authorized';
  end if;
  /* Unset all current */
  update public.master_uploads set is_current = false where is_current = true;
  /* Set chosen one */
  update public.master_uploads set is_current = true where id = p_upload_id;
  if not found then raise exception 'Upload not found'; end if;
end;
$func$;
grant execute on function public.activate_master_upload(uuid) to authenticated;

-- 7. RPC: list all upload versions with summary info
create or replace function public.master_list_versions()
returns table(
  id uuid,
  uploaded_by_name text,
  uploaded_at timestamptz,
  source_filename text,
  total_rows integer,
  stats jsonb,
  is_current boolean
)
language plpgsql
security definer
stable
set search_path = public
as $func$
begin
  return query
  select mu.id,
    (select p.full_name from public.profiles p where p.id = mu.uploaded_by),
    mu.uploaded_at, mu.source_filename, mu.total_rows, mu.stats, mu.is_current
  from public.master_uploads mu
  order by mu.uploaded_at desc;
end;
$func$;
grant execute on function public.master_list_versions() to authenticated;

-- 8. RPC: delete an upload version (admin only, can't delete current)
create or replace function public.master_delete_version(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $func$
declare v_is_current boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admin can delete a master version';
  end if;
  select is_current into v_is_current from public.master_uploads where id = p_upload_id;
  if v_is_current is null then raise exception 'Upload not found'; end if;
  if v_is_current then raise exception 'Cannot delete the current active master. Roll back first.'; end if;
  delete from public.master_uploads where id = p_upload_id;
end;
$func$;
grant execute on function public.master_delete_version(uuid) to authenticated;
