import { readFile, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROJECT_REF, PROJECT_NAME, PROJECT_HOST, PROJECT_PORT, PROJECT_USER, MIGRATIONS, extractSuite, functionDigests, preflightSql, dataGuardSql, lockSql, readOnlyAudit, validateTap, validateConnectionInfo, transactionGuardSql } from './lib/meddocs-cloud-pgtap.mjs';

export function parseOptions(args) {
  const options={};
  for(const arg of args){
    const match=/^--(confirm-project|project-ref|ssl-root-cert|psql)=(.+)$/.exec(arg);
    if(arg==='--verify-clean'){if(options.verifyOnly)throw new Error('Duplicate option.');options.verifyOnly=true;continue;}
    if(!match||Object.hasOwn(options,match[1]))throw new Error('Unsupported or duplicate option. No host/URL/password arguments accepted.');
    options[match[1]]=match[2];
  }
  if(options['confirm-project']!==PROJECT_NAME||options['project-ref']!==PROJECT_REF)throw new Error('Explicit confirmation of mednerds-security-tests / wpdfduxzqqlizuhkhebb required.');
  for(const key of ['ssl-root-cert','psql'])if(!isAbsolute(options[key]??'')||/["\r\n]/.test(options[key]))throw new Error('Absolute local client/certificate paths required.');
  if(basename(options.psql).toLowerCase()!=='psql.exe')throw new Error('PostgreSQL psql.exe is required.');
  return options;
}

export function clientEnvironment(password,certificate,parent=process.env) {
  // Never inherit PGHOSTADDR, PGSERVICE, PGOPTIONS, PGPASSFILE or a linked CLI target.
  const env=Object.fromEntries(Object.entries(parent).filter(([key])=>!/^PG/i.test(key)));
  return {...env,PGPASSWORD:password,PGSSLMODE:'verify-full',PGSSLROOTCERT:certificate,PGSSLMINPROTOCOLVERSION:'TLSv1.2',PGGSSENCMODE:'disable',PGCLIENTENCODING:'UTF8',PGCONNECT_TIMEOUT:'15',LC_ALL:'C',LANG:'C'};
}
export function clientArguments(){return ['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',PROJECT_HOST,'-p',PROJECT_PORT,'-U',PROJECT_USER,'-d','postgres'];}

class PsqlConnection {
  constructor(executable,env){
    this.process=spawn(executable,clientArguments(),{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.process.stdout.setEncoding('utf8');this.process.stderr.setEncoding('utf8');
    this.pending=null;this.buffer='';this.number=0;this.closed=false;this.diagnostics='';
    this.done=new Promise(resolve=>this.process.on('close',code=>{
      this.closed=true;
      const reason=this.pending?.guardMessages.find(message=>this.diagnostics.includes(': '+message));
      const state=/ERROR:\s+([A-Z0-9]{5}):/.exec(this.diagnostics)?.[1];
      const step=this.pending?.label??'Connection';
      this.pending?.reject(new Error(reason?'SQL prerequisite failed: '+reason:step+' failed'+(state?' (SQLSTATE '+state+')':'')+'; transaction aborted.'));
      resolve(code);
    }));
    this.process.on('error',()=>this.pending?.reject(new Error('Could not start the local PostgreSQL client.')));
    this.process.stdin.on('error',()=>this.pending?.reject(new Error('PostgreSQL input closed.')));
    this.process.stderr.on('data',chunk=>{this.diagnostics=(this.diagnostics+chunk.toString('utf8')).slice(-16384);}); // Never print raw provider/credential diagnostics.
    this.process.stdout.on('data',chunk=>{
      this.buffer+=chunk.toString('utf8').replaceAll('\r','');
      const p=this.pending;if(!p)return;const at=this.buffer.indexOf(p.marker+'\n');if(at<0)return;
      const output=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+p.marker.length+1);
      clearTimeout(p.timer);this.pending=null;p.resolve(output);
    });
  }
  query(sql,label='SQL operation'){
    if(this.closed||this.pending)throw new Error('A single live physical connection is required.');
    return new Promise((resolve,reject)=>{
      const marker='MEDNERDS_CLOUD_END_'+(++this.number);
      const timer=setTimeout(()=>{this.process.kill();reject(new Error('PostgreSQL statement timed out; connection terminated.'));},30000);
      const guardMessages=[...sql.matchAll(/raise exception '([A-Za-z0-9 .;/-]+)'/g)].map(match=>match[1]);
      this.pending={marker,resolve,reject,timer,guardMessages,label};
      this.process.stdin.write(sql+'\n\\echo '+marker+'\n');
    });
  }
  async close(){
    if(this.pending)clearTimeout(this.pending.timer);
    if(!this.closed)this.process.stdin.end(); // EOF closes libpq; an open transaction is aborted.
    const timeout=setTimeout(()=>this.process.kill(),3000);
    const code=await this.done;clearTimeout(timeout);return code;
  }
}

/** Dependency-injected orchestration for LOCAL mock tests; the CLI below alone opens libpq. */
export async function runCloudSuite(connection,{suite,migrations,audit,terms,privacy,verifyOnly=false}) {
  const {body,count}=extractSuite(suite),digests=functionDigests(migrations),preflight=preflightSql(digests);
  validateConnectionInfo(await connection.query('\\conninfo','Client-to-pooler TLS and identity'));
  const pid=Number((await connection.query('select pg_backend_pid();')).trim());
  const token=randomUUID(),transactionGuard=transactionGuardSql(pid,token);
  const inTransaction=(sql,label)=>connection.query(transactionGuard+sql,label);
  const confirmRollback=async(phase='Rollback')=>{
    const state=JSON.parse((await connection.query("select json_build_object('pid',pg_backend_pid(),'no_transaction',pg_current_xact_id_if_assigned() is null and coalesce(current_setting('mednerds.security_test_transaction',true),'')='');")).trim());
    if(state.pid!==pid||state.no_transaction!==true)throw new Error(phase+' / physical connection not confirmed.');
  };
  const guard=fixtures=>dataGuardSql({fixtures,pid,terms,privacy});
  let rolledBack=false,tap='',completed=false;
  await confirmRollback('Initial pooled-session state'); // Reject a leftover transaction marker/XID.
  try {
    await connection.query((verifyOnly?'begin read only;':'begin;')+" set local statement_timeout='15s'; set local lock_timeout='3s'; set local idle_in_transaction_session_timeout='30s'; set local search_path=pg_catalog,public,extensions; set local mednerds.security_test_transaction='"+token+"';");
    await inTransaction(preflight+guard(false));
    if(!verifyOnly)await inTransaction(lockSql()+preflight+guard(false));
    let checks=0;
    for(const sql of readOnlyAudit(audit)){
      const lines=(await inTransaction(sql)).trim().split('\n').filter(Boolean);
      for(const line of lines){
        const row=JSON.parse(line);
        if(Object.hasOwn(row,'ok')){
          checks++;
          if(row.ok!==true)throw new Error('Read-only prerequisite failed: '+String(row.check_name));
        }
      }
    }
    if(checks<279)throw new Error('Incomplete prerequisite audit.');
    if(!verifyOnly){
      tap+=await inTransaction(guard(false)+'set local search_path=public,extensions; select plan('+count+');');
      let role='postgres';
      for(const [index,sql] of body.entries()){
        // Recheck target/data before every suite statement, including nested writes in assertions.
        const restore=role==='postgres'?'':'set local role '+role+';';
        tap+=await inTransaction('reset role;'+preflight+guard(true)+restore+sql+';','Suite statement '+(index+1)+'/'+body.length);
        const change=/^set local role (anon|authenticated|service_role)$/i.exec(sql);
        if(change)role=change[1].toLowerCase();else if(/^reset role$/i.test(sql))role='postgres';
      }
      tap+=await inTransaction('reset role;'+preflight+guard(true)+'select * from finish();');
      completed=true;
    }
    await inTransaction('rollback;');rolledBack=true;
    await confirmRollback();
    await connection.query(preflight+guard(false));
    validateConnectionInfo(await connection.query('\\conninfo','Final client TLS and identity'));
    await confirmRollback();
    if(!verifyOnly){
      if(!completed)throw new Error('finish() was not reached.');
      try{validateTap(tap,count);}catch(error){throw new Error(error.message+' ROLLBACK and empty database confirmed.');}
    }
    return {count:verifyOnly?0:count,checks,rolledBack,clean:true,tap};
  } finally {
    if(!rolledBack&&!connection.closed){try{await inTransaction('rollback;');}catch{/* Lost affinity or SQL error: close the connection, never reuse an unknown backend. */}}
  }
}

async function passwordFromStdin(){
  let password='';
  process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin){password+=chunk.toString('utf8');if(Buffer.byteLength(password)>4096)throw new Error('Invalid credential input.');}
  password=password.replace(/\r?\n$/,'');
  if(!password||/[\0\r\n]/.test(password))throw new Error('Password must arrive privately through the PowerShell wrapper.');
  return password;
}
export async function main(args){
  const options=parseOptions(args),repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  for(const key of ['psql','ssl-root-cert'])if(!(await stat(options[key])).isFile())throw new Error('Client and CA certificate must be local files.');
  const files=(await readdir(resolve(repo,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort();
  if(files.length!==MIGRATIONS.length||files.some((name,i)=>!name.startsWith(MIGRATIONS[i]+'_')))throw new Error('Unexpected repository migration set.');
  const migrations=await Promise.all(files.map(name=>readFile(resolve(repo,'supabase/migrations',name),'utf8')));
  const suite=await readFile(resolve(repo,'supabase/tests/meddocs_comments.test.sql'),'utf8');
  const audit=await readFile(resolve(repo,'supabase/tests/meddocs_comments_remote_checks.sql'),'utf8');
  extractSuite(suite);functionDigests(migrations);readOnlyAudit(audit); // Fail before credentials/network.
  const versions=[...migrations[2].matchAll(/'(sha256:[a-f0-9]{64})'/g)].map(match=>match[1]);
  if(versions.length!==2)throw new Error('Expected two reviewed legal snapshots.');
  let password=await passwordFromStdin();
  const env=clientEnvironment(password,options['ssl-root-cert']);password='';
  const connection=new PsqlConnection(options.psql,env);delete env.PGPASSWORD;
  let result,exit;
  try{result=await runCloudSuite(connection,{suite,migrations,audit,terms:versions[0],privacy:versions[1],verifyOnly:options.verifyOnly});}
  finally{exit=await connection.close();}
  if(exit!==0)throw new Error('PostgreSQL client did not close successfully.');
  console.log(options.verifyOnly?'PASS: isolated project prerequisites checked; database remains empty.':
    'PASS: '+result.count+' pgTAP assertions; '+result.checks+' prerequisite checks; ROLLBACK and empty database confirmed.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main(process.argv.slice(2)).catch(error=>{
    // Only our controlled errors escape; no stderr, passwords, connection strings or rows.
    console.error('FAIL: '+error.message);
    console.error('No success claimed. On SQL/connection failure, verify cleanup later using --verify-clean.');
    process.exitCode=1;
  });
}
