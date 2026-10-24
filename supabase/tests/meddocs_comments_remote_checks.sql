-- Read-only operator audit after separately authorized migration. No fixtures or activation.
-- All checks should pass BEFORE intentional operator activation of the first test article.
begin read only;
set local statement_timeout='10s';

with expected(name) as (values ('meddocs_articles'),('meddocs_comments'),('meddocs_comment_revisions'),
 ('meddocs_comment_moderation_events'),('meddocs_comment_limits')),
 tables as (
 select e.name,c.oid,c.relrowsecurity,pg_catalog.pg_get_userbyid(c.relowner) as owner
 from expected e left join pg_catalog.pg_namespace n on n.nspname='mednerds_private'
 left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=e.name and c.relkind='r'
), checks as (
 select name||': exists' as check_name,'true' as expected,(oid is not null)::text as actual,oid is not null as ok from tables
 union all select name||': RLS','true',coalesce(relrowsecurity,false)::text,coalesce(relrowsecurity,false) from tables
 union all select name||': owner','postgres',coalesce(owner,'MISSING'),coalesce(owner='postgres',false) from tables
 union all select t.name||': no policies','0',count(p.*)::text,count(p.*)=0
 from tables t left join pg_catalog.pg_policy p on p.polrelid=t.oid group by t.name
 union all select t.name||': no table rights for '||r.name,'false',
 coalesce(pg_catalog.has_table_privilege(r.name,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)::text,
 t.oid is not null and not coalesce(pg_catalog.has_table_privilege(r.name,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),true)
 from tables t cross join (values ('anon'),('authenticated'),('service_role')) r(name)
 union all select t.name||': no column rights for '||r.name,'false',
 exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
 and pg_catalog.has_column_privilege(r.name,t.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES'))::text,
 t.oid is not null and not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
 and pg_catalog.has_column_privilege(r.name,t.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES'))
 from tables t cross join (values ('anon'),('authenticated'),('service_role')) r(name)
) select * from checks order by check_name;

-- Explicit allowlist: absent functions produce failures rather than silent omissions.
with expected(signature,definer,volatility,access) as (values
 ('mednerds_private.comment_valid_name(text)',false,'i','private'),
 ('mednerds_private.comment_setup(uuid)',false,'v','private'),
 ('mednerds_private.comment_identity(boolean,boolean)',false,'v','private'),
 ('mednerds_private.comment_moderator_identity()',false,'v','private'),
 ('mednerds_private.comment_article(uuid,boolean)',false,'v','private'),
 ('mednerds_private.comment_quota(uuid)',false,'v','private'),
 ('mednerds_private.comment_body(text)',false,'i','private'),
 ('mednerds_private.comment_structure()',true,'v','private'),
 ('mednerds_private.comment_pointer()',true,'v','private'),
 ('mednerds_private.comment_revision_immutable()',true,'v','private'),
 ('mednerds_private.comment_is_public(mednerds_private.meddocs_comments)',false,'s','private'),
 ('mednerds_private.comment_public(mednerds_private.meddocs_comments)',false,'s','private'),
 ('mednerds_private.comment_page(uuid,uuid,jsonb,integer)',false,'v','private'),
 ('mednerds_private.comment_result(mednerds_private.meddocs_comments)',false,'s','private'),
 ('mednerds_private.comment_scrub(uuid,boolean)',false,'v','private'),
 ('mednerds_private.comment_private(mednerds_private.meddocs_comments)',false,'s','private'),
 ('mednerds_private.comment_moderation_target(uuid,bigint,boolean)',false,'v','private'),
 ('mednerds_private.scrub_deleted_account_comments()',true,'v','private'),
 ('public.meddocs_comments_list(uuid,jsonb,integer)',true,'v','read'),
 ('public.meddocs_comment_replies(uuid,uuid,jsonb,integer)',true,'v','read'),
 ('public.meddocs_comments_mine(uuid,jsonb,integer)',true,'v','authenticated'),
 ('public.meddocs_comment_create(uuid,text,uuid,uuid)',true,'v','authenticated'),
 ('public.meddocs_comment_edit(uuid,text,bigint,uuid)',true,'v','authenticated'),
 ('public.meddocs_comment_withdraw(uuid,bigint)',true,'v','authenticated'),
 ('public.meddocs_comment_queue(text,jsonb,integer)',true,'v','authenticated'),
 ('public.meddocs_comment_decide(uuid,text,bigint,text)',true,'v','authenticated'),
 ('public.meddocs_comment_visibility(uuid,text,bigint,text)',true,'v','authenticated'),
 ('public.meddocs_comment_redact(uuid,bigint,text)',true,'v','authenticated'),
 ('public.meddocs_comment_audit(uuid,jsonb,integer)',true,'v','authenticated'),
 ('public.meddocs_articles_sync(jsonb)',true,'v','service_role'),
 ('public.meddocs_comments_retention()',true,'v','service_role')
), functions as (
 select e.*,p.oid,p.prosecdef,p.provolatile,p.proconfig,p.proacl,p.proowner,
 pg_catalog.pg_get_userbyid(p.proowner) as owner from expected e
 left join pg_catalog.pg_proc p on p.oid=case
 when pg_catalog.to_regtype('mednerds_private.meddocs_comments') is not null or e.signature not like '%(mednerds_private.%'
 then pg_catalog.to_regprocedure(e.signature) end
), checks as (
 select signature||': exists' as check_name,'true' as expected,(oid is not null)::text as actual,oid is not null as ok from functions
 union all select signature||': owner','postgres',coalesce(owner,'MISSING'),coalesce(owner='postgres',false) from functions
 union all select signature||': SECURITY DEFINER',definer::text,coalesce(prosecdef::text,'MISSING'),coalesce(prosecdef=definer,false) from functions
 union all select signature||': volatility',volatility,coalesce(provolatile::text,'MISSING'),coalesce(provolatile::text=volatility,false) from functions
 union all select signature||': empty search_path','true',coalesce('search_path=""'=any(proconfig),false)::text,coalesce('search_path=""'=any(proconfig),false) from functions
 union all select signature||': PUBLIC execute','false',exists(select 1
 from pg_catalog.aclexplode(coalesce(proacl,pg_catalog.acldefault('f',proowner))) a
 where a.grantee=0 and a.privilege_type='EXECUTE')::text,
 oid is not null and not exists(select 1 from pg_catalog.aclexplode(coalesce(proacl,pg_catalog.acldefault('f',proowner))) a
 where a.grantee=0 and a.privilege_type='EXECUTE') from functions
 union all select signature||': execute '||r.name,r.allowed::text,
 coalesce(pg_catalog.has_function_privilege(r.name,oid,'EXECUTE'),false)::text,
 oid is not null and coalesce(pg_catalog.has_function_privilege(r.name,oid,'EXECUTE'),false)=r.allowed
 from functions cross join lateral (values ('anon',access='read'),
 ('authenticated',access in ('read','authenticated')),('service_role',access='service_role')) r(name,allowed)
) select * from checks order by check_name;

with expected(name,signature) as (values
 ('mednerds_protect_last_admin','mednerds_private.protect_last_account_admin()'),
 ('mednerds_z_scrub_meddocs_comments','mednerds_private.scrub_deleted_account_comments()')
), triggers as (
 select e.*,t.tgtype,t.tgenabled,t.tgfoid,p.prosecdef,p.proconfig,pg_catalog.pg_get_userbyid(p.proowner) as owner
 from expected e left join pg_catalog.pg_trigger t on t.tgrelid=pg_catalog.to_regclass('auth.users')
 and t.tgname=e.name and not t.tgisinternal left join pg_catalog.pg_proc p on p.oid=t.tgfoid
), checks as (
 select name||': BEFORE ROW DELETE' as check_name,'11' as expected,coalesce(tgtype::text,'MISSING') as actual,coalesce(tgtype=11,false) as ok from triggers
 union all select name||': enabled','O or A',coalesce(tgenabled::text,'MISSING'),coalesce(tgenabled in ('O','A'),false) from triggers
 union all select name||': expected function',signature,coalesce(tgfoid::regprocedure::text,'MISSING'),coalesce(tgfoid=pg_catalog.to_regprocedure(signature),false) from triggers
 union all select name||': postgres definer, empty search_path','true',
 coalesce(owner='postgres' and prosecdef and 'search_path=""'=any(proconfig),false)::text,
 coalesce(owner='postgres' and prosecdef and 'search_path=""'=any(proconfig),false) from triggers
 union all select 'last-admin guard before scrub','true',
 ('mednerds_protect_last_admin'<'mednerds_z_scrub_meddocs_comments')::text,
 (select count(*)=2 and bool_and(tgtype=11 and tgenabled in ('O','A')) from triggers)
) select * from checks order by check_name;

-- INITIAL rollout only: intentionally fails after explicit test-article activation.
select 'no initially enabled articles' as check_name,'0' as expected,
 count(*) filter(where comments_enabled)::text as actual,count(*) filter(where comments_enabled)=0 as ok
from mednerds_private.meddocs_articles;
select 'comments_enabled default' as check_name,'false' as expected,
 coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'MISSING') as actual,
 coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid)='false',false) as ok
from (values ('mednerds_private.meddocs_articles')) e(name)
left join pg_catalog.pg_attribute a on a.attrelid=pg_catalog.to_regclass(e.name) and a.attname='comments_enabled'
left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum;
select 'enabled articles are published' as check_name,'0' as expected,count(*)::text as actual,count(*)=0 as ok
from mednerds_private.meddocs_articles where comments_enabled and state<>'published';
-- Diagnostic FK inventory; actual cascades and Auth-service permissions require integration tests.
select conrelid::regclass as relation,conname,pg_catalog.pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint where contype='f' and connamespace=pg_catalog.to_regnamespace('mednerds_private')
and conrelid::regclass::text like 'mednerds_private.meddocs_%'
order by conrelid::regclass::text,conname;
rollback;
