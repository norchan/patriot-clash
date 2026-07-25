-- Profile post comments table
create table if not exists public.profile_comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid not null references public.profile_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  parent_comment_id uuid references public.profile_comments(id) on delete cascade,
  content text not null,
  score int default 0,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Comment votes table
create table if not exists public.profile_comment_votes (
  id uuid default gen_random_uuid() primary key,
  comment_id uuid not null references public.profile_comments(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  vote smallint not null check (vote in (-1, 0, 1)),
  created_at timestamp default now(),
  unique(comment_id, profile_id)
);

-- Index for faster queries
create index if not exists idx_profile_comments_post_id on public.profile_comments(post_id);
create index if not exists idx_profile_comments_parent_id on public.profile_comments(parent_comment_id);
create index if not exists idx_profile_comment_votes_comment_id on public.profile_comment_votes(comment_id);
