-- ============================================================================
-- VIDEO PERSISTENCE REPAIR — PREFLIGHT (READ-ONLY)
-- ----------------------------------------------------------------------------
-- Purpose: capture the true Production schema before designing the repair
-- migration. Every statement below is a read. No DDL, no DML, no long locks.
-- Safe to run in the Supabase SQL Editor against Production.
--
-- HOW TO RUN: paste this whole file and execute it once. The SQL Editor returns
-- one result grid per statement. Please paste back EVERY grid, in order.
-- An empty grid is itself an answer ("this object does not exist") — do not
-- skip empty grids.
--
-- Every statement is written so it CANNOT error on a partially-migrated schema:
-- object existence is probed with to_regclass() and the catalogs, never by
-- naming a table directly. That matters because the SQL Editor issues the whole
-- script as one implicit transaction — a single error would silently abort
-- every statement after it, and we would get a truncated picture without
-- knowing it. All identifiers are fully qualified (public.*, storage.*), so this
-- works regardless of the Editor's active search_path.
--
-- The bracketed numbers [1a] are query ids. Please keep them when sending
-- results back so I can map answers to questions.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — Enum `media_job_status`
-- ============================================================================

-- [1a] Does the enum type exist, and in which schema?
--      Expected: one row (public.media_job_status) or zero rows.
select n.nspname as schema_name,
       t.typname   as enum_name,
       t.oid       as enum_oid
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where t.typname = 'media_job_status';


-- [1b] If it exists: which labels, in what order?
--      Required end state: queued / generating / completed / failed / never_accepted
--      Labels can only be ADDED (ALTER TYPE ... ADD VALUE); they cannot be
--      removed or reordered without rebuilding the type.
select e.enumlabel,
       e.enumsortorder
from pg_enum e
join pg_type t on t.oid = e.enumtypid
join pg_namespace n on n.oid = t.typnamespace
where t.typname = 'media_job_status'
order by e.enumsortorder;


-- [1c] *** THE DECIDING QUERY ***
--      Which table columns are actually typed as media_job_status?
--      Any row here means the enum IS in use and must be extended, never dropped.
select n.nspname    as table_schema,
       c.relname    as table_name,
       a.attname    as column_name,
       a.attnotnull as not_null,
       pg_get_expr(d.adbin, d.adrelid) as default_expr
from pg_attribute a
join pg_class c      on c.oid = a.attrelid
join pg_namespace n  on n.oid = c.relnamespace
join pg_type t       on t.oid = a.atttypid
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where t.typname = 'media_job_status'
  and a.attnum > 0
  and not a.attisdropped
order by n.nspname, c.relname, a.attnum;


-- [1d] Non-column dependents of the enum type itself (functions, domains,
--      composite types, casts). Normally empty. If non-empty, dropping is
--      even more clearly off the table.
select pg_describe_object(d.classid, d.objid, d.objsubid) as dependent_object,
       d.deptype
from pg_depend d
join pg_type t on t.oid = d.refobjid
where t.typname = 'media_job_status'
  and d.refclassid = 'pg_type'::regclass
  and d.deptype in ('n', 'a');


-- ============================================================================
-- SECTION 2 — Do the media/video tables exist?
-- ============================================================================

-- [2a] Existence summary. NULL / false = does not exist.
--      NOTE: 20260913072247 created `image_child_jobs`, NOT `media_child_jobs`.
--      Both spellings are probed so we can tell a rename from an absence.
select probe.object_name,
       to_regclass(probe.object_name) as resolved,
       (to_regclass(probe.object_name) is not null) as object_exists
from (values
  ('public.video_jobs'),
  ('public.video_assets'),
  ('public.image_batch_jobs'),
  ('public.image_child_jobs'),
  ('public.media_child_jobs'),
  ('public.assets'),
  ('public.content_tasks'),
  ('public.ai_provider_configs')
) as probe(object_name)
order by probe.object_name;


-- [2b] Columns of whichever of those job tables DO exist.
--      Compare against what 20260913120000_add_seedance_video_provider adds:
--        provider_status, provider_meta, idempotency_key, poll_attempts,
--        last_polled_at, submitted_at
--      ...and what 20260914120000 requires the enum to carry: never_accepted.
select c.relname  as table_name,
       a.attname  as column_name,
       format_type(a.atttypid, a.atttypmod) as data_type,
       a.attnotnull as not_null,
       pg_get_expr(d.adbin, d.adrelid) as default_expr
from pg_attribute a
join pg_class c      on c.oid = a.attrelid
join pg_namespace n  on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public'
  and c.relname in ('video_jobs', 'video_assets', 'image_batch_jobs',
                    'image_child_jobs', 'media_child_jobs')
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attnum;


-- ============================================================================
-- SECTION 3 — Constraints, indexes, triggers, RLS on those tables
-- ============================================================================

-- [3a] PKs, unique constraints, check constraints, and FKs.
--      The FK definitions matter because image_child_jobs -> assets(asset_id)
--      is a SINGLE-column FK, and uq_asset_owner lives on the same table.
select c.relname   as table_name,
       con.conname as constraint_name,
       con.contype as kind,   -- p=PK  u=unique  f=FK  c=check
       pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class c     on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('video_jobs', 'video_assets', 'image_batch_jobs',
                    'image_child_jobs', 'media_child_jobs')
order by c.relname, con.contype, con.conname;


-- [3b] All indexes, including the partial/filtered ones added later.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('video_jobs', 'video_assets', 'image_batch_jobs',
                    'image_child_jobs', 'media_child_jobs')
order by tablename, indexname;


-- [3c] Triggers (updated_at maintenance).
select c.relname as table_name,
       t.tgname  as trigger_name,
       pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
join pg_class c     on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('video_jobs', 'video_assets', 'image_batch_jobs',
                    'image_child_jobs', 'media_child_jobs')
  and not t.tgisinternal
order by c.relname, t.tgname;


-- [3d] Is RLS enabled, and which policies exist?
select c.relname      as table_name,
       c.relrowsecurity as rls_enabled,
       p.polname      as policy_name,
       p.polcmd       as command,  -- r=select a=insert w=update d=delete *=all
       pg_get_expr(p.polqual, p.polrelid)      as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_class c
join pg_namespace n  on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('video_jobs', 'video_assets', 'image_batch_jobs',
                    'image_child_jobs', 'media_child_jobs')
order by c.relname, p.polname;


-- [3e] Table-level GRANTs for these tables. The app runs as `authenticated`
--      (cookie session client), never service_role, so a missing grant fails
--      independently of RLS.
select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('video_jobs', 'video_assets', 'image_batch_jobs',
                     'image_child_jobs', 'media_child_jobs')
group by table_name, grantee
order by table_name, grantee;


-- ============================================================================
-- SECTION 4 — Storage: bucket + object policies
-- ============================================================================

-- [4a] Which buckets exist at all? Wanted: video-assets present with public=false.
select id, name, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets
order by id;


-- [4b] Every policy on storage.objects, so we can see exactly which video-assets
--      policies exist and whether our intended policy names are already taken.
select pol.polname as policy_name,
       pol.polcmd  as command,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr,
       (select string_agg(r.rolname, ', ')
          from unnest(pol.polroles) AS role_oid
          join pg_roles r on r.oid = role_oid) as roles
from pg_policy pol
where pol.polrelid = 'storage.objects'::regclass
order by pol.polname;


-- [4c] Is RLS enabled on storage.objects? (Supabase manages this; sanity read
--      only — do not change it.)
select (select relrowsecurity
          from pg_class
         where oid = 'storage.objects'::regclass) as storage_objects_rls_enabled;


-- ============================================================================
-- SECTION 5 — Prerequisites / collateral
-- ============================================================================

-- [5a] Does the private helper used by the updated_at triggers exist?
select n.nspname as schema_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'set_updated_at';


-- [5b] Sanity check that no shared helper is entangled with the media enum.
select pg_describe_object(d.classid, d.objid, d.objsubid) as dependent_object
from pg_depend d
join pg_proc p      on p.oid = d.objid
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
  and p.proname = 'set_updated_at'
  and d.classid = 'pg_proc'::regclass
  and d.deptype = 'n';


-- [5c] Did the OTHER migrations in the 20260913/20260914 batch land? Tells us
--      whether the failure was isolated to the media/video file or the whole
--      batch never ran.
select probe.object_name,
       (to_regclass(probe.object_name) is not null) as object_exists
from (values
  ('public.ai_provider_configs'),
  ('public.connected_accounts'),
  ('public.publishing_jobs'),
  ('public.content_drafts')
) as probe(object_name)
order by probe.object_name;


-- [5d] Which provider labels does ai_provider_configs currently allow?
--      20260913120000 and 20260914180000 both rewrote this constraint for video
--      providers (volcengine / alibaba). If the table exists but the constraint
--      is still the pre-video version, those migrations did not land either.
select con.conname as constraint_name,
       pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class c     on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'ai_provider_configs'
  and con.contype = 'c';


-- [5e] Is a migration ledger present? (Probe only — this query cannot error.
--      If it returns non-null, also run the follow-up below on its own.)
select to_regclass('supabase_migrations.schema_migrations') as ledger_table;


-- [5f] FOLLOW-UP — run this separately, and ONLY if [5e] returned a table name.
--      Hand-applied projects usually have no ledger; an error here is
--      expected and harmless, but it is why this is not part of the batch.
-- select * from supabase_migrations.schema_migrations order by version;
