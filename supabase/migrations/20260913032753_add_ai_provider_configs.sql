create table public.ai_provider_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('text', 'image')),
  provider text not null check (provider in ('seedream', 'openai', 'google', 'custom')),
  model text not null check (char_length(model) between 1 and 200),
  base_url text not null check (char_length(base_url) between 8 and 500),
  api_key_encrypted text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, provider)
);

create unique index ai_provider_configs_one_enabled_per_category_idx
  on public.ai_provider_configs (user_id, category) where enabled;
create index ai_provider_configs_user_category_idx
  on public.ai_provider_configs (user_id, category, updated_at desc);

create function private.ensure_single_enabled_ai_provider()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.enabled then
    update public.ai_provider_configs set enabled = false
      where user_id = new.user_id and category = new.category and id <> new.id and enabled;
  end if;
  return new;
end;
$$;

create trigger ai_provider_configs_ensure_single_enabled
before insert or update of enabled on public.ai_provider_configs
for each row execute function private.ensure_single_enabled_ai_provider();

create trigger ai_provider_configs_set_updated_at
before update on public.ai_provider_configs
for each row execute function private.set_updated_at();

alter table public.ai_provider_configs enable row level security;

create policy ai_provider_configs_owner_select on public.ai_provider_configs
for select to authenticated using ((select auth.uid()) = user_id);
create policy ai_provider_configs_owner_insert on public.ai_provider_configs
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ai_provider_configs_owner_update on public.ai_provider_configs
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy ai_provider_configs_owner_delete on public.ai_provider_configs
for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.ai_provider_configs from anon, authenticated;
grant select, insert, update, delete on public.ai_provider_configs to authenticated;
grant all on public.ai_provider_configs to service_role;
