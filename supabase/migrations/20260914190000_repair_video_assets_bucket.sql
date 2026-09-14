-- 创建 video-assets bucket，与现有视频保存代码的要求完全对齐。
--
-- 背景：20260913072247_add_media_generation_jobs.sql 里已经写过这个 bucket，
-- 但那条迁移的其余部分并未在数据库里生效 —— 实测 Production 上
-- storage.buckets 为空，且 public.video_assets 表不存在（errno 42P01），
-- 说明它整体回滚了（最可能是 create type media_job_status 已存在的报错）。
-- 因此这里不假设它跑过，独立重建 bucket 与 policy。
--
-- 与 20260913072247 的差异说明（如果那条以后被补跑，内容需与本题一致）：
-- 对象路径形如 {auth.uid()}/{uuid}.mp4，点号在 Storage 允许的 key 字符集内，
-- 原样保留即可。

-- 1) bucket 本体 -------------------------------------------------------------
-- private（public = false）。不要改成 true：一旦公开，任何人拿到 URL 就能
-- 永久访问别人的 AI 视频，而 private + 签名链接同样能满足播放需求。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-assets', 'video-assets', false, 104857600, array['video/mp4', 'video/webm'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2) Storage RLS -------------------------------------------------------------
-- 路径约定：第一段目录名必须等于当前用户 id。
-- save 路由用 cookie 会话客户端（requireUser → createClient，不是 service_role），
-- 上传以 authenticated 身份执行，必须靠这些 policy 放行。
-- 客户端播放走 createSignedUrl，签名读**不受** RLS 约束，因此无需为匿名角色开口子。
--
-- drop + create 既能在空库上跑，也能覆盖 20260913072247 若已建过的同名 policy。
drop policy if exists video_assets_storage_owner_select on storage.objects;
drop policy if exists video_assets_storage_owner_insert on storage.objects;
drop policy if exists video_assets_storage_owner_update on storage.objects;
drop policy if exists video_assets_storage_owner_delete on storage.objects;

create policy video_assets_storage_owner_select on storage.objects for select to authenticated
using (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy video_assets_storage_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy video_assets_storage_owner_update on storage.objects for update to authenticated
using (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy video_assets_storage_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'video-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
