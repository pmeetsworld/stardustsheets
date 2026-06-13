create table if not exists public.dm_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default current_date,
  title text not null default '',
  notes_a text not null default '',
  notes_b text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dm_state (
  id text primary key default 'main',
  round integer not null default 1,
  combatants jsonb not null default '[]'::jsonb,
  encounter_notes text not null default '',
  backup_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dm_sessions enable row level security;
alter table public.dm_state enable row level security;

drop policy if exists "Anyone can view dm sessions" on public.dm_sessions;
drop policy if exists "Anyone can insert dm sessions" on public.dm_sessions;
drop policy if exists "Anyone can update dm sessions" on public.dm_sessions;
drop policy if exists "Anyone can view dm state" on public.dm_state;
drop policy if exists "Anyone can insert dm state" on public.dm_state;
drop policy if exists "Anyone can update dm state" on public.dm_state;

create policy "Anyone can view dm sessions"
on public.dm_sessions
for select
using (true);

create policy "Anyone can insert dm sessions"
on public.dm_sessions
for insert
with check (true);

create policy "Anyone can update dm sessions"
on public.dm_sessions
for update
using (true)
with check (true);

create policy "Anyone can view dm state"
on public.dm_state
for select
using (true);

create policy "Anyone can insert dm state"
on public.dm_state
for insert
with check (true);

create policy "Anyone can update dm state"
on public.dm_state
for update
using (true)
with check (true);

grant select, insert, update on public.dm_sessions to anon, authenticated;
grant select, insert, update on public.dm_state to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.dm_state;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.dm_sessions;
exception
  when duplicate_object then null;
end $$;
