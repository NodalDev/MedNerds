import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const site = process.env.SIDEBAR_SITE ?? 'http://127.0.0.1:4326';
const endpoint = process.env.SIDEBAR_CDP ?? 'http://127.0.0.1:9334';
const screenshots = process.env.PREVIEW_SCREENSHOTS ?? tmpdir();
await mkdir(screenshots, { recursive: true });
const source = '/meddocs/anaesthesie/target-controlled-infusion/';
const article = '/meddocs/anaesthesie/allgemeinanaesthesie/';
const echo = '/meddocs/echokardiographie/grundlagen-technik/physikalische-grundlagen/';
const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map(), requests = [], overrides = new Map();
const errors = [];
let delayedPath, delayedRequest;
function command(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function fulfill(requestId, value) {
  await command('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(value)).toString('base64') });
}
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Fetch.requestPaused') {
    const request = message.params, url = new URL(request.request.url);
    requests.push(url.href);
    if (url.pathname === delayedPath) { delayedRequest = request.requestId; return; }
    if (overrides.has(url.pathname)) { void fulfill(request.requestId, overrides.get(url.pathname)); return; }
    void command(url.origin === site ? 'Fetch.continueRequest' : 'Fetch.failRequest', url.origin === site
      ? { requestId: request.requestId } : { requestId: request.requestId, errorReason: 'BlockedByClient' });
  }
};
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function wait(expression) {
  for (let n = 0; n < 120; n++) { if (await evaluate(expression)) return; await pause(50); }
  throw Error(`Timed out: ${expression}`);
}
async function press(key, code, keyCode) {
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
}
async function hover(selector) {
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 200 });
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await pause(100);
  const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
}
const visible = "!document.querySelector('#meddocs-link-preview').hidden";
const title = "document.querySelector('[data-preview-title]').textContent";
const previewRequests = () => requests.filter(url => new URL(url).pathname.startsWith('/meddocs-previews/'));
const asset = path => '/meddocs-previews' + path.slice(0, -1) + '.json';
try {
  await command('Page.enable'); await command('Runtime.enable');
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: site + source });
  await wait("document.readyState === 'complete' && !!document.querySelector('#meddocs-link-preview')");
  await pause(200);
  assert.equal(previewRequests().length, 0, 'no eager preview network requests');
  await evaluate(`(() => {
    const paragraph = document.createElement('p'); paragraph.id = 'preview-test-links';
    const links = [ ['article', ${JSON.stringify(article)}], ['section', ${JSON.stringify(echo + '#b-mode')}], ['unknown', ${JSON.stringify(echo + '#veraltet')}],
      ['relative', '../allgemeinanaesthesie/'], ['same', '#3-das-pharmakokinetische-modell'], ['external', 'https://example.org/meddocs/test/'],
      ['doi', 'https://doi.org/10.1234/test'], ['button', ${JSON.stringify(article)}], ['slow', '/meddocs/echokardiographie/grundlagen-technik/nomenklatur/'],
      ['safe', '/meddocs/echokardiographie/grundlagen-technik/praktische-grundlagen/'] ];
    for (const [name, href] of links) { const link = document.createElement('a'); link.id = 'test-' + name; link.href = href; link.textContent = name + ' '; if (name === 'button') link.className = 'sl-link-button'; paragraph.append(link, document.createTextNode(' · ')); }
    document.querySelector('main .sl-markdown-content').prepend(paragraph);
  })()`);
  await hover('#test-article'); await pause(100);
  assert.equal(await evaluate(visible), false, 'hover delay avoids immediate popups');
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 200 }); await pause(400);
  assert.equal(await evaluate(visible), false);
  assert.equal(previewRequests().length, 0, 'brief hover does not fetch or open a preview');
  await hover('#test-article'); await wait(visible);
  assert.equal(await evaluate(title), 'Allgemeinanästhesie');
  assert.equal(await evaluate("document.querySelector('[data-preview-kind]').textContent"), 'Artikel');
  assert.equal(await evaluate("document.querySelector('#test-article').getAttribute('href')"), article);
  const beforeY = await evaluate('scrollY');
  const cardPoint = await evaluate("(() => { const r = document.querySelector('#meddocs-link-preview').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()");
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...cardPoint }); await pause(250);
  assert.equal(await evaluate(visible), true, 'card remains open while hovered');
  assert.equal(await evaluate('scrollY'), beforeY, 'popover causes no layout shift');
  await hover('#test-article'); await pause(200); assert.equal(await evaluate(visible), true, 'returning to the source link keeps it open');
  await press('Escape', 'Escape', 27); assert.equal(await evaluate(visible), false);

  await hover('#test-section'); await wait(visible);
  assert.equal(await evaluate(title), 'B-Mode');
  assert.equal(await evaluate("document.querySelector('[data-preview-kind]').textContent"), 'Unterkapitel');
  assert.match(await evaluate("document.querySelector('[data-preview-parent]').textContent"), /Physikalische.*Grundlagen/i);
  assert.ok((await evaluate("document.querySelector('[data-preview-text]').textContent")).length > 0);
  await hover('#test-unknown'); await wait(`${visible} && ${title} !== 'B-Mode'`);
  assert.equal(await evaluate("document.querySelector('[data-preview-kind]').textContent"), 'Artikel');
  assert.equal(previewRequests().filter(url => new URL(url).pathname === asset(echo)).length, 1, 'all sections share one cached article asset');
  await press('Escape', 'Escape', 27);

  for (const name of ['same', 'external', 'doi', 'button']) { await hover('#test-' + name); await pause(400); assert.equal(await evaluate(visible), false, `${name} is excluded`); }
  await press('Tab', 'Tab', 9);
  await evaluate("document.querySelector('#test-relative').focus({preventScroll:true})"); await wait(visible);
  assert.equal(await evaluate(title), 'Allgemeinanästhesie');
  assert.equal(await evaluate("document.querySelector('#test-relative').getAttribute('aria-details')"), 'meddocs-link-preview');
  assert.equal(await evaluate("document.querySelector('#test-relative').textContent"), 'relative ');
  assert.equal(await evaluate("document.querySelector('#test-relative').hasAttribute('aria-describedby')"), false);
  await press('Escape', 'Escape', 27);
  assert.equal(await evaluate("document.activeElement.id"), 'test-relative');
  assert.equal(await evaluate("document.querySelector('#test-relative').hasAttribute('aria-details')"), false);
  await press('Tab', 'Tab', 9); assert.equal(await evaluate("document.activeElement.id"), 'test-same', 'Tab remains on native document links');
  await evaluate('document.activeElement.blur()');

  const safePath = '/meddocs/echokardiographie/grundlagen-technik/praktische-grundlagen/';
  overrides.set(asset(safePath), { path: safePath, title: '<img src=x onerror="window.__previewXSS=true">', text: '<script>unsafe</script>', sections: {} });
  await hover('#test-safe'); await wait(visible);
  assert.equal(await evaluate("document.querySelector('#meddocs-link-preview img, #meddocs-link-preview script') !== null"), false);
  assert.equal(await evaluate('window.__previewXSS'), undefined);
  assert.match(await evaluate(title), /<img/);
  await press('Escape', 'Escape', 27);

  delayedPath = asset('/meddocs/echokardiographie/grundlagen-technik/nomenklatur/');
  await hover('#test-slow');
  for (let n = 0; n < 40 && !delayedRequest; n++) await pause(25);
  assert.ok(delayedRequest);
  await hover('#test-article'); await wait(visible);
  const slowData = await (await fetch(site + delayedPath)).json();
  await fulfill(delayedRequest, slowData); delayedPath = undefined;
  await pause(100); assert.equal(await evaluate(title), 'Allgemeinanästhesie', 'stale async responses cannot replace the new card');
  await press('Escape', 'Escape', 27);

  for (const width of [1440, 768, 375]) for (const theme of ['light', 'dark']) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    await pause(200);
    const articleWidth = await evaluate('document.documentElement.scrollWidth');
    await hover('#test-section'); await wait(visible);
    assert.equal(await evaluate("(() => {const r=document.querySelector('#meddocs-link-preview').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=document.documentElement.clientWidth&&r.bottom<=innerHeight;})()"), true);
    // Existing offline/blocked article images are outside this feature; the floating card must add no overflow.
    assert.ok(await evaluate('document.documentElement.scrollWidth') <= articleWidth + 1);
    const screen = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(screenshots, `meddocs-link-preview-${theme}-${width}.png`), Buffer.from(screen.data, 'base64'));
    await press('Escape', 'Escape', 27);
  }
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'any-hover', value: 'none' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate("document.querySelector('#test-article').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'touch'}));document.querySelector('#test-article').focus({preventScroll:true})");
  await pause(450); assert.equal(await evaluate(visible), false, 'touch does not require a preview tap');
  await evaluate("document.querySelector('#test-article').click()");
  await wait(`location.pathname === ${JSON.stringify(article)}`);
  await command('Emulation.setScriptExecutionDisabled', { value: true });
  await command('Page.navigate', { url: site + source });
  await wait("document.readyState==='complete' && location.pathname.includes('target-controlled-infusion')");
  assert.equal(await evaluate("document.querySelector('#meddocs-link-preview').hidden"), true);
  await command('Emulation.setScriptExecutionDisabled', { value: false });
  assert.deepEqual(errors, []);
  console.log('✓ Link previews: lazy/cache, article/section/fallback, hover/card, keyboard/Escape, safe text, async race, native navigation, touch/no-JS, themes/viewport');
} catch (error) {
  const screen = await command('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (screen) await writeFile(join(screenshots, 'meddocs-link-preview-failure.png'), Buffer.from(screen.data, 'base64'));
  throw error;
} finally { socket.close(); await fetch(`${endpoint}/json/close/${target.id}`); }
