create table public.content_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  product_category text,
  target_audience text,
  brand text,
  tone text,
  core_selling_points text,
  additional_info text,
  custom_instructions text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index content_templates_user_updated_idx
  on public.content_templates (user_id, updated_at desc);

create unique index content_templates_one_default_per_user_idx
  on public.content_templates (user_id)
  where is_default;

create function private.ensure_single_default_content_template()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.is_default then
    update public.content_templates
      set is_default = false
      where user_id = new.user_id
        and id <> new.id
        and is_default;
  end if;
  return new;
end;
$$;

create trigger content_templates_ensure_single_default
before insert or update of is_default on public.content_templates
for each row execute function private.ensure_single_default_content_template();

create trigger content_templates_set_updated_at
before update on public.content_templates
for each row execute function private.set_updated_at();

alter table public.content_templates enable row level security;

create policy content_templates_owner_select
on public.content_templates for select to authenticated
using ((select auth.uid()) = user_id);

create policy content_templates_owner_insert
on public.content_templates for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy content_templates_owner_update
on public.content_templates for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy content_templates_owner_delete
on public.content_templates for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.content_templates to authenticated;
revoke all on public.content_templates from anon;
