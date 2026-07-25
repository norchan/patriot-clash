-- Add impressions column to profile_posts if it doesn't exist
alter table public.profile_posts
add column if not exists impressions int default 0;

-- Index for sorting by impressions
create index if not exists idx_profile_posts_impressions on public.profile_posts(impressions desc);
