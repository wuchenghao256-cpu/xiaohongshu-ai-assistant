-- Volcengine Ark (豆包 Seedance 2.0) video provider.
-- Image generation tables are intentionally untouched.

alter table public.ai_provider_configs drop constraint ai_provider_configs_provider_check;
alter table public.ai_provider_configs
  add constraint ai_provider_configs_provider_check
  check (provider in ('seedream', 'openai', 'google', 'custom', 'runway', 'volcengine'));

-- Let a video job stay in `queued` until the provider actually accepts the task,
-- and give it the fields needed to poll, time out and deduplicate submissions.
alter table public.video_jobs
  add column provider_status text,
  add column provider_meta jsonb,
  add column idempotency_key text,
  add column poll_attempts smallint not null default 0 check (poll_attempts between 0 and 1000),
  add column last_polled_at timestamptz,
  add column submitted_at timestamptz;

-- One job per user submission; the client sends a stable token so a double tap
-- or a retried request cannot create a second paid provider task.
create unique index video_jobs_idempotency_idx
  on public.video_jobs (user_id, idempotency_key)
  where idempotency_key is not null;

create index video_jobs_polling_idx
  on public.video_jobs (status, last_polled_at)
  where status in ('queued', 'generating');
