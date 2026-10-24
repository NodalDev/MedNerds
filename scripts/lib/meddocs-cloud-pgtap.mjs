import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
export const PROJECT_REF='wpdfduxzqqlizuhkhebb';
export const PROJECT_NAME='mednerds-security-tests';
export const PROJECT_HOST='aws-0-eu-central-2.pooler.supabase.com';
export const PROJECT_PORT='5432';
export const PROJECT_USER='postgres.'+PROJECT_REF;
export const MIGRATIONS=['20261009000000','20261009000001','20261010000000','20261010010000','20261011000000'];
const users=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const sessions=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const articles=['dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','44444444-4444-4444-8444-444444444444'];
const tables=['public.profiles','public.staff_accounts','public.account_legal_acceptances','mednerds_private.account_legal_releases','mednerds_private.account_deletion_intents','mednerds_private.meddocs_articles','mednerds_private.meddocs_comments','mednerds_private.meddocs_comment_revisions','mednerds_private.meddocs_comment_moderation_events','mednerds_private.meddocs_comment_limits'];
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const list=values=>values.map(quote).join(',');
const uuidList=values=>'array['+list(values)+']::uuid[]';

/** psql 17 / libpq frontend metadata, locale C. Never substitute pg_stat_ssl for this hop. */
export function validateConnectionInfo(output) {
  const lines=output.replaceAll('\r','').trim().split('\n');
  const connected=lines.filter(line=>line.startsWith('You are connected to database '));
  const tls=lines.filter(line=>line.startsWith('SSL connection '));
  const match=/^You are connected to database "([^"]+)" as user "([^"]+)" on host "([^"]+)" \(address "([^"]+)"\) at port "([^"]+)"\.$/.exec(connected[0]??'');
  const secure=/^SSL connection \(protocol: (TLSv1\.[23]), cipher: ([^,]+), compression: off, ALPN: [^)]+\)$/.exec(tls[0]??'');
  if(connected.length!==1||!match||match[1]!=='postgres'||match[2]!==PROJECT_USER
    ||match[3]!==PROJECT_HOST||isIP(match[4])!==4||match[5]!==PROJECT_PORT)throw new Error('Unexpected client pooler identity or non-IPv4 connection.');
  if(tls.length!==1||!secure||secure[2]==='unknown')throw new Error('Client-to-pooler TLS could not be confirmed.');
  return {host:match[3],user:match[2],port:match[5],protocol:secure[1]};
}

/** SET LOCAL identifies this explicit transaction even when READ ONLY never obtains an XID. */
export function transactionGuardSql(pid,token) {
  if(!Number.isSafeInteger(pid)||pid<=0||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(token))throw new Error('Invalid transaction identity.');
  return `do $transaction_guard$ begin
    if pg_backend_pid()<>${pid} or coalesce(current_setting('mednerds.security_test_transaction',true),'')<>${quote(token)} then
      raise exception 'Backend switched or test transaction ended unexpectedly';end if;
  end $transaction_guard$;`;
}

/** Split reviewed SQL, preserving literals and rejecting unterminated tokens/metacommands. */
export function splitSql(source) {
  source=source.replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
  const statements=[];let current='',mode='plain',tag='',depth=0;
  for(let i=0;i<source.length;i++){
    const c=source[i],next=source[i+1];
    if(mode==='line'){if(c==='\n'){mode='plain';current+='\n';}continue;}
    if(mode==='block'){if(c==='/'&&next==='*'){depth++;i++;}else if(c==='*'&&next==='/'){if(--depth===0)mode='plain';i++;}continue;}
    if(mode==='dollar'){if(source.startsWith(tag,i)){current+=tag;i+=tag.length-1;mode='plain';}else current+=c;continue;}
    if(mode==='single'||mode==='double'){
      current+=c;const delimiter=mode==='single'?"'":'"';
      if(c===delimiter){if(next===delimiter){current+=next;i++;}else mode='plain';}
      continue;
    }
    if(c==='-'&&next==='-'){mode='line';i++;continue;}
    if(c==='/'&&next==='*'){mode='block';depth=1;current+=' ';i++;continue;}
    if(c==="'"||c==='"'){mode=c==="'"?'single':'double';current+=c;continue;}
    if(c==='$'){const found=/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));if(found){tag=found[0];mode='dollar';current+=tag;i+=tag.length-1;continue;}}
    if(c==='\\')throw new Error('psql metacommands or unquoted escapes are forbidden.');
    if(c===';'){if(current.trim())statements.push(current.trim());current='';}else current+=c;
  }
  if(mode!=='plain'&&mode!=='line')throw new Error('Unterminated SQL token.');
  if(current.trim())throw new Error('Every SQL statement must end with a semicolon.');
  return statements;
}
export function extractSuite(source) {
  const statements=splitSql(source),normalize=s=>s.replace(/\s+/g,' ').toLowerCase();
  const required=['begin','create extension if not exists pgtap with schema extensions','set local search_path=public,extensions','select no_plan()'];
  if(required.some((s,i)=>normalize(statements[i]??'')!==s)||normalize(statements.at(-2)??'')!=='select * from finish()'||normalize(statements.at(-1)??'')!=='rollback')throw new Error('Unexpected local suite framing; review required.');
  const body=statements.slice(4,-2);
  for(const s of body){
    if(!/^(?:select|insert|update|delete|set local role (?:anon|authenticated|service_role)$|reset role$|set constraints all immediate$|create temporary table)\b/i.test(s))throw new Error('Unsupported suite statement; review required.');
    if(/^select\b/i.test(s)&&!/^select\s+(?:ok|is|throws_ok|lives_ok|set_config)\s*\(/i.test(s))throw new Error('Unreviewed SELECT in suite.');
  }
  const count=body.filter(s=>/^select\s+(?:ok|is|throws_ok|lives_ok)\s*\(/i.test(s)).length;
  if(!count)throw new Error('Suite has no assertions.');
  return {body,count};
}
export function functionDigests(migrations) {
  const functions=new Map();
  for(const source of migrations)for(const statement of splitSql(source)){
    const name=/^create(?:\s+or\s+replace)?\s+function\s+([a-z_]+\.[a-z_]+)/i.exec(statement)?.[1];
    if(!name)continue;
    const body=/\bas\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*)\1\s*$/i.exec(statement)?.[2];
    if(body===undefined)throw new Error('Unsupported migration function body: '+name);
    functions.set(name,createHash('md5').update(body.trim().replaceAll('\r\n','\n').replaceAll('\r','\n')).digest('hex'));
  }
  return [...functions];
}
export function preflightSql(digests) {
  const functions=digests.map(([name,hash])=>'('+quote(name)+','+quote(hash)+')').join(',');
  const triggers=[
    ['auth.users','mednerds_auth_user_created','mednerds_private.create_auth_profile'],
    ['auth.users','mednerds_protect_last_admin','mednerds_private.protect_last_account_admin'],
    ['auth.users','mednerds_z_scrub_meddocs_comments','mednerds_private.scrub_deleted_account_comments'],
    ['public.profiles','profiles_prepare','mednerds_private.prepare_profile'],
    ['mednerds_private.meddocs_comments','comment_structure','mednerds_private.comment_structure'],
    ['mednerds_private.meddocs_comments','comment_pointer','mednerds_private.comment_pointer'],
    ['mednerds_private.meddocs_comment_revisions','comment_revision_immutable','mednerds_private.comment_revision_immutable']
  ].map(row=>'('+row.map(quote).join(',')+')').join(',');
  return String.raw`do $guard$
begin
  if current_database()<>'postgres' or session_user<>'postgres' or current_user<>'postgres'
    or current_setting('server_version_num')::integer not between 150000 and 179999 then
    raise exception 'Connection identity or PostgreSQL version guard failed'; end if;
  -- This is ONLY the pooler-to-Postgres hop. Client TLS is checked via libpq conninfo.
  if not exists(select 1 from pg_catalog.pg_stat_ssl where pid=pg_backend_pid() and ssl) then
    raise exception 'Pooler-to-PostgreSQL TLS could not be confirmed';end if;
  if not exists(select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace
    where e.extname='pgtap' and e.extversion='1.3.3' and n.nspname='extensions') then
    raise exception 'pgTAP 1.3.3 in extensions required'; end if;
  if exists(select 1 from pg_catalog.pg_event_trigger where evtenabled<>'D') then
    raise exception 'Enabled DDL event triggers need separate side-effect review';end if;
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'Migration history missing; review installation provenance'; end if;
  if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations)
    is distinct from array[${list(MIGRATIONS)}]::text[] then
    raise exception 'Exactly the five reviewed migration versions are required'; end if;
  if exists(select 1 from (values ${functions}) e(name,hash)
    where (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname||'.'||p.proname=e.name
      and pg_catalog.md5(btrim(replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),E' \t\n'))=e.hash)<>1) then
    raise exception 'Installed function bodies differ from repository migrations'; end if;
  if exists(select 1 from (values ('auth.users','id','uuid'),('auth.users','email_confirmed_at','timestamp with time zone'),
    ('auth.sessions','id','uuid'),('auth.sessions','user_id','uuid')) e(relation,column_name,type_name)
    where not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=to_regclass(e.relation)
      and a.attname=e.column_name and a.atttypid=to_regtype(e.type_name) and a.attnum>0 and not a.attisdropped)) then
    raise exception 'Auth fixture columns or types mismatch'; end if;
  if exists(select 1 from pg_catalog.pg_attribute a where a.attrelid in ('auth.users'::regclass,'auth.sessions'::regclass)
    and a.attnum>0 and not a.attisdropped and a.attnotnull and not a.atthasdef and a.attidentity=''
    and a.attgenerated='' and not((a.attrelid='auth.users'::regclass and a.attname in ('id','email_confirmed_at'))
      or (a.attrelid='auth.sessions'::regclass and a.attname in ('id','user_id')))) then
    raise exception 'Auth schema requires additional fixture columns'; end if;
  if exists(select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid
    join pg_catalog.pg_namespace fn on fn.oid=p.pronamespace
    where not t.tgisinternal and n.nspname in ('auth','public','mednerds_private')
    and not exists(select 1 from (values ${triggers}) e(relation,name,function_name)
      where n.nspname||'.'||c.relname=e.relation and t.tgname=e.name
      and fn.nspname||'.'||p.proname=e.function_name and t.tgenabled in ('O','A'))) then
    raise exception 'Unexpected or disabled trigger; external side effects not allowed'; end if;
  if (select count(*) from pg_catalog.pg_trigger t where not t.tgisinternal and t.tgenabled in ('O','A')
    and t.tgname in ('mednerds_auth_user_created','mednerds_protect_last_admin','mednerds_z_scrub_meddocs_comments',
      'profiles_prepare','comment_structure','comment_pointer','comment_revision_immutable'))<>7 then
    raise exception 'Required triggers missing'; end if;
  if exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','mednerds_private') and c.relkind in ('r','p','f','m')
    and n.nspname||'.'||c.relname not in (${list(tables)})) then raise exception 'Unexpected application relations';end if;
end $guard$;`;
}
export function dataGuardSql({fixtures=false,pid,terms,privacy}) {
  if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid backend identity.');
  if(!/^sha256:[a-f0-9]{64}$/.test(terms)||!/^sha256:[a-f0-9]{64}$/.test(privacy))throw new Error('Invalid legal snapshot.');
  const ownership=[
    ['public.profiles','user_id',users],['public.staff_accounts','user_id',users],['public.account_legal_acceptances','user_id',users],
    ['mednerds_private.meddocs_articles','id',articles],['mednerds_private.meddocs_comments','article_id',articles],
    ['mednerds_private.meddocs_comments','author_id',users],['mednerds_private.meddocs_comment_limits','user_id',users],
    ['auth.users','id',users],['auth.sessions','id',sessions],['auth.sessions','user_id',users]
  ];
  const own=fixtures?ownership.map(([table,key,ids])=>`
  if exists(select 1 from ${table} where ${key} is not null and not(${key}=any(${uuidList(ids)}))) then
    raise exception 'Unexpected non-fixture ownership in ${table}';end if;`).join(''):'';
  const allowed=fixtures?"and n.nspname||'.'||c.relname not in ("+list(ownership.map(row=>row[0]).concat(['mednerds_private.meddocs_comment_revisions','mednerds_private.meddocs_comment_moderation_events']))+")":'';
  return `do $guard$
declare relation record; has_rows boolean;
begin
  if pg_backend_pid()<>${pid} or session_user<>'postgres' or current_user<>'postgres' or current_database()<>'postgres' then
    raise exception 'Physical connection guard failed';end if;
  if (select count(*) from mednerds_private.account_legal_releases)<>1 or not exists(
    select 1 from mednerds_private.account_legal_releases where terms_version=${quote(terms)}
      and privacy_notice_version=${quote(privacy)} and is_current and gravatar_enabled
  ) then raise exception 'Unexpected legal-release seed';end if;
  for relation in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('auth','public','mednerds_private') and c.relkind in ('r','p')
    and not(n.nspname='auth' and c.relname='schema_migrations')
    and not(n.nspname='mednerds_private' and c.relname='account_legal_releases') ${allowed}
  loop
    execute format('select exists(select 1 from %I.%I)',relation.nspname,relation.relname) into has_rows;
    if has_rows then raise exception 'Unexpected data in %.%',relation.nspname,relation.relname;end if;
  end loop;
  ${own}
end $guard$;`;
}
export function lockSql() {
  return 'lock table '+['auth.users','auth.sessions',...tables].join(',')+' in share row exclusive mode;';
}
export function readOnlyAudit(source) {
  const statements=splitSql(source);
  if(statements[0].toLowerCase()!=='begin read only'||statements.at(-1).toLowerCase()!=='rollback')throw new Error('Unexpected audit framing.');
  return statements.slice(1,-1).filter(s=>!/^set local statement_timeout=/i.test(s)).map(s=>{
    const code=s.replace(/'(?:''|[^'])*'/g,"''");
    if(!/^(?:select|with)\b/i.test(s)||/\b(?:insert|update|delete|truncate|create|alter|drop|grant|revoke|call|do)\b/i.test(code))throw new Error('Audit must remain read-only.');
    return 'select row_to_json(audit_row) from ('+s+') audit_row;';
  });
}
export function validateTap(output,expected) {
  const lines=output.replaceAll('\r','').split('\n').filter(Boolean);
  const plans=lines.filter(line=>/^\d+\.\.\d+(?:\s|$)/.test(line)),tests=lines.filter(line=>/^(?:not )?ok\b/.test(line));
  if(plans.length!==1||plans[0]!=='1..'+expected)throw new Error('Missing or incorrect TAP plan.');
  if(tests.length!==expected||tests.some((line,index)=>Number(/^(?:not )?ok\s+(\d+)/.exec(line)?.[1])!==index+1))throw new Error('Missing, duplicate or out-of-order assertions.');
  const failed=tests.filter(line=>/^not ok\b/.test(line));
  if(failed.length||lines.some(line=>/^Bail out!/i.test(line)||/^#.*(?:failed|planned|No tests run|extra tests)/i.test(line)))throw new Error('pgTAP assertions or finish() failed; failed test numbers: '+(failed.map(line=>/^not ok\s+(\d+)/.exec(line)?.[1]).join(', ')||'see finish diagnostics')+'.');
  return {count:expected};
}
