-- Hornbill Flight leaderboard.
--
-- Paste this into the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query) and run it once. Re-running is safe: every statement is guarded.
--
-- The game is a static site with no server of its own, so the browser talks
-- straight to PostgREST with the anon key. That key is public by design, which
-- means the table's own constraints and policies are the only thing standing
-- between the board and nonsense. Hence: no UPDATE or DELETE policy at all,
-- and CHECK constraints that reject scores a real run could not have produced.

create table if not exists public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stars integer not null,
  duration_seconds real not null,
  created_at timestamptz not null default now(),

  constraint leaderboard_name_length check (char_length(name) between 1 and 16),
  constraint leaderboard_stars_range check (stars >= 0 and stars <= 999),
  constraint leaderboard_duration_range check (duration_seconds > 0 and duration_seconds <= 3600),

  -- A run starts with 60 seconds and every 3 stars buys 10 more, so the clock
  -- a player can possibly have burned is bounded by their star count. This is
  -- what makes "999 stars in 4 seconds" impossible to post. The 5 second slack
  -- absorbs a long final frame on a machine that hitched. Integer division is
  -- deliberate -- it mirrors the game awarding a bonus per whole 3 stars.
  constraint leaderboard_duration_plausible
    check (duration_seconds <= 65 + (stars / 3) * 10)
);

-- The board is always read in rank order: most stars first, and among equal
-- star counts the run that stayed alive longest.
create index if not exists leaderboard_rank_idx
  on public.leaderboard (stars desc, duration_seconds desc);

alter table public.leaderboard enable row level security;

-- Anyone may read the board and post to it. Nobody may edit or remove an
-- entry: with no UPDATE or DELETE policy, row level security denies both.
drop policy if exists "Leaderboard is publicly readable" on public.leaderboard;
create policy "Leaderboard is publicly readable"
  on public.leaderboard for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone may post a score" on public.leaderboard;
create policy "Anyone may post a score"
  on public.leaderboard for insert
  to anon, authenticated
  with check (true);
