-- Add cross-posting support to profile_posts
alter table public.profile_posts
add column if not exists is_cross_post boolean default false,
add column if not exists source_gym_id uuid references public.gyms(id) on delete set null;

-- Index for finding cross-posts
create index if not exists idx_profile_posts_is_cross_post on public.profile_posts(is_cross_post);
create index if not exists idx_profile_posts_source_gym_id on public.profile_posts(source_gym_id);
