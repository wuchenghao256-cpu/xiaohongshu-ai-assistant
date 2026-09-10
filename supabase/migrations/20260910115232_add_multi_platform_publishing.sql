create type public.publishing_platform as enum (
  'xiaohongshu',
  'douyin',
  'weibo',
  'wechat_moments'
);

create type public.connected_account_status as enum (
  'connected',
  'expired',
  'revoked',
  'error'
);

alter type public.publish_status add value if not exists 'queued';
alter type public.publish_status add value if not exists 'manual_required';
alter type public.publish_status add value if not exists 'connection_required';

create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform public.publishing_platform not null,
  platform_user_id text not null check (char_length(platform_user_id) between 1 and 255),
  display_name text check (display_name is null or char_length(display_name) <= 255),
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz,
  status public.connected_account_status not null default 'connected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, platform, platform_user_id)
);

comment on table public.connected_accounts is
  'Server-managed official platform connections. Token ciphertext columns are not selectable by authenticated clients.';
comment on column public.connected_accounts.access_token_encrypted is
  'Ciphertext only. Encryption and decryption must remain in a server-only token vault.';
comment on column public.connected_accounts.refresh_token_encrypted is
  'Ciphertext only. Encryption and decryption must remain in a server-only token vault.';

alter table public.publishing_jobs
  add column platform public.publishing_platform not null default 'xiaohongshu',
  add column account_id uuid,
  add column external_post_id text,
  add column published_at timestamptz,
  add constraint publishing_jobs_account_owner_fk
    foreign key (account_id, user_id)
    references public.connected_accounts(id, user_id)
    on delete set null (account_id);

update public.publishing_jobs
set external_post_id = external_id
where external_post_id is null and external_id is not null;

comment on column public.publishing_jobs.external_id is
  'Deprecated compatibility column. New provider integrations use external_post_id.';

create table public.platform_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null,
  platform public.publishing_platform not null,
  title text,
  body text,
  hashtags text[] not null default '{}',
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, platform),
  foreign key (post_id, user_id) references public.posts(id, user_id) on delete cascade
);

comment on table public.platform_variants is
  'Optional per-platform content derived from the canonical posts row. This migration does not generate variants.';

create index connected_accounts_user_platform_idx
  on public.connected_accounts (user_id, platform, status);
create index publishing_jobs_user_created_idx
  on public.publishing_jobs (user_id, created_at desc);
create index publishing_jobs_platform_status_idx
  on public.publishing_jobs (platform, status, created_at desc);
create index platform_variants_user_post_idx
  on public.platform_variants (user_id, post_id);

create trigger connected_accounts_set_updated_at
before update on public.connected_accounts
for each row execute function private.set_updated_at();

create trigger platform_variants_set_updated_at
before update on public.platform_variants
for each row execute function private.set_updated_at();

alter table public.connected_accounts enable row level security;
alter table public.platform_variants enable row level security;

create policy connected_accounts_owner_all
on public.connected_accounts for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy platform_variants_owner_all
on public.platform_variants for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on public.connected_accounts from anon, authenticated;
grant select (
  id,
  user_id,
  platform,
  platform_user_id,
  display_name,
  expires_at,
  status,
  created_at,
  updated_at
) on public.connected_accounts to authenticated;

grant select, insert, update, delete on public.platform_variants to authenticated;
revoke all on public.platform_variants from anon;
