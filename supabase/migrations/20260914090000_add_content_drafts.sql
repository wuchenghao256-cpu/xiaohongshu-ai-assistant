-- 「保存草稿」功能：生成结果页可以直接把一次生成沉淀成可回访的草稿。
-- 与 posts 的区别：posts 是「准备发布的内容」（一个任务一条，文案+状态为主），
-- content_drafts 保存的是完整的生成现场（参考图、成图、prompt、模板、风格预设），
-- 同一次任务可以保留多个草稿版本，因此用独立表而不是往 posts 加列。
create table public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 任务必填：草稿的「发布」动作复用 posts 流程，而 posts 需要 task_id。
  -- 生成流程本身已经先 ensureTask()，所以保存草稿时任务一定存在。
  task_id uuid not null,
  platform text not null default 'xiaohongshu',
  title text not null default '',
  body text not null default '',
  hashtags text[] not null default '{}',
  -- 生成现场：源图与成图都是 assets 行，删除素材时把引用置空而不是级联删草稿。
  source_asset_id uuid references public.assets(id) on delete set null,
  generated_asset_id uuid references public.assets(id) on delete set null,
  prompt text,
  template text,
  style_preset text,
  cover_url text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (task_id, user_id) references public.content_tasks(id, user_id) on delete cascade
);

create index content_drafts_user_updated_idx
  on public.content_drafts (user_id, updated_at desc);
create index content_drafts_user_status_idx
  on public.content_drafts (user_id, status, updated_at desc);

create trigger content_drafts_set_updated_at before update on public.content_drafts
  for each row execute function private.set_updated_at();

alter table public.content_drafts enable row level security;

create policy content_drafts_owner_all on public.content_drafts for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.content_drafts to authenticated;
grant all on public.content_drafts to service_role;
revoke all on public.content_drafts from anon;
