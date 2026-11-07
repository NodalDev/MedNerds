import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { handleAccess, handleLogin } from '../netlify/lib/preview-access/handler.ts';
import { hashPassword, randomSecret } from '../netlify/lib/preview-access/passwords.ts';
import { SESSION_COOKIE } from '../netlify/lib/preview-access/sessions.ts';

// Same CDP approach as existing browser tests. Actual handlers + built site,
// ephemeral test keys and Fetch interception; no remote authentication or deployment.
const endpoint = process.env.PREVIEW_ACCESS_CDP ?? 'http://127.0.0.1:9223';
const site = 'https://preview.mednerds.test';
const password = randomSecret();
const secret = randomSecret();
const values = { MEDNERDS_ACCESS_GATE: 'enabled', MEDNERDS_ACCESS_SESSION_SECRET: secret,
  MEDNERDS_ACCESS_CREDENTIALS: JSON.stringify({ version: 1, credentials: [
    { id: 'browser-test', enabled: true, revision: 1, passwordHash: await hashPassword(password) },
  ] }) };
const root = resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const previews = (await readdir('dist/meddocs-previews', { recursive: true })).filter(path => path.endsWith('.json'));
assert.ok(previews.length);
const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
let fragmentLeak = false;
const capability = randomSecret();
let simulate429 = false;
const authTrace = [];

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function staticResponse(request) {
  const url = new URL(request.url);
  let file = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
  if (!extname(file)) file = resolve(file, 'index.html');
  try { return new Response(await readFile(file), { headers: { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' } }); }
  catch { return new Response('Not found', { status: 404 }); }
}

async function respond({ requestId, request: incoming }) {
  const url = new URL(incoming.url);
  if (url.origin !== site) return command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
  if (incoming.url.includes(capability) || incoming.postData?.includes(capability)) fragmentLeak = true;
  // Chrome may omit the Cookie header in Fetch interception; read its actual jar,
  // including HttpOnly cookies, to emulate the HTTP transport without JS access.
  const { cookies } = await command('Network.getCookies', { urls: [url.href] });
  const headers = new Headers(incoming.headers);
  if (cookies.length) headers.set('Cookie', cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '));
  url.hash = '';
  const request = new Request(url, { method: incoming.method, headers,
    ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: incoming.postData ?? '' } : {}) });
  const context = { next: () => staticResponse(request) };
  const isLogin = ['/_preview-access/login', '/_preview-access/login/'].includes(url.pathname);
  const response = isLogin && simulate429 ? new Response('Too many requests', { status: 429 })
    : await (isLogin ? handleLogin : handleAccess)(request, context, name => values[name]);
  if (url.pathname.startsWith('/_preview-access/')) authTrace.push({ path: url.pathname, method: request.method,
    status: response.status, originMatches: headers.get('origin') === site, originIsNull: headers.get('origin') === 'null' });
  await command('Fetch.fulfillRequest', { requestId, responseCode: response.status,
    responseHeaders: [...response.headers].map(([name, value]) => ({ name, value })),
    body: Buffer.from(await response.arrayBuffer()).toString('base64') });
}

socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const job = pending.get(message.id);
  if (job) {
    pending.delete(message.id);
    message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result);
  }
  if (message.method === 'Fetch.requestPaused') respond(message.params).catch(error => {
    // Navigation can cancel an intercepted subresource while the handler awaits crypto.
    if (!error.message.includes('Invalid InterceptionId')) errors.push(error.message);
  });
  if (message.method === 'Runtime.exceptionThrown') errors.push((message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).slice(0, 500));
};

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  const state = await evaluate(`({title:document.title,hasPassword:!!document.querySelector('#password'),
    focused:document.activeElement?.tagName+':'+document.activeElement?.id,
    search:document.querySelector('#starlight__search')?.textContent.slice(0,120),
    searchInput:!!document.querySelector('#starlight__search input'),
    image:document.querySelector('img')?{path:new URL(document.querySelector('img').currentSrc||document.querySelector('img').src).pathname,
      width:document.querySelector('img').naturalWidth,complete:document.querySelector('img').complete}:null})`);
  throw Error('Timed out: ' + expression + '; state=' + JSON.stringify(state) + '; auth=' + JSON.stringify(authTrace.slice(-5)) + '; errors=' + JSON.stringify(errors));
}
async function key(key, code, windowsVirtualKeyCode, text) {
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(text ? { text } : {}) });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
}
async function activate(selector, touch = false) {
  const point = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'});
    const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  if (touch) {
    await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
}
async function navigate(path) {
  await command('Page.navigate', { url: site + path });
  await wait('document.readyState === "complete" && !!document.querySelector("main")');
}
async function enterPassword(value) {
  await evaluate("document.querySelector('#password').focus()");
  await command('Input.insertText', { text: value });
  await key('Enter', 'Enter', 13, '\r');
}
async function logout() {
  await navigate('/_preview-access/logout');
  await wait("document.querySelector('h1').textContent==='Vorschauzugang beenden'");
  await activate('form button[type=submit]');
  await wait("!!document.querySelector('#password')");
  const { cookies } = await command('Network.getCookies', { urls: [site] });
  assert.ok(cookies.every(cookie => cookie.name !== SESSION_COOKIE));
}

try {
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
  await command('Network.setCacheDisabled', { cacheDisabled: true });
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const widths = [320, 375, 430, 768, 1440].filter(width => !process.env.PREVIEW_ACCESS_WIDTH || width === Number(process.env.PREVIEW_ACCESS_WIDTH));
  assert.ok(widths.length, 'Invalid PREVIEW_ACCESS_WIDTH');
  for (const width of widths) for (const theme of ['light', 'dark']) {
    await command('Network.deleteCookies', { name: SESSION_COOKIE, url: site });
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await command('Emulation.setTouchEmulationEnabled', { enabled: width < 600, maxTouchPoints: 1 });
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const path = '/meddocs/?keep=a%2Bb#preview-orientation';
    await navigate(path);
    await wait("!!document.querySelector('#password') && document.querySelector('img').naturalWidth>0");
    assert.equal(await evaluate('location.pathname+location.search+location.hash'), path);
    assert.equal(await evaluate("document.querySelector('label').htmlFor"), 'password');
    assert.equal(await evaluate("document.querySelector('#password').autocomplete"), 'current-password');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true);
    await key('Tab', 'Tab', 9);
    assert.equal(await evaluate("document.activeElement.id==='password' && getComputedStyle(document.activeElement).outlineStyle!=='none'"), true);
    await activate('#show-password', width < 600);
    assert.equal(await evaluate("document.querySelector('#password').type"), 'text');
    await activate('#show-password', width < 600);
    if (width === 320 && theme === 'light') {
      await enterPassword(randomSecret());
      await wait("document.querySelector('#error').textContent.includes('nicht gültig')");
      assert.equal(await evaluate("document.querySelector('#password').getAttribute('aria-invalid')"), 'true');
      simulate429 = true;
      await enterPassword(password);
      await wait("document.querySelector('#error').textContent.includes('Zu viele Versuche')");
      simulate429 = false;
    }
    if ((width === 320 && theme === 'light') || (width === 1440 && theme === 'dark')) {
      await mkdir('.astro/preview-access', { recursive: true });
      const screenshot = await command('Page.captureScreenshot', { format: 'png' });
      await writeFile(`.astro/preview-access/${width}-${theme}.png`, Buffer.from(screenshot.data, 'base64'));
    }
    await enterPassword(password);
    await wait('!!document.querySelector("site-search") && !document.querySelector("#password")');
    assert.equal(await evaluate('location.pathname+location.search+location.hash'), path);
    assert.equal(await evaluate(`document.cookie.includes(${JSON.stringify(SESSION_COOKIE)})`), false);
    const { cookies } = await command('Network.getCookies', { urls: [site] });
    const session = cookies.find(cookie => cookie.name === SESSION_COOKIE);
    assert.ok(session?.httpOnly && session.secure && session.sameSite === 'Lax' && session.path === '/');
    assert.equal(await evaluate(`Promise.all(['/pagefind/pagefind-entry.json',${JSON.stringify('/meddocs-previews/' + previews[0].replaceAll('\\', '/'))}].map(async path=>{
      const r=await fetch(path); return r.ok && r.headers.get('cache-control')==='private, no-store' && !!(await r.json());
    })).then(values=>values.every(Boolean))`), true);
    if (theme === 'light' && [375, 1440].includes(width)) {
      // Starlight initializes Pagefind on idle; test after its normal input exists.
      await wait('!!document.querySelector("#starlight__search input")');
      if (width < 600) {
        await activate('starlight-menu-button button', true);
        await wait('document.body.hasAttribute("data-mobile-menu-expanded")');
      }
      await activate(width < 600 ? 'mednerds-drawer-search button' : 'site-search button[data-open-modal]', width < 600);
      await wait('document.querySelector("site-search dialog").open');
      await wait('document.activeElement===document.querySelector("#starlight__search input")');
      await command('Input.insertText', { text: 'tci' });
      await wait('document.querySelectorAll(".pagefind-ui__result-link").length>0');
      assert.ok((await evaluate('document.querySelector(".pagefind-ui__message").textContent')).includes('Ergebnisse'));
      await activate('#starlight__search a[href*="#"]', width < 600);
      await wait('location.pathname.includes("target-controlled-infusion") && location.hash.length>1 && !document.querySelector("#password")');
    }
    await logout();
    console.log(`V Preview Access: ${width}px ${theme}, layout, keyboard/touch, signed HttpOnly session, protected JSON/Pagefind${[375, 1440].includes(width) && theme === 'light' ? ', real search/section navigation' : ''}`);
  }

  // The real PatientSessionEntry consumes the invitation fragment after gate login.
  await command('Emulation.setDeviceMetricsOverride', { width: 430, height: 850, deviceScaleFactor: 1, mobile: true });
  await navigate(`/medcases/session/patient/?code=ABC234#access=${capability}`);
  await wait("!!document.querySelector('#password')");
  assert.equal(await evaluate('location.hash'), '#access=' + capability);
  await enterPassword(password);
  await wait("!!sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1')");
  assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1')).patientCapability"), capability);
  assert.equal(await evaluate('location.pathname+location.search'), '/medcases/session/patient/?code=ABC234');
  assert.equal(fragmentLeak, false, 'Invitation fragment never reaches the gate/login backend');
  await logout();

  // Native form fallback still works without client-side JavaScript for path/query.
  await command('Emulation.setScriptExecutionDisabled', { value: true });
  await navigate('/meddocs/?native=a%2Bb');
  await enterPassword(password);
  await wait('!!document.querySelector("site-search") && !document.querySelector("#password")');
  assert.equal(await evaluate('location.pathname+location.search'), '/meddocs/?native=a%2Bb');
  await command('Emulation.setScriptExecutionDisabled', { value: false });
  assert.deepEqual(errors, []);
  console.log('V Real MedCases fragment import and native no-JS path/query fallback. Native Netlify rate limiting/CDN not simulated; 429 checks only UI handling.');
} finally {
  await command('Emulation.setScriptExecutionDisabled', { value: false });
  await command('Network.deleteCookies', { name: SESSION_COOKIE, url: site });
  await evaluate('sessionStorage.clear();localStorage.clear()').catch(() => {});
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
