import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LegalStore, createLegalApi } from '../src/lib/auth/legal-store.ts';
import { ProfileStore } from '../src/lib/auth/profile-store.ts';
import { validateProfessionalRole, hasPublicDisplayName, isProfileReadyForPublicActions, publicProfessionalRole, defaultProfileExtensions } from '../src/lib/auth/profile.ts';
import { avatarInitials, gravatarUrl, AccountAvatar } from '../src/lib/auth/avatar.ts';
import { getLegalDocumentVersions } from '../src/lib/auth/legal-documents.ts';
import { getAccountSetupStatus, getAccountFeatureAccess, getAccountReturnPath, createAccountSetupHref } from '../src/lib/auth/account-access.ts';

const versions=await getLegalDocumentVersions();
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const waitReady=async store=>{for(let i=0;i<30;i++){if(!store.state.loading && store.state.status!=='loading')return;await new Promise(r=>setTimeout(r,0));}throw new Error('Store did not load');};
const policy=(extra={})=>({registration_enabled:true,gravatar_enabled:true,terms_version:versions.terms,privacy_notice_version:versions.privacy,accepted:false,...extra});
const profile=(id='A')=>({user_id:id,display_name:null,created_at:'2026-10-10T00:00:00Z',updated_at:'2026-10-10T00:00:00Z',...defaultProfileExtensions});

test('central setup status uses only the authenticated user\'s loaded persisted row',()=>{
  const state={status:'ready',userId:'A',profile:profile()};
  assert.equal(getAccountSetupStatus(state,'A'),'required');
  const formValue='Valid unsaved name';assert.ok(formValue);
  assert.equal(getAccountSetupStatus(state,'A'),'required');
  for(const display_name of [null,'',' ','A','x'.repeat(61),'A\nB']) {
    assert.equal(getAccountSetupStatus({...state,profile:{...profile(),display_name}},'A'),'required');
  }
  const complete={...state,profile:{...profile(),display_name:'Nickname'}};
  assert.equal(getAccountSetupStatus(complete,'A'),'complete');
  for(const status of ['idle','loading','error'])assert.equal(getAccountSetupStatus({...complete,status},'A'),'pending');
  for(const userId of [null,'B'])assert.equal(getAccountSetupStatus(complete,userId),'pending');
  assert.equal(getAccountSetupStatus({...complete,profile:{...complete.profile,user_id:'B'}},'A'),'pending');
  assert.equal(getAccountSetupStatus({...complete,profile:null},'A'),'pending');
});

test('feature access independently requires authentication, own saved profile, and current legal acceptance',()=>{
  const context={auth:{status:'signed-in',userId:'A'},profile:{status:'ready',userId:'A',profile:profile()},
    legal:{userId:'A',loading:false,saving:false,error:'',policy:{terms:versions.terms,privacy:versions.privacy,accepted:true}},versions};
  assert.equal(getAccountFeatureAccess(context),'profile-required');
  const complete={...context,profile:{...context.profile,profile:{...profile(),display_name:'Nickname'}}};
  assert.equal(getAccountFeatureAccess(complete),'ready');
  assert.equal(getAccountFeatureAccess({...complete,auth:{status:'signed-out',userId:null}}),'authentication-required');
  for(const status of ['loading','error'])assert.equal(getAccountFeatureAccess({...complete,auth:{status,userId:'A'}}),'authentication-pending');
  assert.equal(getAccountFeatureAccess({...complete,profile:{...complete.profile,status:'loading'}}),'profile-pending');
  for(const patch of [{userId:'B'},{loading:true},{saving:true},{error:'Unavailable'}]) {
    assert.equal(getAccountFeatureAccess({...complete,legal:{...complete.legal,...patch}}),'legal-pending');
  }
  for(const patch of [{accepted:false},{terms:'old'},{privacy:'old'}]) {
    assert.equal(getAccountFeatureAccess({...complete,legal:{...complete.legal,policy:{...complete.legal.policy,...patch}}}),'legal-required');
  }
  assert.equal(getAccountFeatureAccess({...complete,legal:{...complete.legal,error:'Unavailable'}},{requireLegalAcceptance:false}),'ready');
  assert.equal(getAccountFeatureAccess(context,{requireLegalAcceptance:false}),'profile-required');
});

test('feature return links preserve local paths/query/fragment and reject external redirects or account loops',()=>{
  const origin='https://mednerds.ch',path='/medlearn/beispiel/?chapter=2#aufgabe';
  assert.equal(getAccountReturnPath(path,origin),path);
  const href=createAccountSetupHref(path,origin),url=new URL(href,origin);
  assert.equal(url.pathname,'/account/');assert.equal(url.hash,'#profil-vervollstaendigen');
  assert.equal(url.searchParams.get('returnTo'),path);
  for(const mode of ['login','register']){
    const entry=new URL(createAccountSetupHref(path,origin,mode),origin);
    assert.equal(entry.searchParams.get('mode'),mode);assert.equal(entry.searchParams.get('returnTo'),path);
  }
  for(const raw of [null,'','https://evil.example/','javascript:alert(1)','//evil.example/','//mednerds.ch/meddocs/',
    '/\\evil.example/','/account','/account/?returnTo=/medlearn/','/account/#profil-vervollstaendigen']) {
    assert.equal(getAccountReturnPath(raw,origin),null);
    assert.equal(createAccountSetupHref(raw??'',origin),'/account/#profil-vervollstaendigen');
  }
});

test('feature gate stays closed during unsaved input, pending/failed writes and completes only on a confirmed stored name',async()=>{
  let stored=profile(),pending=deferred();
  const store=new ProfileStore({readProfile:async()=>({data:stored,extensionsAvailable:true,error:null}),
    readStaff:async()=>({data:null,error:null}),updateName:()=>pending.promise});
  store.setUser('A');await waitReady(store);
  const access=()=>getAccountFeatureAccess({auth:{status:'signed-in',userId:'A'},profile:store.state,versions,
    legal:{userId:'A',loading:false,saving:false,error:'',policy:{terms:versions.terms,privacy:versions.privacy,accepted:true}}});
  assert.equal(access(),'profile-required');
  const first=store.completeProfile('Nickname');assert.equal(store.state.saving,true);
  assert.equal(access(),'profile-required');assert.equal(store.state.profile.display_name,null);
  pending.resolve({data:null,error:{code:'42501'}});assert.equal(await first,false);assert.equal(access(),'profile-required');
  pending=deferred();const retry=store.completeProfile('Nickname');assert.equal(access(),'profile-required');
  stored={...stored,display_name:'Nickname'};pending.resolve({data:stored,error:null});
  assert.equal(await retry,true);assert.equal(access(),'ready');
  await store.load();assert.equal(access(),'ready');
  store.setUser(null);assert.equal(access(),'profile-pending');
  store.setUser('A');await waitReady(store);assert.equal(access(),'ready');store.dispose();
});

test('future comment and personalized-learning writes explicitly require server authorization (documentation)',async()=>{
  const docs=await readFile(new URL('../src/lib/auth/README.md',import.meta.url),'utf8');
  for(const required of ['getAccountFeatureAccess','schreiben, beantworten oder bearbeiten','Lernfortschritte',
    'Testergebnisse','serverseitig durch PostgreSQL/RLS','erst mit der jeweiligen Backend-Implementierung',
    'Öffentliche Lernmaterialien','Gastkommentare'])assert.ok(docs.includes(required),required);
});

test('professional role is optional Unicode text, normalized, at most 80 codepoints, never a staff role',()=>{
  for(const [raw,value] of [['',null],['  ',null],['  Pflege\u00a0  Ausbildung  ','Pflege Ausbildung'],['Ärztin','Ärztin'],['😀'.repeat(80),'😀'.repeat(80)]]) assert.deepEqual(validateProfessionalRole(raw),{ok:true,value});
  for(const raw of ['a\nb','a\tb','ab\u202e','x'.repeat(81)]) assert.equal(validateProfessionalRole(raw).ok,false);
  for(const name of [null,'',' ','A']) assert.equal(hasPublicDisplayName({display_name:name}),false);
  assert.equal(hasPublicDisplayName({display_name:'Nickname'}),true);
  assert.equal(isProfileReadyForPublicActions({display_name:'Nickname'},false),false);
  assert.equal(isProfileReadyForPublicActions({display_name:' '},true),false);
  assert.equal(isProfileReadyForPublicActions({display_name:'Nickname'},true),true);
  assert.equal(publicProfessionalRole({...profile(),professional_role:'Ärztin'}),null);
  assert.equal(publicProfessionalRole({...profile(),professional_role_public:true,professional_role:null}),null);
  assert.equal(publicProfessionalRole({...profile(),professional_role_public:true,professional_role:'Ärztin'}),'Ärztin');
});

test('initials use display names only; SHA-256 normalizes email and never emits plaintext',async()=>{
  assert.equal(avatarInitials('Orlando Frey'),'OF');assert.equal(avatarInitials(null),'');
  for (const name of ['', ' ', 'A', 'A\nB']) assert.equal(avatarInitials(name),'');
  assert.equal(avatarInitials(' Zoë  Müller '),'ZM');assert.equal(avatarInitials('李 雷'),'李雷');
  const expected=createHash('sha256').update('demo@example.test').digest('hex');
  assert.equal(await gravatarUrl(' Demo@Example.Test '),`https://gravatar.com/avatar/${expected}?s=128&r=g&d=404`);
});

test('disabled or unsaved Gravatar preference creates no external image',()=>{
  const initials={textContent:'',hidden:false},neutral={hidden:true},host={dataset:{},
    querySelector:selector=>selector==='[data-initials]'?initials:neutral,append(){appended++;}};
  let appended=0;
  const avatar=new AccountAvatar(host);
  avatar.update(profile(),'demo@example.test',true);
  avatar.update({...profile(),avatar_provider:'gravatar'},'demo@example.test',false);
  avatar.update(null,null,true);assert.equal(appended,0);assert.equal(initials.textContent,'');
  assert.equal(initials.hidden,true);assert.equal(neutral.hidden,false);assert.equal(host.dataset.avatarState,'neutral');
  avatar.update({...profile(),display_name:'Zoë Müller'},'demo@example.test',false);
  assert.equal(initials.textContent,'ZM');assert.equal(initials.hidden,false);assert.equal(neutral.hidden,true);
  avatar.update({...profile(),avatar_provider:'gravatar'},'demo@example.test',true);
  assert.equal(appended,0);assert.equal(neutral.hidden,false);avatar.dispose();
});

test('legal versions are exact current-document snapshots and migration versions match (static)',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20261010000000_account_profile_extensions.sql',import.meta.url),'utf8');
  assert.ok(sql.includes(versions.terms));assert.ok(sql.includes(versions.privacy));
  assert.match(sql,/for select to authenticated using \(\(select auth.uid\(\)\) = user_id\)/);
  assert.match(sql,/email_confirmed_at is not null/);assert.match(sql,/where is_current and terms_version = requested_terms_version/);
  assert.match(sql,/on conflict \(user_id, terms_version, privacy_notice_version\) do nothing/);
  assert.ok(!/grant update on/i.test(sql));assert.ok(!sql.includes('raw_user_meta_data'));
});

test('remote checks stay read-only, cover privileges and use the actual document hashes (static)',async()=>{
  const sql=await readFile(new URL('../supabase/tests/account_phase21_remote_checks.sql',import.meta.url),'utf8');
  assert.ok(sql.includes(versions.terms));assert.ok(sql.includes(versions.privacy));
  for(const required of ['relrowsecurity','pg_policies','has_column_privilege','has_schema_privilege',
    'has_function_privilege','aclexplode','pg_trigger','pg_constraint','named_profiles','orphan_staff']) {
    assert.ok(sql.includes(required),`Missing remote inspection: ${required}`);
  }
  const statements=sql.replace(/--[^\r\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
  for(const statement of statements) {
    assert.match(statement,/^(select|with)\b/i);
    const withoutLiterals=statement.replace(/'(?:''|[^'])*'/g,"''");
    assert.doesNotMatch(withoutLiterals,/\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|set|do|call|copy|set_config|record_account_legal_acceptance)\b/i);
  }
});

test('legal API sends only document versions, never user IDs or client timestamps',async()=>{
  const calls=[];
  const api=createLegalApi({rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:null,error:null})};}});
  await api.read(new AbortController().signal);await api.accept(versions.terms,versions.privacy,new AbortController().signal);
  assert.deepEqual(calls[1],{name:'record_account_legal_acceptance',args:{requested_terms_version:versions.terms,requested_privacy_notice_version:versions.privacy}});
});

test('legal acceptance requires identity and current server versions; failure allows retry without false success',async()=>{
  let fail=true,writes=0;
  const api={read:async()=>({data:policy(),error:null}),accept:async()=>{writes++;return fail?{data:null,error:{code:'XX'}}:{data:{user_id:'A',terms_version:versions.terms,privacy_notice_version:versions.privacy,accepted_at:'2026-10-10T00:00:00Z'},error:null};}};
  const store=new LegalStore(api);store.setUser(null);await waitReady(store);
  assert.equal(await store.accept(versions),false);assert.equal(writes,0);
  store.setUser('A');await waitReady(store);assert.equal(await store.accept({...versions,terms:'forged'}),false);
  assert.equal(await store.accept(versions),false);assert.equal(store.state.policy.accepted,false);assert.ok(store.state.error);
  fail=false;assert.equal(await store.accept(versions),true);assert.equal(store.state.policy.accepted,true);
});

test('legal proof cannot cross user changes; duplicate submits are rejected',async()=>{
  const pending=deferred();let writes=0;
  const store=new LegalStore({read:async()=>({data:policy(),error:null}),accept:()=>{writes++;return pending.promise;}});
  store.setUser('A');await waitReady(store);const accepting=store.accept(versions);
  assert.equal(await store.accept(versions),false);assert.equal(writes,1);
  store.setUser('B');await waitReady(store);pending.resolve({data:{user_id:'A',terms_version:versions.terms,privacy_notice_version:versions.privacy,accepted_at:'date'},error:null});
  assert.equal(await accepting,false);assert.equal(store.state.policy.accepted,false);store.dispose();
});

test('missing or malformed legal backend disables registration and external avatars',async()=>{
  for(const result of [{data:null,error:{code:'PGRST202'}},{data:{registration_enabled:true},error:null},{data:policy({terms_version:null}),error:null}]) {
    const store=new LegalStore({read:async()=>result,accept:async()=>{throw new Error('must not write');}});
    store.setUser(null);await waitReady(store);assert.equal(store.matches(versions),false);assert.equal(store.state.policy.gravatarEnabled,false);
  }
});

test('profile extension fields save together, visibility clears on empty role and old schema cannot claim success',async()=>{
  let saved;
  const api={readProfile:async()=>({data:profile(),extensionsAvailable:true,error:null}),readStaff:async()=>({data:null,error:null}),
    updateName:async(id,name,_signal,extensions)=>{saved={display_name:name,...extensions};return {data:{...profile(id),...saved},error:null};}};
  const store=new ProfileStore(api);store.setUser('A');await waitReady(store);
  assert.equal(await store.save('Nick',{professionalRole:'  Assistenzärztin ',professionalRolePublic:true,gravatar:true}),true);
  assert.deepEqual(saved,{display_name:'Nick',professional_role:'Assistenzärztin',professional_role_public:true,avatar_provider:'gravatar'});
  await store.save('Nick',{professionalRole:' ',professionalRolePublic:true,gravatar:false});assert.equal(saved.professional_role,null);assert.equal(saved.professional_role_public,false);
  api.readProfile=async()=>({data:profile(),extensionsAvailable:false,error:null});await store.load();
  assert.equal(await store.save('Nick',{professionalRole:'Ärztin',professionalRolePublic:false,gravatar:false}),false);
  assert.match(store.state.error,/nichts gespeichert/);
});

test('onboarding derives from persisted profile across reload/login; invalid names never write',async()=>{
  let stored=profile(),writes=0;
  const api={readProfile:async()=>({data:stored,extensionsAvailable:true,error:null}),readStaff:async()=>({data:null,error:null}),
    updateName:async(id,name,_signal,extensions)=>{writes++;stored={...stored,user_id:id,display_name:name,...extensions};return {data:stored,error:null};}};
  const store=new ProfileStore(api);store.setUser('A');await waitReady(store);
  assert.equal(store.requiresCompletion,true);
  for(const raw of ['', ' ', 'A', 'x'.repeat(61), 'A\nB']) {
    assert.equal(await store.completeProfile(raw),false);assert.equal(store.requiresCompletion,true);assert.equal(store.state.invalidName,true);
  }
  assert.equal(writes,0);await store.load();assert.equal(store.requiresCompletion,true);
  store.setUser(null);assert.equal(store.state.profile,null);store.setUser('A');await waitReady(store);
  assert.equal(store.requiresCompletion,true);
  assert.equal(await store.completeProfile('  Zoë Müller  ','  Pflege '),true);
  assert.equal(store.requiresCompletion,false);assert.equal(stored.display_name,'Zoë Müller');assert.equal(stored.professional_role,'Pflege');
  assert.equal(stored.professional_role_public,false);assert.equal(stored.avatar_provider,'initials');
  await store.load();assert.equal(store.requiresCompletion,false);
  assert.equal(await store.completeProfile('Other'),false);assert.equal(writes,1);
  assert.equal(await store.save('',undefined,{requireDisplayName:true}),false);
  assert.equal(store.requiresCompletion,false);store.dispose();
});

test('onboarding retries failures and requires the returned saved name, preserving existing preferences',async()=>{
  const stored={...profile(),professional_role_public:true,avatar_provider:'gravatar'};let fail=true,returnedName=null;
  const api={readProfile:async()=>({data:stored,extensionsAvailable:true,error:null}),readStaff:async()=>({data:null,error:null}),
    updateName:async(id,_name,_signal,extensions)=>fail?{data:null,error:{code:'42501'}}:
      {data:{...stored,user_id:id,display_name:returnedName,...extensions},error:null}};
  const store=new ProfileStore(api);store.setUser('A');await waitReady(store);
  assert.equal(await store.completeProfile('Nick','Ärztin'),false);assert.equal(store.requiresCompletion,true);
  assert.equal(store.state.saving,false);assert.ok(store.state.error);
  fail=false;
  for(const name of [null, 'A', 'Different']) {
    returnedName=name;assert.equal(await store.completeProfile('Nick','Ärztin'),false);
    assert.equal(store.requiresCompletion,true);assert.equal(store.state.message,'');
  }
  returnedName='Nick';assert.equal(await store.completeProfile('Nick','Ärztin'),true);
  assert.equal(store.requiresCompletion,false);assert.equal(store.state.profile.professional_role_public,true);
  assert.equal(store.state.profile.avatar_provider,'gravatar');assert.equal(store.state.error,'');store.dispose();
});

test('late onboarding save cannot complete another account or survive logout',async()=>{
  for(const nextUser of [null,'B']) {
    const pending=deferred();
    const api={readProfile:async id=>({data:profile(id),extensionsAvailable:true,error:null}),readStaff:async()=>({data:null,error:null}),updateName:()=>pending.promise};
    const store=new ProfileStore(api);store.setUser('A');await waitReady(store);
    const completion=store.completeProfile('Nickname');store.setUser(nextUser);await waitReady(store);
    pending.resolve({data:{...profile('A'),display_name:'Nickname'},error:null});
    assert.equal(await completion,false);assert.equal(store.state.userId,nextUser);
    assert.equal(store.state.profile?.display_name??null,null);assert.equal(store.state.message,'');store.dispose();
  }
});
