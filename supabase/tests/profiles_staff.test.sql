-- LOCAL ONLY: supabase test db. All synthetic fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok((select relrowsecurity from pg_class where oid='public.profiles'::regclass), 'Profiles RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.staff_accounts'::regclass), 'Staff RLS enabled');
select ok(not has_function_privilege('authenticated', 'mednerds_private.create_auth_profile()', 'EXECUTE'), 'Auth trigger not callable by users');
select ok(not has_schema_privilege('authenticated', 'mednerds_private', 'USAGE'), 'Private functions not exposed');

-- A and B: actual auth inserts run the registration trigger, with untrusted metadata.
insert into auth.users (id, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', '{"role":"admin","display_name":"Administrator","author_slug":"orlando-frey"}'),
  ('22222222-2222-4222-8222-222222222222', '{}');
select is((select count(*)::int from public.profiles where user_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')), 2, 'Registration creates profiles once');
select is((select display_name from public.profiles where user_id='11111111-1111-4111-8111-111111111111'), null::text, 'Metadata/name not copied');
select is((select count(*)::int from public.staff_accounts where user_id='11111111-1111-4111-8111-111111111111'), 0, 'Registration/metadata cannot assign staff');

-- Simulate a pre-migration Auth user, then run the migration's backfill twice.
-- test-profiles.mjs checks both statements match the versioned migration.
alter table auth.users disable trigger mednerds_auth_user_created;
insert into auth.users (id) values ('33333333-3333-4333-8333-333333333333');
alter table auth.users enable trigger mednerds_auth_user_created;
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;
select is((select count(*)::int from public.profiles where user_id='33333333-3333-4333-8333-333333333333'), 1, 'Backfill handles existing user idempotently');

-- Only privileged maintenance grants staff. B will be an app admin.
insert into public.staff_accounts (user_id, role, author_slug) values
  ('22222222-2222-4222-8222-222222222222', 'admin', 'orlando-frey');

set local role anon;
select throws_ok($$select * from public.profiles$$, '42501', null, 'Anon cannot read profiles');
select throws_ok($$update public.profiles set display_name='Demo'$$, '42501', null, 'Anon cannot edit profiles');
select throws_ok($$insert into public.profiles(user_id) values ('11111111-1111-4111-8111-111111111111')$$, '42501', null, 'Anon cannot insert profiles');
select throws_ok($$select * from public.staff_accounts$$, '42501', null, 'Anon cannot read staff');
select throws_ok($$insert into public.staff_accounts(user_id,role) values ('11111111-1111-4111-8111-111111111111','admin')$$, '42501', null, 'Anon cannot assign staff');
reset role;

select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.profiles), 1, 'A reads only own profile');
select is((select count(*)::int from public.staff_accounts), 0, 'A cannot read B staff row');
select lives_ok($$update public.profiles set display_name=U&'\3000Zoë Müller\00A0' where user_id='11111111-1111-4111-8111-111111111111'$$, 'A updates own Unicode name');
select is((select display_name from public.profiles), 'Zoë Müller', 'DB trims Unicode spaces');
select ok((select updated_at > created_at from public.profiles), 'DB updates timestamp on real change');
select set_config('test.profile_updated_at',(select updated_at::text from public.profiles),true);
select lives_ok($$update public.profiles set display_name='Zoë Müller'$$, 'No-op name update allowed');
select is((select updated_at::text from public.profiles),current_setting('test.profile_updated_at'), 'No-op preserves timestamp');
select results_eq($$update public.profiles set display_name='Forbidden' where user_id='22222222-2222-4222-8222-222222222222' returning user_id$$, $$select null::uuid where false$$, 'A cannot update B');
select throws_ok($$update public.profiles set user_id='22222222-2222-4222-8222-222222222222'$$, '42501', null, 'user_id column protected');
select throws_ok($$update public.profiles set created_at='2000-01-01'$$, '42501', null, 'created_at column protected');
select throws_ok($$update public.profiles set updated_at='2000-01-01'$$, '42501', null, 'updated_at column protected');
select throws_ok($$insert into public.profiles(user_id) values ('11111111-1111-4111-8111-111111111111')$$, '42501', null, 'Users cannot insert profiles');
select throws_ok($$delete from public.profiles$$, '42501', null, 'Users cannot delete profiles');
select throws_ok($$update public.profiles set display_name='A'$$, '23514', null, 'One character rejected');
select throws_ok($$update public.profiles set display_name=repeat('😀',61)$$, '23514', null, '61 Unicode code points rejected');
select throws_ok($$update public.profiles set display_name=E'A\nB'$$, '23514', null, 'Controls rejected before trim');
select throws_ok($$update public.profiles set display_name=U&'AB\202E'$$, '23514', null, 'Bidi controls rejected');
select lives_ok($$update public.profiles set display_name=repeat('😀',60)$$, '60 Unicode code points allowed');
select lives_ok($$update public.profiles set display_name='  '$$, 'Blank optional name cleared');
select is((select display_name from public.profiles),null::text,'Blank stored as NULL');
select lives_ok($$update public.profiles set display_name='Administrator'$$,'Display name Administrator is normal text');
select is((select count(*)::int from public.staff_accounts),0,'Name grants no staff privileges');
select throws_ok($$insert into public.staff_accounts(user_id,role) values ('11111111-1111-4111-8111-111111111111','author')$$,'42501',null,'No self-promotion to author');
select throws_ok($$insert into public.staff_accounts(user_id,role) values ('11111111-1111-4111-8111-111111111111','admin')$$,'42501',null,'No self-promotion to admin');
select throws_ok($$update public.staff_accounts set role='author'$$,'42501',null,'No staff edits, including foreign rows');
select throws_ok($$delete from public.staff_accounts$$,'42501',null,'No staff deletes');
reset role;

select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.profiles),1,'B reads only own profile');
select is((select role::text from public.staff_accounts),'admin','B reads own trusted staff role');
select is((select author_slug from public.staff_accounts),'orlando-frey','Staff mapping preserved');
select throws_ok($$update public.staff_accounts set role='author'$$,'42501',null,'App admin also cannot edit staff via browser');
select throws_ok($$delete from public.staff_accounts$$,'42501',null,'App admin cannot remove staff via browser');
reset role;

-- No authenticated context after logout; do not claim JWT revocation from UI state.
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select is((select count(*)::int from public.profiles),0,'No identity reads no profiles');
select results_eq($$update public.profiles set display_name='Forbidden' returning user_id$$,$$select null::uuid where false$$,'No identity edits no profiles');
reset role;
delete from auth.users where id='22222222-2222-4222-8222-222222222222';
select is((select count(*)::int from public.profiles where user_id='22222222-2222-4222-8222-222222222222'),0,'Auth delete cascades profile');
select is((select count(*)::int from public.staff_accounts where user_id='22222222-2222-4222-8222-222222222222'),0,'Auth delete cascades staff');
select * from finish();
rollback;
