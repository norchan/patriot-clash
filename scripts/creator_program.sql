-- Creator program table
create table if not exists public.creator_program (
  id uuid default gen_random_uuid() primary key,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  agreed_to_terms boolean default false,
  status text default 'pending_kyc', -- pending_kyc, kyc_verified, active, suspended
  stripe_connect_id text, -- Stripe Connect account ID
  total_impressions bigint default 0,
  total_earnings numeric default 0.00,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Creator earnings tracking (per post/message)
create table if not exists public.creator_earnings (
  id uuid default gen_random_uuid() primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null, -- 'post', 'message', 'hall_post'
  content_id uuid not null,
  impressions bigint default 0,
  earnings_usd numeric default 0.00,
  status text default 'pending', -- pending, claimable (30+ days), claimed
  impression_date timestamp default now(),
  created_at timestamp default now()
);

-- Creator withdrawal requests
create table if not exists public.creator_withdrawals (
  id uuid default gen_random_uuid() primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount_usd numeric not null,
  status text default 'pending', -- pending, processing, completed, failed
  stripe_transfer_id text,
  created_at timestamp default now(),
  processed_at timestamp
);

-- Indexes for queries
create index if not exists idx_creator_program_profile_id on public.creator_program(profile_id);
create index if not exists idx_creator_program_status on public.creator_program(status);
create index if not exists idx_creator_earnings_profile_id on public.creator_earnings(profile_id);
create index if not exists idx_creator_earnings_status on public.creator_earnings(status);
create index if not exists idx_creator_earnings_date on public.creator_earnings(impression_date);
create index if not exists idx_creator_withdrawals_profile_id on public.creator_withdrawals(profile_id);
create index if not exists idx_creator_withdrawals_status on public.creator_withdrawals(status);
