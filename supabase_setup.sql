-- ============================================================
-- BLE Transaction Tracker — Supabase setup (complete)
-- Developed by Sunny Gupta
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text not null,
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz default now(),
  last_login timestamptz
);

create table if not exists public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz default now(),
  ended_at timestamptz,
  active_seconds integer default 0
);

create table if not exists public.activity_time (
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  active_seconds integer default 0,
  updated_at timestamptz default now(),
  primary key (user_id, date)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  station_count integer,
  txn_total integer,
  ble_mapped integer,
  ble_pct numeric(5,2),
  customer_txn_total integer,
  state_count integer,
  data_final jsonb,
  data_state jsonb,
  data_txn jsonb,
  data_cust jsonb
);
create index if not exists idx_reports_user_created on public.reports(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.activity_sessions enable row level security;
alter table public.activity_time enable row level security;
alter table public.reports enable row level security;

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "read own profile" on public.profiles;
drop policy if exists "admin reads all profiles" on public.profiles;
drop policy if exists "admin updates profiles" on public.profiles;
drop policy if exists "admin deletes profiles" on public.profiles;
drop policy if exists "user updates own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);
create policy "admin reads all profiles" on public.profiles for select using (public.is_admin());
create policy "admin updates profiles" on public.profiles for update using (public.is_admin());
create policy "admin deletes profiles" on public.profiles for delete using (public.is_admin());
create policy "user updates own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "user reads own sessions" on public.activity_sessions;
drop policy if exists "user inserts own sessions" on public.activity_sessions;
drop policy if exists "user updates own sessions" on public.activity_sessions;
drop policy if exists "admin reads all sessions" on public.activity_sessions;
create policy "user reads own sessions" on public.activity_sessions for select using (auth.uid() = user_id);
create policy "user inserts own sessions" on public.activity_sessions for insert with check (auth.uid() = user_id);
create policy "user updates own sessions" on public.activity_sessions for update using (auth.uid() = user_id);
create policy "admin reads all sessions" on public.activity_sessions for select using (public.is_admin());

drop policy if exists "user reads own time" on public.activity_time;
drop policy if exists "user upserts own time" on public.activity_time;
drop policy if exists "user updates own time" on public.activity_time;
drop policy if exists "admin reads all time" on public.activity_time;
create policy "user reads own time" on public.activity_time for select using (auth.uid() = user_id);
create policy "user upserts own time" on public.activity_time for insert with check (auth.uid() = user_id);
create policy "user updates own time" on public.activity_time for update using (auth.uid() = user_id);
create policy "admin reads all time" on public.activity_time for select using (public.is_admin());

drop policy if exists "user reads own reports" on public.reports;
drop policy if exists "user inserts own reports" on public.reports;
drop policy if exists "user deletes own reports" on public.reports;
drop policy if exists "admin reads all reports" on public.reports;
drop policy if exists "admin deletes any report" on public.reports;
create policy "user reads own reports" on public.reports for select using (auth.uid() = user_id);
create policy "user inserts own reports" on public.reports for insert with check (auth.uid() = user_id);
create policy "user deletes own reports" on public.reports for delete using (auth.uid() = user_id);
create policy "admin reads all reports" on public.reports for select using (public.is_admin());
create policy "admin deletes any report" on public.reports for delete using (public.is_admin());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'user')
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.promote_to_admin(target_email text)
returns void language plpgsql security definer as $$
begin
  update public.profiles set role = 'admin' where email = target_email;
end; $$;

create or replace function public.cleanup_old_reports()
returns integer language plpgsql security definer as $$
declare deleted_count integer;
begin
  delete from public.reports where created_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end; $$;

grant execute on function public.cleanup_old_reports() to authenticated;
