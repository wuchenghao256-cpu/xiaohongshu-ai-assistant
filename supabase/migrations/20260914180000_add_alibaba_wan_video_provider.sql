-- Alibaba Cloud Model Studio / DashScope (阿里云百炼) Wan2.7 image-to-video provider.
--
-- Two things make this provider different from Ark and Runway:
--   1. Its endpoint is per-workspace: https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com
--      The workspace id therefore has to travel with the provider config row.
--   2. Its credential is a platform DashScope key. Alibaba validates the key against the
--      workspace's *sub-account* binding, so a key pasted by an app user would fail at
--      submit time. The key is resolved from the server environment instead
--      (DASHSCOPE_API_KEY / DASHSCOPE_WORKSPACE_ID / DASHSCOPE_REGION); this migration
--      only stores the non-secret endpoint metadata.
--
-- Image generation tables are intentionally untouched.

alter table public.ai_provider_configs drop constraint ai_provider_configs_provider_check;
alter table public.ai_provider_configs
  add constraint ai_provider_configs_provider_check
  check (provider in ('seedream', 'openai', 'google', 'custom', 'runway', 'volcengine', 'alibaba'));

-- DashScope workspace id and region are endpoint coordinates, not secrets.
alter table public.ai_provider_configs
  add column workspace_id text check (workspace_id is null or char_length(workspace_id) between 3 and 64),
  add column region text check (region is null or char_length(region) between 4 and 40);

-- The public schema revokes default privileges, and 20260913032753 granted access with a
-- table-level `grant select, insert, update, delete` (no column list), which covers columns
-- added later. These explicit grants are therefore belt-and-braces: if that table-level grant
-- is ever replaced by a column list, a new column would silently become unreadable and the
-- settings page would break. RLS only decides *which rows* a role sees, never which columns.
grant select (workspace_id, region) on public.ai_provider_configs to authenticated;
grant insert (workspace_id, region) on public.ai_provider_configs to authenticated;
grant update (workspace_id, region) on public.ai_provider_configs to authenticated;
