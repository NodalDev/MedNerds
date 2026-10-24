import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Local dist only. ALL other requests are mocked or blocked before navigation.
const site=process.env.AUTH_SITE??'http://127.0.0.1:4326';
const endpoint=process.env.AUTH_CDP??'http://127.0.0.1:9334';
const screenshots=process.env.AUTH_SCREENSHOTS??tmpdir();
await mkdir(screenshots,{recursive:true});
const manifest=JSON.parse(await readFile('.astro/meddocs-comments-manifest.json','utf8'));
// Every enabled route uses the central footer; resources never acquire a composer.
for (const row of manifest.filter(row=>row.comments_enabled)) {
  const html=await readFile(join('dist',row.canonical_path.slice(1),'index.html'),'utf8');
  assert.equal((html.match(/<meddocs-comments\b/g)??[]).length,1);
  assert.ok(html.includes(`data-article-id="${row.id}"`));
}
assert.doesNotMatch(await readFile('dist/meddocs/ekg/links-ressourcen/index.html','utf8'),/<meddocs-comments\b/);
assert.doesNotMatch(await readFile('dist/meddocs/diverses/beispielartikel/index.html','utf8'),/<meddocs-comments\b/);
const article=manifest.find(row=>row.canonical_path.includes('physikalische-grundlagen'));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const stamp='2026-10-11T12:00:00Z';
let signedIn=false,userId=A,name='Test User',legal=true,staff=null;
let blocked=0,serviceHost='',sequence=10,writeError=null,listError=false,ownReadError=false,readDelay=0,publicFailure=null,privateFailure=null,networkFailure=false,canWrite=true,ownHasMore=false;
const tabs=[],errors=[],calls=[],own=[];
const roots=[{id:R,article_id:article.id,parent_id:null,reply_to_id:null,body:'Öffentlich freigegebener Text <img src=x onerror="window.__xss=1">',visibility:'active',display_name:'Orlando Frey',role:'author',author_slug:'orlando-frey',professional_role:'Arzt',created_at:stamp,edited_at:null,version:1,reply_count:1}];
const replies=[{...roots[0],id:B,parent_id:R,reply_to_id:R,body:'Eine vorhandene Antwort',display_name:'Test Antwort',role:null,author_slug:null,professional_role:null,reply_count:0}];
const audit=[];const votes=new Map();let voteError=false;
function publicView(row){const {owner,...data}=row;const voters=votes.get(row.id)??new Set();return {...data,first_published_at:row.first_published_at??row.created_at,upvote_count:voters.size,has_upvoted:signedIn&&voters.has(userId),can_upvote:signedIn&&owner!==userId&&canWrite&&row.visibility==='active'&&!!row.body};}
function orderedRoots(order){return roots.map(publicView).sort((a,b)=>order==='oldest'?a.first_published_at.localeCompare(b.first_published_at)||a.id.localeCompare(b.id):(order==='helpful'?b.upvote_count-a.upvote_count:0)||b.first_published_at.localeCompare(a.first_published_at)||b.id.localeCompare(a.id));}
function session(){const exp=Math.floor(Date.now()/1000)+3600;const head=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload=Buffer.from(JSON.stringify({sub:userId,email:'test@example.test',aud:'authenticated',session_id:B,exp})).toString('base64url');
  return {access_token:`${head}.${payload}.mock-signature`,refresh_token:'mock-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user:{id:userId,email:'test@example.test',email_confirmed_at:stamp,aud:'authenticated',role:'authenticated',created_at:stamp,app_metadata:{provider:'email'},user_metadata:{}}};}
const page=(items,cursor=null)=>({items,next_cursor:cursor,article:{state:'published',can_write:canWrite}});
async function intercept(tab,params){const url=new URL(params.request.url);
  const fulfill=(status,body,mime='application/json')=>tab.command('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:status,responseHeaders:[
    {name:'Content-Type',value:mime},{name:'Access-Control-Allow-Origin',value:new URL(site).origin},{name:'Access-Control-Allow-Headers',value:'authorization,apikey,content-type,prefer,accept-profile,content-profile,x-client-info,x-supabase-api-version,x-supabase-client-platform,x-supabase-client-platform-version,x-supabase-client-runtime,x-supabase-client-runtime-version'},
    {name:'Access-Control-Allow-Methods',value:'GET,POST,PATCH,OPTIONS'},{name:'Access-Control-Expose-Headers',value:'x-supabase-api-version'},{name:'x-supabase-api-version',value:'2024-01-01'}],body:Buffer.from(typeof body==='string'?body:JSON.stringify(body)).toString('base64')});
  if(url.origin===new URL(site).origin)return tab.command('Fetch.continueRequest',{requestId:params.requestId});
  if(url.pathname.startsWith('/rest/v1/')){
    serviceHost=url.hostname;if(params.request.method==='OPTIONS')return fulfill(200,{});
    const resource=url.pathname.split('/').at(-1);const args=JSON.parse(params.request.postData??'{}');calls.push({resource,args});
    const versions=await tab.evaluate("(()=>{const d=document.querySelector('meddocs-comments,meddocs-moderation,mednerds-account')?.dataset;return {terms:d?.termsVersion,privacy:d?.privacyVersion}})()");
    if(resource==='profiles'&&params.request.method==='PATCH')name=args.display_name;
    if(resource==='profiles')return fulfill(200,{user_id:userId,display_name:name,professional_role:null,professional_role_public:false,avatar_provider:'initials',created_at:stamp,updated_at:stamp});
    if(resource==='staff_accounts')return fulfill(200,staff?{user_id:userId,role:staff,author_slug:staff==='author'?'orlando-frey':null,created_at:stamp}:null);
    if(resource==='get_account_legal_state')return fulfill(200,{registration_enabled:true,gravatar_enabled:true,terms_version:versions.terms,privacy_notice_version:versions.privacy,accepted:legal});
    if(resource==='record_account_legal_acceptance'){legal=true;return fulfill(200,{user_id:userId,terms_version:versions.terms,privacy_notice_version:versions.privacy,accepted_at:stamp});}
    if(resource==='meddocs_comments_list'){
      if(networkFailure)return tab.command('Fetch.failRequest',{requestId:params.requestId,errorReason:'ConnectionFailed'});
      if(publicFailure)return fulfill(400,publicFailure);
      if(listError)return fulfill(500,{code:'XX',message:'private details'});
      const ordered=args.target_article===article.id?orderedRoots(args.sort_order):[];
      const start=args.cursor?ordered.findIndex(row=>row.id===args.cursor.id)+1:0;const items=ordered.slice(start,start+args.page_size);
      const last=items.at(-1);return fulfill(200,page(items,last&&(!args.cursor||start+items.length<ordered.length)?{at:last.first_published_at,id:last.id,votes:last.upvote_count,order:args.sort_order}:null));
    }
    if(resource==='meddocs_comment_replies')return fulfill(200,page(args.cursor?[]:replies.map(publicView),args.cursor?null:{at:stamp,id:B,votes:0,order:'oldest'}));
    if(resource==='meddocs_comment_upvote'){
      assert.deepEqual(Object.keys(args).sort(),['target_comment','voted']);
      if(voteError)return fulfill(500,{code:'XX',message:'internal private details'});
      const row=[...roots,...replies].find(row=>row.id===args.target_comment);
      if(!signedIn||!row||!publicView(row).can_upvote)return fulfill(403,{code:'42501',message:'forbidden'});
      const voters=votes.get(row.id)??new Set();args.voted?voters.add(userId):voters.delete(userId);votes.set(row.id,voters);
      return fulfill(200,{id:row.id,upvote_count:voters.size,has_upvoted:voters.has(userId)});
    }
    if(resource==='meddocs_comments_mine'){
      if(privateFailure)return fulfill(400,privateFailure);
      if(ownReadError)return fulfill(500,{code:'XX',message:'private details'});
      const data=page(own.filter(row=>row.owner===userId&&args.target_article===article.id).map(({owner,...row})=>row),ownHasMore?{at:stamp,id:R}:null);
      if(readDelay)await new Promise(resolve=>setTimeout(resolve,readDelay));return fulfill(200,data);
    }
    if(['meddocs_comment_create','meddocs_comment_edit','meddocs_comment_withdraw','meddocs_comment_decide','meddocs_comment_visibility','meddocs_comment_redact'].includes(resource)){
      if(writeError)return fulfill(400,{code:'P0001',message:writeError});
      if(resource==='meddocs_comment_create'){
        assert.deepEqual(Object.keys(args).sort(),args.reply_to?['body','reply_to','request_id','target_article']:['body','request_id','target_article']);
        const id=`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
        const row={id,article_id:article.id,parent_id:args.reply_to?R:null,reply_to_id:args.reply_to??null,body:args.body,published_body:staff==='admin'?args.body:null,visibility:'active',display_name:name,created_at:stamp,edited_at:null,version:1,canonical_path:article.canonical_path,article_state:'published',revision_id:id,status:staff==='admin'?'approved':'pending',reason_code:null,owner:userId};
        own.push(row);return fulfill(200,{id,version:1,status:row.status});
      }
      const row=own.find(row=>row.id===(args.target_comment??args.target_revision));assert.ok(row,'Mock target exists');
      assert.equal(args.expected_version,row.version);row.version++;
      if(resource==='meddocs_comment_edit'){row.body=args.body;row.status='pending';}
      if(resource==='meddocs_comment_withdraw'){row.visibility='withdrawn';row.status='withdrawn';row.body=null;row.published_body=null;}
      if(resource==='meddocs_comment_decide'){
        assert.equal(staff,'admin');row.status=args.decision==='approve'?'approved':'rejected';if(args.decision==='approve')row.published_body=row.body;
        audit.push({kind:'event',id:A,created_at:stamp,actor_id:userId,reason_code:args.reason,action:args.decision,revision_id:row.revision_id});
      }
      if(resource==='meddocs_comment_visibility'){row.visibility=args.action==='hide'?'hidden':'active';}
      if(resource==='meddocs_comment_redact'){row.body=null;row.published_body=null;row.visibility='hidden';}
      return fulfill(200,{id:row.id,version:row.version,status:resource==='meddocs_comment_visibility'||resource==='meddocs_comment_redact'?row.visibility:row.status});
    }
    if(resource==='meddocs_comment_queue'){
      if(staff!=='admin')return fulfill(400,{code:'P0001',message:'forbidden'});
      return fulfill(200,page(args.cursor?[]:own.filter(row=>args.mode==='hidden'?row.visibility==='hidden':args.mode==='published'?row.published_body&&row.visibility==='active':row.status==='pending'&&row.visibility==='active').map(({owner,...row})=>row),args.cursor?null:{at:stamp,id:R}));
    }
    if(resource==='meddocs_comment_audit'){
      const row=own.find(row=>row.id===args.target_comment);return fulfill(200,page(args.cursor?[]:[{kind:'revision',id:row.revision_id,created_at:stamp,actor_id:null,reason_code:null,number:1,body:row.body,status:row.status,decided_at:row.status==='pending'?null:stamp,redacted_at:row.body?null:stamp},...audit],args.cursor?null:{at:stamp,id:row.revision_id}));
    }
    errors.push(`Unexpected mock RPC ${resource}`);return fulfill(500,{});
  }
  if(url.pathname.startsWith('/auth/v1/')){
    if(params.request.method==='OPTIONS')return fulfill(200,{});
    if(url.pathname.endsWith('/logout')){signedIn=false;return fulfill(200,{});}
    if(url.pathname.endsWith('/user'))return signedIn?fulfill(200,session().user):fulfill(401,{message:'expired'});
    if(url.pathname.endsWith('/token'))return signedIn?fulfill(200,session()):fulfill(401,{message:'expired'});
    if(url.pathname.endsWith('/otp'))return fulfill(200,{});
    if(url.pathname.endsWith('/verify')){signedIn=true;return fulfill(200,session());}
  }
  if(url.hostname==='challenges.cloudflare.com' && url.pathname==='/turnstile/v0/api.js')return fulfill(200,"window.turnstile={render(host,options){queueMicrotask(()=>options.callback('mock-captcha'));return 'mock-widget';},reset(){},remove(){},isExpired(){return false;}};",'text/javascript');
  if(params.resourceType==='Image')return fulfill(200,'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="gray"/></svg>','image/svg+xml');
  blocked++;return tab.command('Fetch.failRequest',{requestId:params.requestId,errorReason:'BlockedByClient'});
}
async function createTab(){const target=await(await fetch(`${endpoint}/json/new?about:blank`,{method:'PUT'})).json();const socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});let sequence=0;const pending=new Map();
  const tab={target,socket,command(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});},
    async evaluate(expression){const result=await this.command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;},
    async wait(expression){for(let i=0;i<160;i++){if(await this.evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error(`Timed out: ${expression}`);},
    async navigate(path=article.canonical_path){await this.command('Page.navigate',{url:`${site}${path}`});await this.wait("document.readyState==='complete'");if(path===article.canonical_path){await this.evaluate("document.querySelector('meddocs-comments').scrollIntoView()");await this.wait("['ready','error'].includes(document.querySelector('meddocs-comments').dataset.publicState)");}},
    async click(selector){await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);},
    async sort(value){await this.evaluate(`(()=>{const s=document.querySelector('[data-sort]');if(${JSON.stringify(value)}!==null)s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);},
    async input(selector,value){await this.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);},
    async setSession(value){signedIn=Boolean(value);await this.evaluate(`(()=>{for(const key of Object.keys(localStorage)){if(key.startsWith('sb-')&&key.endsWith('-auth-token'))localStorage.removeItem(key);} ${value?`localStorage.setItem(${JSON.stringify(`sb-${serviceHost.split('.')[0]}-auth-token`)},${JSON.stringify(JSON.stringify(session()))});`:''}})()`);}};
  socket.onmessage=({data})=>{const message=JSON.parse(data);if(pending.has(message.id)){const{resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(message.error.message)):resolve(message.result);}if(message.method==='Fetch.requestPaused')void intercept(tab,message.params).catch(error=>{if(error.message!=='Invalid InterceptionId.')errors.push(error.message); /* A deliberately aborted SDK fetch no longer has a CDP interception. */});if(message.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(message.params.exceptionDetails));};
  tabs.push(tab);await tab.command('Page.enable');await tab.command('Runtime.enable');await tab.command('Fetch.enable',{patterns:[{urlPattern:'*'}]});return tab;
}
try{
  const tab=await createTab();await tab.command('Storage.clearDataForOrigin',{origin:new URL(site).origin,storageTypes:'all'});await tab.navigate();
  assert.equal(await tab.evaluate("document.querySelector('meddocs-comments').textContent.includes('Kommentare sind nicht redaktionell geprüft')"),false);
  assert.equal(await tab.evaluate("document.querySelector('[data-pending-summary]').hidden"),true);
  assert.equal(await tab.evaluate("(()=>{const nav=document.querySelector('.meddocs-pagination'),card=document.querySelector('.meddocs-editorial'),comments=document.querySelector('meddocs-comments');return document.querySelectorAll('.meddocs-pagination').length===1&&!!(nav.compareDocumentPosition(card)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(card.compareDocumentPosition(comments)&Node.DOCUMENT_POSITION_FOLLOWING)&&[...nav.querySelectorAll('a')].every(link=>!!link.href);})()"),true,'Pagination → editorial card → comments, with working links');
  assert.equal(await tab.evaluate("document.querySelectorAll('.article-cite-link,[data-citation-trigger]').length"),0);
  const ready="document.querySelector('meddocs-comments').dataset.publicState==='ready'";
  const privateReady="document.querySelector('meddocs-comments').dataset.privateState==='ready'";
  const accountReady="document.querySelector('[data-action=compose]')&&!document.querySelector('[data-action=compose]').disabled&&document.querySelector('[data-gate]').hidden";
  const compose=async()=>{await tab.wait(accountReady);await tab.click('[data-action=compose]');await tab.wait("!document.querySelector('[data-composer]').hidden");};
  assert.equal(await tab.evaluate("document.querySelector('[data-composer]').hidden"),true);
  assert.equal(await tab.evaluate("document.querySelector('[data-gate]').hidden"),true);
  assert.equal(await tab.evaluate("!!document.querySelector('[data-public-list] img')"),false);
  assert.equal(await tab.evaluate('window.__xss'),undefined);
  assert.equal(await tab.evaluate("!!document.querySelector('[data-action=refresh],.comments-refresh')"),false);
  assert.equal(await tab.evaluate("document.querySelector('[data-sort]').value"),'newest');
  assert.equal(await tab.evaluate("document.querySelector('[data-action=upvote] svg').getBBox().width>0"),true);
  assert.match(await tab.evaluate("document.querySelector('[data-action=upvote]').getAttribute('aria-label')"),/anmelden/);
  const beforeGuestVote=calls.filter(call=>call.resource==='meddocs_comment_upvote').length;
  await tab.click('[data-action=upvote]');assert.equal(await tab.evaluate("document.querySelector('[data-auth-dialog]').open"),true);
  assert.match(await tab.evaluate("document.querySelector('#comment-auth-title').textContent"),/bewerten/);
  assert.equal(calls.filter(call=>call.resource==='meddocs_comment_upvote').length,beforeGuestVote);
  await tab.click('[data-action=close-auth]');
  assert.equal(await tab.evaluate("document.querySelector('[data-composer-avatar] svg').getBBox().width>0"),true);
  assert.match(await tab.evaluate("document.querySelector('[data-public-list]').textContent"),/Autor/);
  assert.match(await tab.evaluate("document.querySelector('[data-public-list]').textContent"),/nicht überprüft/);
  assert.equal(await tab.evaluate("document.querySelector('[data-count]').hidden"),true);
  await tab.click('[data-action=replies]');await tab.wait("document.querySelector('.comment-thread')?.textContent.includes('vorhandene Antwort')");
  await tab.click('[data-action=more-replies]');await tab.wait("!document.querySelector('[data-action=more-replies]')");
  await tab.click('[data-action=more]');await tab.wait("document.querySelector('[data-action=more]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('[data-count]').textContent"),'(2)');
  // Global ordering (including a second page), publication time and deterministic ties.
  // The same composer accepts guests; auth is deferred until a valid explicit submit.
  const creates=()=>calls.filter(call=>call.resource==='meddocs_comment_create').length;
  await compose();await tab.input('#comment-body','   ');await tab.click('[data-composer] button[type=submit]');
  assert.equal(await tab.evaluate("document.querySelector('[data-auth-dialog]').open"),false);
  const prepared='Vorbereiteter Kommentar\nmit mehreren Zeilen <b>bleibt Text</b>';
  await tab.input('#comment-body',prepared);
  assert.equal(await tab.evaluate("Object.keys(sessionStorage).some(key=>key.startsWith('mednerds:comment-draft:'))"),false);
  const beforeAuth=creates();await tab.evaluate("document.querySelector('[data-composer] button[type=submit]').focus()");await tab.click('[data-composer] button[type=submit]');
  assert.equal(creates(),beforeAuth);assert.equal(await tab.evaluate("document.querySelector('[data-auth-dialog]').matches(':modal')"),true);
  for(const [width,height,theme]of[[1440,900,'dark'],[320,480,'dark'],[390,600,'light']]){
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await tab.evaluate(`document.documentElement.dataset.theme='${theme}'`);
    assert.equal(await tab.evaluate("(()=>{const d=document.querySelector('[data-auth-dialog]'),r=d.getBoundingClientRect();return r.left>=15&&r.right<=innerWidth-15&&r.top>=15&&r.bottom<=innerHeight-15&&d.scrollWidth<=d.clientWidth+1})()"),true);
  }
  const authCapture=await tab.command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,'mednerds-comment-auth-dialog.png'),Buffer.from(authCapture.data,'base64'));
  // Storage denial must stop navigation rather than silently dropping the text.
  await tab.evaluate("window.__draftStorageDescriptor=Object.getOwnPropertyDescriptor(window,'sessionStorage');Object.defineProperty(window,'sessionStorage',{configurable:true,get(){throw new DOMException('denied','SecurityError')}});true");
  await tab.click('[data-comment-login]');
  assert.equal(await tab.evaluate('location.pathname'),article.canonical_path);
  assert.equal(await tab.evaluate("document.querySelector('[data-auth-error]').hidden"),false);
  assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),prepared);
  await tab.evaluate("Object.defineProperty(window,'sessionStorage',window.__draftStorageDescriptor);delete window.__draftStorageDescriptor");
  await tab.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await tab.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await tab.wait("!document.querySelector('[data-auth-dialog]').open");
  assert.equal(await tab.evaluate("document.activeElement.matches('[data-composer] button[type=submit]')"),true);
  assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),prepared);
  // Upvote auth uses that dialog too and must preserve a parallel comment.
  await tab.click('[data-action=upvote]');await tab.click('[data-action=close-auth]');
  assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),prepared);
  await tab.click('[data-composer] button[type=submit]');
  await tab.click('[data-comment-login]');await tab.wait("!!document.querySelector('mednerds-account')");
  assert.equal(await tab.evaluate("new URL(location.href).searchParams.get('mode')"),'login');
  assert.equal(await tab.evaluate("new URL(location.href).searchParams.get('returnTo')"),article.canonical_path+'#kommentare');
  assert.equal(await tab.evaluate(`location.href.includes(${JSON.stringify(prepared)})`),false);
  // Aborting on the account page still permits restoration in this tab.
  await tab.navigate();await tab.wait("!document.querySelector('[data-composer]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),prepared);assert.equal(creates(),beforeAuth);
  await tab.click('[data-action=cancel-edit]');
  for(const mode of ['login','register']){
    const beforeFlow=creates();
    const beforeVotes=calls.filter(call=>call.resource==='meddocs_comment_upvote').length;
    name=mode==='register'?null:'Test User';legal=false;
    await compose();await tab.input('#comment-body',prepared+' '+mode);await tab.click('[data-composer] button[type=submit]');
    if(mode==='login'){await tab.click('[data-action=close-auth]');await tab.click('[data-action=upvote]');}
    await tab.click(mode==='login'?'[data-comment-login]':'[data-comment-register]');
    await tab.wait("!!document.querySelector('mednerds-account') && !document.querySelector('[data-login]').hidden");
    assert.equal(await tab.evaluate(`document.querySelector('[data-mode="${mode}"]').getAttribute('aria-pressed')`),'true');
    await tab.input('#account-email','test@example.test');
    if(mode==='register')await tab.evaluate("for(const s of ['[data-terms]','[data-privacy]']){const e=document.querySelector(s);e.checked=true;e.dispatchEvent(new Event('change'));}");
    await tab.wait("!document.querySelector('[data-send]').disabled");await tab.click('[data-send]');await tab.wait("!document.querySelector('[data-code-step]').hidden");
    await tab.input('#account-otp','000012');await tab.click('[data-verify]');
    if(mode==='register'){
      await tab.wait("!document.querySelector('[data-onboarding-view]').hidden");
      assert.equal(creates(),beforeFlow);
      await tab.input('#account-display-name','Test User');await tab.click('[data-profile-form] button[type=submit]');
    }else{
      await tab.wait("!document.querySelector('[data-legal-section]').hidden && !document.querySelector('[data-account-terms]').disabled");
      await tab.evaluate("for(const s of ['[data-account-terms]','[data-account-privacy]']){const e=document.querySelector(s);e.checked=true;e.dispatchEvent(new Event('change'));}");
      await tab.click('[data-legal-save]');
    }
    await tab.wait(`location.pathname===${JSON.stringify(article.canonical_path)} && !!document.querySelector('meddocs-comments') && document.querySelector('meddocs-comments').dataset.publicState==='ready'`);
    await tab.wait("!document.querySelector('[data-composer]').hidden");await tab.wait(privateReady);
    assert.equal(await tab.evaluate('location.hash'),'#kommentare');
    assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),prepared+' '+mode);
    assert.match(await tab.evaluate("document.querySelector('[data-draft-status]').textContent"),/wiederhergestellt/);
    assert.equal(creates(),beforeFlow,'Login/profile/legal completion must never submit');
    assert.equal(calls.filter(call=>call.resource==='meddocs_comment_upvote').length,beforeVotes,'Login never votes automatically');
    const deadline=await tab.evaluate("JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key=>key.startsWith('mednerds:comment-draft:')))).expiresAt");
    const reviewed=prepared+' '+mode+' (geprüft)';await tab.input('#comment-body',reviewed);
    assert.equal(await tab.evaluate("JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key=>key.startsWith('mednerds:comment-draft:')))).expiresAt"),deadline);
    await tab.navigate();await tab.wait("!document.querySelector('[data-composer]').hidden");await tab.wait(privateReady);
    assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),reviewed);assert.equal(creates(),beforeFlow);
    await tab.evaluate("const b=document.querySelector('[data-composer] button[type=submit]');b.click();b.click()");
    await tab.wait("document.querySelector('[data-composer]').hidden");await tab.wait(privateReady);
    assert.equal(creates(),beforeFlow+1);assert.equal(own.at(-1).status,'pending');assert.equal(own.at(-1).body,reviewed);own.length=0;
    assert.equal(await tab.evaluate("Object.keys(sessionStorage).some(key=>key.startsWith('mednerds:comment-draft:'))"),false);
    // Keep the existing regression fixture counts unchanged after each independent flow.
    await tab.setSession(false);await tab.navigate();
  }
  name='Test User';legal=true;
  await tab.command('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const original=roots.splice(0);for(let i=0;i<12;i++)roots.push({...original[0],id:'50000000-0000-4000-8000-'+String(i).padStart(12,'0'),first_published_at:'2026-10-12T12:00:00Z',reply_count:0});
  votes.set(roots[0].id,new Set([B]));votes.set(roots[1].id,new Set([B]));
  for(const order of ['newest','oldest','helpful']){
    await tab.sort(order);await tab.wait(ready);
    const expected=orderedRoots(order).map(row=>row.id);
    assert.deepEqual(await tab.evaluate("[...document.querySelector('[data-public-list]').children].map(li=>li.dataset.commentId)"),expected.slice(0,10));
    await tab.click('[data-action=more]');await tab.wait(ready);
    assert.deepEqual(await tab.evaluate("[...document.querySelector('[data-public-list]').children].map(li=>li.dataset.commentId)"),expected);
  }
  roots.splice(0,roots.length,...original);votes.clear();await tab.sort('newest');await tab.wait(ready);
  // Missing migrations are a backend availability issue, never an expired session.
  for(const failure of [{code:'PGRST202',message:'authentication_required SQL secret'},{code:'42501',message:'private permission'}]){
    publicFailure=failure;await tab.navigate();
    assert.equal(await tab.evaluate("document.querySelector('[data-list-status]').textContent"),'Kommentare sind momentan nicht verfügbar.');
    assert.equal(await tab.evaluate("document.querySelector('[data-composer-home]').hidden"),true);
    assert.equal(await tab.evaluate("document.querySelector('[data-count]').hidden"),true);
    assert.equal(await tab.evaluate("document.querySelector('meddocs-comments').textContent.includes('SQL secret')"),false);
    assert.equal(await tab.evaluate("document.querySelector('[data-gate]').hidden"),true);
  }
  publicFailure=null;networkFailure=true;await tab.navigate();
  assert.equal(await tab.evaluate("document.querySelector('meddocs-comments').dataset.publicCause"),'network_error');
  networkFailure=false;await tab.click('[data-action=load]');await tab.wait(ready);
  const savedRoots=roots.splice(0);await tab.navigate();
  assert.match(await tab.evaluate("document.querySelector('[data-list-status]').textContent"),/Noch keine Kommentare/);
  assert.equal(await tab.evaluate("document.querySelector('[data-count]').textContent"),'(0)');roots.push(...savedRoots);
  name=null;await tab.setSession(true);await tab.navigate();await tab.wait("document.querySelector('[data-gate]').textContent.includes('Profil')");
  assert.equal(await tab.evaluate("document.querySelector('[data-composer]').hidden"),true);
  await tab.click('[data-action=compose]');await tab.input('#comment-body','Profile completion draft');await tab.click('[data-composer] button[type=submit]');
  const href=await tab.evaluate("document.querySelector('[data-comment-login]').getAttribute('href')");assert.match(href,/returnTo=/);assert.match(href,/#profil-vervollstaendigen/);
  name='Test User';legal=false;await tab.navigate();await tab.wait("document.querySelector('[data-gate]').textContent.includes('rechtlichen')");
  legal=true;await tab.navigate();await tab.wait(accountReady);await tab.wait(privateReady);
  // Vote / remove / failure / self-vote / replies through the real SDK and UI.
  const voteSelector=`[data-comment-id="${R}"] > .comment-row [data-action=upvote]`;
  await tab.wait("!document.querySelector('[data-action=upvote]').disabled");
  const initialWidth=await tab.evaluate("document.querySelector('[data-action=upvote]').getBoundingClientRect().width");
  await tab.evaluate("document.querySelector('[data-action=upvote]').focus()");
  await tab.click(voteSelector);await tab.wait("document.querySelector('[data-action=upvote]').getAttribute('aria-pressed')==='true'");
  assert.equal(votes.get(R).size,1);
  assert.equal(await tab.evaluate("document.activeElement.dataset.action"),'upvote');
  assert.equal(await tab.evaluate("document.querySelector('[data-action=upvote]').getBoundingClientRect().width"),initialWidth);
  voteError=true;await tab.click(voteSelector);await tab.wait("!document.querySelector('[data-vote-error]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('[data-action=upvote]').getAttribute('aria-pressed')"),'true');assert.equal(votes.get(R).size,1);
  assert.doesNotMatch(await tab.evaluate("document.querySelector('[data-vote-error]').textContent"),/internal private/);
  voteError=false;await tab.click(voteSelector);await tab.wait("document.querySelector('[data-action=upvote]').getAttribute('aria-pressed')==='false'");assert.equal(votes.get(R).size,0);
  roots[0].owner=A;await tab.sort(null);await tab.wait(ready);assert.equal(await tab.evaluate("document.querySelector('[data-action=upvote]').disabled"),true);delete roots[0].owner;
  await tab.sort(null);await tab.wait(ready);await tab.click('[data-action=replies]');await tab.wait("!!document.querySelector('.comment-thread [data-action=upvote]')");
  await tab.click('.comment-thread [data-action=upvote]');await tab.wait("document.querySelector('.comment-thread [data-action=upvote]').getAttribute('aria-pressed')==='true'");
  assert.equal(votes.get(B).has(A),true);
  // Voting in helpful order re-fetches the global ranking.
  await tab.sort('helpful');await tab.wait(ready);
  const listCalls=calls.filter(call=>call.resource==='meddocs_comments_list').length;
  await tab.click(voteSelector);await tab.wait(ready);
  await tab.wait("document.querySelector('[data-action=upvote]').getAttribute('aria-pressed')==='true'");
  assert.ok(calls.filter(call=>call.resource==='meddocs_comments_list').length>listCalls);
  await tab.sort('newest');await tab.wait(ready);
  assert.equal(await tab.evaluate("document.querySelector('[data-composer]').hidden"),true);
  publicFailure={code:'PGRST202',message:'authentication_required private SQL'};await tab.navigate();
  await tab.wait(privateReady);assert.equal(signedIn,true);
  assert.equal(await tab.evaluate("document.querySelector('[data-gate]').hidden"),true);
  publicFailure=null;await tab.click('[data-action=load]');await tab.wait(ready);await tab.wait(accountReady);
  privateFailure={code:'PGRST202',message:'authentication_required'};await tab.sort(null);await tab.wait(ready);
  await tab.wait("document.querySelector('meddocs-comments').dataset.privateState==='error'");
  assert.equal(signedIn,true);assert.equal(await tab.evaluate("document.querySelector('[data-gate]').hidden"),true);
  privateFailure=null;await tab.click('[data-action=retry-mine]');await tab.wait(privateReady);
  canWrite=false;await tab.navigate();await tab.wait("document.querySelector('[data-gate]').textContent.includes('nicht möglich')");
  assert.equal(await tab.evaluate("document.querySelector('[data-action=compose]').disabled"),true);canWrite=true;await tab.navigate();await tab.wait(accountReady);
  ownReadError=true;await tab.sort(null);await tab.wait("document.querySelector('meddocs-comments').dataset.privateState==='error'");await tab.wait(ready);
  assert.equal(await tab.evaluate("document.querySelector('[data-private-status]').hidden"),false);
  assert.equal(await tab.evaluate("document.querySelector('[data-list-status]').textContent"),'');
  assert.ok(await tab.evaluate("document.querySelector('[data-public-list]').textContent.includes('Öffentlich')"));
  ownReadError=false;await tab.click('[data-action=retry-mine]');await tab.wait(privateReady);
  await tab.evaluate("(()=>{const element=document.querySelector('meddocs-comments'),parent=element.parentElement;element.remove();parent.append(element)})()");
  await tab.wait(ready);await compose();
  await tab.input('#comment-body','   ');await tab.click('[data-composer] button[type=submit]');assert.equal(await tab.evaluate("document.querySelector('#comment-body').getAttribute('aria-invalid')"),'true');
  const body='Neuer Kommentar <svg onload="window.__xss=2">';await tab.input('#comment-body',body);
  writeError='rate_limited';await tab.click('[data-composer] button[type=submit]');await tab.wait("document.querySelector('[data-error]').textContent.includes('Beitragslimit')");assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),body);
  // Async refresh must preserve both draft and keyboard focus.
  await tab.evaluate("document.querySelector('#comment-body').focus()");await tab.sort(null);await tab.wait(ready);await tab.wait(privateReady);
  assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),body);
  assert.equal(await tab.evaluate("document.activeElement.id"),'comment-body');
  writeError=null;await tab.click('[data-composer] button[type=submit]');await tab.wait("document.querySelector('[data-public-list]').textContent.includes('Wartet auf Freigabe')");
  await tab.wait("document.querySelector('[data-pending-summary]').textContent==='1 Beitrag wartet auf Freigabe.'");
  assert.equal(await tab.evaluate("document.querySelector('[data-own-id] .comment-byline .comment-pending').textContent"),'Wartet auf Freigabe');
  assert.equal(await tab.evaluate("document.querySelectorAll('[data-own-id] .comment-state').length"),1);
  assert.equal(await tab.evaluate("document.querySelector('[data-own-id] .comment-content > .comment-state')"),null);
  const previousRoots=roots.splice(0);await tab.navigate();await tab.wait(ready);await tab.wait(privateReady);
  assert.equal(await tab.evaluate("document.querySelector('[data-count]').textContent"),'(0)');
  assert.equal(await tab.evaluate("document.querySelector('[data-pending-summary]').textContent"),'1 Beitrag wartet auf Freigabe.');
  roots.push(...previousRoots);await tab.navigate();await tab.wait(ready);await tab.wait(privateReady);
  ownHasMore=true;await tab.sort(null);await tab.wait(privateReady);
  assert.equal(await tab.evaluate("document.querySelector('[data-pending-summary]').textContent"),'Mindestens 1 Beitrag wartet auf Freigabe.');
  ownHasMore=false;await tab.sort(null);await tab.wait(privateReady);
  assert.equal(await tab.evaluate("document.querySelectorAll('[data-own-id]').length"),1);
  assert.equal(await tab.evaluate("!!document.querySelector('[data-private] [data-action=upvote]')"),false);
  assert.equal(await tab.evaluate('window.__xss'),undefined);
  assert.equal(await tab.evaluate("document.querySelector('[data-composer]').hidden"),true);
  await tab.click('[data-action=edit]');await tab.input('#comment-body','Geänderte Fassung');await tab.click('[data-composer] button[type=submit]');await tab.wait("document.querySelector('[data-public-list]').textContent.includes('Geänderte Fassung')");
  // Existing public body stays public while its private edit is pending/rejected.
  const editRow=own[0];editRow.published_body='Freigegebene Originalfassung';
  roots.push({...roots[0],id:editRow.id,body:editRow.published_body,display_name:name,role:null,professional_role:null,reply_count:0});
  await tab.sort(null);await tab.wait(ready);await tab.wait(privateReady);
  assert.equal(await tab.evaluate(`document.querySelectorAll('[data-comment-id="${editRow.id}"]').length`),1);
  assert.equal(await tab.evaluate(`document.querySelector('[data-comment-id="${editRow.id}"] .comment-body').textContent`),'Freigegebene Originalfassung');
  assert.match(await tab.evaluate(`document.querySelector('[data-comment-id="${editRow.id}"] details').textContent`),/Geänderte Fassung/);
  editRow.status='rejected';await tab.sort(null);await tab.wait(ready);await tab.wait(privateReady);
  assert.equal(await tab.evaluate("document.querySelector('[data-pending-summary]').hidden"),true);
  assert.equal(await tab.evaluate(`document.querySelector('[data-comment-id="${editRow.id}"] .comment-pending')`),null);
  assert.match(await tab.evaluate(`document.querySelector('[data-comment-id="${editRow.id}"]').textContent`),/Änderung abgelehnt/);
  editRow.status='pending';roots.pop();editRow.published_body=null;
  await tab.sort(null);await tab.wait(ready);await tab.wait(privateReady);
  await tab.click(`[data-comment-id="${R}"] [data-action=reply]`);
  assert.equal(await tab.evaluate(`document.querySelector('[data-editor-for="${R}"]').contains(document.querySelector('[data-composer]'))`),true);
  await tab.input('#comment-body','Eine neue Antwort');await tab.click('[data-composer] button[type=submit]');await tab.wait("document.querySelector('.comment-thread')?.textContent.includes('Eine neue Antwort')");
  await tab.wait("document.querySelector('[data-pending-summary]').textContent==='2 Beiträge warten auf Freigabe.'");
  assert.equal(calls.filter(call=>call.resource==='meddocs_comment_create').at(-1).args.reply_to,R);
  await tab.click('[data-action=replies]');assert.equal(await tab.evaluate("document.querySelector('.comment-thread').hidden"),true);
  await tab.click('[data-action=replies]');assert.equal(await tab.evaluate("document.querySelector('.comment-thread').hidden"),false);
  await tab.wait("!!document.querySelector('[data-action=more-replies]')");
  await tab.click('[data-action=more-replies]');await tab.wait("!document.querySelector('[data-action=more-replies]')");
  await tab.click('[data-action=more]');await tab.wait("document.querySelector('[data-action=more]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('[data-count]').textContent"),'(2)'); // Private posts never inflate the public count.
  await compose();await tab.input('#comment-body','Zurückziehbarer Beitrag');await tab.click('[data-composer] button[type=submit]');await tab.wait("document.querySelector('[data-public-list]').textContent.includes('Zurückziehbarer Beitrag')");
  await compose();await tab.input('#comment-body','Entwurf\nmit mehreren Zeilen\nfür das Textfeld');
  await tab.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  for(const [width,theme]of[[320,'dark'],[375,'light'],[768,'dark'],[1440,'light']]){
    await tab.command('Emulation.setTouchEmulationEnabled',{enabled:width<1024});
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await tab.evaluate(`document.documentElement.dataset.theme='${theme}'`);
    assert.equal(await tab.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    assert.equal(await tab.evaluate("document.querySelector('#comment-body').labels.length"),1);
    assert.equal(await tab.evaluate("document.querySelector('[data-action-status]').getAttribute('aria-live')"),'polite');
    assert.equal(await tab.evaluate("!!document.querySelector('[data-public-list] time[datetime]')"),true);
    assert.equal(await tab.evaluate("document.querySelector('meddocs-comments').querySelectorAll('h2').length"),1);
    assert.equal(await tab.evaluate("getComputedStyle(document.querySelector('[data-action=edit]')).textDecorationLine"),'none');
    assert.equal(await tab.evaluate("getComputedStyle(document.querySelector('.comment-entry')).animationName"),'none');
    if(width<1024){assert.equal(await tab.evaluate("matchMedia('(pointer: coarse)').matches"),true);assert.equal(await tab.evaluate("document.querySelector('[data-action=edit]').getBoundingClientRect().height>=44"),true);}
    assert.equal(await tab.evaluate(`(()=>{const body=document.querySelector('[data-comment-id="${R}"] .comment-body');const saved=body.textContent;body.textContent='https://example.test/'+ 'x'.repeat(500);const fits=document.documentElement.scrollWidth<=innerWidth+1;body.textContent=saved;return fits;})()`),true);
    if(width===375||width===1440){await tab.evaluate("document.querySelector('meddocs-comments').scrollIntoView({block:'start'});window.scrollBy(0,-80)");const capture=await tab.command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,`mednerds-comments-${theme}-${width}.png`),Buffer.from(capture.data,'base64'));}
  }
  await tab.command('Page.bringToFront');await tab.evaluate("document.querySelector('#comment-body').focus()");await tab.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await tab.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await tab.evaluate("document.activeElement.dataset.action"),'cancel-edit');
  await tab.click('[data-action=cancel-edit]');assert.equal(await tab.evaluate("document.activeElement.dataset.action"),'compose');
  // Capture the closed, quiet composer and readable public thread in both themes.
  for(const [width,theme]of[[375,'dark'],[1440,'dark'],[1440,'light']]){
    await tab.command('Emulation.setTouchEmulationEnabled',{enabled:width<1024});
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<600});await tab.evaluate(`document.documentElement.dataset.theme='${theme}'`);
    await tab.evaluate("document.querySelector('meddocs-comments').scrollIntoView({block:'start'});window.scrollBy(0,-80)");
    const capture=await tab.command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,`mednerds-comments-closed-${theme}-${width}.png`),Buffer.from(capture.data,'base64'));
  }
  const withdrawSelector=`[data-own-id="${own.at(-1).id}"] [data-action=withdraw]`;
  await tab.click(withdrawSelector);assert.equal(await tab.evaluate("document.querySelector('[data-withdraw-dialog]').open"),true);await tab.click('[data-action=cancel-withdraw]');
  await tab.click(withdrawSelector);await tab.click('[data-action=confirm-withdraw]');await tab.wait("document.querySelector('[data-action-status]').textContent.includes('zurückgezogen')");await tab.wait(privateReady);
  assert.equal(await tab.evaluate(`!!document.querySelector('[data-own-id="${own.at(-1).id}"]')`),false);
  // Replies whose parent is not currently public stay private in a small disclosure.
  const orphan={...own[1],id:'44444444-4444-4444-8444-444444444444',parent_id:A,body:'Private verwaiste Antwort'};own.push(orphan);
  await tab.sort(null);await tab.wait(ready);await tab.wait(privateReady);
  assert.equal(await tab.evaluate("document.querySelector('[data-personal]').hidden"),false);
  assert.equal(await tab.evaluate("document.querySelector('[data-personal]').open"),false);
  assert.match(await tab.evaluate("document.querySelector('[data-personal-list]').textContent"),/verwaiste Antwort/);own.pop();
  roots[0].role='admin';await tab.sort(null);await tab.wait(ready);await tab.wait(privateReady);
  assert.equal(await tab.evaluate(`document.querySelector('[data-comment-id="${R}"] .comment-badge').textContent`),'Admin');
  roots[0].role='author';
  // An article change discards delayed private responses for the previous article.
  readDelay=500;await tab.sort(null);await tab.evaluate(`document.querySelector('meddocs-comments').dataset.articleId='${A}'`);
  await tab.wait(ready);await tab.wait(privateReady);await new Promise(resolve=>setTimeout(resolve,600));
  assert.equal(await tab.evaluate("document.querySelectorAll('[data-own-id]').length"),0);
  assert.equal(await tab.evaluate("document.querySelector('[data-count]').textContent"),'(0)');readDelay=0;
  assert.equal(await tab.evaluate("document.querySelector('[data-pending-summary]').hidden"),true);
  await tab.setSession(false);await tab.navigate();
  assert.equal(await tab.evaluate("document.querySelectorAll('[data-own-id]').length"),0);
  // Admin queue remains private; edits compare against the still-published old body.
  await tab.navigate('/account/moderation/');await tab.wait("document.querySelector('[data-gate]').textContent.includes('Melde dich')");
  assert.equal(await tab.evaluate("document.querySelector('[data-admin-panel]').hidden"),true);
  staff='author';await tab.setSession(true);await tab.navigate('/account/moderation/');await tab.wait("document.querySelector('[data-gate]').textContent.includes('keine Administrationsrechte')");
  const queueBefore=calls.filter(call=>call.resource==='meddocs_comment_queue').length;
  assert.equal(await tab.evaluate("document.querySelector('[data-admin-panel]').hidden"),true);
  staff='admin';await tab.navigate('/account/moderation/');await tab.wait("document.querySelector('[data-queue]').textContent.includes('Eine neue Antwort')");assert.ok(calls.filter(call=>call.resource==='meddocs_comment_queue').length>queueBefore);
  await tab.click('[data-action=more]');await tab.wait("document.querySelector('[data-action=more]').hidden");
  const moderationCapture=await tab.command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,'mednerds-comments-moderation.png'),Buffer.from(moderationCapture.data,'base64'));
  assert.match(await tab.evaluate("document.querySelector('meta[name=robots]').content"),/noindex/);
  await tab.click('[data-action=approve]');assert.equal(await tab.evaluate("document.querySelector('meddocs-moderation dialog').open"),true);
  assert.equal(await tab.evaluate("document.activeElement.dataset.action"),'cancel');
  const originalDescription=await tab.evaluate("document.querySelector('#moderation-confirm-description').textContent");
  for(const [width,height,theme]of[[1440,900,'dark'],[768,900,'light'],[320,480,'dark'],[390,600,'light']]) {
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
    await tab.evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('#moderation-confirm-description').textContent=${JSON.stringify(originalDescription)}+' /'+ 'x'.repeat(500)`);
    const layout=await tab.evaluate(`(()=>{const d=document.querySelector('meddocs-moderation dialog'),r=d.getBoundingClientRect(),width=document.documentElement.clientWidth,height=document.documentElement.clientHeight;return {centered:Math.abs(r.x+r.width/2-width/2)<2&&Math.abs(r.y+r.height/2-height/2)<2,fits:r.left>=15&&r.top>=15&&r.right<=width-15&&r.bottom<=height-15,overflow:d.scrollWidth>d.clientWidth+1,modal:d.matches(':modal'),backdrop:getComputedStyle(d,'::backdrop').backgroundColor,rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width,height}}})()`);
    assert.equal(layout.centered,true,JSON.stringify(layout));assert.equal(layout.fits,true,JSON.stringify(layout));assert.equal(layout.overflow,false,JSON.stringify(layout));assert.equal(layout.modal,true);assert.notEqual(layout.backdrop,'rgba(0, 0, 0, 0)');
  }
  await tab.evaluate(`document.querySelector('#moderation-confirm-description').textContent=${JSON.stringify(originalDescription)}`);
  const dialogCapture=await tab.command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,'mednerds-comments-moderation-dialog.png'),Buffer.from(dialogCapture.data,'base64'));
  await tab.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await tab.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await tab.wait("!document.querySelector('meddocs-moderation dialog').open");
  assert.equal(await tab.evaluate("document.activeElement.dataset.action"),'approve');
  await tab.click('[data-action=approve]');
  const before=calls.filter(call=>call.resource==='meddocs_comment_decide').length;await tab.click('[data-action=cancel]');assert.equal(calls.filter(call=>call.resource==='meddocs_comment_decide').length,before);
  await tab.click('[data-action=approve]');await tab.click('[data-action=confirm]');await tab.wait("document.querySelector('[data-action-status]').textContent.includes('gespeichert')");
  await tab.click('[data-action=reject]');await tab.click('[data-action=confirm]');await tab.wait("document.querySelector('[data-list-status]').textContent.includes('Keine Beiträge')");
  await tab.evaluate("const s=document.querySelector('#moderation-mode');s.value='published';s.dispatchEvent(new Event('change'))");await tab.wait("!!document.querySelector('[data-action=hide]')");
  assert.match(await tab.evaluate("document.querySelector('.comment-comparison').textContent"),/Geänderte Fassung/);
  await tab.click('[data-action=audit]');await tab.wait("document.querySelector('[data-history]')?.textContent.includes('Revision 1')");
  await tab.click('[data-action=audit-more]');await tab.wait("!document.querySelector('[data-action=audit-more]')");
  await tab.click('[data-action=hide]');await tab.click('[data-action=confirm]');await tab.wait("document.querySelector('[data-list-status]').textContent.includes('Keine Beiträge')");
  await tab.evaluate("document.querySelector('#moderation-mode').value='hidden';document.querySelector('#moderation-mode').dispatchEvent(new Event('change'))");await tab.wait("!!document.querySelector('[data-action=restore]')");
  await tab.click('[data-action=restore]');await tab.click('[data-action=confirm]');await tab.wait("document.querySelector('[data-list-status]').textContent.includes('Keine Beiträge')");
  await tab.evaluate("document.querySelector('#moderation-mode').value='published';document.querySelector('#moderation-mode').dispatchEvent(new Event('change'))");await tab.wait("!!document.querySelector('[data-action=audit]')");
  await tab.click('[data-action=audit]');await tab.wait("!!document.querySelector('[data-action=redact]')");await tab.click('[data-action=redact]');await tab.click('[data-action=confirm]');await tab.wait("document.querySelector('[data-list-status]').textContent.includes('Keine Beiträge')");
  for(const[width,theme]of[[320,'dark'],[390,'light'],[1440,'dark']]){await tab.command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await tab.evaluate(`document.documentElement.dataset.theme='${theme}'`);assert.equal(await tab.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);}
  await tab.setSession(false);await tab.navigate('/account/moderation/');await tab.wait("document.querySelector('[data-admin-panel]').hidden");assert.equal(await tab.evaluate("document.querySelector('[data-queue]').textContent"),'');
  // Real SDK cross-tab auth events, with a delayed private reply that must be discarded.
  staff=null;userId=A;name='Test User';await tab.setSession(true);readDelay=600;await tab.navigate();await tab.wait(accountReady);await compose();await tab.input('#comment-body','Private draft before logout');
  const other=await createTab();await other.navigate('/account/');await other.wait("!document.querySelector('[data-account-controls]').hidden");await other.click('[data-logout]');
  await tab.wait("!document.querySelector('[data-draft-status]').hidden && document.querySelector('[data-draft-status]').textContent.includes('Anmeldung')");await new Promise(resolve=>setTimeout(resolve,700));
  assert.equal(await tab.evaluate("document.querySelectorAll('[data-own-id]').length"),0);
  assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),'');readDelay=0;
  assert.equal(await tab.evaluate("document.querySelector('[data-pending-summary]').hidden"),true);
  userId=B;name='Other User';await other.wait("!document.querySelector('[data-login]').hidden");await other.click('[data-mode=login]');
  await other.input('#account-email','other@example.test');await other.wait("!document.querySelector('[data-send]').disabled");await other.click('[data-send]');await other.wait("!document.querySelector('[data-code-step]').hidden");
  await other.input('#account-otp','000012');await other.click('[data-verify]');await other.wait("!document.querySelector('[data-account-controls]').hidden");
  await tab.wait(accountReady);await compose();assert.equal(await tab.evaluate("document.querySelectorAll('[data-own-id]').length"),0);
  assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),'','A different account never adopts the previous account draft');
  writeError='authentication_required';await tab.input('#comment-body','Expired session submission');await tab.click('[data-composer] button[type=submit]');
  await tab.wait("!document.querySelector('[data-gate]').hidden && document.querySelector('[data-gate]').textContent.includes('abgelaufen')");await other.wait("document.querySelector('[data-account-controls]').hidden");writeError=null;
  assert.equal(await tab.evaluate("document.querySelector('#comment-body').value"),'Expired session submission');
  const staticTab=await createTab();await staticTab.command('Emulation.setScriptExecutionDisabled',{value:true});
  await staticTab.command('Page.navigate',{url:site+article.canonical_path});await staticTab.wait("document.readyState==='complete'");
  assert.ok(await staticTab.evaluate("document.querySelector('h1').textContent.includes('Grundlagen')"));
  assert.equal(await staticTab.evaluate("!!document.querySelector('meddocs-comments noscript')"),true);
  assert.equal(await staticTab.evaluate("!!customElements.get('meddocs-comments')"),false);
  await staticTab.command('Emulation.setScriptExecutionDisabled',{value:false});
  assert.equal(blocked,0);assert.deepEqual(errors,[]);
  console.log('✓ MedDocs comments browser: guest composer, shared auth dialog, OTP login/registration/profile/legal return, draft restore/cancel/storage denial, explicit submit/double-click protection, upvotes/sort/pagination, moderation, keyboard/mobile/dark/light, expiry/logout/account isolation');
}finally{for(const tab of tabs){tab.socket.close();await fetch(`${endpoint}/json/close/${tab.target.id}`).catch(()=>{});}}
