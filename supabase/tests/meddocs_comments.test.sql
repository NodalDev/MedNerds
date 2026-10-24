-- ONLY disposable local/isolated database. NEVER run these synthetic Auth fixtures remotely.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok((select count(*)=6 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='mednerds_private' and c.relname like 'meddocs_%' and c.relrowsecurity),'All six tables have RLS');
select ok(not has_table_privilege('authenticated','mednerds_private.meddocs_comment_revisions','SELECT'),'No private revision SELECT');
select ok(not has_table_privilege('anon','mednerds_private.meddocs_comments','INSERT'),'No anonymous INSERT');
select ok(not has_function_privilege('anon','public.meddocs_comment_create(uuid,text,uuid,uuid)','EXECUTE'),'No anonymous submission RPC');
select ok(not has_function_privilege('authenticated','public.meddocs_articles_sync(jsonb)','EXECUTE'),'No browser catalog writes');
select ok((select count(*)=0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname like 'meddocs_comment%' and (not p.prosecdef or not('search_path=""'=any(p.proconfig)))),'Public RPCs secure definer/search path');

insert into auth.users(id,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111',clock_timestamp()),
 ('22222222-2222-4222-8222-222222222222',clock_timestamp()),
 ('33333333-3333-4333-8333-333333333333',clock_timestamp());
insert into auth.sessions(id,user_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333');
insert into public.staff_accounts(user_id,role,author_slug) values
 ('22222222-2222-4222-8222-222222222222','admin',null),
 ('33333333-3333-4333-8333-333333333333','author','orlando-frey');
update public.profiles set display_name='Test Admin' where user_id='22222222-2222-4222-8222-222222222222';
update public.profiles set display_name='Test Author' where user_id='33333333-3333-4333-8333-333333333333';
insert into public.account_legal_acceptances(user_id,terms_version,privacy_notice_version)
 select u.id,r.terms_version,r.privacy_notice_version from auth.users u cross join mednerds_private.account_legal_releases r
 where r.is_current and u.id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
insert into mednerds_private.meddocs_articles(id,locale,canonical_path,author_slugs,state,comments_enabled) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','de','/meddocs/ekg/demo/','{orlando-frey}','published',true),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','de','/meddocs/ekg/other/','{}','published',false);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Test','10000000-0000-4000-8000-000000000001')$$,'P0001','profile_required','NULL name cannot submit');
select throws_ok($$select * from mednerds_private.meddocs_comment_revisions$$,'42501',null,'No alternative private revision access');
select throws_ok($$select public.meddocs_comment_queue()$$,'P0001','forbidden','User cannot moderate/read queue');
reset role;
update public.profiles set display_name='Test User',professional_role='Administrator',professional_role_public=false where user_id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
select throws_ok($$select public.meddocs_comment_create('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Test','10000000-0000-4000-8000-000000000001')$$,'P0001','article_unavailable','Default-disabled article rejects writes');
select throws_ok($$select public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd',repeat('x',4001),'10000000-0000-4000-8000-000000000001')$$,'P0001','invalid_body','Server body limit');
select set_config('test.comments.user',public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Original','10000000-0000-4000-8000-000000000001')->>'id',true);
select is((public.meddocs_comments_mine('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'->0->>'status'),'pending','User premoderated');
select is(pg_catalog.jsonb_array_length(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'),0,'Pending not public');
select is(public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Original','10000000-0000-4000-8000-000000000001')->>'id',current_setting('test.comments.user'),'Create retry idempotent');
select throws_ok($$select public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Changed request','10000000-0000-4000-8000-000000000001')$$,'P0001','conflict','Request reuse with another body rejected');
reset role;
select is((select short_count from mednerds_private.meddocs_comment_limits where user_id='11111111-1111-4111-8111-111111111111'),1,'Retry does not charge twice');
select set_config('test.comments.revision',(select id::text from mednerds_private.meddocs_comment_revisions where comment_id=current_setting('test.comments.user')::uuid),true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.meddocs_comment_decide(current_setting('test.comments.revision')::uuid,'approve',1)$$,'Admin publishes exact revision');
select throws_ok($$select public.meddocs_comment_decide(current_setting('test.comments.revision')::uuid,'approve',1)$$,'P0001','conflict','Repeated decision conflicts');
select is(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'->0->>'body','Original','Approved text public');
select ok(not(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'->0 ? 'author_id'),'No public Auth UUID');
select ok(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'->0->>'professional_role' is null,'Unpublished profession stays private');
select ok(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'->0->>'role' is null,'Profession grants no role');
select throws_ok($$select public.meddocs_comment_edit(current_setting('test.comments.user')::uuid,'Foreign',2,'10000000-0000-4000-8000-000000000002')$$,'P0001','forbidden','Admin cannot edit others');
select set_config('test.comments.admin',public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Admin response','20000000-0000-4000-8000-000000000001',current_setting('test.comments.user')::uuid)->>'id',true);
select is(public.meddocs_comment_replies('dddddddd-dddd-4ddd-8ddd-dddddddddddd',current_setting('test.comments.user')::uuid)->'items'->0->>'body','Admin response','Admin new reply auto-published');
select lives_ok($$select public.meddocs_comment_edit(current_setting('test.comments.admin')::uuid,'Admin pending edit',1,'20000000-0000-4000-8000-000000000002')$$,'Admin edits also pending');
select is(public.meddocs_comment_replies('dddddddd-dddd-4ddd-8ddd-dddddddddddd',current_setting('test.comments.user')::uuid)->'items'->0->>'body','Admin response','Admin pending edit keeps publication');
reset role;
update mednerds_private.meddocs_articles set comments_enabled=true where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
set local role authenticated;
select throws_ok($$select public.meddocs_comment_create('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Cross article','20000000-0000-4000-8000-000000000003',current_setting('test.comments.user')::uuid)$$,'P0001','invalid_reply','Cross-article target rejected');
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.meddocs_comment_edit(current_setting('test.comments.user')::uuid,'New pending text',2,'10000000-0000-4000-8000-000000000002')$$,'Owner submits edit');
select is(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'->0->>'body','Original','Pending edit keeps old public text');
select throws_ok($$select public.meddocs_comment_edit(current_setting('test.comments.user')::uuid,'Lost update',2,'10000000-0000-4000-8000-000000000003')$$,'P0001','conflict','Stale version conflicts');
reset role;
select set_config('test.comments.edit',(select id::text from mednerds_private.meddocs_comment_revisions where comment_id=current_setting('test.comments.user')::uuid and status='pending'),true);
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.meddocs_comment_decide(current_setting('test.comments.edit')::uuid,'approve',3)$$,'P0001','forbidden','Author cannot moderate');
select throws_ok($$select public.meddocs_comment_audit(current_setting('test.comments.user')::uuid)$$,'P0001','forbidden','Author cannot read private history');
select is(pg_catalog.jsonb_array_length(public.meddocs_comments_mine('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'),0,'Other user cannot read pending edits through mine');
select is(public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Author pending','30000000-0000-4000-8000-000000000001')->>'status','pending','Author posts premoderated');
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.meddocs_comment_decide(current_setting('test.comments.edit')::uuid,'reject',3,'off_topic')$$,'Admin rejects edit');
select is(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'->0->>'body','Original','Rejected edit keeps publication');
select lives_ok($$select public.meddocs_comment_visibility(current_setting('test.comments.user')::uuid,'hide',4,'sensitive_data')$$,'Hide root');
select is(pg_catalog.jsonb_array_length(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'),0,'Hide excludes entire root');
select throws_ok($$select public.meddocs_comment_replies('dddddddd-dddd-4ddd-8ddd-dddddddddddd',current_setting('test.comments.user')::uuid)$$,'P0001','article_unavailable','Hidden root cannot leak replies');
select lives_ok($$select public.meddocs_comment_visibility(current_setting('test.comments.user')::uuid,'restore',5)$$,'Restore reviewed root');
reset role;

-- A second published contribution with pending replacements is purged by actual Auth DELETE,
-- not by a prior withdrawal. No production fixtures; local isolation only.
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
update mednerds_private.meddocs_comment_limits set short_window_started_at=clock_timestamp()-interval '61 seconds' where user_id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('test.comments.delete',public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Own published text for DELETE','10000000-0000-4000-8000-000000000005')->>'id',true);
reset role;
select set_config('test.comments.delete_rev',(select id::text from mednerds_private.meddocs_comment_revisions where comment_id=current_setting('test.comments.delete')::uuid),true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.meddocs_comment_decide(current_setting('test.comments.delete_rev')::uuid,'approve',1)$$,'Publish second contribution');
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.meddocs_comment_edit(current_setting('test.comments.delete')::uuid,'Private pending edit for DELETE',2,'10000000-0000-4000-8000-000000000006')$$,'Pending edit for deletion fixture');
select lives_ok($$select public.meddocs_comment_edit(current_setting('test.comments.delete')::uuid,'Private replacement for DELETE',3,'10000000-0000-4000-8000-000000000007')$$,'Replace pending with new revision');
reset role;
select is((select count(*)::int from mednerds_private.meddocs_comment_revisions where comment_id=current_setting('test.comments.delete')::uuid and status='pending'),1,'Exactly one pending');
select is((select count(*)::int from mednerds_private.meddocs_comment_revisions where comment_id=current_setting('test.comments.delete')::uuid and status='superseded'),1,'Old pending superseded');
select set_config('test.comments.delete_pending',(select id::text from mednerds_private.meddocs_comment_revisions where comment_id=current_setting('test.comments.delete')::uuid and status='pending'),true);
select throws_ok($$update mednerds_private.meddocs_comment_revisions set body='Rewritten' where id=current_setting('test.comments.delete_rev')::uuid$$,'23514','Immutable revision','Even maintenance cannot rewrite a revision');
select throws_ok($$update mednerds_private.meddocs_comments set parent_id=id,reply_to_id=id where id=current_setting('test.comments.delete')::uuid$$,'23514','Immutable comment identity','Structure immutable / cannot create cycles');
select throws_ok($$insert into mednerds_private.meddocs_comments(article_id,author_id,client_request_id,parent_id,reply_to_id) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111',gen_random_uuid(),current_setting('test.comments.admin')::uuid,current_setting('test.comments.admin')::uuid)$$,'23514','Invalid thread','Reply cannot become a parent');

delete from public.account_legal_acceptances where user_id='11111111-1111-4111-8111-111111111111';
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Without legal','10000000-0000-4000-8000-000000000004')$$,'P0001','legal_required','Current legal required');
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.meddocs_comment_decide(current_setting('test.comments.delete_pending')::uuid,'approve',4)$$,'P0001','legal_required','Approval rechecks contributor legal acceptance');
reset role;
update public.profiles set display_name=null where user_id='11111111-1111-4111-8111-111111111111';
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.meddocs_comment_withdraw(current_setting('test.comments.user')::uuid,6)$$,'Withdrawal independent of name/legal');
reset role;
select is((select count(*)::int from mednerds_private.meddocs_comment_revisions where comment_id=current_setting('test.comments.user')::uuid),0,'Withdrawal purges all own revisions');
select is((select count(*)::int from mednerds_private.meddocs_comment_moderation_events where comment_id=current_setting('test.comments.user')::uuid),0,'Withdrawal purges events');
delete from auth.users where id='11111111-1111-4111-8111-111111111111';
select ok((select author_id is null from mednerds_private.meddocs_comments where id=current_setting('test.comments.user')::uuid),'Deleted author cleared');
select is((select count(*)::int from mednerds_private.meddocs_comment_revisions where comment_id=current_setting('test.comments.delete')::uuid),0,'Auth DELETE purges published, pending and superseded text');
select is((select count(*)::int from mednerds_private.meddocs_comment_moderation_events where comment_id=current_setting('test.comments.delete')::uuid),0,'Auth DELETE purges own moderation events');
select ok((select author_id is null and published_revision_id is null and visibility='withdrawn' from mednerds_private.meddocs_comments where id=current_setting('test.comments.delete')::uuid),'Actual DELETE leaves only neutral structure');
select is((select count(*)::int from mednerds_private.meddocs_comments where id=current_setting('test.comments.admin')::uuid),1,'Other user reply survives');
select is((select count(*)::int from public.profiles where user_id='11111111-1111-4111-8111-111111111111'),0,'Deleted profile cascades');
select is((select count(*)::int from mednerds_private.meddocs_comment_limits where user_id='11111111-1111-4111-8111-111111111111'),0,'Deleted quota cascades');
select is((select count(*)::int from public.account_legal_acceptances where user_id='11111111-1111-4111-8111-111111111111'),0,'No retained deleted-user acceptances');
select throws_ok($$delete from auth.users where id='22222222-2222-4222-8222-222222222222'$$,'P0001','Last administrator cannot be deleted','Last admin protected');
select ok((select r.body='Admin response' from mednerds_private.meddocs_comments c join mednerds_private.meddocs_comment_revisions r on r.id=c.published_revision_id where c.id=current_setting('test.comments.admin')::uuid),'Blocked deletion rolls back cleanup');

select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}',true);
update mednerds_private.meddocs_comment_limits set short_count=3 where user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
select throws_ok($$select public.meddocs_comment_create('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Too many','30000000-0000-4000-8000-000000000002')$$,'P0001','rate_limited','Server quota enforced');
reset role;
delete from auth.sessions where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
select throws_ok($$select public.meddocs_comments_mine()$$,'P0001','authentication_required','Revoked session rejected even with JWT');
reset role;
set local role anon;
select is(public.meddocs_comments_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd')->'items'->0->>'display_name','Gelöschter Account','Public tombstone without personal name');
reset role;
set constraints all immediate;
-- Catalog sync is an upsert, never a destructive replacement. Fixtures stay isolated.
select set_config('test.comments.manifest','[{"id":"ffffffff-ffff-4fff-8fff-ffffffffffff","locale":"de","canonical_path":"/meddocs/ekg/catalog-fixture/","author_slugs":["orlando-frey"],"state":"published","comments_enabled":false}]',true);
set local role service_role;
select is(public.meddocs_articles_sync(current_setting('test.comments.manifest')::jsonb),1,'Operator imports supplied persistent UUID');
reset role;
select ok((select not comments_enabled from mednerds_private.meddocs_articles where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'New published article stays disabled');
select ok((select comments_enabled from mednerds_private.meddocs_articles where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'Partial manifest preserves omitted active article');
select is(public.meddocs_articles_sync('[]'),0,'Empty manifest is a no-op');
select ok((select comments_enabled from mednerds_private.meddocs_articles where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'Empty manifest does not deactivate');
select throws_ok($$select public.meddocs_articles_sync(null)$$,'22023',null,'Null manifest rejected');
select throws_ok($$select public.meddocs_articles_sync('[{}]')$$,'22023',null,'Missing fields rejected');
select throws_ok($$select public.meddocs_articles_sync(jsonb_set(current_setting('test.comments.manifest')::jsonb,'{0,comments_enabled}','true'))$$,'22023',null,'Manifest cannot activate writes');
select throws_ok($$select public.meddocs_articles_sync(current_setting('test.comments.manifest')::jsonb||current_setting('test.comments.manifest')::jsonb)$$,'22023',null,'Duplicate UUID/path rejected');
update mednerds_private.meddocs_articles set comments_enabled=true where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
select is(public.meddocs_articles_sync(jsonb_set(current_setting('test.comments.manifest')::jsonb,'{0,state}','"unpublished"')),1,'Explicit unpublish remains supported');
select ok((select state='unpublished' and not comments_enabled from mednerds_private.meddocs_articles where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'Unpublish disables writes');
select is(public.meddocs_articles_sync(current_setting('test.comments.manifest')::jsonb),1,'Regular sync remains possible');
select ok((select state='unpublished' and not comments_enabled from mednerds_private.meddocs_articles where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'Sync cannot reactivate unpublished article');
update mednerds_private.meddocs_articles set state='archived' where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
select is(public.meddocs_articles_sync(current_setting('test.comments.manifest')::jsonb),1,'Archived metadata can sync');
select is((select state from mednerds_private.meddocs_articles where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'archived','Archive survives sync');
select throws_ok($$select public.meddocs_articles_sync(jsonb_set(current_setting('test.comments.manifest')::jsonb,'{0,state}','"unpublished"')||'[{}]'::jsonb)$$,'22023',null,'Invalid trailing entry rolls back earlier upsert');
select is((select state from mednerds_private.meddocs_articles where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'archived','Invalid batch is atomic');
set local role authenticated;
select throws_ok($$select public.meddocs_articles_sync('[]')$$,'42501',null,'Authenticated browser cannot sync catalog');
reset role;
set local role anon;
select throws_ok($$select public.meddocs_articles_sync('[]')$$,'42501',null,'Anonymous browser cannot sync catalog');
reset role;

-- Fixed timestamps/UUIDs are inserted, never changed on existing comments.
insert into mednerds_private.meddocs_articles(id,locale,canonical_path,state,comments_enabled)
values('44444444-4444-4444-8444-444444444444','de','/meddocs/ekg/pagination-fixture/','published',false);
create temporary table comment_page_fixture(id uuid,parent_id uuid,created_at timestamptz);
insert into comment_page_fixture values
 ('41000000-0000-4000-8000-000000000001',null,'2026-10-10 12:00Z'),
 ('41000000-0000-4000-8000-000000000002',null,'2026-10-10 12:00Z'),
 ('41000000-0000-4000-8000-000000000003',null,'2026-10-10 11:00Z'),
 ('41000000-0000-4000-8000-000000000005','41000000-0000-4000-8000-000000000001','2026-10-10 13:00Z'),
 ('41000000-0000-4000-8000-000000000006','41000000-0000-4000-8000-000000000001','2026-10-10 13:00Z');
insert into mednerds_private.meddocs_comments(id,article_id,author_id,client_request_id,parent_id,reply_to_id,created_at)
select id,'44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',id,parent_id,parent_id,created_at
from comment_page_fixture order by parent_id nulls first,id;
insert into mednerds_private.meddocs_comment_revisions(id,comment_id,number,client_request_id,body,status,decided_at)
select id,id,1,id,'Chronological fixture','approved',created_at from comment_page_fixture;
update mednerds_private.meddocs_comments set published_revision_id=id,first_published_at=created_at,revision_number=1
where article_id='44444444-4444-4444-8444-444444444444';
set local role anon;
select set_config('test.comments.page',public.meddocs_comments_list('44444444-4444-4444-8444-444444444444',null,2,'oldest')::text,true);
select is(current_setting('test.comments.page')::jsonb->'items'->0->>'id','41000000-0000-4000-8000-000000000003','Roots oldest first');
select is(current_setting('test.comments.page')::jsonb->'items'->1->>'id','41000000-0000-4000-8000-000000000001','Timestamp ties use UUID');
select set_config('test.comments.page2',public.meddocs_comments_list('44444444-4444-4444-8444-444444444444',current_setting('test.comments.page')::jsonb->'next_cursor',2,'oldest')::text,true);
select is(current_setting('test.comments.page2')::jsonb->'items'->0->>'id','41000000-0000-4000-8000-000000000002','Exclusive cursor does not skip tied next root');
select is(jsonb_array_length(current_setting('test.comments.page2')::jsonb->'items'),1,'No duplicated roots on next page');
select ok(current_setting('test.comments.page2')::jsonb->'next_cursor'='null'::jsonb,'Last page has no next cursor');
select set_config('test.comments.reply_page',public.meddocs_comment_replies('44444444-4444-4444-8444-444444444444','41000000-0000-4000-8000-000000000001',null,1)::text,true);
select is(current_setting('test.comments.reply_page')::jsonb->'items'->0->>'id','41000000-0000-4000-8000-000000000005','Replies chronological with UUID tie');
select is(public.meddocs_comment_replies('44444444-4444-4444-8444-444444444444','41000000-0000-4000-8000-000000000001',current_setting('test.comments.reply_page')::jsonb->'next_cursor',1)->'items'->0->>'id','41000000-0000-4000-8000-000000000006','Reply cursor neither skips nor repeats tied replies');
reset role;
select * from finish();
rollback;
