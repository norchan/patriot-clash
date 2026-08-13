-- SECURITY: Supabase flagged public tables with RLS disabled — anyone with
-- the (public, shipped-in-the-client) anon key could read/write them via
-- PostgREST. Every one of these tables is accessed ONLY through the
-- service-role server client (which bypasses RLS), the browser does no direct
-- table reads (storage + broadcast channels only — audited 2026-08-11), so
-- enabling RLS with NO policies closes the hole with zero app impact.
alter table public.arcade_bests            enable row level security;
alter table public.bot_dm_queue            enable row level security;
alter table public.clique_bans             enable row level security;
alter table public.clique_members          enable row level security;
alter table public.clique_moderators       enable row level security;
alter table public.clique_pow_wow_guests   enable row level security;
alter table public.creator_earnings        enable row level security;
alter table public.creator_program         enable row level security;
alter table public.creator_withdrawals     enable row level security;
alter table public.enemy_spawn_gens        enable row level security;
alter table public.enemy_spawns            enable row level security;
alter table public.friendships             enable row level security;
alter table public.house_troop_queue       enable row level security;
alter table public.house_troops            enable row level security;
alter table public.profile_comment_votes   enable row level security;
alter table public.profile_comments        enable row level security;
alter table public.push_subscriptions      enable row level security;
alter table public.spawn_catches           enable row level security;
