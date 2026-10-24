import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Requires an already migrated, EMPTY disposable Supabase-compatible local database.
// No connection URIs, hosted targets, default databases, linked projects or .env loading.
const args=Object.fromEntries(process.argv.slice(2).map(arg=>arg.split('=')));
const database=args['--database'],port=args['--port']??'54322';
if(args['--confirm-disposable']!==undefined || !process.argv.includes('--confirm-disposable')
  || !/^mednerds_comments_test_[a-z0-9_]+$/.test(database??'') || !/^\d{2,5}$/.test(port)
  || Number(port)>65535 || process.argv.slice(2).some(arg=>!/^--(?:confirm-disposable|database=mednerds_comments_test_[a-z0-9_]+|port=\d{2,5}|psql=.+)$/.test(arg))) {
  throw new Error('Only --confirm-disposable --database=mednerds_comments_test_NAME [--port=54322] [--psql=local-executable] are accepted. Never use hosted Staging/Production.');
}
class SqlSession {
  constructor() {
    // PGHOSTADDR/PGSERVICE could otherwise override the explicit localhost target.
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
    if(process.env.PGPASSWORD)env.PGPASSWORD=process.env.PGPASSWORD;
    this.process=spawn(args['--psql']??'psql',['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',database],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
    this.buffer='';this.errors='';this.pending=null;this.sequence=0;
    this.process.stdout.on('data',chunk=>{this.buffer+=chunk.toString().replaceAll('\r','');this.flush();});
    this.process.stderr.on('data',chunk=>{this.errors+=chunk.toString();});
    this.process.on('error',error=>this.pending?.reject(error));
    this.process.on('exit',code=>{this.exited=true;this.pending?.reject(new Error('Local psql exited: '+code+' '+this.errors));});
  }
  flush() {
    const p=this.pending;if(!p)return;const at=this.buffer.indexOf(p.marker+'\n');if(at<0)return;
    const result=this.buffer.slice(0,at).trim();this.buffer=this.buffer.slice(at+p.marker.length+1);
    this.pending=null;clearTimeout(p.timer);p.resolve(result);
  }
  query(sql) {
    assert.equal(this.pending,null,'one operation per physical connection');
    return new Promise((resolve,reject)=>{
      const marker='MEDNERDS_END_'+(++this.sequence);
      const timer=setTimeout(()=>reject(new Error('Local SQL worker timeout')),12000);
      this.pending={marker,resolve,reject,timer};
      this.process.stdin.write(sql+'\n\\echo '+marker+'\n');
    });
  }
  close(){if(this.pending)clearTimeout(this.pending.timer);this.process.kill();}
}
const A='51000000-0000-4000-8000-000000000001',B='51000000-0000-4000-8000-000000000002',
 C='51000000-0000-4000-8000-000000000003',D='51000000-0000-4000-8000-000000000004',
 article='52000000-0000-4000-8000-000000000001';
const auth=id=>`select set_config('request.jwt.claims','${JSON.stringify({sub:id,session_id:id,role:'authenticated'})}',false); set role authenticated;`;
const create=(body,request,reply)=>`select public.meddocs_comment_create('${article}','${body}','${request}'${reply?",'"+reply+"'":''});`;
const sessions=[];
try {
  const monitor=new SqlSession(),first=new SqlSession(),second=new SqlSession();sessions.push(monitor,first,second);
  assert.equal(await monitor.query("select current_database();"),database);
  assert.equal(await monitor.query("select (select count(*) from auth.users)+(select count(*) from mednerds_private.meddocs_articles);"),'0','database must be empty; fixtures are never installed into an existing project');
  await monitor.query(`begin;
    insert into auth.users(id,email_confirmed_at) values ${[A,B,C,D].map(id=>"('"+id+"',clock_timestamp())").join(',')};
    insert into auth.sessions(id,user_id) values ${[A,B,C,D].map(id=>"('"+id+"','"+id+"')").join(',')};
    update public.profiles set display_name='Isolated test user';
    insert into public.account_legal_acceptances(user_id,terms_version,privacy_notice_version)
      select u.id,r.terms_version,r.privacy_notice_version from auth.users u cross join mednerds_private.account_legal_releases r where r.is_current;
    insert into public.staff_accounts(user_id,role) values ('${B}','admin'),('${C}','admin');
    insert into mednerds_private.meddocs_articles(id,locale,canonical_path,author_slugs,state,comments_enabled)
      values('${article}','de','/meddocs/ekg/concurrency-fixture/','{orlando-frey}','published',true);
    commit;`);
  const pid=Number(await second.query('select pg_backend_pid();'));
  async function overlap(promise) {
    // Observe an actual waiting backend, not a guessed sleep-based ordering.
    let settled=false;promise.then(()=>{settled=true;},()=>{settled=true;});
    for(let attempt=0;attempt<40;attempt++){
      if(settled)throw new Error('Request did not overlap the held transaction');
      const waiting=await monitor.query(`select exists(select 1 from pg_stat_activity where pid=${pid} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0);`);
      if(waiting==='t')return;
      await delay(10);
    }
    throw new Error('No real lock contention observed');
  }
  const request='53000000-0000-4000-8000-000000000001';
  await first.query(auth(A)+'begin;'+create('Same concurrent request',request));
  const pending=second.query(auth(A)+create('Same concurrent request',request));pending.catch(()=>{});
  await overlap(pending);await first.query('commit;');await pending;
  assert.equal(await monitor.query(`select count(*) from mednerds_private.meddocs_comments where author_id='${A}' and client_request_id='${request}';`),'1');
  assert.equal(await monitor.query(`select short_count from mednerds_private.meddocs_comment_limits where user_id='${A}';`),'1');
  console.log('PASS: real concurrent identical Create -> one comment, one quota charge');

  async function thread(user,requestId) {
    await first.query('reset role;'+auth(user)+create('Published root',requestId));
    const root=await monitor.query(`select id from mednerds_private.meddocs_comments where author_id='${user}' and client_request_id='${requestId}';`);
    const revision=await monitor.query(`select id from mednerds_private.meddocs_comment_revisions where comment_id='${root}';`);
    await first.query('reset role;'+auth(B)+`select public.meddocs_comment_decide('${revision}','approve',1);`);
    const replyRequest=requestId.slice(0,-1)+'5';
    await first.query(create('Preserved foreign reply',replyRequest,root));
    await first.query('reset role;'+auth(user)+`select public.meddocs_comment_edit('${root}','Private edit',2,'${requestId.slice(0,-1)+'6'}');`);
    const edit=await monitor.query(`select id from mednerds_private.meddocs_comment_revisions where comment_id='${root}' and status='pending';`);
    return {root,edit};
  }
  async function assertPurged(root) {
    assert.equal(await monitor.query(`select count(*) from mednerds_private.meddocs_comment_revisions where comment_id='${root}';`),'0');
    assert.equal(await monitor.query(`select count(*) from mednerds_private.meddocs_comment_moderation_events where comment_id='${root}';`),'0');
    assert.equal(await monitor.query(`select author_id is null and published_revision_id is null and visibility='withdrawn' from mednerds_private.meddocs_comments where id='${root}';`),'t');
    assert.equal(await monitor.query(`select count(*) from mednerds_private.meddocs_comments c join mednerds_private.meddocs_comment_revisions r on r.id=c.published_revision_id where c.parent_id='${root}' and r.body='Preserved foreign reply';`),'1');
  }
  // The identical-create fixture is still pending; use it as this user's root.
  const rootA=await monitor.query(`select id from mednerds_private.meddocs_comments where author_id='${A}';`);
  const revA=await monitor.query(`select id from mednerds_private.meddocs_comment_revisions where comment_id='${rootA}';`);
  await first.query('reset role;'+auth(B)+`select public.meddocs_comment_decide('${revA}','approve',1);`+create('Preserved foreign reply','53000000-0000-4000-8000-000000000005',rootA));
  await first.query('reset role;'+auth(A)+`select public.meddocs_comment_edit('${rootA}','Private edit',2,'53000000-0000-4000-8000-000000000006');`);
  const editA=await monitor.query(`select id from mednerds_private.meddocs_comment_revisions where comment_id='${rootA}' and status='pending';`);
  await first.query('reset role;'+auth(B)+`begin;select public.meddocs_comment_decide('${editA}','approve',3);`);
  const deletion=second.query(`reset role;delete from auth.users where id='${A}';`);deletion.catch(()=>{});
  await overlap(deletion);await first.query('commit;');await deletion;await assertPurged(rootA);
  console.log('PASS: moderation first, deletion waits then purges; foreign reply preserved');

  const {root,edit}=await thread(D,'54000000-0000-4000-8000-000000000001');
  await first.query(`reset role;begin;delete from auth.users where id='${D}';`);
  const decision=second.query('reset role;'+auth(B)+`do $$begin
    perform public.meddocs_comment_decide('${edit}','approve',3);
    raise exception 'Unexpected approval of deleted author';
    exception when sqlstate 'P0001' then if sqlerrm not in ('conflict','forbidden') then raise; end if;end$$;`);decision.catch(()=>{});
  await overlap(decision);await first.query('commit;');await decision;await assertPurged(root);
  console.log('PASS: deletion first, moderation waits and fails safely; no text resurrection');

  await first.query(`reset role;begin;delete from auth.users where id='${B}';`);
  const last=second.query(`reset role;do $$begin delete from auth.users where id='${C}';
    raise exception 'Unexpected last-admin deletion';
    exception when sqlstate 'P0001' then if sqlerrm<>'Last administrator cannot be deleted' then raise;end if;end$$;`);last.catch(()=>{});
  await overlap(last);await first.query('commit;');await last;
  assert.equal(await monitor.query("select count(*) from public.staff_accounts where role='admin';"),'1');
  console.log('PASS: concurrent administrator deletion preserves one administrator');
  console.log('Dispose of this local test database after inspection. No hosted connection was made.');
} finally {for(const session of sessions)session.close();}
