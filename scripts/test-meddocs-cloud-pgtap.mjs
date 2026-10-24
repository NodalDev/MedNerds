import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { splitSql, extractSuite, functionDigests, preflightSql, dataGuardSql, readOnlyAudit, validateTap, validateConnectionInfo, transactionGuardSql, PROJECT_HOST, PROJECT_USER, PROJECT_PORT, MIGRATIONS } from './lib/meddocs-cloud-pgtap.mjs';
import { parseOptions, clientEnvironment, clientArguments, runCloudSuite } from './test-meddocs-comments-cloud.mjs';

const suite=await readFile('supabase/tests/meddocs_comments.test.sql','utf8');
const audit=await readFile('supabase/tests/meddocs_comments_remote_checks.sql','utf8');
const files=(await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
// This runner audits the explicitly reviewed Phase-3B baseline, not today's schema.
const baselineFiles=MIGRATIONS.map(version=>{
  const matches=files.filter(name=>name.startsWith(version+'_'));
  assert.equal(matches.length,1,'Exactly one file for reviewed migration '+version);
  return matches[0];
});
const migrations=await Promise.all(baselineFiles.map(name=>readFile('supabase/migrations/'+name,'utf8')));
const versions=[...migrations[2].matchAll(/'(sha256:[a-f0-9]{64})'/g)].map(match=>match[1]);
const options={suite,migrations,audit,terms:versions[0],privacy:versions[1]};
const tap=count=>'1..'+count+'\n'+Array.from({length:count},(_,i)=>'ok '+(i+1)+' - assertion').join('\n')+'\n';
const conninfo='You are connected to database "postgres" as user "postgres.wpdfduxzqqlizuhkhebb" on host "aws-0-eu-central-2.pooler.supabase.com" (address "192.0.2.10") at port "5432".\nSSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off, ALPN: none)\n';

test('reviewed five-migration baseline retains 92 assertions and 40 functions; later migrations are excluded',()=>{
  assert.equal(baselineFiles.length,5);
  assert.equal(extractSuite(suite).count,92);
  assert.equal(functionDigests(migrations).length,40);
  assert.equal(readOnlyAudit(audit).length,7);
  const changed=[...migrations];changed[2]=changed[2].replace('Verified account required','Different account requirement');
  assert.notDeepEqual(functionDigests(changed),functionDigests(migrations));
});
test('SQL splitter preserves quoted semicolons, dollar bodies, Unicode escapes and comments',()=>{
  assert.deepEqual(splitSql("select ';'; -- comment\nselect $$begin; end;$$; /* nested /* x */ */ select U&'\\0020';"),
    ["select ';'","select $$begin; end;$$","select U&'\\0020'"]);
  for(const source of ["select 'missing;","select 1","\\connect elsewhere\nselect 1;"])assert.throws(()=>splitSql(source));
  for(const source of [suite.replace('select * from finish();','commit;'),suite.replace('select no_plan();','select plan(1);'),suite.replace('reset role;','commit;')])assert.throws(()=>extractSuite(source));
  assert.throws(()=>readOnlyAudit(audit.replace('rollback;','commit;')));
  assert.throws(()=>readOnlyAudit('begin read only; with removed as (delete from auth.users returning id) select * from removed; rollback;'));
});
test('exact session pooler identity; production, staging and host/port/user/URL overrides rejected',()=>{
  const valid=['--confirm-project=mednerds-security-tests','--project-ref=wpdfduxzqqlizuhkhebb','--psql='+resolve('psql.exe'),'--ssl-root-cert='+resolve('ca.crt')];
  assert.equal(parseOptions(valid)['project-ref'],'wpdfduxzqqlizuhkhebb');
  for(const args of [[],valid.map(arg=>arg.replace('wpdfduxzqqlizuhkhebb','production')), ...['--host=remote','--port=6543','--port=5432','--user=postgres','--url=postgres://remote','--password=secret'].map(arg=>[...valid,arg]),[...valid,valid[0]],valid.map(arg=>arg.replace('mednerds-security-tests','mednerds-staging'))])assert.throws(()=>parseOptions(args));
  assert.equal(PROJECT_HOST,'aws-0-eu-central-2.pooler.supabase.com');
  assert.equal(PROJECT_USER,'postgres.wpdfduxzqqlizuhkhebb');assert.equal(PROJECT_PORT,'5432');
  assert.equal(clientArguments()[clientArguments().indexOf('-h')+1],PROJECT_HOST);
  assert.equal(clientArguments()[clientArguments().indexOf('-U')+1],PROJECT_USER);
  assert.equal(clientArguments()[clientArguments().indexOf('-p')+1],'5432');
  assert.ok(!clientArguments().includes('6543'));
  assert.ok(clientArguments().includes('-X'));assert.ok(clientArguments().includes('ON_ERROR_STOP=1'));
});
test('libpq target overrides and credentials never enter client command-line arguments',()=>{
  const env=clientEnvironment('private-test','/ca.crt',{PATH:'bin',PGHOSTADDR:'production-ip',PGSERVICE:'production',PGOPTIONS:'options',PGPASSFILE:'old-file',PGDATABASE:'staging',PGPASSWORD:'old'});
  assert.equal(env.PGHOSTADDR,undefined);assert.equal(env.PGSERVICE,undefined);assert.equal(env.PGPASSFILE,undefined);assert.equal(env.PGOPTIONS,undefined);
  assert.equal(env.PGSSLMODE,'verify-full');assert.equal(env.PGPASSWORD,'private-test');
  assert.equal(env.PGSSLROOTCERT,'/ca.crt');assert.equal(env.PGSSLMINPROTOCOLVERSION,'TLSv1.2');
  assert.equal(env.PGGSSENCMODE,'disable');assert.equal(env.LC_ALL,'C');
  assert.doesNotMatch(JSON.stringify(clientArguments()),/private-test|password=/);
});
test('frontend libpq TLS and tenant identity are distinct from backend pg_stat_ssl',()=>{
  assert.deepEqual(validateConnectionInfo(conninfo),{host:PROJECT_HOST,user:PROJECT_USER,port:'5432',protocol:'TLSv1.3'});
  assert.equal(validateConnectionInfo(conninfo.replace('TLSv1.3','TLSv1.2')).protocol,'TLSv1.2');
  for(const wrong of [conninfo.replace(PROJECT_USER,'postgres.otherproject'),conninfo.replace(PROJECT_HOST,'db.wpdfduxzqqlizuhkhebb.supabase.co'),conninfo.replace('"5432"','"6543"'),conninfo.replace('192.0.2.10','::1'),conninfo.split('SSL connection')[0],conninfo.replace('TLSv1.3','TLSv1.1'),conninfo+'SSL connection (protocol: TLSv1.3)\n'])assert.throws(()=>validateConnectionInfo(wrong));
  assert.match(preflightSql(functionDigests(migrations)),/Pooler-to-PostgreSQL TLS could not be confirmed/);
});
test('transaction guard uses backend PID and SET LOCAL token; rejects unsafe token interpolation',()=>{
  const sql=transactionGuardSql(123,'00000000-0000-4000-8000-000000000001');
  assert.ok(sql.includes('pg_backend_pid()<>123'));assert.ok(sql.includes('mednerds.security_test_transaction'));
  for(const token of ['',"';commit;",'not-a-uuid'])assert.throws(()=>transactionGuardSql(123,token));
});
test('guards validate version history, pgTAP, definitions, triggers, Auth columns and empty data',()=>{
  const preflight=preflightSql(functionDigests(migrations));
  for(const expected of ['schema_migrations','1.3.3','pg_stat_ssl','prosrc','attnotnull','pg_trigger','pg_event_trigger'])assert.ok(preflight.includes(expected));
  const clean=dataGuardSql({pid:123,terms:versions[0],privacy:versions[1]});
  assert.ok(clean.includes('pg_backend_pid()<>123'));assert.ok(clean.includes('Unexpected data'));
  assert.throws(()=>dataGuardSql({pid:123,terms:"';commit;",privacy:versions[1]}));
  const fixtures=dataGuardSql({fixtures:true,pid:123,terms:versions[0],privacy:versions[1]});
  assert.ok(fixtures.includes('Unexpected non-fixture ownership'));assert.ok(fixtures.includes('auth.sessions'));
});
test('TAP validation rejects not-ok, SQL-success assertion failures, missing tests and finish diagnostics',()=>{
  assert.deepEqual(validateTap(tap(2),2),{count:2});
  for(const value of [tap(2).replace('ok 2','not ok 2'),tap(1),tap(2).replace('ok 2','ok 1'),tap(2)+'# Looks like you failed 1 test\n',tap(2)+'Bail out! fatal\n',tap(2)+'1..2\n',tap(2).replace('ok 2','ok - no number')])assert.throws(()=>validateTap(value,2));
});

// No subprocess, DB, network, password or real account in these orchestration tests.
class MockConnection {
  constructor({badTap=false,sqlError=false,dirtyAfter=false,auditFailure=false,badConnInfo=false,switchBeforeInsert=false,switchDuringAudit=false,switchAfterRollback=false,endTransactionBeforeInsert=false,endTransactionDuringAudit=false,ignoreRollback=false}={}){Object.assign(this,{badTap,sqlError,dirtyAfter,auditFailure,badConnInfo,switchBeforeInsert,switchDuringAudit,switchAfterRollback,endTransactionBeforeInsert,endTransactionDuringAudit,ignoreRollback});this.commands=[];this.number=0;this.closed=false;this.pid=123;this.token='';this.rolledBack=false;}
  async query(sql){
    this.commands.push(sql);
    if(sql==='\\conninfo')return this.badConnInfo?conninfo.replace('TLSv1.3','TLSv1.1'):conninfo;
    if(sql==='select pg_backend_pid();')return this.pid+'\n';
    if(/^begin(?: read only)?;/.test(sql)){this.token=/set local mednerds\.security_test_transaction='([^']+)'/.exec(sql)?.[1]??'';return '';}
    if(this.switchBeforeInsert&&/\binsert into auth.users/i.test(sql))this.pid=456;
    if(this.switchDuringAudit&&sql.includes('select row_to_json'))this.pid=456;
    if(this.endTransactionBeforeInsert&&/\binsert into auth.users/i.test(sql))this.token='';
    if(this.endTransactionDuringAudit&&sql.includes('select row_to_json'))this.token='';
    if(sql.includes('do $transaction_guard$')){
      const pid=Number(/pg_backend_pid\(\)<>(\d+)/.exec(sql)?.[1]);
      const expected=/current_setting\('mednerds.security_test_transaction',true\),''\)<>\s*'([^']+)'/.exec(sql)?.[1];
      if(this.pid!==pid||this.token!==expected){this.closed=true;throw new Error('Backend switched or test transaction ended unexpectedly');}
    }
    if(sql.endsWith('rollback;')){if(!this.ignoreRollback){this.token='';this.rolledBack=true;}return '';}
    if(sql.startsWith('select json_build_object')){
      if(this.switchAfterRollback&&this.rolledBack)this.pid=456;
      return JSON.stringify({pid:this.pid,no_transaction:this.token===''});
    }
    if(sql.includes('select row_to_json')){
      return Array.from({length:279},(_,i)=>JSON.stringify({check_name:'prerequisite '+i,ok:!(this.auditFailure&&i===0)})).join('\n')+'\n';
    }
    if(this.dirtyAfter&&this.rolledBack&&sql.includes('Unexpected data'))throw new Error('Residual data');
    if(sql.includes('select plan('))return '1..92\n';
    if(/;\s*select (ok|is|throws_ok|lives_ok)\(/i.test(sql)){
      if(this.sqlError){this.closed=true;throw new Error('SQL failed');}
      this.number++;return (this.badTap&&this.number===3?'not ok ':'ok ')+this.number+' - assertion\n';
    }
    return '';
  }
}
test('one physical mock connection: preflight before writes, fixed plan, finish, rollback and cleanup',async()=>{
  const conn=new MockConnection(),result=await runCloudSuite(conn,options);
  assert.equal(result.count,92);assert.equal(result.clean,true);
  const write=conn.commands.findIndex(sql=>/\binsert into auth.users/i.test(sql));
  assert.ok(write>0);assert.ok(conn.commands.slice(0,write).some(sql=>sql.includes('lock table')));
  assert.ok(conn.commands[write].indexOf('Physical connection guard failed')<conn.commands[write].indexOf('insert into auth.users'));
  assert.equal(conn.commands.filter(sql=>/^begin;/.test(sql)).length,1);
  assert.equal(conn.commands.filter(sql=>sql.endsWith('rollback;')).length,1);
  assert.ok(conn.commands.some(sql=>sql.includes('select * from finish()')));
  assert.ok(conn.commands.some(sql=>sql.includes('Unexpected data')&&conn.commands.indexOf(sql)>conn.commands.findIndex(sql=>sql.endsWith('rollback;'))));
  assert.ok(!conn.commands.some(sql=>/^commit\b/i.test(sql)));
});
test('failed pgTAP assertions still reach finish and rollback, but never pass',async()=>{
  const conn=new MockConnection({badTap:true});
  await assert.rejects(runCloudSuite(conn,options),/failed test numbers: 3/);
  assert.ok(conn.commands.some(sql=>sql.includes('select * from finish()')));assert.ok(conn.commands.some(sql=>sql.endsWith('rollback;')));
});
test('SQL-error closed connection stops all following tests and never claims cleanup success',async()=>{
  const conn=new MockConnection({sqlError:true});
  await assert.rejects(runCloudSuite(conn,options),/SQL failed/);
  assert.ok(!conn.commands.some(sql=>sql.includes('select * from finish()')));
  assert.equal(conn.commands.filter(sql=>sql.startsWith('select json_build_object')).length,1); // Initial clean-session check only.
});
test('failed prerequisites abort before inserts; residual data cannot become a successful run',async()=>{
  const conn=new MockConnection({auditFailure:true});
  await assert.rejects(runCloudSuite(conn,options),/prerequisite failed/);
  assert.ok(!conn.commands.some(sql=>/\binsert into auth.users/i.test(sql)));assert.ok(conn.commands.some(sql=>sql.endsWith('rollback;')));
  await assert.rejects(runCloudSuite(new MockConnection({dirtyAfter:true}),options),/Residual data/);
});
test('verify-clean stays read-only and never runs fixtures or acquires write locks',async()=>{
  const conn=new MockConnection(),result=await runCloudSuite(conn,{...options,verifyOnly:true});
  assert.equal(result.count,0);assert.ok(conn.commands.some(sql=>sql.startsWith('begin read only')));
  assert.ok(!conn.commands.some(sql=>/\binsert into auth.users|select plan\(|lock table/i.test(sql)));
});
test('backend switches during audit or before fixtures abort before writes and never reach finish',async()=>{
  for(const mode of [{switchBeforeInsert:true},{switchDuringAudit:true},{endTransactionBeforeInsert:true}]){
    const conn=new MockConnection(mode);
    await assert.rejects(runCloudSuite(conn,options),/Backend switched or test transaction ended/);
    assert.ok(conn.closed);assert.ok(!conn.commands.some(sql=>sql.includes('select * from finish()')));
    assert.equal(conn.commands.filter(sql=>sql.startsWith('select json_build_object')).length,1);
  }
});
test('wrong post-rollback PID or missing rollback confirmation cannot pass',async()=>{
  for(const mode of [{switchAfterRollback:true},{ignoreRollback:true}]){
    await assert.rejects(runCloudSuite(new MockConnection(mode),options),/Rollback \/ physical connection not confirmed/);
  }
});
test('leftover initial session marker aborts before BEGIN and test fixtures',async()=>{
  const conn=new MockConnection();conn.token='leftover-session-marker';
  await assert.rejects(runCloudSuite(conn,options),/Initial pooled-session state/);
  assert.ok(!conn.commands.some(sql=>/^begin|\binsert into auth.users/i.test(sql)));
});
test('VerifyClean rejects client TLS, prerequisites, backend switching and residual data',async()=>{
  for(const [mode,error] of [[{badConnInfo:true},/TLS/],[{auditFailure:true},/prerequisite failed/],[{switchDuringAudit:true},/Backend switched/],[{endTransactionDuringAudit:true},/transaction ended/],[{switchAfterRollback:true},/Rollback/],[{dirtyAfter:true},/Residual data/]]){
    const conn=new MockConnection(mode);
    await assert.rejects(runCloudSuite(conn,{...options,verifyOnly:true}),error);
    assert.ok(!conn.commands.some(sql=>/\binsert into auth.users|select plan\(|lock table/i.test(sql)));
  }
});
test('PowerShell uses hidden credential input and child pipe; no file or shell password argument',async()=>{
  const source=await readFile('scripts/test-meddocs-comments-cloud.ps1','utf8');
  assert.match(source,/-AsSecureString/);assert.match(source,/StandardInput\.BaseStream\.Write/);assert.match(source,/ZeroFreeBSTR/);
  assert.doesNotMatch(source,/Set-Content|WriteAllText|--password|PGPASSWORD/);
});
