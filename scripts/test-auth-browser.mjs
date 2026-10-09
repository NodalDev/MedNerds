import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Serve dist locally. Every external request is blocked or mocked: no live OTPs.
const site = process.env.AUTH_SITE ?? 'http://127.0.0.1:4326';
const endpoint = process.env.AUTH_CDP ?? 'http://127.0.0.1:9334';
const screenshots = process.env.AUTH_SCREENSHOTS ?? tmpdir();
const email = 'demo@example.test';
const requests = [];
const errors = [];
const tabs = [];
let sendError, verifyError, logoutError, refreshError;
let sendDelay = 0;
let scriptLoads = 0;
let blockedExternal = 0;
let profileName = null, profileReadError, profileWriteError, staffReadError;
let profileWriteDelay = 0;
let staffRow = null;
const profileWrites = [];
let profileReads = 0;

const turnstileMock = `(() => {
  let sequence=0,active;
  const widgets=new Map();
  window.__captcha={renders:0,resets:0,removes:0,solve(){
    const widget=widgets.get(active);widget.expired=false;widget.options.callback('test-captcha-'+active);
  },expire(){const widget=widgets.get(active);widget.expired=true;widget.options['expired-callback']();},
  fail(){widgets.get(active).options['error-callback']();},
  get activeCount(){return widgets.size;}};
  window.turnstile={render(host,options){
    const id='mock-widget-'+(++sequence);active=id;window.__captcha.renders++;
    const button=document.createElement('button');button.type='button';button.textContent='Sicherheitsprüfung bestätigen (Test)';
    button.onclick=()=>window.__captcha.solve();host.append(button);
    widgets.set(id,{host,options,button,expired:false});return id;
  },reset(id){window.__captcha.resets++;widgets.get(id).expired=false;},
  remove(id){window.__captcha.removes++;widgets.get(id)?.button.remove();widgets.delete(id);},
  isExpired(id){return !widgets.has(id)||widgets.get(id).expired;}};
})();`;

function fakeSession() {
  const expires = Math.floor(Date.now()/1000)+3600;
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub:'00000000-0000-4000-8000-000000000001',aud:'authenticated',exp:expires,email})).toString('base64url');
  return {access_token:`${header}.${payload}.test-signature`,refresh_token:'test-refresh-only',expires_in:3600,
    expires_at:expires,token_type:'bearer',user:{id:'00000000-0000-4000-8000-000000000001',email,
      aud:'authenticated',role:'authenticated',created_at:'2026-10-08T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{}}};
}

async function handleRequest(tab, params) {
  const url = new URL(params.request.url);
  const fulfill = (status, body, mime = 'application/json') => tab.command('Fetch.fulfillRequest', {
    requestId:params.requestId,responseCode:status,responseHeaders:[
      {name:'Content-Type',value:mime},{name:'Access-Control-Allow-Origin',value:new URL(site).origin},
      {name:'Access-Control-Allow-Headers',value:'authorization,apikey,content-type,prefer,accept-profile,content-profile,x-client-info,x-supabase-api-version,x-supabase-client-platform,x-supabase-client-platform-version,x-supabase-client-runtime,x-supabase-client-runtime-version'},
      {name:'Access-Control-Allow-Methods',value:'GET,POST,PATCH,OPTIONS'},
      {name:'Access-Control-Expose-Headers',value:'x-supabase-api-version'},
      {name:'x-supabase-api-version',value:'2024-01-01'},
    ],body:Buffer.from(typeof body==='string'?body:JSON.stringify(body)).toString('base64'),
  });
  if(url.origin===new URL(site).origin) return tab.command('Fetch.continueRequest',{requestId:params.requestId});
  if(url.hostname==='challenges.cloudflare.com' && url.pathname==='/turnstile/v0/api.js') {
    scriptLoads++; return fulfill(200,turnstileMock,'text/javascript');
  }
  if(url.pathname.startsWith('/rest/v1/')) {
    if(params.request.method==='OPTIONS') return fulfill(200,{});
    const table=url.pathname.split('/').at(-1);
    const userId=url.searchParams.get('user_id')?.replace(/^eq\./,'');
    assert.equal(userId,'00000000-0000-4000-8000-000000000001');
    if(table==='profiles') {
      if(params.request.method==='PATCH') {
        const update=JSON.parse(params.request.postData);
        profileWrites.push(update);
        if(profileWriteDelay) await new Promise(resolve=>setTimeout(resolve,profileWriteDelay));
        if(profileWriteError) return fulfill(400,{code:profileWriteError,message:'private database diagnostic'});
        profileName=update.display_name;
        return fulfill(200,{user_id:userId,display_name:profileName,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T01:00:00Z'});
      }
      assert.equal(params.request.method,'GET');profileReads++;
      if(profileReadError) return fulfill(404,{code:profileReadError,message:'private database diagnostic'});
      return fulfill(200,[{user_id:userId,display_name:profileName,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T00:00:00Z'}]);
    }
    assert.equal(table,'staff_accounts');assert.equal(params.request.method,'GET');
    return staffReadError ? fulfill(403,{code:'42501',message:'private database diagnostic'}) : fulfill(200,staffRow?[staffRow]:[]);
  }
  if(url.pathname.startsWith('/auth/v1/')) {
    if(params.request.method==='OPTIONS') return fulfill(200,{});
    const body = JSON.parse(params.request.postData || '{}');
    const method = url.pathname.split('/').at(-1);
    // Only non-sensitive, artificial test fields are recorded. Never record headers or project URLs.
    requests.push({method,email:body.email,token:method==='verify'?body.token:undefined,
      createUser:body.create_user,captcha:body.gotrue_meta_security?.captcha_token});
    if(method==='otp') {
      if(sendDelay) await new Promise(resolve=>setTimeout(resolve,sendDelay));
      return sendError ? fulfill(sendError.status,{code:sendError.code,msg:'private server diagnostic'}) : fulfill(200,{});
    }
    if(method==='verify') return verifyError ? fulfill(403,{code:verifyError,msg:'private server diagnostic'}) : fulfill(200,fakeSession());
    if(method==='logout') return logoutError ? fulfill(500,{code:'unexpected_failure',msg:'private server diagnostic'}) : fulfill(200,{});
    if(method==='user') return fulfill(200,fakeSession().user);
    if(method==='token') return refreshError ? fulfill(400,{code:'refresh_token_not_found',msg:'private server diagnostic'}) : fulfill(200,fakeSession());
    throw new Error('Unexpected mocked auth method');
  }
  blockedExternal++;
  return tab.command('Fetch.failRequest',{requestId:params.requestId,errorReason:'BlockedByClient'});
}

async function createTab() {
  const target = await (await fetch(`${endpoint}/json/new?about:blank`,{method:'PUT'})).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let sequence=0;const pending=new Map();
  const tab={target,socket,command(method,params={}){
    return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  },async evaluate(expression){
    const result=await this.command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  },async wait(expression){
    for(let i=0;i<150;i++){if(await this.evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,75));}
    throw new Error(`Timed out: ${expression}`);
  },async navigate(){
    await this.command('Page.navigate',{url:`${site}/account/`});
    await this.wait("document.readyState==='complete' && !!document.querySelector('mednerds-account')");
  },async input(selector,value){
    await this.evaluate(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  },async click(selector){await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}};
  socket.onmessage=({data})=>{
    const message=JSON.parse(data);
    if(pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(message.error.message)):resolve(message.result);}
    if(message.method==='Fetch.requestPaused') void handleRequest(tab,message.params).catch(()=>errors.push('Mock interception failed'));
    if(message.method==='Runtime.exceptionThrown') errors.push('Browser runtime error');
  };
  tabs.push(tab);
  await tab.command('Page.enable');await tab.command('Runtime.enable');
  await tab.command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  // Speed up only the UI cooldown; this does not bypass Supabase in production.
  await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:`
    const actualNow=Date.now;window.__clockOffset=0;Date.now=()=>actualNow()+window.__clockOffset;
    const actualInterval=window.setInterval,actualClear=window.clearInterval;
    window.__cooldownTimers=new Set();
    window.setInterval=(callback,delay,...args)=>{const id=actualInterval(callback,delay,...args);if(delay===1000)window.__cooldownTimers.add(id);return id;};
    window.clearInterval=id=>{window.__cooldownTimers.delete(id);actualClear(id);};
  `});
  return tab;
}

try {
  const tab=await createTab();await tab.navigate();
  if(process.env.AUTH_EXPECT_UNCONFIGURED==='1') {
    await tab.wait("!document.querySelector('[data-error]').hidden && document.querySelector('[data-loading]').hidden");
    assert.equal(await tab.evaluate("document.querySelector('[data-login]').hidden"),true);
    assert.equal(requests.length,0);assert.equal(scriptLoads,0);assert.equal(blockedExternal,0);
    assert.ok(await tab.evaluate("document.querySelector('[data-error]').textContent.includes('nicht eingerichtet')"));
    assert.deepEqual(errors,[]);
    console.log('✓ Account browser without configuration: clear message, no Auth or Turnstile requests');
  } else {
  await tab.wait("!document.querySelector('[data-login]').hidden && !!window.__captcha?.activeCount");
  assert.equal(scriptLoads,1);
  assert.equal(profileReads,0);
  assert.equal(await tab.evaluate('window.__cooldownTimers.size'),0);
  const page=await tab.evaluate(`({title:document.querySelector('h1').textContent.trim(),
    robots:document.querySelector('meta[name=robots]').content,pagefind:!!document.querySelector('[data-pagefind-body]'),
    labels:[...document.querySelectorAll('mednerds-account input')].every(input=>input.labels.length===1),
    password:!!document.querySelector('input[type=password]'),navLinks:document.querySelectorAll('a[href="/account/"]').length,
    live:document.querySelector('[data-status]').getAttribute('aria-live'),
    otpType:document.querySelector('#account-otp').type,otpAutocomplete:document.querySelector('#account-otp').autocomplete})`);
  assert.equal(page.title,'MedNerds Account');assert.ok(page.robots.includes('noindex'));assert.equal(page.pagefind,false);
  assert.equal(page.labels,true);assert.equal(page.password,false);assert.equal(page.navLinks,0);
  assert.equal(page.live,'polite');assert.equal(page.otpType,'text');assert.equal(page.otpAutocomplete,'one-time-code');
  const indexed=await tab.evaluate(`(async()=>{
    const pagefind=await import('/pagefind/pagefind.js');
    const account=await pagefind.search('Account');
    const urls=await Promise.all(account.results.map(async result=>(await result.data()).url));
    return {urls,positive:(await pagefind.search('OSCE')).results.length};
  })()`);
  assert.ok(indexed.urls.every(url=>!url.endsWith('/account/')));assert.ok(indexed.positive>0);

  await tab.input('#account-email',email);
  await tab.evaluate("document.querySelector('[data-email-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert.equal(requests.filter(r=>r.method==='otp').length,0);
  await tab.evaluate('window.__captcha.solve()');await tab.input('#account-email','invalid');await tab.click('[data-send]');
  assert.equal(await tab.evaluate("document.querySelector('#account-email').getAttribute('aria-invalid')"),'true');
  assert.ok(await tab.evaluate("document.querySelector('#account-email').getAttribute('aria-describedby').includes('account-error')"));
  assert.equal(requests.filter(r=>r.method==='otp').length,0);
  await tab.input('#account-email',email);await tab.evaluate('window.__captcha.expire()');
  assert.equal(await tab.evaluate("document.querySelector('[data-send]').disabled"),true);
  assert.ok(await tab.evaluate('window.__captcha.resets>0'));
  await tab.evaluate('window.__captcha.fail()');assert.equal(await tab.evaluate("document.querySelector('[data-retry-captcha]').hidden"),false);
  await tab.click('[data-retry-captcha]');await tab.wait('window.__captcha.activeCount===1');
  assert.equal(scriptLoads,1);

  // Reconnect the same element: old listeners and widgets must be removed.
  await tab.evaluate("(()=>{const account=document.querySelector('mednerds-account'),parent=account.parentElement;account.remove();parent.append(account);})()");
  await tab.wait("!document.querySelector('[data-login]').hidden && window.__captcha.activeCount===1");
  await tab.input('#account-email',email);await tab.evaluate('window.__captcha.solve()');
  sendDelay=250;
  await tab.click('[data-send]');
  await tab.evaluate("document.querySelector('[data-email-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert.equal(await tab.evaluate("document.querySelector('[data-send]').disabled"),true);
  await tab.wait("!document.querySelector('[data-code-step]').hidden");sendDelay=0;
  const send=requests.filter(r=>r.method==='otp');assert.equal(send.length,1);
  assert.equal(send[0].email,email);assert.equal(send[0].createUser,true);assert.ok(send[0].captcha.startsWith('test-captcha-'));
  assert.equal(await tab.evaluate("document.querySelector('[data-delivery-email]').textContent"),email);
  assert.equal(await tab.evaluate("document.activeElement.id"),'account-otp');
  assert.equal(await tab.evaluate("document.querySelector('[data-status]').textContent"),'');
  assert.equal(await tab.evaluate('window.__cooldownTimers.size'),1);
  assert.equal(await tab.evaluate("document.querySelector('.account-code-title').textContent"),'Anmeldecode eingeben');
  assert.ok(await tab.evaluate("document.querySelector('.account-delivery').textContent.includes('sechsstelligen Code')"));
  assert.equal(await tab.evaluate('window.__captcha.activeCount'),0);
  assert.equal(await tab.evaluate("document.querySelector('[data-resend-panel]').hidden"),true);
  assert.ok(await tab.evaluate("/^Neuer Code in (59|60) s$/.test(document.querySelector('[data-cooldown]').textContent)"));
  assert.equal(await tab.evaluate("document.querySelector('[data-cooldown]').hasAttribute('aria-live')"),false);
  assert.equal(await tab.evaluate("document.querySelector('[data-open-resend]').hidden"),true);
  await tab.click('[data-open-resend]');
  assert.equal(await tab.evaluate('window.__captcha.activeCount'),0);
  await tab.evaluate('window.__clockOffset+=30000');
  await tab.wait("/^Neuer Code in (29|30) s$/.test(document.querySelector('[data-cooldown]').textContent)");
  await tab.evaluate('window.__clockOffset+=31000');await tab.wait("!document.querySelector('[data-open-resend]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('[data-cooldown]').hidden"),true);
  assert.equal(await tab.evaluate('window.__cooldownTimers.size'),0);
  await tab.input('#account-otp','000012');
  await tab.evaluate("document.querySelector('[data-open-resend]').focus()");
  assert.equal(await tab.evaluate("document.activeElement.matches('[data-open-resend]')"),true);
  assert.equal(await tab.evaluate("document.querySelector('[data-open-resend]').disabled"),false);
  await tab.command('Page.bringToFront');
  await tab.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await tab.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await tab.wait('window.__captcha.activeCount===1');
  assert.equal(await tab.evaluate("document.activeElement.id"),'account-resend-title');
  assert.equal(await tab.evaluate("document.querySelector('[data-open-resend]').getAttribute('aria-expanded')"),'true');
  assert.equal(await tab.evaluate("document.querySelector('[data-resend]').disabled"),true);
  // Even a synthetic click cannot send without a verified challenge.
  await tab.evaluate("document.querySelector('[data-resend]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  assert.equal(requests.filter(r=>r.method==='otp').length,1);
  assert.equal(await tab.evaluate("document.querySelector('#account-otp').disabled"),false);
  await tab.input('#account-otp','000034');
  await tab.evaluate('window.__captcha.solve()');await tab.click('[data-cancel-resend]');
  assert.equal(await tab.evaluate('window.__captcha.activeCount'),0);
  assert.equal(await tab.evaluate("document.querySelector('#account-otp').value"),'000034');
  assert.equal(await tab.evaluate("document.activeElement.matches('[data-open-resend]')"),true);
  assert.equal(requests.filter(r=>r.method==='otp').length,1);
  await tab.click('[data-open-resend]');await tab.wait('window.__captcha.activeCount===1');
  assert.equal(await tab.evaluate("document.querySelector('[data-resend]').disabled"),true);
  await tab.evaluate('window.__captcha.solve();window.__captcha.expire()');
  assert.equal(await tab.evaluate("document.querySelector('[data-resend]').disabled"),true);
  await tab.evaluate('window.__captcha.solve()');
  sendError={status:500,code:'unexpected_failure'};await tab.click('[data-resend]');
  await tab.wait("document.querySelector('[data-error]').textContent.includes('konnte nicht gesendet')");
  assert.equal(await tab.evaluate("document.querySelector('[data-resend-panel]').hidden"),false);
  assert.equal(await tab.evaluate("document.querySelector('[data-resend]').disabled"),true);
  assert.equal(await tab.evaluate("document.querySelector('#account-otp').value"),'000034');
  sendError=undefined;await tab.evaluate('window.__captcha.solve()');
  await tab.click('[data-resend]');await tab.wait("document.querySelector('[data-status]').textContent==='Neuer Code gesendet.'");
  assert.equal(requests.filter(r=>r.method==='otp').length,3);
  assert.equal(await tab.evaluate('window.__captcha.activeCount'),0);
  assert.equal(await tab.evaluate("document.querySelector('[data-resend-panel]').hidden"),true);
  assert.equal(await tab.evaluate("document.querySelector('#account-otp').value"),'000034');
  assert.equal(await tab.evaluate("document.activeElement.id"),'account-otp');
  assert.ok(await tab.evaluate("/^Neuer Code in (59|60) s$/.test(document.querySelector('[data-cooldown]').textContent)"));
  await tab.wait("document.querySelector('[data-status]').textContent===''");
  assert.equal(await tab.evaluate('window.__cooldownTimers.size'),1);

  // Both the compact code view and the expanded resend view remain usable on mobile.
  for(const width of [320,390,768,1440]) for(const theme of ['dark','light']) {
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    await tab.evaluate(`document.documentElement.dataset.theme='${theme}'`);
    assert.ok(await tab.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`OTP ${width} ${theme}: overflow`);
    assert.equal(await tab.evaluate('window.__captcha.activeCount'),0);
    if ((width===1440 && theme==='dark') || (width===390 && theme==='light')) {
      await tab.evaluate('window.scrollTo(0,0)');
      const capture=await tab.command('Page.captureScreenshot',{format:'png'});
      await mkdir(screenshots,{recursive:true});
      await writeFile(join(screenshots,`mednerds-otp-${theme}-${width}.png`),Buffer.from(capture.data,'base64'));
    }
  }
  await tab.evaluate('window.__clockOffset+=61000');await tab.wait("!document.querySelector('[data-open-resend]').hidden");
  await tab.click('[data-open-resend]');await tab.wait('window.__captcha.activeCount===1');
  for(const width of [320,390,768,1440]) for(const theme of ['dark','light']) {
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    await tab.evaluate(`document.documentElement.dataset.theme='${theme}'`);
    await tab.wait('window.__captcha.activeCount===1');
    assert.ok(await tab.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`Resend ${width} ${theme}: overflow`);
  }
  await tab.click('[data-cancel-resend]');
  assert.notEqual(requests.filter(r=>r.method==='otp')[0].captcha,requests.filter(r=>r.method==='otp')[1].captcha);

  await tab.input('#account-otp','12345');await tab.click('[data-verify]');assert.equal(requests.filter(r=>r.method==='verify').length,0);
  assert.equal(await tab.evaluate("document.querySelector('#account-otp').getAttribute('aria-invalid')"),'true');
  verifyError='otp_expired';await tab.input('#account-otp','000012');await tab.click('[data-verify]');
  await tab.wait("document.querySelector('[data-error]').textContent.includes('ungültig oder abgelaufen')");
  assert.ok(await tab.evaluate("!document.querySelector('[data-code-step]').hidden"));
  assert.ok(!(await tab.evaluate("document.querySelector('[data-error]').textContent")).includes('private server diagnostic'));
  verifyError=undefined;
  const beforeChange=requests.filter(r=>r.method==='otp').length;
  await tab.click('[data-change-email]');
  assert.equal(await tab.evaluate("document.querySelector('[data-email-form]').hidden"),false);
  assert.equal(await tab.evaluate("document.querySelector('#account-otp').value"),'');
  assert.equal(requests.filter(r=>r.method==='otp').length,beforeChange);
  assert.equal(await tab.evaluate("document.querySelector('[data-send]').disabled"),true);
  await tab.wait('window.__captcha.activeCount===1');
  await tab.evaluate('window.__clockOffset+=61000;window.__captcha.solve()');await tab.wait("!document.querySelector('[data-send]').disabled");
  await tab.click('[data-send]');await tab.wait("!document.querySelector('[data-code-step]').hidden");
  await tab.evaluate('window.__clockOffset+=61000');await tab.wait("!document.querySelector('[data-open-resend]').hidden");
  await tab.click('[data-open-resend]');await tab.wait('window.__captcha.activeCount===1');
  // Existing OTP verification remains available while the resend panel is open, without CAPTCHA.
  await tab.input('#account-otp','000012');await tab.click('[data-verify]');
  await tab.wait("!document.querySelector('[data-session]').hidden");
  assert.equal(await tab.evaluate('window.__cooldownTimers.size'),0);
  assert.equal(requests.filter(r=>r.method==='verify').at(-1).token,'000012');
  assert.equal(await tab.evaluate("document.querySelector('[data-session-email]').textContent"),email);
  await tab.wait("!document.querySelector('[data-profile-form]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('#account-display-name').value"),'');
  assert.ok(await tab.evaluate("document.querySelector('#account-name-hint').textContent.includes('öffentlich')"));
  assert.equal(await tab.evaluate("document.querySelector('[data-staff-role]').textContent"),'Rolle: Nutzer');
  await tab.input('#account-display-name','A');await tab.click('[data-profile-save]');
  assert.equal(profileWrites.length,0);
  assert.equal(await tab.evaluate("document.querySelector('#account-display-name').getAttribute('aria-invalid')"),'true');
  await tab.input('#account-display-name','  Zoë Müller  ');
  profileWriteDelay=200;await tab.click('[data-profile-save]');
  await tab.evaluate("document.querySelector('[data-profile-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert.equal(await tab.evaluate("document.querySelector('[data-profile-save]').disabled"),true);
  await tab.wait("document.querySelector('[data-profile-status]').textContent.includes('gespeichert')");profileWriteDelay=0;
  assert.deepEqual(profileWrites,[{display_name:'Zoë Müller'}]);
  assert.equal(await tab.evaluate("document.querySelector('#account-display-name').value"),'Zoë Müller');
  for(const width of [320,390,768,1440]) for(const theme of ['dark','light']) {
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    await tab.evaluate(`document.documentElement.dataset.theme='${theme}';window.scrollTo(0,0)`);
    assert.ok(await tab.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`Profile ${width} ${theme}: overflow`);
    assert.ok(await tab.evaluate("[...document.querySelectorAll('[data-session] input,[data-session] button')].filter(node=>node.getClientRects().length).every(node=>node.getBoundingClientRect().height>=44)"));
    if((width===390 && theme==='light') || (width===1440 && theme==='dark')) {
      const capture=await tab.command('Page.captureScreenshot',{format:'png'});
      await mkdir(screenshots,{recursive:true});
      await writeFile(join(screenshots,`mednerds-profile-${theme}-${width}.png`),Buffer.from(capture.data,'base64'));
    }
  }
  await tab.command('Page.bringToFront');
  await tab.evaluate("document.querySelector('#account-display-name').focus()");
  await tab.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await tab.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await tab.evaluate("document.activeElement.matches('[data-profile-save]') && document.activeElement.matches(':focus-visible')"),true);
  profileWriteError='23514';await tab.input('#account-display-name','Other');await tab.click('[data-profile-save]');
  await tab.wait("document.querySelector('[data-profile-error]').textContent.includes('nicht gespeichert')");profileWriteError=undefined;
  assert.ok(!(await tab.evaluate('document.body.textContent')).includes('private database diagnostic'));
  await tab.input('#account-display-name','<img src=x onerror=alert(1)>');await tab.click('[data-profile-save]');
  await tab.wait("document.querySelector('[data-profile-status]').textContent.includes('gespeichert')");
  assert.equal(await tab.evaluate("!!document.querySelector('[data-profile] img')"),false);
  await tab.input('#account-display-name','Zoë Müller');await tab.click('[data-profile-save]');
  await tab.wait("document.querySelector('[data-profile-status]').textContent.includes('gespeichert')");
  assert.equal(await tab.evaluate('window.__captcha.activeCount'),0);
  assert.ok(!(await tab.evaluate('document.body.textContent')).includes('test-refresh-only'));
  await tab.navigate();await tab.wait("!document.querySelector('[data-session]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('[data-session-email]').textContent"),email);
  await tab.wait("!document.querySelector('[data-profile-form]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('#account-display-name').value"),'Zoë Müller');
  staffRow={user_id:'00000000-0000-4000-8000-000000000001',role:'admin',author_slug:'orlando-frey',created_at:'2026-10-09T00:00:00Z'};
  await tab.navigate();await tab.wait("document.querySelector('[data-staff-role]').textContent==='Rolle: Administrator'");
  staffReadError=true;await tab.navigate();await tab.wait("document.querySelector('[data-staff-role]').textContent.includes('konnte nicht geladen')");staffReadError=false;
  profileReadError='PGRST205';await tab.navigate();
  await tab.wait("document.querySelector('[data-profile-error]').textContent.includes('Anmeldung funktioniert weiterhin')");
  assert.equal(await tab.evaluate("document.querySelector('[data-session]').hidden"),false);
  assert.equal(await tab.evaluate("document.querySelector('[data-profile-form]').hidden"),true);
  profileReadError=undefined;await tab.click('[data-profile-retry]');await tab.wait("!document.querySelector('[data-profile-form]').hidden");

  const second=await createTab();await second.navigate();await second.wait("!document.querySelector('[data-session]').hidden");
  assert.equal(await second.evaluate("document.querySelector('[data-session-email]').textContent"),email);
  logoutError=true;await tab.click('[data-logout]');await tab.wait("document.querySelector('[data-error]').textContent.includes('vollständige Abmeldung konnte nicht bestätigt')");
  assert.equal(await tab.evaluate("document.querySelector('[data-status]').textContent.includes('Du bist abgemeldet')"),false);
  await tab.wait("!document.querySelector('[data-login]').hidden");
  await second.wait("!document.querySelector('[data-login]').hidden");
  assert.equal(await tab.evaluate("document.querySelector('#account-display-name').value"),'');
  assert.equal(await second.evaluate("document.querySelector('#account-display-name').value"),'');
  const writesAfterLogout=profileWrites.length;
  await tab.evaluate("document.querySelector('[data-profile-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  assert.equal(profileWrites.length,writesAfterLogout);
  logoutError=false;
  await tab.wait('window.__captcha.activeCount===1');await tab.input('#account-email',email);await tab.evaluate('window.__captcha.solve()');
  await tab.click('[data-send]');await tab.wait("!document.querySelector('[data-code-step]').hidden");
  await tab.input('#account-otp','000012');await tab.click('[data-verify]');await tab.wait("!document.querySelector('[data-session]').hidden");
  await second.wait("!document.querySelector('[data-session]').hidden");
  await tab.click('[data-logout]');await tab.wait("!document.querySelector('[data-login]').hidden");
  await second.wait("!document.querySelector('[data-login]').hidden");
  assert.ok(await tab.evaluate("document.querySelector('[data-status]').textContent.includes('Du bist abgemeldet')"));

  // Rate limit and server failures need a new challenge and never expose diagnostics.
  await tab.evaluate('window.__clockOffset+=61000');
  await tab.wait('window.__captcha.activeCount===1');await tab.input('#account-email',email);await tab.evaluate('window.__captcha.solve()');
  sendError={status:429,code:'over_email_send_rate_limit'};await tab.click('[data-send]');
  await tab.wait("document.querySelector('[data-error]').textContent.includes('Zu viele Versuche')");
  assert.equal(await tab.evaluate("document.querySelector('[data-send]').disabled"),true);
  assert.equal(await tab.evaluate('window.__cooldownTimers.size'),1);
  await tab.evaluate("document.dispatchEvent(new Event('astro:before-swap'))");
  assert.equal(await tab.evaluate('window.__cooldownTimers.size'),0);
  assert.equal(await tab.evaluate('window.__captcha.activeCount'),0);
  await tab.evaluate("(()=>{const account=document.querySelector('mednerds-account'),parent=account.parentElement;account.remove();parent.append(account);})()");
  await tab.wait('window.__captcha.activeCount===1 && window.__cooldownTimers.size===1');
  assert.equal(await tab.evaluate("document.querySelector('[data-send]').disabled"),true);
  await tab.evaluate('window.__clockOffset+=61000;window.__captcha.solve()');await tab.wait("!document.querySelector('[data-send]').disabled");
  sendError={status:500,code:'unexpected_failure'};await tab.click('[data-send]');
  await tab.wait("document.querySelector('[data-error]').textContent.includes('konnte nicht gesendet')");
  assert.equal(await tab.evaluate("document.querySelector('[data-send]').disabled"),true);
  assert.ok(!(await tab.evaluate('document.body.textContent')).includes('private server diagnostic'));
  sendError=undefined;

  for(const width of [320,390,768,1440]) for(const theme of ['dark','light']) {
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    await tab.evaluate(`document.documentElement.dataset.theme='${theme}'`);
    await tab.wait('window.__captcha.activeCount===1');
    assert.ok(await tab.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`${width} ${theme}: overflow`);
    assert.ok(await tab.evaluate("[...document.querySelectorAll('mednerds-account input,mednerds-account button')].filter(node=>node.getClientRects().length && !node.closest('.account-challenge')).every(node=>node.getBoundingClientRect().height>=44)"));
  }
  await tab.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await tab.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await tab.evaluate("document.querySelector('#account-email').focus()");
  assert.equal(await tab.evaluate("document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle==='solid'"),true);
  for(const [width,theme] of [[1440,'dark'],[390,'light']]) {
    await tab.command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    await tab.evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-error]').hidden=true;window.scrollTo(0,0)`);
    await tab.wait('window.__captcha.activeCount===1');
    const capture=await tab.command('Page.captureScreenshot',{format:'png'});
    await mkdir(screenshots,{recursive:true});
    const file=join(screenshots,`mednerds-account-${theme}-${width}.png`);
    await writeFile(file,Buffer.from(capture.data,'base64'));
    console.log(`Account mock screenshot: ${file}`);
  }

  // Supabase, not application code, handles a stored expired session and failed refresh.
  await tab.evaluate('window.__clockOffset+=61000;window.__captcha.solve()');await tab.wait("!document.querySelector('[data-send]').disabled");
  await tab.click('[data-send]');await tab.wait("!document.querySelector('[data-code-step]').hidden");
  await tab.input('#account-otp','000012');await tab.click('[data-verify]');await tab.wait("!document.querySelector('[data-session]').hidden");
  await tab.evaluate("(()=>{for(const key of Object.keys(localStorage).filter(key=>key.endsWith('-auth-token'))){const value=JSON.parse(localStorage.getItem(key));value.expires_at=1;localStorage.setItem(key,JSON.stringify(value));}})()");
  refreshError=true;await tab.navigate();await tab.wait("!document.querySelector('[data-login]').hidden");refreshError=false;

  const callsBefore=requests.length, scriptsBefore=scriptLoads;
  await tab.command('Emulation.setScriptExecutionDisabled',{value:true});await tab.navigate();
  assert.ok(await tab.evaluate("document.body.textContent.includes('Bitte aktiviere JavaScript')"));
  assert.equal(await tab.evaluate("document.querySelector('[data-login]').hidden"),true);
  assert.equal(requests.length,callsBefore);assert.equal(scriptLoads,scriptsBefore);
  await tab.command('Emulation.setScriptExecutionDisabled',{value:false});
  await tab.command('Page.navigate',{url:`${site}/medtools/`});
  await tab.wait("document.readyState==='complete' && !!document.querySelector('.mn-tools-overview')");
  assert.equal(requests.length,callsBefore);assert.equal(scriptLoads,scriptsBefore);
  assert.deepEqual(errors,[]);assert.equal(blockedExternal,0);
  console.log('✓ Account browser: mock-only OTP/CAPTCHA, profile validation/save/reload/errors/staff, missing backend, logout cleanup, responsive dark/light/keyboard, noindex/Pagefind, no-JS');
  }
} finally {
  for(const tab of tabs) {
    try { await tab.command('Emulation.setScriptExecutionDisabled',{value:false}); } catch { /* Already closed. */ }
    tab.socket.close();await fetch(`${endpoint}/json/close/${tab.target.id}`);
  }
}
