-- Local disposable DB only; never run this fixture suite on a linked project.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email_confirmed_at, raw_user_meta_data) values
  ('44444444-4444-4444-8444-444444444444', clock_timestamp(), '{"role":"admin"}'),
  ('55555555-5555-4555-8555-555555555555', clock_timestamp(), '{}'),
  ('66666666-6666-4666-8666-666666666666', null, '{}');
update public.profiles set display_name='Existing name' where user_id='44444444-4444-4444-8444-444444444444';
insert into public.staff_accounts (user_id, role) values ('55555555-5555-4555-8555-555555555555', 'admin');
select is((select display_name from public.profiles where user_id='44444444-4444-4444-8444-444444444444'),'Existing name','Existing display name remains usable');
select ok((select professional_role is null and not professional_role_public and avatar_provider='initials' from public.profiles where user_id='44444444-4444-4444-8444-444444444444'),'Safe profile defaults, Auth trigger still works');
select ok((select relrowsecurity from pg_class where oid='public.account_legal_acceptances'::regclass),'Legal acceptance RLS enabled');

set local role anon;
select is((public.get_account_legal_state()->>'accepted')::boolean,false,'Anon config never exposes another acceptance');
select throws_ok($$select * from public.profiles$$,'42501',null,'Anon cannot read profiles');
select throws_ok($$update public.profiles set professional_role='Test'$$,'42501',null,'Anon cannot update profiles');
select throws_ok($$select * from public.account_legal_acceptances$$,'42501',null,'Anon cannot read evidence');
select throws_ok($$select public.record_account_legal_acceptance('forged','forged')$$,'42501',null,'Anon cannot invoke acceptance writer');
reset role;

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$update public.profiles set professional_role=U&'\3000Assistenzärztin  Kardiologie\00A0', professional_role_public=true$$,'A edits own profession');
select is((select professional_role from public.profiles),'Assistenzärztin Kardiologie','DB normalizes Unicode profession spaces');
select ok((select professional_role_public from public.profiles),'A controls own profession visibility');
select set_config('test.phase21_updated_at',(select updated_at::text from public.profiles),true);
select lives_ok($$update public.profiles set avatar_provider='gravatar'$$,'A can save avatar preference');
select isnt((select updated_at::text from public.profiles),current_setting('test.phase21_updated_at'),'Avatar change updates timestamp');
select set_config('test.phase21_updated_at',(select updated_at::text from public.profiles),true);
select lives_ok($$update public.profiles set avatar_provider='gravatar'$$,'Same preference remains valid');
select is((select updated_at::text from public.profiles),current_setting('test.phase21_updated_at'),'No-op preserves timestamp');
select lives_ok($$update public.profiles set professional_role=' ', professional_role_public=true$$,'Empty profession is cleared');
select ok((select professional_role is null and not professional_role_public from public.profiles),'Empty profession is never public');
select throws_ok($$update public.profiles set professional_role=repeat('x',81)$$,'23514',null,'Overlong profession rejected');
select throws_ok($$update public.profiles set professional_role=E'A\nB'$$,'23514',null,'Profession controls rejected');
select throws_ok($$update public.profiles set professional_role=U&'AB\202E'$$,'23514',null,'Profession bidi controls rejected');
select throws_ok($$update public.profiles set avatar_provider='external-url'$$,'22P02',null,'Arbitrary provider rejected');
select results_eq($$update public.profiles set professional_role='Forbidden' where user_id='55555555-5555-4555-8555-555555555555' returning user_id$$,$$select null::uuid where false$$,'A cannot edit B profession');
select throws_ok($$update public.profiles set user_id='55555555-5555-4555-8555-555555555555'$$,'42501',null,'Stable identity still protected');
select throws_ok($$update public.profiles set created_at='2000-01-01'$$,'42501',null,'Created timestamp still protected');
select throws_ok($$update public.profiles set updated_at='2000-01-01'$$,'42501',null,'Updated timestamp still protected');
select throws_ok($$update public.staff_accounts set role='author'$$,'42501',null,'Staff still not editable');
select lives_ok($$update public.profiles set professional_role='Administrator'$$,'Unverified profession remains ordinary text');
select is((select count(*)::int from public.staff_accounts),0,'Profession and metadata grant no staff role');
select throws_ok($$insert into public.account_legal_acceptances(user_id,terms_version,privacy_notice_version) values ('55555555-5555-4555-8555-555555555555','forged','forged')$$,'42501',null,'No direct/foreign evidence insertion');
select throws_ok($$select public.record_account_legal_acceptance('forged','forged')$$,'22023',null,'Invented document versions rejected');
select lives_ok($$select public.record_account_legal_acceptance(public.get_account_legal_state()->>'terms_version',public.get_account_legal_state()->>'privacy_notice_version')$$,'Verified A records current documents');
select ok((select user_id='44444444-4444-4444-8444-444444444444' and accepted_at>='2026-01-01' from public.account_legal_acceptances),'Own ID and server timestamp recorded');
select set_config('test.phase21_accepted_at',(select accepted_at::text from public.account_legal_acceptances),true);
select lives_ok($$select public.record_account_legal_acceptance(public.get_account_legal_state()->>'terms_version',public.get_account_legal_state()->>'privacy_notice_version')$$,'Retry is idempotent');
select is((select accepted_at::text from public.account_legal_acceptances),current_setting('test.phase21_accepted_at'),'Retry does not rewrite timestamp');
select throws_ok($$update public.account_legal_acceptances set accepted_at='2000-01-01'$$,'42501',null,'Acceptance timestamp cannot be forged');
select throws_ok($$delete from public.account_legal_acceptances$$,'42501',null,'Evidence cannot be removed by browser');
select throws_ok($$update mednerds_private.account_legal_releases set gravatar_enabled=true$$,'42501',null,'Versions/activation remain privileged');
reset role;

select set_config('request.jwt.claims','{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.record_account_legal_acceptance(public.get_account_legal_state()->>'terms_version',public.get_account_legal_state()->>'privacy_notice_version')$$,'42501',null,'Unverified pre-OTP account cannot record acceptance');
reset role;

-- A newer release does not overwrite A's historic evidence or make it current.
update mednerds_private.account_legal_releases set is_current=false where is_current;
insert into mednerds_private.account_legal_releases (terms_version,privacy_notice_version,is_current)
values ('sha256:'||repeat('a',64),'sha256:'||repeat('b',64),true);
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_account_legal_state()->>'accepted')::boolean,false,'Historic acceptance is not proof of current release');
select is((select count(*)::int from public.account_legal_acceptances),1,'Historical evidence retained');
select throws_ok($$select public.record_account_legal_acceptance((select terms_version from public.account_legal_acceptances),(select privacy_notice_version from public.account_legal_acceptances))$$,'22023',null,'Old versions cannot be reaccepted as current');
reset role;

select set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.account_legal_acceptances),0,'B cannot read A evidence');
select throws_ok($$update public.staff_accounts set role='author'$$,'42501',null,'Application admin still cannot edit Staff');
reset role;
select is((select role::text from public.staff_accounts where user_id='55555555-5555-4555-8555-555555555555'),'admin','Existing staff assignment preserved');
select * from finish();
rollback;
