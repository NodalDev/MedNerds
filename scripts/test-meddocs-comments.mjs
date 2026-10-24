import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createArticleManifest, validateArticleManifest, commentsVisible, isCommentArticle } from '../src/lib/meddocs/comments/articles.ts';
import { assignArticleIds, initialArticleId, readArticleEntries, repositoryManifest } from './prepare-meddocs-comments-sync.mjs';
import { syncArticles, syncConfiguration } from './sync-meddocs-comments.mjs';
import { articleMetadataSchema } from '../src/lib/meddocs/article-metadata-schema.ts';
import { validateCommentBody, parseUpvote, parseCursor, parsePublicComment, parsePublicPage, parseOwnComment, parseAudit, parseMutation, roleLabel, statusLabel } from '../src/lib/meddocs/comments/validation.ts';
import { createCommentsApi, commentError } from '../src/lib/meddocs/comments/api.ts';
import { getAccountFeatureAccess } from '../src/lib/auth/account-access.ts';
import { mergeCommentViews, exactPublicCount, privateStatus, pendingCommentSummary, commentDate } from '../src/lib/meddocs/comments/presentation.ts';
import { COMMENT_DRAFT_TTL, saveCommentDraft, readCommentDraft, removeCommentDraft, bindCommentDraftToUser } from '../src/lib/meddocs/comments/draft.ts';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const date='2026-10-11T10:00:00Z';
const article=(data={},id='meddocs/ekg/example')=>({id,filePath:`src/content/docs/${id}.mdx`,data:{articleId:A,comments:true,authors:['orlando-frey'],published:new Date(date),...data}});
const publicRow={id:A,article_id:B,parent_id:null,reply_to_id:null,body:'Approved',visibility:'active',display_name:'Test User',role:null,author_slug:null,professional_role:null,created_at:date,edited_at:null,version:1,reply_count:0,first_published_at:date,upvote_count:0,has_upvoted:false,can_upvote:true};
const ownRow={id:A,article_id:B,parent_id:null,reply_to_id:null,body:'Pending',published_body:'Approved',visibility:'active',display_name:'Test User',created_at:date,edited_at:null,version:2,canonical_path:'/meddocs/ekg/example/',article_state:'published',revision_id:B,status:'pending',reason_code:null};
const page=(items)=>({items,next_cursor:null,article:{state:'published',can_write:true}});

const draftStorage=()=>{const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,
 getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const draft=(extra={})=>({articleId:A,path:'/meddocs/ekg/example/',body:'Prepared comment',replyTo:null,owner:null,expiresAt:1000+COMMENT_DRAFT_TTL,...extra});
test('comment draft is tab-storage only, exact article/path scoped, expiring and explicitly removable',()=>{
 const store=draftStorage();assert.equal(saveCommentDraft(draft(),store,1000),true);
 assert.equal(readCommentDraft(B,draft().path,store,1000),null);assert.equal(readCommentDraft(A,'/meddocs/ekg/other/',store,1000),null);
 assert.deepEqual(readCommentDraft(A,draft().path,store,1001),draft());
 assert.equal(readCommentDraft(A,draft().path,store,1000+COMMENT_DRAFT_TTL),null);assert.equal(store.length,0);
 saveCommentDraft(draft(),store,1000);removeCommentDraft(A,store);assert.equal(store.length,0);
 saveCommentDraft({...draft(),unexpected:'never persist extra fields'},store,1000);
 assert.equal(store.getItem(store.key(0)).includes('unexpected'),false);
});
test('first verified login binds a guest draft; another account cannot adopt it',()=>{
 const store=draftStorage();saveCommentDraft(draft({requestId:B,replyTo:B}),store,1000);
 bindCommentDraftToUser(draft().path+'#kommentare',B,store,1001);
 assert.equal(readCommentDraft(A,draft().path,store,1002).owner,B);
 bindCommentDraftToUser('/meddocs/ekg/other/',A,store,1002);assert.equal(store.length,1);
 bindCommentDraftToUser(draft().path,A,store,1003);assert.equal(store.length,0);
});
test('a pending edit keeps its owner, target/version and retry identity; anonymous edits are rejected',()=>{
 const store=draftStorage(),edit=draft({owner:B,edit:{id:B,version:7},requestId:A});
 assert.equal(saveCommentDraft(edit,store,1000),true);assert.deepEqual(readCommentDraft(A,edit.path,store,1001),edit);
 assert.equal(saveCommentDraft({...edit,owner:null},store,1000),false);
 assert.equal(saveCommentDraft({...edit,edit:{id:B,version:0}},store,1000),false);
});
test('malformed, oversized, external-path, expired and blocked storage fail safely without durable fallback',()=>{
 const store=draftStorage();
 for(const change of [{body:'x'.repeat(4001)},{articleId:'bad'},{path:'//evil.test/'},{expiresAt:1000},{owner:'bad'},{requestId:'bad'}])assert.equal(saveCommentDraft(draft(change),store,1000),false);
 store.setItem('mednerds:comment-draft:v1:'+A,'{');assert.equal(readCommentDraft(A,draft().path,store,1000),null);assert.equal(store.length,0);
 const blocked={getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');},get length(){throw Error('denied');}};
 assert.equal(saveCommentDraft(draft(),blocked,1000),false);assert.equal(readCommentDraft(A,draft().path,blocked,1000),null);
 assert.doesNotThrow(()=>removeCommentDraft(A,blocked));assert.doesNotThrow(()=>bindCommentDraftToUser(draft().path,B,blocked,1000));
});

test('stable UUID survives a slug change; drafts/disabled pages remain private',()=>{
  assert.equal(createArticleManifest([article()])[0].id,createArticleManifest([article({},'meddocs/ekg/renamed')])[0].id);
  assert.equal(commentsVisible(article()),true);assert.equal(commentsVisible(article({draft:true})),false);
  assert.equal(commentsVisible(article({comments:false})),false);assert.equal(commentsVisible(article({pageLayout:'hub'})),false);
  assert.equal(createArticleManifest([article({draft:true})])[0].state,'unpublished');
  assert.equal(createArticleManifest([article()])[0].comments_enabled,true);
  assert.equal(commentsVisible(article({comments:undefined})),true);
  assert.equal(createArticleManifest([article({comments:false})])[0].comments_enabled,false);
});
test('ID validation rejects duplicates including disabled/draft entries',()=>{
  assert.throws(()=>createArticleManifest([article(),article({draft:true,comments:false},'meddocs/ekg/another')]),/Duplicate/);
  assert.throws(()=>createArticleManifest([article({articleId:'invalid'})]),/Invalid articleId/);
  assert.throws(()=>createArticleManifest([article({articleId:undefined})]),/Missing persistent articleId/);
  assert.throws(()=>createArticleManifest([article({},'meddocs/ekg/index')]),/Invalid comment article/);
  assert.equal(articleMetadataSchema.safeParse({comments:true,authors:['orlando-frey'],published:'2026-10-11'}).success,false);
});
test('complete deployment manifest matches repository UUIDs and rejects stale/partial data',()=>{
  const expected=createArticleManifest([article(),article({articleId:B},'meddocs/ekg/second')]);
  assert.deepEqual(validateArticleManifest([...expected].reverse(),expected),expected);
  for(const value of [[],expected.slice(0,1),[expected[0],expected[0]]]) assert.throws(()=>validateArticleManifest(value,expected));
  for(const changes of [{comments_enabled:false},{state:['published']},{id:'invalid'},{canonical_path:'//outside/'},{author_slugs:[]},{extra:true},{state:'unpublished'}]) {
    assert.throws(()=>validateArticleManifest([{...expected[0],...changes},expected[1]],expected));
  }
  assert.throws(()=>validateArticleManifest([{...expected[0],canonical_path:expected[1].canonical_path},expected[1]],expected),/Duplicate/);
});

test('manifest accepts published true/false and unpublished false, but rejects unpublished true and non-booleans',()=>{
  const base=createArticleManifest([article()])[0];
  for(const [state,comments_enabled,allowed] of [
    ['published',true,true],['published',false,true],
    ['unpublished',false,true],['unpublished',true,false],
  ]) {
    const row={...base,state,comments_enabled};
    if(allowed)assert.deepEqual(validateArticleManifest([row],[row]),[row]);
    else assert.throws(()=>validateArticleManifest([row],[row]),/Invalid manifest fields/);
  }
  for(const comments_enabled of [undefined,null,'false',0,1,{},[]]) {
    const row={...base,comments_enabled};
    assert.throws(()=>validateArticleManifest([row],[row]),/Invalid manifest fields/);
  }
});

test('frontmatter opt-out and drafts stay disabled without changing existing UUIDs or default activation',()=>{
  const published=article({comments:undefined});
  const optedOut=article({comments:false});
  const draft=article({draft:true});
  assert.equal(createArticleManifest([published])[0].comments_enabled,true);
  for(const entry of [optedOut,draft]) {
    const manifest=createArticleManifest([entry]);
    assert.equal(manifest[0].id,A);
    assert.equal(manifest[0].state,'unpublished');
    assert.equal(manifest[0].comments_enabled,false);
    assert.equal(commentsVisible(entry),false);
    assert.deepEqual(validateArticleManifest(manifest,manifest),manifest);
  }
  for(const entry of [article({comments:undefined},'meddocs/ekg/index'),
    article({comments:undefined,pageLayout:'hub'}),article({comments:undefined,authors:undefined,published:undefined})]) {
    assert.equal(isCommentArticle(entry),false);assert.equal(commentsVisible(entry),false);
  }
});
test('chronological UI ordering has stable UUID ties and deduplicates overlapping pages',()=>{
  const older={...publicRow,id:B,created_at:'2026-10-10T10:00:00Z'};
  const tied={...publicRow,id:'33333333-3333-4333-8333-333333333333'};
  assert.deepEqual(mergeCommentViews([tied,publicRow,older,publicRow],[]).map(row=>row.id),[B,A,tied.id]);
});
test('all published editorial articles participate by default; original Production UUIDs stay intact',async()=>{
  const entries=await readArticleEntries();const manifest=await repositoryManifest();
  const eligible=entries.filter(entry=>isCommentArticle(entry)&&entry.data.draft!==true&&entry.data.comments!==false);
  assert.ok(eligible.length>=5);assert.equal(manifest.filter(row=>row.comments_enabled).length,eligible.length);
  assert.ok(eligible.every(commentsVisible));
  for(const [suffix,id] of [
    ['anaesthesie/target-controlled-infusion','6ef3100a-85ed-46b0-8bd5-b0c69aebb9b9'],
    ['echokardiographie/grundlagen-technik/einfuehrung-echokardiographie','a4463f60-dc24-424c-9aba-fc41054f1fff'],
    ['echokardiographie/grundlagen-technik/nomenklatur','3c8b75af-d3cf-4927-9a96-df77e1056267'],
    ['echokardiographie/grundlagen-technik/physikalische-grundlagen','bbbcdd36-40d7-4668-bd20-35c8064848d6'],
    ['echokardiographie/grundlagen-technik/praktische-grundlagen','79c2ca37-4547-4807-983e-d1038c8956dc']
  ])assert.equal(entries.find(entry=>entry.id===`meddocs/${suffix}`).data.articleId,id);
});

test('former articles are disabled without inventing editorial metadata',()=>{
  const former=article({authors:undefined,published:undefined,comments:undefined});
  const manifest=createArticleManifest([former]);
  assert.deepEqual(manifest[0].author_slugs,[]);assert.equal(manifest[0].state,'unpublished');
  assert.equal(commentsVisible(former),false);assert.deepEqual(validateArticleManifest(manifest,manifest),manifest);
});

test('read-only ID checks reject missing IDs; explicit assignment is repeatable and survives renaming',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mednerds-comment-ids-'));
  try {
    const dir=join(root,'src/content/docs/meddocs/ekg');await mkdir(dir,{recursive:true});
    const source='---\r\ntitle: New article\r\nauthors: [orlando-frey]\r\npublished: 2026-10-11\r\n---\r\nOriginal body.\r\n';
    const path=join(dir,'new.mdx');await writeFile(path,source);
    const draft=source.replace('title: New article','draft: true\r\ntitle: Draft');await writeFile(join(dir,'draft.mdx'),draft);
    const script=fileURLToPath(new URL('./prepare-meddocs-comments-sync.mjs',import.meta.url));
    const missing=spawnSync(process.execPath,['--experimental-strip-types',script,'--check'],{cwd:root,encoding:'utf8'});
    assert.equal(missing.status,1);assert.match(missing.stderr,/Missing persistent articleId.*npm run comments:prepare/);
    assert.equal(await readFile(path,'utf8'),source,'Validation must not assign an ID');
    assert.deepEqual(await assignArticleIds(root),{assigned:1,articles:1});
    const id=initialArticleId('meddocs/ekg/new');const saved=await readFile(path,'utf8');
    assert.equal(saved,source.replace('---\r\n',`---\r\narticleId: ${id}\r\n`));
    assert.equal(await readFile(join(dir,'draft.mdx'),'utf8'),draft);
    const checked=spawnSync(process.execPath,['--experimental-strip-types',script,'--check'],{cwd:root,encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr);assert.match(checked.stdout,/No source changes/);
    assert.equal(await readFile(path,'utf8'),saved);
    const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
    for(const hook of ['prebuild','predev','prestart'])assert.equal(pkg.scripts[hook],'npm run comments:check');
    assert.deepEqual(await assignArticleIds(root),{assigned:0,articles:1});
    await writeFile(join(dir,'renamed.mdx'),saved);await rm(path);
    assert.equal((await repositoryManifest(root))[0].id,id);
    const duplicate=source.replace('---\r\n',`---\r\narticleId: ${id}\r\n`);await writeFile(join(dir,'copy.mdx'),duplicate);
    await writeFile(join(dir,'unsaved.mdx'),source);
    await assert.rejects(assignArticleIds(root),/Duplicate/);
    assert.equal(await readFile(join(dir,'unsaved.mdx'),'utf8'),source);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('deployment sync requires exact Production and a server-only key; previews cannot write',()=>{
  const env={PUBLIC_SUPABASE_URL:'https://hwuqqeixfxnyvpzwyjvq.supabase.co',MEDDOCS_COMMENTS_SYNC_ENABLED:'true',MEDDOCS_COMMENTS_SYNC_SECRET_KEY:'sb_secret_mock'};
  assert.equal(syncConfiguration(env).url,env.PUBLIC_SUPABASE_URL);
  for(const changes of [{CONTEXT:'deploy-preview'},{CONTEXT:'branch-deploy'},{MEDDOCS_COMMENTS_SYNC_ENABLED:undefined},
    {PUBLIC_SUPABASE_URL:'https://fkacxmolcfhpvywdcvog.supabase.co'},
    {PUBLIC_SUPABASE_URL:'https://wpdfduxzqqlizuhkhebb.supabase.co'},
    {MEDDOCS_COMMENTS_SYNC_SECRET_KEY:'sb_publishable_mock'},{MEDDOCS_COMMENTS_SYNC_SECRET_KEY:'user.token.jwt'}]) {
    assert.throws(()=>syncConfiguration({...env,...changes}));
  }
});

test('deployment repeats the same complete RPC payload; dry-run has no client and provider errors do not leak',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'mednerds-sync-manifest-'));
  const manifestPath=join(temp,'manifest.json');await writeFile(manifestPath,JSON.stringify(await repositoryManifest()));
  try {
  const calls=[];const env={PUBLIC_SUPABASE_URL:'https://hwuqqeixfxnyvpzwyjvq.supabase.co',MEDDOCS_COMMENTS_SYNC_ENABLED:'true',MEDDOCS_COMMENTS_SYNC_SECRET_KEY:'sb_secret_mock'};
  const clientFactory=(url,key,options)=>{
    assert.equal(url,env.PUBLIC_SUPABASE_URL);assert.equal(key,env.MEDDOCS_COMMENTS_SYNC_SECRET_KEY);
    assert.equal(options.auth.persistSession,false);
    return {async rpc(name,args){calls.push({name,args});return {data:args.manifest.length,error:null};}};
  };
  const dry=await syncArticles({manifestPath,dryRun:true,clientFactory:()=>{throw new Error('Must not connect');}});assert.equal(dry.dryRun,true);
  await syncArticles({manifestPath,env,clientFactory});await syncArticles({manifestPath,env,clientFactory});
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].name,'meddocs_articles_sync');
  assert.ok(calls[0].args.manifest.some(row=>row.comments_enabled));
  await assert.rejects(syncArticles({manifestPath,env,clientFactory:()=>({rpc:async()=>({error:{message:'sb_secret_private provider details'}})})}),error=>!error.message.includes('sb_secret_private'));
  await assert.rejects(syncArticles({manifestPath,env,clientFactory:()=>({rpc:async()=>({data:0,error:null})})}),/Unexpected sync count/);
  await writeFile(manifestPath,'[]');
  await assert.rejects(syncArticles({manifestPath,env,clientFactory:()=>{throw new Error('Must not connect');}}),/incomplete or stale/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('automatic sync follow-up is catalog-only, atomic and keeps service_role as its only API caller',async()=>{
  const sql=await readFile('supabase/migrations/20261011010000_meddocs_comments_automatic_sync.sql','utf8');
  assert.match(sql,/create or replace function public\.meddocs_articles_sync\(manifest jsonb\)/);
  assert.match(sql,/begin;/);assert.match(sql,/commit;/);assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/grant execute.*to service_role/);assert.match(sql,/where not \(id=any\(seen\)\)/);
  assert.match(sql,/on conflict\(id\) do update/);assert.match(sql,/is distinct from row/);
  assert.match(sql,/security definer set search_path=''/);
  assert.match(sql,/pg_catalog\.jsonb_typeof\(item->'comments_enabled'\) is distinct from 'boolean'/);
  assert.match(sql,/or \(\s*item->>'state' = 'unpublished'\s*and item->'comments_enabled' is distinct from 'false'::jsonb\s*\)/);
  assert.doesNotMatch(sql,/pg_catalog\.to_jsonb\(item->>'state'='published'\)/);
  assert.doesNotMatch(sql,/\b(?:delete from|truncate|drop table|create table)\b/i);
  assert.doesNotMatch(sql,/(?:update|insert into)\s+(?:auth\.|public\.profiles|public\.staff_accounts|mednerds_private\.meddocs_comment)/i);
});
test('Unicode/codepoint/UTF-8 and control limits, harmless HTML stays plain text',()=>{
  assert.deepEqual(validateCommentBody('  \nTest\nLine\t '),{ok:true,value:'Test\nLine'});
  for(const body of ['', '  ', 'x'.repeat(4001),'Test\u202e','Test\u0000'])assert.equal(validateCommentBody(body).ok,false);
  assert.equal(validateCommentBody('😀'.repeat(4000)).ok,true);
  assert.equal(validateCommentBody('<img src=x onerror=alert(1)>').ok,true);
});
test('public response allowlist drops private fields and withdrawn identities',()=>{
  const parsed=parsePublicComment({...publicRow,author_id:B,email:'private@example.test',pending_body:'Secret',session_id:A});
  assert.equal('email' in parsed,false);assert.equal('author_id' in parsed,false);assert.equal('pending_body' in parsed,false);
  const removed=parsePublicComment({...publicRow,visibility:'withdrawn',display_name:'Private name',role:'admin',author_slug:'orlando-frey',professional_role:'Private role'});
  assert.equal(removed.body,null);assert.equal(removed.display_name,'Beitrag entfernt');assert.equal(removed.role,null);assert.equal(removed.professional_role,null);
});
test('DTO validation rejects malformed identifiers/cursors/routes and oversized pages',()=>{
  assert.throws(()=>parsePublicComment({...publicRow,role:'owner'}));
  assert.throws(()=>parsePublicPage({...page([publicRow]),next_cursor:{at:'bad',id:A}}));
  assert.throws(()=>parsePublicPage(page(Array(21).fill(publicRow))));
  assert.throws(()=>parseOwnComment({...ownRow,canonical_path:'//evil.test/'}));
  assert.throws(()=>parseMutation({id:A,status:'approved',version:1e20}));
  assert.equal(parsePublicPage(page([publicRow])).items[0].body,'Approved');
  assert.equal(parseAudit({kind:'revision',id:A,created_at:date,actor_id:null,reason_code:null,number:1,body:null,status:'rejected',decided_at:date,redacted_at:date}).body,null);
});
test('staff badges require DB role plus an actual registry mapping',()=>{
  assert.equal(roleLabel({role:null,author_slug:'orlando-frey'},['orlando-frey']),'');
  assert.equal(roleLabel({role:'admin',author_slug:null},[]),'Administrator');
  assert.equal(roleLabel({role:'author',author_slug:'unknown-person'},[]),'MedNerds-Team');
  assert.equal(roleLabel({role:'author',author_slug:'orlando-frey'},['orlando-frey']),'Autor dieses Artikels');
  assert.equal(roleLabel({role:'author',author_slug:'orlando-frey'},[]),'Autor');
});
test('published edits/rejections and private new submissions have clear separate states',()=>{
  assert.match(statusLabel(ownRow),/Änderung.*bisherige Fassung/);
  assert.match(statusLabel({...ownRow,published_body:null}),/nur für dich/);
  assert.match(statusLabel({...ownRow,status:'rejected'}),/abgelehnt.*bisherige Fassung/);
  assert.match(statusLabel({...ownRow,visibility:'withdrawn'}),/zurückgezogen/);
});
test('central feature access accepts saved profile + current legal, not form values',()=>{
  const context={auth:{status:'signed-in',userId:A},profile:{status:'ready',userId:A,profile:{user_id:A,display_name:null}},legal:{userId:A,loading:false,saving:false,error:'',policy:{terms:'t',privacy:'p',accepted:true}},versions:{terms:'t',privacy:'p'}};
  assert.equal(getAccountFeatureAccess(context),'profile-required');
  context.profile.profile.display_name='Saved Name';assert.equal(getAccountFeatureAccess(context),'ready');
  context.legal.policy.accepted=false;assert.equal(getAccountFeatureAccess(context),'legal-required');
  context.profile.userId=B;assert.equal(getAccountFeatureAccess(context),'profile-pending');
});
test('API calls exact narrow RPC arguments and preserves cursor/abort signal',async()=>{
  const calls=[];const signal=new AbortController().signal;
  const client={rpc(name,args){calls.push({name,args});return {abortSignal(s){assert.equal(s,signal);return Promise.resolve({data:page([publicRow]),error:null});}};}};
  const api=createCommentsApi(client);const cursor={at:date,id:A};assert.equal((await api.list(B,cursor,signal)).items.length,1);
  assert.deepEqual(calls[0],{name:'meddocs_comments_list',args:{target_article:B,cursor,page_size:10,sort_order:'newest'}});
});
test('API only reports controlled errors including rate limit; provider details never leak',async()=>{
  for(const [message,expected] of [['rate_limited','Beitragslimit'],['profile_required','Profil'],['secret SQL SELECT auth.users','erneut']]) {
    const api=createCommentsApi({rpc(){return Promise.resolve({data:null,error:{message}});}});
    await assert.rejects(api.create(B,'Test',A),new RegExp(expected));
  }
  assert.equal(commentError({code:'PGRST301',message:'secret'}).code,'authentication_required');
});
test('mutation API preserves version/request ID on retry; no client moderator/author injection',async()=>{
  const calls=[];const api=createCommentsApi({rpc(name,args){calls.push({name,args});return Promise.resolve({data:{id:A,version:3,status:'pending'},error:null});}});
  await api.edit(A,'Pending',2,B);await api.edit(A,'Pending',2,B);assert.deepEqual(calls[0],calls[1]);
  assert.deepEqual(Object.keys(calls[0].args).sort(),['body','expected_version','request_id','target_comment']);
  await api.withdraw(A,3);assert.equal(calls[2].name,'meddocs_comment_withdraw');
});
test('SQL safety contract: private RLS, exact definer grants and transactional scrub',async()=>{
  const sql=await readFile('supabase/migrations/20261011000000_meddocs_comments.sql','utf8');
  assert.equal((sql.match(/create table mednerds_private\.meddocs_/g)??[]).length,5);
  assert.equal((sql.match(/enable row level security/g)??[]).length,5);
  assert.match(sql,/create trigger mednerds_z_scrub_meddocs_comments before delete on auth.users/);
  assert.match(sql,/foreign key\(id,published_revision_id\)/);assert.match(sql,/for share/);assert.match(sql,/for update/);
  assert.doesNotMatch(sql,/create function public\.meddocs_comment_history/);
  assert.match(sql,/comment_identity\(true\)/);assert.match(sql,/comment_identity\(\)/);assert.match(sql,/grant execute.*meddocs_articles_sync\(jsonb\).*to service_role/s);
  assert.equal((sql.match(/alter table mednerds_private\.meddocs_\w+ owner to postgres/g)??[]).length,5);
  assert.match(sql,/order by \(parent_id is not null\),coalesce\(parent_id,id\),id for update/);
  const sync=sql.split('create function public.meddocs_articles_sync')[1].split('create function public.meddocs_comments_retention')[0];
  assert.doesNotMatch(sync,/where not\s*\(/i);
  assert.match(sync,/Upsert ONLY supplied IDs/);
  const target=sql.split('create function mednerds_private.comment_moderation_target')[1].split('create function public.meddocs_comment_decide')[0];
  assert.ok(target.indexOf('comment_moderator_identity()')<target.indexOf('comment_identity(true,true)'));
  // This checks migration intent, not real privileges / SQL execution / concurrency.
});
test('remote audit remains read-only and reports explicit expected/actual checks',async()=>{
  const source=await readFile('supabase/tests/meddocs_comments_remote_checks.sql','utf8');
  const statements=source.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
  assert.doesNotMatch(statements,/\b(?:insert|update|delete|truncate|create|alter|drop|grant|revoke|call)\b/i);
  assert.match(source,/begin read only/i);assert.match(source,/as expected/);assert.match(source,/as actual/);assert.match(source,/as ok/);
  assert.match(source,/mednerds_protect_last_admin/);assert.match(source,/mednerds_z_scrub_meddocs_comments/);
  assert.match(source,/has_column_privilege/);assert.match(source,/aclexplode/);
});
test('real concurrency runner rejects unsafe/default/remote targets before connecting',()=>{
  for(const args of [[],['--confirm-disposable','--database=postgres'],['--confirm-disposable','--database=mednerds_comments_test_example','--host=remote']]) {
    const result=spawnSync(process.execPath,['scripts/test-meddocs-comments-concurrency.mjs',...args],{encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/Only --confirm-disposable/);
  }
});

test('reader merges own revisions by ID without replacing the approved public body',()=>{
  const rows=mergeCommentViews([publicRow,publicRow],[ownRow]);
  assert.equal(rows.length,1);assert.equal(rows[0].publicComment.body,'Approved');
  assert.equal(rows[0].ownComment.body,'Pending');
  assert.equal(privateStatus(ownRow),'Änderung wird geprüft');
  assert.equal(privateStatus({...ownRow,status:'rejected'}),'Änderung abgelehnt');
  assert.equal(privateStatus({...ownRow,published_body:null}),'Wartet auf Freigabe');
});
test('private-only pending/rejected/hidden posts are included, withdrawn and unloaded approved posts are not',()=>{
  for(const status of ['pending','rejected'])assert.equal(mergeCommentViews([],[{...ownRow,status,published_body:null}]).length,1);
  assert.equal(mergeCommentViews([],[{...ownRow,status:'approved',visibility:'hidden'}]).length,1);
  assert.equal(mergeCommentViews([],[{...ownRow,status:'approved'}]).length,0);
  assert.equal(mergeCommentViews([],[{...ownRow,visibility:'withdrawn'}]).length,0);
});
test('own pending summary uses singular/plural and never counts published edits or other states',()=>{
  const pending={...ownRow,published_body:null};
  assert.equal(pendingCommentSummary([],true),'');
  assert.equal(pendingCommentSummary([pending],true),'1 Beitrag wartet auf Freigabe.');
  assert.equal(pendingCommentSummary([pending,{...pending,id:B,parent_id:A,reply_to_id:A}],true),'2 Beiträge warten auf Freigabe.');
  assert.equal(pendingCommentSummary([pending],false),'Mindestens 1 Beitrag wartet auf Freigabe.');
  assert.equal(pendingCommentSummary([pending,{...pending,id:B}],false),'Mindestens 2 Beiträge warten auf Freigabe.');
  for(const changes of [{status:'approved'},{status:'rejected'},{status:'superseded'},
    {visibility:'hidden'},{visibility:'withdrawn'},{body:null},{published_body:'Already public'}]) {
    assert.equal(pendingCommentSummary([{...pending,...changes}],true),'');
  }
});

test('public count remains unknown until every public page and thread is complete',()=>{
  assert.equal(exactPublicCount([],false,new Map()),null);
  assert.equal(exactPublicCount([],true,new Map()),0);
  const root={...publicRow,reply_count:1};
  assert.equal(exactPublicCount([root],true,new Map()),null);
  assert.equal(exactPublicCount([root],true,new Map([[A,{items:[publicRow],complete:false}]])),null);
  assert.equal(exactPublicCount([root],true,new Map([[A,{items:[publicRow],complete:true}]])),2);
  assert.equal(exactPublicCount([{...root,visibility:'withdrawn',body:null}],true,new Map([[A,{items:[publicRow],complete:true}]])),1);
  assert.equal(exactPublicCount([publicRow],true,new Map()),1); // Own/private DTOs never enter this API.
});
test('missing migrations, permissions, network failures and expired auth remain distinct safe errors',()=>{
  for(const code of ['PGRST202','PGRST204','PGRST205','42P01','42883']){
    const failure=commentError({code,message:'authentication_required private SQL details'});
    assert.equal(failure.code,'backend_not_configured');assert.doesNotMatch(failure.message,/SQL|abgelaufen/);
  }
  assert.equal(commentError({code:'42501',message:'private permission'}).code,'forbidden');
  assert.equal(commentError(new TypeError('Failed to fetch')).code,'network_error');
  assert.equal(commentError({code:'PGRST301',message:'private JWT'}).code,'authentication_required');
});
test('compact dates are stable calendar dates rather than aging relative timers',()=>{
  assert.match(commentDate(date),/11.*2026/);
});

// New contracts are tested locally; real database assertions live in pgTAP.
test('public roots retain server order while own pending rows remain private',()=>{
 const pending={...ownRow,id:'33333333-3333-4333-8333-333333333333',published_body:null};
 assert.deepEqual(mergeCommentViews([{...publicRow,id:B},publicRow],[pending],true).map(row=>row.id),[B,A,pending.id]);
});
test('vote DTOs/cursors validate scores and reject malformed states',()=>{
 assert.deepEqual(parseUpvote({id:A,upvote_count:2,has_upvoted:true,user_id:B}),{id:A,upvote_count:2,has_upvoted:true});
 const cursor={at:date,id:A,order:'helpful',votes:2};assert.deepEqual(parseCursor(cursor),cursor);
 for(const change of [{upvote_count:-1},{has_upvoted:1},{upvote_count:1.5}])assert.throws(()=>parseUpvote({id:A,upvote_count:0,has_upvoted:false,...change}));
 assert.throws(()=>parseCursor({...cursor,order:'random'}));assert.throws(()=>parseCursor({...cursor,votes:-1}));
});
test('vote API only sends desired state and target, no identity; ranking cursor survives',async()=>{
 const calls=[];const api=createCommentsApi({rpc(name,args){calls.push({name,args});return Promise.resolve({data:name==='meddocs_comment_upvote'?{id:A,upvote_count:1,has_upvoted:args.voted}:page([publicRow]),error:null});}});
 await api.upvote(A,true);await api.upvote(A,true);assert.deepEqual(calls[0],calls[1]);
 await api.upvote(A,false);assert.deepEqual(calls[2],{name:'meddocs_comment_upvote',args:{target_comment:A,voted:false}});
 const cursor={at:date,id:A,order:'helpful',votes:3};await api.list(B,cursor,undefined,'helpful');
 assert.deepEqual(calls[3].args,{target_article:B,cursor,page_size:10,sort_order:'helpful'});
});
test('additive votes migration locks eligibility, isolates identities and paginates global scores',async()=>{
 const sql=await readFile('supabase/migrations/20261017000000_meddocs_comment_upvotes_sorting.sql','utf8');
 assert.match(sql,/primary key \(comment_id,user_id\)/);assert.match(sql,/references auth.users\(id\) on delete cascade/);
 assert.match(sql,/enable row level security/);assert.match(sql,/comment_identity\(true\)/);
 assert.match(sql,/c.author_id=identity/);assert.match(sql,/r.status='approved'/);assert.match(sql,/for update/);
 assert.match(sql,/where comment_id=c.id and user_id=identity/);assert.match(sql,/on conflict do nothing/);
 assert.match(sql,/grant execute on function public.meddocs_comment_upvote\(uuid,boolean\) to authenticated/);
 assert.match(sql,/first_published_at as stamp/);assert.match(sql,/group by c.id/);assert.match(sql,/s.votes,c.stamp,c.id/);
 assert.doesNotMatch(sql,/alter table .*meddocs_comments (?:drop|alter)/);
});
