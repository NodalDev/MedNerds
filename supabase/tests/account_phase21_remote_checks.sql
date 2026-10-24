-- Read-only operator checks; no fixtures, RPC writes or session/role changes.
-- Run manually in the confirmed project's privileged SQL Editor.
-- Section 1 works BEFORE and AFTER Phase 2.1. Save its aggregate baseline first.
-- Sections 2-8 are for AFTER migration. Expected rights are documented below.
-- No identities, emails, display names, profession values or secrets are output.
-- Catalog/aggregate checks do NOT replace isolated PostgreSQL/RLS attack tests.

-- 1. Compare before/after totals during a quiet maintenance window.
-- Equal counts do not prove individual names/assignments survived unchanged:
-- also manually verify an existing profile and admin in the account UI.
select
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.profiles where display_name is not null) as named_profiles,
  (select count(*) from public.staff_accounts) as staff_accounts,
  (select count(*) from public.staff_accounts where role = 'admin') as admins,
  (select count(*) from public.staff_accounts where role = 'author') as authors,
  (select count(*) from auth.users u where not exists
    (select 1 from public.profiles p where p.user_id = u.id)) as missing_profiles,
  (select count(*) from public.profiles p where not exists
    (select 1 from auth.users u where u.id = p.user_id)) as orphan_profiles,
  (select count(*) from public.staff_accounts s where not exists
    (select 1 from auth.users u where u.id = s.user_id)) as orphan_staff;

-- 2. All four relations must exist and have RLS enabled.
with expected(relation) as (values
  ('public.profiles'), ('public.staff_accounts'),
  ('public.account_legal_acceptances'), ('mednerds_private.account_legal_releases'))
select e.relation, c.oid is not null as exists, c.relrowsecurity as rls_enabled
from expected e left join pg_catalog.pg_class c on c.oid = pg_catalog.to_regclass(e.relation)
order by e.relation;

-- 3. Inspect column type/nullability/defaults. New profile defaults: false/initials.
-- Acceptance timestamps must default to server-side clock_timestamp().
select table_schema, table_name, column_name, data_type, udt_name,
  is_nullable, column_default
from information_schema.columns
where (table_schema = 'public' and table_name in
    ('profiles', 'staff_accounts', 'account_legal_acceptances'))
  or (table_schema = 'mednerds_private' and table_name = 'account_legal_releases')
order by table_schema, table_name, ordinal_position;

-- Own SELECT policies only; profiles also has own UPDATE USING + WITH CHECK.
-- There must be no browser write policy on staff/acceptances/releases.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where (schemaname = 'public' and tablename in
    ('profiles', 'staff_accounts', 'account_legal_acceptances'))
  or (schemaname = 'mednerds_private' and tablename = 'account_legal_releases')
order by schemaname, tablename, policyname;

-- 4. Every rights_match must be true. Table-level UPDATE on profiles stays false.
with expected(role_name, relation, privilege, allowed) as (values
  ('anon', 'public.profiles', 'SELECT', false),
  ('anon', 'public.staff_accounts', 'SELECT', false),
  ('anon', 'public.account_legal_acceptances', 'SELECT', false),
  ('authenticated', 'public.profiles', 'SELECT', true),
  ('authenticated', 'public.staff_accounts', 'SELECT', true),
  ('authenticated', 'public.account_legal_acceptances', 'SELECT', true)),
denied as (
  select r.role_name, t.relation, p.privilege, false as allowed
  from (values ('anon'), ('authenticated')) r(role_name)
  cross join (values ('public.profiles'), ('public.staff_accounts'),
    ('public.account_legal_acceptances'), ('mednerds_private.account_legal_releases')) t(relation)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
    ('REFERENCES'), ('TRIGGER')) p(privilege)
  union all
  select r.role_name, 'mednerds_private.account_legal_releases', 'SELECT', false
  from (values ('anon'), ('authenticated')) r(role_name)
), checks as (select * from expected union all select * from denied)
select role_name, relation, privilege, allowed as expected,
  pg_catalog.has_table_privilege(role_name, pg_catalog.to_regclass(relation), privilege) = allowed
    as rights_match
from checks order by role_name, relation, privilege;

-- Check effective column rights too: table-level denial alone is insufficient.
-- Only authenticated UPDATE on the four editable profile columns is allowed.
select r.role_name, n.nspname as schema_name, c.relname as table_name,
  a.attname as column_name, p.privilege,
  pg_catalog.has_column_privilege(r.role_name, c.oid, a.attnum, p.privilege) =
    (r.role_name = 'authenticated' and n.nspname = 'public' and c.relname = 'profiles'
      and p.privilege = 'UPDATE' and a.attname in
        ('display_name', 'professional_role', 'professional_role_public', 'avatar_provider'))
    as rights_match
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) r(role_name)
cross join (values ('INSERT'), ('UPDATE'), ('REFERENCES')) p(privilege)
where a.attnum > 0 and not a.attisdropped and
  ((n.nspname = 'public' and c.relname in ('profiles', 'staff_accounts', 'account_legal_acceptances'))
    or (n.nspname = 'mednerds_private' and c.relname = 'account_legal_releases'))
order by schema_name, table_name, role_name, column_name, privilege;

-- 5. Private schema must deny both roles USAGE/CREATE (both rights_match true).
select r.role_name, p.privilege,
  not pg_catalog.has_schema_privilege(r.role_name,
    pg_catalog.to_regnamespace('mednerds_private'), p.privilege) as rights_match
from (values ('anon'), ('authenticated')) r(role_name)
cross join (values ('USAGE'), ('CREATE')) p(privilege);

-- 6. All functions exist, safe empty search_path, expected definer mode.
-- PUBLIC execute must be false; public reader anon/auth true, writer auth only.
-- Both trigger functions must deny direct browser execution.
with expected(signature, definer, anon_execute, authenticated_execute) as (values
  ('public.get_account_legal_state()', true, true, true),
  ('public.record_account_legal_acceptance(text,text)', true, false, true),
  ('mednerds_private.prepare_profile()', false, false, false),
  ('mednerds_private.create_auth_profile()', true, false, false))
select e.signature, f.oid is not null as exists,
  f.prosecdef = e.definer as definer_matches,
  coalesce('search_path=""' = any(f.proconfig), false) as empty_search_path,
  not exists (select 1 from pg_catalog.aclexplode(coalesce(f.proacl,
    pg_catalog.acldefault('f', f.proowner))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as public_execute_denied,
  pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE') = e.anon_execute as anon_matches,
  pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE') = e.authenticated_execute
    as authenticated_matches
from expected e left join pg_catalog.pg_proc f on f.oid = pg_catalog.to_regprocedure(e.signature)
order by e.signature;

-- Auth creation and profile normalization triggers must remain enabled (O).
select n.nspname as schema_name, c.relname as table_name, t.tgname,
  t.tgenabled, pn.nspname as function_schema, p.proname as function_name
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal and
  ((n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'mednerds_auth_user_created')
    or (n.nspname = 'public' and c.relname = 'profiles' and t.tgname = 'profiles_prepare'));

-- 7. PKs, FKs, profile validation and exactly-one-current unique index.
select conrelid::regclass as relation, conname, contype,
  pg_catalog.pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint
where conrelid in (pg_catalog.to_regclass('public.profiles'),
  pg_catalog.to_regclass('public.staff_accounts'), pg_catalog.to_regclass('public.account_legal_acceptances'),
  pg_catalog.to_regclass('mednerds_private.account_legal_releases'))
order by relation, conname;

select indexname, indexdef from pg_catalog.pg_indexes
where schemaname = 'mednerds_private' and tablename = 'account_legal_releases';

-- 8. Exactly one active release; both hashes_match and global availability true.
-- Hashes represent the current development documents, not a public-launch approval.
select count(*) as active_releases,
  coalesce(bool_and(terms_version =
    'sha256:ed251cd66a339075f9a4fdaa59117e0a29c5aef2f88dd7198cd72b1cfab68784'), false) as terms_hash_matches,
  coalesce(bool_and(privacy_notice_version =
    'sha256:774a62462adf957c65d479c2ea0f7521dbd2e43925766e0709ffeff5d7114187'), false) as privacy_hash_matches,
  coalesce(bool_and(gravatar_enabled), false) as gravatar_available
from mednerds_private.account_legal_releases where is_current;
