alter table public.ai_provider_configs drop constraint ai_provider_configs_category_check;
alter table public.ai_provider_configs drop constraint ai_provider_configs_provider_check;
alter table public.ai_provider_configs
  add constraint ai_provider_configs_category_check check (category in ('text', 'image', 'video')),
  add constraint ai_provider_configs_provider_check check (provider in ('seedream', 'openai', 'google', 'custom', 'runway')),
  add column quality_model text check (quality_model is null or char_length(quality_model) between 1 and 200);

create type public.media_job_status as enum ('queued', 'generating', 'completed', 'failed');

create table public.image_batch_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  status public.media_job_status not null default 'queued',
  request_snapshot jsonb not null default '{}',
  total_count smallint not null check (total_count between 1 and 4),
  completed_count smallint not null default 0,
  failed_count smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (task_id, user_id) references public.content_tasks(id, user_id) on delete cascade
);

create table public.image_child_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  position smallint not null check (position between 1 and 4),
  status public.media_job_status not null default 'queued',
  attempts smallint not null default 0 check (attempts between 0 and 3),
  asset_id uuid references public.assets(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, position),
  foreign key (batch_id, user_id) references public.image_batch_jobs(id, user_id) on delete cascade,
  foreign key (task_id, user_id) references public.content_tasks(id, user_id) on delete cascade
);

create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image_to_video', 'product_ad', 'product_ugc')),
  status public.media_job_status not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  provider text not null default 'runway',
  external_task_id text,
  input_snapshot jsonb not null default '{}',
  output_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id)
);

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_job_id uuid not null,
  storage_bucket text not null default 'video-assets',
  storage_path text not null,
  original_name text not null,
  mime_type text not null default 'video/mp4',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path),
  unique (video_job_id),
  foreign key (video_job_id, user_id) references public.video_jobs(id, user_id) on delete cascade
);

create index image_batch_jobs_user_task_idx on public.image_batch_jobs (user_id, task_id, created_at desc);
create index image_child_jobs_batch_idx on public.image_child_jobs (batch_id, position);
create index video_jobs_user_created_idx on public.video_jobs (user_id, created_at desc);

create trigger image_batch_jobs_set_updated_at before update on public.image_batch_jobs for each row execute function private.set_updated_at();
create trigger image_child_jobs_set_updated_at before update on public.image_child_jobs for each row execute function private.set_updated_at();
create trigger video_jobs_set_updated_at before update on public.video_jobs for each row execute function private.set_updated_at();

alter table public.image_batch_jobs enable row level security;
alter table public.image_child_jobs enable row level security;
alter table public.video_jobs enable row level security;
alter table public.video_assets enable row level security;

create policy image_batch_jobs_owner_all on public.image_batch_jobs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy image_child_jobs_owner_all on public.image_child_jobs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy video_jobs_owner_all on public.video_jobs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy video_assets_owner_all on public.video_assets for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.image_batch_jobs, public.image_child_jobs,
  public.video_jobs, public.video_assets to authenticated;
grant all on public.image_batch_jobs, public.image_child_jobs, public.video_jobs, public.video_assets to service_role;
revoke all on public.image_batch_jobs, public.image_child_jobs, public.video_jobs, public.video_assets from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-assets', 'video-assets', false, 104857600, array['video/mp4', 'video/webm'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy video_assets_storage_owner_select on storage.objects for select to authenticated
using (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy video_assets_storage_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy video_assets_storage_owner_update on storage.objects for update to authenticated
using (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy video_assets_storage_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
