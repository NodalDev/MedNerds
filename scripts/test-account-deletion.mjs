import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createDeletionHandler, verifiedSessionId } from '../supabase/functions/delete-account/handler.ts';
import { createDeletionApi } from '../src/lib/auth/deletion.ts';
import { AuthStore } from '../src/lib/auth/auth-store.ts';

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const session='cccccccc-cccc-4ccc-8ccc-cccccccccccc',challenge='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const user={id:A,email:'demo@example.test',sessionId:session};
const begin={action:'begin',captchaToken:'test-captcha'};
const confirm={action:'delete',challengeId:challenge,code:'000012',confirmed:true};
function fixture(options={}) {
  const calls=[],state={active:false,used:false,alive:true,originalSessionAlive:true,now:0,expiresAt:300000,challengeId:challenge,...options};
  const deps={
    authenticate:async token=>{calls.push(['authenticate',token]);return token==='valid'&&state.alive?user:null;},
    begin:async account=>{calls.push(['begin',account.id]);return {status:state.lastAdmin?'last_admin':'created',challengeId:challenge};},
    sendOtp:async(email,captcha)=>{calls.push(['send',email,captcha]);return !state.sendFailure;},
    ready:async()=>{if(state.readyFailure)return false;state.active=true;return true;},
    claim:async(account,id)=>{calls.push(['claim',account.id,id]);if(!state.active||state.used||state.expired||state.now>=state.expiresAt||!state.originalSessionAlive||account.id!==A||account.sessionId!==session||id!==state.challengeId)return false;state.used=true;return true;},
    verifyOtp:async(email,code)=>{calls.push(['verify',email,code]);return state.wrongUser?B:state.badCode?null:A;},
    authorize:async(account,id)=>{calls.push(['authorize',account.id,id]);return state.active&&state.used&&!state.expired&&state.now<state.expiresAt&&state.originalSessionAlive&&state.alive&&account.id===A&&account.sessionId===session&&id===state.challengeId;},
    deleteUser:async id=>{calls.push(['delete',id]);return !state.deleteFailure;},cleanup:async()=>{calls.push(['cleanup']);},
  };
  const handler=createDeletionHandler({enabled:!state.disabled,origins:['https://mednerds.ch'],dependencies:()=>deps});
  const request=(body=confirm,token='valid',origin='https://mednerds.ch')=>new Request('https://edge.example.test/delete-account',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,Origin:origin},body:JSON.stringify(body)});
  return {calls,state,deps,request,handler};
}
test('unauthenticated/expired JWTs and disabled deployment never delete or send OTPs',async()=>{
  for(const options of [{},{disabled:true}]) {
    const f=fixture(options);
    for(const token of ['','expired','forged']) {assert.ok((await f.handler(f.request(confirm,token))).status>=400);}
    assert.equal(f.calls.filter(c=>['delete','send'].includes(c[0])).length,0);
  }
});
test('foreign origins, HTTP methods and malformed/supplied user IDs are rejected',async()=>{
  const f=fixture();
  assert.equal((await f.handler(f.request(begin,'valid','https://evil.example'))).status,403);
  assert.equal((await f.handler(new Request('https://edge.example.test',{method:'GET'}))).status,405);
  for(const body of [{...begin,userId:B},{...confirm,userId:B},{...confirm,confirmed:false},null,{action:'delete'},{...confirm,code:'12345'}]) {
    assert.equal((await f.handler(f.request(body))).status,400);
  }
  assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
});
test('a normal session alone does not authorize deletion; successful OTP delivery activates intent',async()=>{
  const f=fixture();assert.equal((await f.handler(f.request())).status,409);
  const result=await f.handler(f.request(begin));assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{status:'code_sent',challengeId:challenge,expiresIn:300});
  assert.deepEqual(f.calls.find(c=>c[0]==='send'),['send',user.email,'test-captcha']);
  const done=await f.handler(f.request());assert.deepEqual(await done.json(),{status:'deleted'});
  assert.deepEqual(f.calls.find(c=>c[0]==='delete'),['delete',A]);
});
test('delivery failure, expired intent and wrong OTP/user cannot reach deleteUser',async()=>{
  for(const options of [{sendFailure:true},{readyFailure:true},{expired:true},{badCode:true},{wrongUser:true}]) {
    const f=fixture(options);await f.handler(f.request(begin));
    assert.ok((await f.handler(f.request())).status>=400);
    assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
  }
});

test('five-minute boundary is exclusive both at claim and after OTP verification',async()=>{
  for(const now of [299999,300000,300001]) {
    const f=fixture();await f.handler(f.request(begin));f.state.now=now;
    assert.equal((await f.handler(f.request())).status,now<300000?200:409);
    assert.equal(f.calls.filter(c=>c[0]==='delete').length,now<300000?1:0);
  }
  const f=fixture();await f.handler(f.request(begin));
  f.deps.verifyOtp=async()=>{f.state.now=300000;return A;};
  assert.equal((await f.handler(f.request())).status,409);
  assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
});

test('a replaced intent during OTP verification invalidates the old claimed challenge',async()=>{
  const f=fixture();await f.handler(f.request(begin));
  f.deps.verifyOtp=async()=>{f.state.challengeId=B;f.state.used=false;return A;};
  assert.equal((await f.handler(f.request())).status,409);
  assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
});
test('claim persists across requests and consumes even a failed verification',async()=>{
  const f=fixture({badCode:true});await f.handler(f.request(begin));
  assert.equal((await f.handler(f.request())).status,403);f.state.badCode=false;
  assert.equal((await f.handler(f.request())).status,409);
  assert.equal(f.calls.filter(c=>c[0]==='verify').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
});
test('parallel double requests result in exactly one OTP verification and deletion',async()=>{
  const f=fixture();await f.handler(f.request(begin));
  const results=await Promise.all([f.handler(f.request()),f.handler(f.request())]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(f.calls.filter(c=>c[0]==='verify').length,1);assert.equal(f.calls.filter(c=>c[0]==='delete').length,1);
});

test('another request cannot reuse a claim while the first OTP verification is still pending',async()=>{
  const f=fixture();await f.handler(f.request(begin));
  let releaseVerification,enteredVerification;
  const entered=new Promise(resolve=>{enteredVerification=resolve;});
  const pending=new Promise(resolve=>{releaseVerification=resolve;});
  f.deps.verifyOtp=async()=>{f.calls.push(['verify']);enteredVerification();return pending;};
  const first=f.handler(f.request());await entered;
  assert.equal((await f.handler(f.request())).status,409);
  assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
  releaseVerification(A);assert.equal((await first).status,200);
  assert.equal(f.calls.filter(c=>c[0]==='verify').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='delete').length,1);
});

test('an intent belongs to its original user/session, even when Auth still accepts a token',async()=>{
  for(const account of [{...user,id:B},{...user,sessionId:B}]) {
    const f=fixture();await f.handler(f.request(begin));f.deps.authenticate=async()=>account;
    assert.equal((await f.handler(f.request())).status,409);
    assert.equal(f.calls.filter(c=>['verify','delete'].includes(c[0])).length,0);
  }
  const f=fixture();await f.handler(f.request(begin));f.state.originalSessionAlive=false;
  assert.equal((await f.handler(f.request())).status,409);
  assert.equal(f.calls.filter(c=>['verify','delete'].includes(c[0])).length,0);
});
test('last admin preflight stops delivery; DB guard failure during delete never claims success',async()=>{
  const f=fixture({lastAdmin:true});assert.equal((await f.handler(f.request(begin))).status,409);
  assert.equal(f.calls.filter(c=>c[0]==='send').length,0);
  const race=fixture({deleteFailure:true});await race.handler(race.request(begin));
  assert.deepEqual(await (await race.handler(race.request())).json(),{status:'delete_failed'});
});
test('logout/session/user/email changes and expiry during OTP verification fail the final authorization',async()=>{
  for(const change of [()=>null,()=>({...user,sessionId:B}),()=>({...user,id:B}),()=>({...user,email:'changed@example.test'})]) {
    const f=fixture();await f.handler(f.request(begin));
    f.deps.verifyOtp=async()=>{f.deps.authenticate=async()=>change();return A;};
    assert.equal((await f.handler(f.request())).status,401);assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
  }
  const f=fixture();await f.handler(f.request(begin));f.deps.verifyOtp=async()=>{f.state.expired=true;return A;};
  assert.equal((await f.handler(f.request())).status,409);assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
});

test('expiry or original-session revocation between OTP verification and the final RPC prevents deletion',async()=>{
  for(const revoke of [state=>{state.expired=true;},state=>{state.originalSessionAlive=false;}]) {
    const f=fixture();await f.handler(f.request(begin));
    const authenticate=f.deps.authenticate;let authentications=0;
    f.deps.authenticate=async token=>{const account=await authenticate(token);if(++authentications===2)revoke(f.state);return account;};
    assert.equal((await f.handler(f.request())).status,409);
    assert.equal(f.calls.filter(c=>c[0]==='authorize').length,1);
    assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
    assert.equal((await f.handler(f.request())).status,409);
  }
});

test('failed or thrown Auth deletion never reports success and cannot reuse the intent',async()=>{
  for(const throws of [false,true]) {
    const f=fixture({deleteFailure:true});await f.handler(f.request(begin));
    if(throws)f.deps.deleteUser=async()=>{f.calls.push(['delete',A]);throw new Error('private Auth diagnostic');};
    const response=await f.handler(f.request());
    assert.deepEqual(await response.json(),{status:throws?'unavailable':'delete_failed'});
    assert.equal((await f.handler(f.request())).status,409);
    assert.equal(f.calls.filter(c=>c[0]==='delete').length,1);
    assert.equal(f.calls.filter(c=>c[0]==='cleanup').length,3);
  }
});

test('errors at each provider boundary fail closed, clean up, and consume claimed attempts',async()=>{
  for(const boundary of ['authenticate','ready','claim','verifyOtp','authorize']) {
    const f=fixture();if(!['authenticate','ready'].includes(boundary))await f.handler(f.request(begin));
    f.deps[boundary]=async()=>{throw new Error('private diagnostic');};
    const response=await f.handler(f.request(['authenticate','ready'].includes(boundary)?begin:confirm));
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{status:'unavailable'});
    assert.equal(f.calls.filter(c=>c[0]==='delete').length,0);
    assert.equal(f.calls.at(-1)[0],'cleanup');
    if(['verifyOtp','authorize'].includes(boundary))assert.equal((await f.handler(f.request())).status,409);
  }
});

test('cleanup failure cannot turn an unconfirmed deletion into success or hide a confirmed result',async()=>{
  for(const deleteFailure of [false,true]) {
    const f=fixture({deleteFailure});await f.handler(f.request(begin));
    f.deps.cleanup=async()=>{throw new Error('private cleanup diagnostic');};
    assert.deepEqual(await (await f.handler(f.request())).json(),{status:deleteFailure?'delete_failed':'deleted'});
  }
});

test('allowed CORS preflight never authenticates; disallowed origins never instantiate dependencies',async()=>{
  const f=fixture();
  const response=await f.handler(new Request('https://edge.example.test',{method:'OPTIONS',headers:{Origin:'https://mednerds.ch'}}));
  assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://mednerds.ch');
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(f.calls,[]);
  let instantiated=false;
  const handler=createDeletionHandler({enabled:true,origins:['https://mednerds.ch'],dependencies:()=>{instantiated=true;return f.deps;}});
  const denied=await handler(f.request(begin,'valid','https://evil.example'));
  assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);assert.equal(instantiated,false);
});
test('provider errors are masked and cleanup runs without exposing diagnostics or tokens',async()=>{
  const f=fixture();f.deps.begin=async()=>{throw new Error('secret provider diagnostic');};
  const result=await f.handler(f.request(begin));assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{status:'unavailable'});assert.ok(f.calls.some(c=>c[0]==='cleanup'));
});
test('session claim parser tolerates malformed tokens but never determines user identity',()=>{
  const jwt='header.'+Buffer.from(JSON.stringify({session_id:session,sub:B})).toString('base64url')+'.signature';
  assert.equal(verifiedSessionId(jwt),session);
  for(const value of ['','broken','x.'+Buffer.from('{}').toString('base64url')+'.y']) assert.equal(verifiedSessionId(value),null);
});
test('browser API sends no identity; HTTP errors cannot impersonate success',async()=>{
  const bodies=[];
  const client={auth:{getSession:async()=>({data:{session:{access_token:'test-only'}},error:null})},functions:{invoke:async(_name,options)=>{
    bodies.push(options.body);return {data:null,error:{context:new Response(JSON.stringify({status:'deleted'}),{status:500})}};}}};
  const api=createDeletionApi(client),signal=new AbortController().signal;
  assert.equal((await api.begin('captcha',signal)).status,'unavailable');
  assert.equal((await api.confirm(challenge,'000012',signal)).status,'unavailable');
  assert.deepEqual(bodies,[{action:'begin',captchaToken:'captcha'},confirm]);
});
test('confirmed deletion clears AuthStore and owned storage, but never another account',async()=>{
  let listener,initial={user:{id:A,email:user.email}},signouts=[],cleared=[];
  const auth={getSession:async()=>({data:{session:initial},error:null}),onAuthStateChange:cb=>{listener=cb;return {data:{subscription:{unsubscribe(){}}}};},
    signOut:async options=>{signouts.push(options);throw new Error('already deleted');}};
  const store=new AuthStore(auth,Date.now,id=>cleared.push(id));store.subscribe(()=>{});await store.initialize();
  assert.equal(await store.clearDeletedAccount(B),false);assert.equal(signouts.length,0);
  assert.equal(await store.clearDeletedAccount(A),true);assert.deepEqual(signouts,[{scope:'local'}]);assert.deepEqual(cleared,[A]);
  assert.equal(store.state.userId,null);assert.equal(store.state.email,null);assert.equal(store.state.status,'signed-out');
  listener('SIGNED_IN',{user:{id:B,email:'other@example.test'}});
  assert.equal(await store.clearDeletedAccount(A),false);assert.equal(store.state.userId,B);
});
test('SQL contract: private bounded intent, service-only RPCs, atomic claim and last-admin DELETE guard',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20261010010000_account_deletion.sql',import.meta.url),'utf8');
  assert.match(sql,/user_id uuid primary key references auth.users\(id\) on delete cascade/);
  assert.match(sql,/references auth.sessions\(id\) on delete cascade/);
  assert.match(sql,/consumed_at is null/);assert.match(sql,/interval '5 minutes'/);assert.match(sql,/interval '60 seconds'/);
  assert.match(sql,/enable row level security/);assert.match(sql,/from public, anon, authenticated/);
  assert.equal((sql.match(/security definer set search_path = ''/g)||[]).length,5);
  assert.match(sql,/lock table public.staff_accounts in share row exclusive mode/);
  assert.match(sql,/before delete on auth.users/);
  assert.match(sql,/create function public\.account_deletion_authorize\([^]*?returns boolean language sql volatile security definer/);
  const source=await readFile(new URL('../supabase/functions/delete-account/index.ts',import.meta.url),'utf8');
  assert.match(source,/admin.auth.admin.deleteUser\(id, false\)/);assert.match(source,/shouldCreateUser: false/);
  assert.match(source,/persistSession: false/);assert.match(source,/ACCOUNT_DELETION_ENABLED/);
  for(const file of ['20261009000000_profiles_and_staff.sql','20261010000000_account_profile_extensions.sql']) {
    const old=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
    assert.match(old,/references auth.users\(id\) on delete cascade/);
  }
});

test('account deletion has no profile-completion or legal feature gate',async()=>{
  for(const file of ['../supabase/functions/delete-account/index.ts','../supabase/functions/delete-account/handler.ts','../src/lib/auth/deletion.ts']) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/getAccountFeatureAccess|getAccountSetupStatus|isProfileReadyForPublicActions|display_name/);
  }
  const docs=await readFile(new URL('../src/lib/auth/README.md',import.meta.url),'utf8');
  assert.ok(docs.includes('/account/?action=delete'));
  assert.ok(docs.includes('ohne vorher einen Anzeigenamen zu verlangen'));
});
