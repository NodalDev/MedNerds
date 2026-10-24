-- Disposable local Supabase only, after all migrations. Never Production fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_table_privilege('authenticated','mednerds_private.meddocs_comment_upvotes','SELECT'),'No voter identity access');
select ok(not has_table_privilege('authenticated','mednerds_private.meddocs_comment_upvotes','INSERT'),'No direct votes');
select ok(not has_function_privilege('anon','public.meddocs_comment_upvote(uuid,boolean)','EXECUTE'),'Guests cannot vote');
select ok((select relrowsecurity from pg_class where oid='mednerds_private.meddocs_comment_upvotes'::regclass),'Votes have RLS');

insert into auth.users(id,email_confirmed_at) values
 ('61000000-0000-4000-8000-000000000001',clock_timestamp()),
 ('61000000-0000-4000-8000-000000000002',clock_timestamp());
insert into auth.sessions(id,user_id) select id,id from auth.users where id in
 ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002');
update public.profiles set display_name='Vote fixture' where user_id in
 ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002');
insert into public.account_legal_acceptances(user_id,terms_version,privacy_notice_version)
 select u.id,r.terms_version,r.privacy_notice_version from auth.users u cross join mednerds_private.account_legal_releases r
 where r.is_current and u.id in ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002');
insert into mednerds_private.meddocs_articles(id,locale,canonical_path,state,comments_enabled)
 values('62000000-0000-4000-8000-000000000001','de','/meddocs/ekg/vote-fixture/','published',true);
insert into mednerds_private.meddocs_comments(id,article_id,author_id,client_request_id,created_at)
 select ('63000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'62000000-0000-4000-8000-000000000001',
 '61000000-0000-4000-8000-000000000001',gen_random_uuid(),'2026-10-01 00:00Z'::timestamptz from generate_series(1,4) i;
insert into mednerds_private.meddocs_comment_revisions(id,comment_id,number,client_request_id,body,status,decided_at)
 select id,id,1,gen_random_uuid(),'Published fixture','approved','2026-10-02 00:00Z'::timestamptz
 from mednerds_private.meddocs_comments where article_id='62000000-0000-4000-8000-000000000001';
update mednerds_private.meddocs_comments set published_revision_id=id,revision_number=1,
 first_published_at=case when id='63000000-0000-4000-8000-000000000001' then '2026-10-03 00:00Z'::timestamptz else '2026-10-02 00:00Z'::timestamptz end
 where article_id='62000000-0000-4000-8000-000000000001';
-- A genuinely private pending contribution, not a pending edit of approved text.
insert into mednerds_private.meddocs_comments(id,article_id,author_id,client_request_id)
 values('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',gen_random_uuid());
insert into mednerds_private.meddocs_comment_revisions(comment_id,number,client_request_id,body,status)
 values('64000000-0000-4000-8000-000000000001',1,gen_random_uuid(),'Private pending fixture','pending');
insert into mednerds_private.meddocs_comments(id,article_id,author_id,client_request_id,parent_id,reply_to_id)
 values('65000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
 '61000000-0000-4000-8000-000000000001',gen_random_uuid(),'63000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001');
insert into mednerds_private.meddocs_comment_revisions(id,comment_id,number,client_request_id,body,status,decided_at)
 values('65000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001',1,gen_random_uuid(),'Public reply fixture','approved',clock_timestamp());
update mednerds_private.meddocs_comments set published_revision_id=id,first_published_at=clock_timestamp(),revision_number=1
 where id='65000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","session_id":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000001',true)$$,'P0001','forbidden','Self votes rejected');
reset role;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","session_id":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000002',true)->>'upvote_count','1','First vote');
select is(public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000002',true)->>'upvote_count','1','Repeated desired state is idempotent');
select is(public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000002',false)->>'upvote_count','0','Own vote removed');
select lives_ok($$select public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000002',true)$$,'Vote again');
select lives_ok($$select public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000003',true)$$,'Equal score fixture');
select throws_ok($$select public.meddocs_comment_upvote('64000000-0000-4000-8000-000000000001',true)$$,'P0001','forbidden','Pending is not votable');
select is(public.meddocs_comment_upvote('65000000-0000-4000-8000-000000000001',true)->>'upvote_count','1','Published replies are votable');
select lives_ok($$select public.meddocs_comment_upvote('65000000-0000-4000-8000-000000000001',false)$$,'Reply vote can be removed');
select throws_ok($$select public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000002',true,'61000000-0000-4000-8000-000000000001')$$,'42883',null,'No client identity argument exists');
select set_config('vote.page',public.meddocs_comments_list('62000000-0000-4000-8000-000000000001',null,2,'helpful')::text,true);
select is(current_setting('vote.page')::jsonb->'items'->0->>'id','63000000-0000-4000-8000-000000000003','Helpful tie uses publication then UUID descending');
select is(current_setting('vote.page')::jsonb->'items'->0->>'has_upvoted','true','Reader sees own state');
select ok(not(current_setting('vote.page')::jsonb->'items'->0 ? 'user_id'),'No voter IDs returned');
select is(public.meddocs_comments_list('62000000-0000-4000-8000-000000000001',current_setting('vote.page')::jsonb->'next_cursor',2,'helpful')->'items'->0->>'id',
 '63000000-0000-4000-8000-000000000001','Next page uses global score, not local sort');
select is(public.meddocs_comments_list('62000000-0000-4000-8000-000000000001')->'items'->0->>'id','63000000-0000-4000-8000-000000000001','Default newest uses publication, not creation');
select is(public.meddocs_comments_list('62000000-0000-4000-8000-000000000001',null,10,'oldest')->'items'->0->>'id','63000000-0000-4000-8000-000000000002','Oldest uses publication then UUID ascending');
select throws_ok($$select public.meddocs_comments_list('62000000-0000-4000-8000-000000000001',current_setting('vote.page')::jsonb->'next_cursor',2,'newest')$$,'P0001','invalid_request','Wrong-order cursor rejected');
reset role;
update mednerds_private.meddocs_comment_revisions set status='rejected',decided_at=clock_timestamp()
 where comment_id='64000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.meddocs_comment_upvote('64000000-0000-4000-8000-000000000001',true)$$,'P0001','forbidden','Rejected private text is not votable');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select is(public.meddocs_comments_list('62000000-0000-4000-8000-000000000001',null,10,'helpful')->'items'->0->>'upvote_count','1','Guest sees count');
select is(public.meddocs_comments_list('62000000-0000-4000-8000-000000000001',null,10,'helpful')->'items'->0->>'has_upvoted','false','Guest has no own vote');
reset role;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","session_id":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$delete from mednerds_private.meddocs_comment_upvotes where user_id='61000000-0000-4000-8000-000000000002'$$,'42501',null,'Cannot delete foreign votes directly');
reset role;
select is((select count(*) from mednerds_private.meddocs_comment_upvotes),2::bigint,'Foreign votes untouched');
update mednerds_private.meddocs_comments set visibility='hidden' where id='63000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","session_id":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000002',true)$$,'P0001','forbidden','Hidden is not votable');
reset role;
update mednerds_private.meddocs_comments set visibility='withdrawn',published_revision_id=null where id='63000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.meddocs_comment_upvote('63000000-0000-4000-8000-000000000002',true)$$,'P0001','forbidden','Withdrawn is not votable');
reset role;
delete from auth.users where id='61000000-0000-4000-8000-000000000002';
select is((select count(*) from mednerds_private.meddocs_comment_upvotes),0::bigint,'Account deletion cascades votes');
select * from finish();
rollback;
