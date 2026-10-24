-- ONLY disposable local database. No remote fixtures, even with ROLLBACK.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is((select provolatile::text from pg_proc
  where oid = 'public.account_deletion_authorize(uuid,uuid,uuid)'::regprocedure),
  'v','Clock-based final authorization is VOLATILE');
select ok((select p.prosecdef and p.provolatile = 'v'
  and has_table_privilege(p.proowner, 'public.staff_accounts', 'SELECT')
  and has_table_privilege(p.proowner, 'public.staff_accounts', 'UPDATE,DELETE,TRUNCATE')
  and (r.rolsuper or r.rolbypassrls or (c.relowner = p.proowner and not c.relforcerowsecurity))
  from pg_proc p join pg_roles r on r.oid = p.proowner
  cross join pg_class c
  where p.oid = 'mednerds_private.protect_last_account_admin()'::regprocedure
    and c.oid = 'public.staff_accounts'::regclass),
  'Guard owner can lock staff and see all administrators despite RLS');

insert into auth.users (id, email_confirmed_at) values
  ('77777777-7777-4777-8777-777777777777', clock_timestamp()),
  ('88888888-8888-4888-8888-888888888888', clock_timestamp());
insert into auth.sessions (id, user_id) values
  ('99999999-9999-4999-8999-999999999999','77777777-7777-4777-8777-777777777777');
insert into public.staff_accounts (user_id, role) values
  ('77777777-7777-4777-8777-777777777777','admin'),
  ('88888888-8888-4888-8888-888888888888','admin');
insert into public.account_legal_acceptances (user_id, terms_version, privacy_notice_version)
  select '77777777-7777-4777-8777-777777777777', terms_version, privacy_notice_version
  from mednerds_private.account_legal_releases where is_current;

set local role authenticated;
select throws_ok($$select public.account_deletion_begin('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999')$$,'42501',null,'Browser cannot mint deletion intent');
select throws_ok($$select * from mednerds_private.account_deletion_intents$$,'42501',null,'Browser cannot read intents');
reset role;
set local role anon;
select throws_ok($$select public.account_deletion_claim('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999')$$,'42501',null,'Anon cannot claim confirmation');
reset role;

select set_config('test.deletion.challenge',public.account_deletion_begin('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999')->>'challenge_id',true);
select ok(not public.account_deletion_claim('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Unsent intent unusable');
select ok(public.account_deletion_ready('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Server activates sent intent');
select ok(not public.account_deletion_claim('88888888-8888-4888-8888-888888888888','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Foreign user cannot claim');
select ok(not public.account_deletion_claim('77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888',current_setting('test.deletion.challenge')::uuid),'Different session cannot claim');
select ok(public.account_deletion_claim('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Atomic one-use claim');
select ok(not public.account_deletion_claim('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Replay rejected');
select ok(public.account_deletion_authorize('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Live consumed intent remains within expiry');
select ok(not public.account_deletion_authorize('88888888-8888-4888-8888-888888888888','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Final authorization rejects foreign user');
select ok(not public.account_deletion_authorize('77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888',current_setting('test.deletion.challenge')::uuid),'Final authorization rejects different session');
update mednerds_private.account_deletion_intents set expires_at = clock_timestamp() - interval '1 second';
select ok(not public.account_deletion_authorize('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Expired intent rejected after OTP');

-- A live JWT alone cannot revive the intent after logout deletes its session.
delete from auth.sessions where id = '99999999-9999-4999-8999-999999999999';
select is((select count(*)::int from mednerds_private.account_deletion_intents),0,'Session revocation cascades intent');
select ok(not public.account_deletion_authorize('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Revoked original session cannot authorize');

insert into auth.sessions (id, user_id) values
  ('99999999-9999-4999-8999-999999999999','77777777-7777-4777-8777-777777777777');
select set_config('test.deletion.challenge',public.account_deletion_begin('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999')->>'challenge_id',true);
select ok(public.account_deletion_ready('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'New session creates a separate intent');
update mednerds_private.account_deletion_intents set expires_at = clock_timestamp() - interval '1 second';
select ok(not public.account_deletion_claim('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999',current_setting('test.deletion.challenge')::uuid),'Expired unclaimed intent cannot be consumed');

delete from auth.users where id='77777777-7777-4777-8777-777777777777';
select is((select count(*)::int from public.profiles where user_id='77777777-7777-4777-8777-777777777777'),0,'Profile cascades');
select is((select count(*)::int from public.staff_accounts where user_id='77777777-7777-4777-8777-777777777777'),0,'Staff cascades');
select is((select count(*)::int from public.account_legal_acceptances where user_id='77777777-7777-4777-8777-777777777777'),0,'Legal evidence cascades');
select is((select count(*)::int from mednerds_private.account_deletion_intents),0,'Intents cascade');
select throws_ok($$delete from auth.users where id='88888888-8888-4888-8888-888888888888'$$,'P0001','Last administrator cannot be deleted','Last admin guarded in DELETE transaction');
select is((select role::text from public.staff_accounts where user_id='88888888-8888-4888-8888-888888888888'),'admin','Last administrator survives');
select * from finish();
rollback;
