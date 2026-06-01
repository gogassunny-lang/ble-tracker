-- ============================================================
-- BLE Transaction Tracker — Step B SQL
-- Activity tracking helpers (atomic increments, session lifecycle)
-- Developed by Sunny Gupta
-- Run this in Supabase SQL Editor AFTER supabase_setup.sql
-- ============================================================

-- Atomic increment of today's active seconds for the current user.
-- Returns the new total active_seconds for today.
create or replace function public.bump_activity(seconds_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if seconds_delta < 0 or seconds_delta > 3600 then
    -- sanity guard: no negative, no more than 1 hour per call
    raise exception 'Invalid delta: %', seconds_delta;
  end if;

  insert into public.activity_time(user_id, date, active_seconds, updated_at)
  values (v_uid, v_today, seconds_delta, now())
  on conflict (user_id, date) do update
    set active_seconds = public.activity_time.active_seconds + excluded.active_seconds,
        updated_at = now()
  returning active_seconds into v_total;

  return v_total;
end;
$$;

grant execute on function public.bump_activity(integer) to authenticated;

-- Atomic increment of the current session's active seconds.
create or replace function public.bump_session(p_session_id uuid, seconds_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if seconds_delta < 0 or seconds_delta > 3600 then
    raise exception 'Invalid delta: %', seconds_delta;
  end if;
  update public.activity_sessions
    set active_seconds = active_seconds + seconds_delta
    where id = p_session_id and user_id = v_uid;
end;
$$;

grant execute on function public.bump_session(uuid, integer) to authenticated;

-- End the session: set ended_at = now()
create or replace function public.end_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  update public.activity_sessions
    set ended_at = now()
    where id = p_session_id and user_id = v_uid and ended_at is null;
end;
$$;

grant execute on function public.end_session(uuid) to authenticated;

-- Convenience view: today's seconds for the current user (using IST midnight)
create or replace function public.my_time_today()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(active_seconds, 0)
  from public.activity_time
  where user_id = auth.uid()
    and date = (now() at time zone 'Asia/Kolkata')::date;
$$;

grant execute on function public.my_time_today() to authenticated;

-- Week + month rollups for the current user (rolling 7 / current calendar month)
create or replace function public.my_time_summary()
returns table(today_secs integer, week_secs integer, month_secs integer)
language sql
security definer
stable
set search_path = public
as $$
  with d as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select
    coalesce((select active_seconds from public.activity_time, d
              where user_id = auth.uid() and date = d.today), 0) as today_secs,
    coalesce((select sum(active_seconds)::int from public.activity_time, d
              where user_id = auth.uid() and date >= d.today - 6 and date <= d.today), 0) as week_secs,
    coalesce((select sum(active_seconds)::int from public.activity_time, d
              where user_id = auth.uid()
                and date >= date_trunc('month', d.today)::date
                and date <= d.today), 0) as month_secs;
$$;

grant execute on function public.my_time_summary() to authenticated;
