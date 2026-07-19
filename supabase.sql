-- ═══════════════════════════════════════════════════════════════════
--  Ember — Phase 2 partner sync schema
--  Run this once in your Supabase project: SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Ember friend',
  updated_at timestamptz not null default now()
);

create table if not exists public.pairs (
  code text primary key,
  creator uuid not null references auth.users on delete cascade,
  partner uuid references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_summaries (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  done int not null default 0,
  total int not null default 0,
  streak int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.profiles enable row level security;
alter table public.pairs enable row level security;
alter table public.daily_summaries enable row level security;

-- Helper: are two users linked? SECURITY DEFINER so summary policies can
-- consult pairs without recursive RLS evaluation.
create or replace function public.is_paired(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pairs
    where (creator = a and partner = b) or (creator = b and partner = a)
  );
$$;

-- profiles: own row full access; paired partner may read
create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy "partner reads profile" on public.profiles
  for select using (public.is_paired(auth.uid(), id));

-- pairs: create your own; see your own; claim an open code; unlink
create policy "create pair" on public.pairs
  for insert with check (creator = auth.uid());
create policy "see own pairs" on public.pairs
  for select using (creator = auth.uid() or partner = auth.uid());
create policy "claim open pair" on public.pairs
  for update using (partner is null and creator <> auth.uid())
  with check (partner = auth.uid());
create policy "unlink pair" on public.pairs
  for delete using (creator = auth.uid() or partner = auth.uid());

-- daily_summaries: write your own; read your own or your partner's
create policy "insert own summary" on public.daily_summaries
  for insert with check (user_id = auth.uid());
create policy "update own summary" on public.daily_summaries
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "read own or partner summaries" on public.daily_summaries
  for select using (user_id = auth.uid() or public.is_paired(auth.uid(), user_id));
