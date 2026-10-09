import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { ProfileStore, createProfileApi } from '../src/lib/auth/profile-store.ts';
import { validateDisplayName, getStaffAuthor, isStaffAuthorOfArticle } from '../src/lib/auth/profile.ts';

const profile = (id='A', name=null) => ({user_id:id, display_name:name, created_at:'2026-10-09T00:00:00Z', updated_at:'2026-10-09T00:00:00Z'});
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };
function mockApi() {
  const updates=[];
  return { updates, async readProfile(id){return {data:profile(id),error:null};},
    async readStaff(){return {data:null,error:null};},
    async updateName(id,name){updates.push({id,name});return {data:profile(id,name),error:null};} };
}
const ready = async store => {
  for(let i=0;i<20;i++){if(store.state.status!=='loading')return;await new Promise(r=>setTimeout(r,0));}
  throw new Error('Profile load did not finish');
};

test('optional Unicode display names: trim, code-point lengths, no controls/bidi, no email fallback', () => {
  for(const [raw,value] of [['',null],[' \u00a0 ',null],['  Zoë Müller  ','Zoë Müller'],['\u3000李雷\u3000','李雷'],['😀'.repeat(60),'😀'.repeat(60)],['<b>Demo</b>','<b>Demo</b>'],['Administrator','Administrator']]) {
    assert.deepEqual(validateDisplayName(raw),{ok:true,value});
  }
  for(const raw of ['A','😀'.repeat(61),'a\nb','a\tb','ab\u0000','ab\u007f','ab\u0085','ab\u202e','ab\u200b','ab\ufeff']) assert.equal(validateDisplayName(raw).ok,false);
});

test('only trusted staff author_slug matches editorial IDs; names do not establish article authorship', () => {
  const staff={user_id:'A',role:'author',author_slug:'orlando-frey',created_at:''};
  assert.equal(getStaffAuthor(staff).name,'Orlando Frey');
  assert.equal(isStaffAuthorOfArticle(staff,['orlando-frey']),true);
  assert.equal(isStaffAuthorOfArticle(staff,['tim-luginbuehl']),false);
  assert.equal(isStaffAuthorOfArticle(null,['orlando-frey']),false);
  for(const slug of ['unknown','__proto__',null]) assert.equal(getStaffAuthor({...staff,author_slug:slug}),undefined);
});

test('one typed API updates only display_name and filters every query by stable user ID', async () => {
  const calls=[];
  const client={from(table){const chain={};for(const method of ['select','eq','abortSignal','update']) chain[method]=(...args)=>{calls.push({table,method,args});return chain;};
    chain.maybeSingle=chain.single=async()=>({data:profile('A'),error:null});return chain;}};
  const api=createProfileApi(client), signal=new AbortController().signal;
  await api.readProfile('A',signal);await api.readStaff('A',signal);await api.updateName('A','Demo',signal);
  assert.deepEqual(calls.find(c=>c.method==='update').args,[{display_name:'Demo'}]);
  assert.equal(calls.filter(c=>c.method==='eq' && c.args[0]==='user_id' && c.args[1]==='A').length,3);
  assert.equal(calls.filter(c=>c.method==='abortSignal').length,3);
});

test('signed-out state makes no requests; own profile loads once and saves a normalized name', async () => {
  const api=mockApi(),store=new ProfileStore(api);let reads=0;
  api.readProfile=async id=>{reads++;return {data:profile(id),error:null};};
  assert.equal(await store.save('Demo'),false);assert.equal(reads,0);
  store.setUser('A');await ready(store);store.setUser('A');assert.equal(reads,1);
  assert.equal(store.state.profile.display_name,null);assert.equal(store.state.staff,null);
  assert.equal(await store.save('  Zoë  '),true);assert.deepEqual(api.updates,[{id:'A',name:'Zoë'}]);
  assert.equal(store.state.profile.display_name,'Zoë');assert.ok(store.state.message);
  assert.equal(await store.save(''),true);assert.equal(store.state.profile.display_name,null);
});

test('invalid names and duplicate submits never create additional writes', async () => {
  const api=mockApi(),store=new ProfileStore(api);store.setUser('A');await ready(store);
  assert.equal(await store.save('A'),false);assert.equal(api.updates.length,0);assert.equal(store.state.invalidName,true);
  const pending=deferred();let writes=0;api.updateName=()=>{writes++;return pending.promise;};
  const save=store.save('Demo');assert.equal(store.state.saving,true);assert.equal(await store.save('Other'),false);assert.equal(writes,1);
  pending.resolve({data:profile('A','Demo'),error:null});assert.equal(await save,true);assert.equal(store.state.saving,false);
});

test('late load responses cannot leak across logout, user changes or disposal', async () => {
  const api=mockApi(),pending=deferred(),store=new ProfileStore(api);
  api.readProfile=id=>id==='A'?pending.promise:Promise.resolve({data:profile(id,'User B'),error:null});
  store.setUser('A');await new Promise(r=>setTimeout(r,0));store.setUser('B');await ready(store);
  pending.resolve({data:profile('A','Private A'),error:null});await new Promise(r=>setTimeout(r,0));
  assert.equal(store.state.profile.user_id,'B');assert.equal(store.state.profile.display_name,'User B');
  store.setUser(null);assert.equal(store.state.profile,null);assert.equal(store.state.staff,null);
  assert.equal(await store.save('Demo'),false);store.dispose();assert.equal(store.state.userId,null);
});

test('logout aborts an in-flight write and ignores its success', async () => {
  const api=mockApi(),pending=deferred(),store=new ProfileStore(api);let signal;
  api.updateName=(_id,_name,s)=>{signal=s;return pending.promise;};
  store.setUser('A');await ready(store);const saving=store.save('Demo');store.setUser(null);
  assert.equal(signal.aborted,true);pending.resolve({data:profile('A','Demo'),error:null});
  assert.equal(await saving,false);assert.equal(store.state.profile,null);assert.equal(store.state.message,'');
});

test('rapid identity changes load only the latest identity; pending writes cannot overwrite another account', async () => {
  const api=mockApi(),reads=[];
  api.readProfile=async id=>{reads.push(id);return {data:profile(id),error:null};};
  const store=new ProfileStore(api);store.setUser('A');store.setUser('B');store.setUser('A');await ready(store);
  assert.deepEqual(reads,['A']);
  const pending=deferred();api.updateName=()=>pending.promise;
  const save=store.save('Old A');store.setUser('B');await ready(store);
  pending.resolve({data:profile('A','Old A'),error:null});assert.equal(await save,false);
  assert.equal(store.state.profile.user_id,'B');assert.equal(store.state.profile.display_name,null);
});

test('missing migration, missing row and transport failures do not affect auth and never expose diagnostics', async () => {
  for(const result of [{data:null,error:{code:'42P01',message:'private diagnostic'}},{data:null,error:{code:'PGRST205'}},{data:null,error:null}]) {
    const api=mockApi();api.readProfile=async()=>result;const store=new ProfileStore(api);store.setUser('A');await ready(store);
    assert.equal(store.state.status,'error');assert.ok(store.state.error.includes('Anmeldung funktioniert weiterhin'));assert.ok(!store.state.error.includes('private'));
  }
  const api=mockApi();api.readProfile=async()=>{throw new Error('private network error');};
  const store=new ProfileStore(api);store.setUser('A');await ready(store);assert.equal(store.state.status,'error');assert.ok(!store.state.error.includes('private'));
  api.readProfile=async id=>({data:profile(id),error:null});await store.load();assert.equal(store.state.status,'ready');
  api.updateName=async()=>{throw new Error('private');};assert.equal(await store.save('Demo'),false);assert.equal(store.state.saving,false);
});

test('foreign results and unknown staff roles are rejected; staff read failure does not become a user role', async () => {
  const api=mockApi();api.readStaff=async()=>({data:{user_id:'A',role:'admin',author_slug:'orlando-frey'},error:null});
  const store=new ProfileStore(api);store.setUser('A');await ready(store);assert.equal(store.state.staff.role,'admin');
  api.readStaff=async()=>({data:{user_id:'B',role:'admin'},error:null});await store.load();assert.equal(store.state.staffStatus,'error');assert.equal(store.state.staff,null);
  api.readStaff=async()=>({data:{user_id:'A',role:'superadmin'},error:null});await store.load();assert.equal(store.state.staffStatus,'error');
  api.readProfile=async()=>({data:profile('B'),error:null});await store.load();assert.equal(store.state.status,'error');assert.equal(store.state.profile,null);
});

test('migration contracts: explicit RLS, only name updates, private definer, idempotent backfill (static, not DB validation)', async () => {
  const sql=await readFile(new URL('../supabase/migrations/20261009000000_profiles_and_staff.sql',import.meta.url),'utf8');
  const backfill=await readFile(new URL('../supabase/migrations/20261009000001_backfill_profiles.sql',import.meta.url),'utf8');
  assert.equal((sql.match(/enable row level security/g)||[]).length,2);
  assert.match(sql,/grant update \(display_name\) on public.profiles to authenticated/);
  assert.match(sql,/revoke all on table public.profiles, public.staff_accounts from public, anon, authenticated/);
  assert.match(sql,/for update to authenticated[\s\S]*with check \(\(select auth.uid\(\)\) = user_id\)/);
  assert.equal((sql.match(/security definer/g)||[]).length,1);assert.match(sql,/security definer set search_path = ''/);
  assert.ok(!sql.includes('raw_user_meta_data'));assert.ok(!sql.includes('for insert'));assert.ok(!sql.includes('for delete'));
  assert.match(backfill,/select id from auth.users[\s\S]*on conflict \(user_id\) do nothing/);
  const dbTest=await readFile(new URL('../supabase/tests/profiles_staff.test.sql',import.meta.url),'utf8');
  const statement=backfill.replace(/^--.*$/gm,'').trim();
  assert.equal(dbTest.split(statement).length-1,2, 'RLS test uses the migration backfill verbatim twice');
});
