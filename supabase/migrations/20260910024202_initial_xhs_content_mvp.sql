create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.generation_status as enum ('idle', 'generating', 'completed', 'failed');
create type public.publish_status as enum ('draft', 'ready', 'publishing', 'published', 'failed');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '默认项目' check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.content_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  product_name text not null default '',
  category text not null default '',
  description text not null default '',
  selling_points text not null default '',
  target_audience text not null default '',
  price text,
  brand_name text,
  writing_style text not null default '真实分享',
  custom_style text,
  additional_info text,
  generation_status public.generation_status not null default 'idle',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete set null (project_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  title text not null default '',
  body text not null default '',
  hashtags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'final')),
  publish_status public.publish_status not null default 'draft',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id),
  unique (id, user_id),
  foreign key (task_id, user_id) references public.content_tasks(id, user_id) on delete cascade
);

create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status public.generation_status not null default 'generating',
  input_snapshot jsonb not null default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (task_id, user_id) references public.content_tasks(id, user_id) on delete cascade
);

create table public.post_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  generation_id uuid not null,
  version_number smallint not null check (version_number between 1 and 3),
  title text not null,
  body text not null,
  hashtags text[] not null default '{}',
  angle text not null,
  reasoning_summary text not null,
  is_final boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (generation_id, version_number),
  foreign key (task_id, user_id) references public.content_tasks(id, user_id) on delete cascade,
  foreign key (generation_id, user_id) references public.ai_generations(id, user_id) on delete cascade
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  storage_bucket text not null default 'product-assets',
  storage_path text not null,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 8388608),
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path),
  foreign key (task_id, user_id) references public.content_tasks(id, user_id) on delete cascade
);

create table public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null,
  provider text not null default 'xiaohongshu-manual',
  status public.publish_status not null default 'draft',
  external_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (post_id, user_id) references public.posts(id, user_id) on delete cascade
);

create index content_tasks_user_created_idx on public.content_tasks (user_id, created_at desc);
create index posts_user_updated_idx on public.posts (user_id, updated_at desc);
create index post_variants_task_idx on public.post_variants (task_id, created_at desc);
create index assets_task_idx on public.assets (task_id, created_at);
create index ai_generations_task_idx on public.ai_generations (task_id, created_at desc);
create index publishing_jobs_post_idx on public.publishing_jobs (post_id, created_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger projects_set_updated_at before update on public.projects for each row execute function private.set_updated_at();
create trigger content_tasks_set_updated_at before update on public.content_tasks for each row execute function private.set_updated_at();
create trigger posts_set_updated_at before update on public.posts for each row execute function private.set_updated_at();
create trigger ai_generations_set_updated_at before update on public.ai_generations for each row execute function private.set_updated_at();
create trigger post_variants_set_updated_at before update on public.post_variants for each row execute function private.set_updated_at();
create trigger publishing_jobs_set_updated_at before update on public.publishing_jobs for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.content_tasks enable row level security;
alter table public.posts enable row level security;
alter table public.post_variants enable row level security;
alter table public.assets enable row level security;
alter table public.ai_generations enable row level security;
alter table public.publishing_jobs enable row level security;

create policy profiles_owner_all on public.profiles for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy projects_owner_all on public.projects for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy content_tasks_owner_all on public.content_tasks for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy posts_owner_all on public.posts for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy post_variants_owner_all on public.post_variants for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy assets_owner_all on public.assets for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ai_generations_owner_all on public.ai_generations for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy publishing_jobs_owner_all on public.publishing_jobs for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.projects, public.content_tasks,
  public.posts, public.post_variants, public.assets, public.ai_generations, public.publishing_jobs to authenticated;
revoke all on public.profiles, public.projects, public.content_tasks,
  public.posts, public.post_variants, public.assets,
  public.ai_generations, public.publishing_jobs from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-assets', 'product-assets', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy product_assets_owner_select on storage.objects for select to authenticated
using (bucket_id = 'product-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy product_assets_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'product-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy product_assets_owner_update on storage.objects for update to authenticated
using (bucket_id = 'product-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'product-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy product_assets_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'product-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
