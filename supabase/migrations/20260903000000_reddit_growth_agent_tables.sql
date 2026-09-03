-- Reddit Growth Agent: subreddit discovery + draft-and-approve engagement tables.

-- ── reddit_subreddits: Part A output — Jay promotes rows to control Part B scan set ──────────
create table if not exists public.reddit_subreddits (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                      -- no r/ prefix
  subscriber_count integer,
  active_user_count integer,
  posts_per_day numeric,
  keyword_hits integer default 0,
  category text check (category in ('la_local', 'interest_topic')),
  relevance_score numeric default 0,
  status text not null default 'candidate'
    check (status in ('candidate', 'watchlist', 'active', 'ignored')),
  notes text,
  last_scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reddit_subreddits is
  'Subreddits discovered and scored by the reddit-discover-subreddits cron. Jay promotes status to watchlist/active to enable Part B thread scanning.';

create index if not exists reddit_subreddits_status_idx on public.reddit_subreddits (status);
create index if not exists reddit_subreddits_score_idx on public.reddit_subreddits (relevance_score desc);

alter table public.reddit_subreddits enable row level security;
-- No policies: service role only.

-- ── reddit_matches: Part B — discovered thread + LLM draft + review state in one row ─────────
create table if not exists public.reddit_matches (
  id uuid primary key default gen_random_uuid(),
  subreddit_id uuid not null references public.reddit_subreddits (id) on delete cascade,
  reddit_post_id text not null unique,            -- Reddit t3_xxxxx fullname
  title text not null,
  url text not null,
  author text,
  body_snippet text,
  matched_keywords text[],
  posted_at timestamptz,
  discovered_at timestamptz not null default now(),
  draft_text text,
  edited_text text,                               -- null until Jay edits
  model text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'posted', 'rejected')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  posted_comment_id text,
  post_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reddit_matches is
  'Reddit threads matched by intent keywords. Each row holds the thread metadata, LLM draft, and Jay review state. Nothing posts until status=approved and reddit-post-comment is invoked.';

create index if not exists reddit_matches_status_idx on public.reddit_matches (status);
create index if not exists reddit_matches_subreddit_idx on public.reddit_matches (subreddit_id);
create index if not exists reddit_matches_discovered_idx on public.reddit_matches (discovered_at desc);

alter table public.reddit_matches enable row level security;
-- No policies: service role only.

-- ── reddit_oauth_account: connection status, no tokens stored here ────────────────────────────
create table if not exists public.reddit_oauth_account (
  id uuid primary key default gen_random_uuid(),
  reddit_username text not null,
  scopes text[],
  connected_at timestamptz,
  token_status text not null default 'connected'
    check (token_status in ('connected', 'expired', 'revoked')),
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.reddit_oauth_account is
  'Tracks Reddit OAuth connection status. Refresh token lives in Supabase Vault (reddit_refresh_token), not here.';

alter table public.reddit_oauth_account enable row level security;
-- No policies: service role only.
