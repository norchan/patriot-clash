-- Add impressions tracking to town hall posts
alter table public.hall_posts
add column if not exists impressions bigint default 0;

-- Add impressions tracking to direct messages
alter table public.direct_messages
add column if not exists impressions bigint default 0;

-- Indexes for sorting by impressions
create index if not exists idx_hall_posts_impressions on public.hall_posts(impressions desc);
create index if not exists idx_direct_messages_impressions on public.direct_messages(impressions desc);
