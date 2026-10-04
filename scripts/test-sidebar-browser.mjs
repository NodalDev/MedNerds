import assert from 'node:assert/strict';

// Serve the production build and launch headless Chrome/CDP; no browser dependency.
const site = process.env.SIDEBAR_SITE ?? 'http://127.0.0.1:4326';
const endpoint = process.env.SIDEBAR_CDP ?? 'http://127.0.0.1:9334';
const article = '/meddocs/echokardiographie/grundlagen-technik/nomenklatur/';
const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
};
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(expression)) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function navigate(path) {
  await command('Page.navigate', { url: `${site}${path}` });
  await waitFor(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && !!document.querySelector('main h1')`);
  if (path.startsWith('/meddocs/')) {
    await waitFor("document.querySelector('.mn-sidebar-toggle')?.dataset.mednerdsCollapse === 'true'");
  }
}
async function viewport(width) {
  await command('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 800 });
  await pause(300);
}
async function scrollTo(y) {
  await evaluate(`window.scrollTo({top:${y},behavior:'instant'})`);
  await pause(300);
  assert.ok(Math.abs(await evaluate('scrollY') - y) <= 2, `Scroll position should reach ${y}`);
}
async function collapsed(expected) {
  assert.equal(await evaluate("document.documentElement.classList.contains('mn-sidebar-collapsed')"), expected);
  assert.equal(await evaluate("document.querySelector('.mn-sidebar-toggle').getAttribute('aria-expanded')"), String(!expected));
  assert.equal(await evaluate("document.querySelector('.mn-sidebar-toggle').getAttribute('aria-label')"), expected ? 'Sidebar ausklappen' : 'Sidebar einklappen');
  assert.equal(await evaluate("document.querySelector('.mn-sidebar-toggle-label').textContent"), expected ? 'Ausklappen' : 'Einklappen');
}
async function clickToggle() {
  await evaluate("document.querySelector('.mn-sidebar-toggle').scrollIntoView({block:'nearest',behavior:'instant'})");
  const point = await evaluate(`(() => {
    const rect = document.querySelector('.mn-sidebar-toggle').getBoundingClientRect();
    return {x:rect.x + rect.width / 2,y:rect.y + rect.height / 2};
  })()`);
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await pause(300);
}
async function activeGroupOpen() {
  return evaluate("!!document.querySelector('.sidebar-content .top-level > li > details a[aria-current=page]')?.closest('.top-level > li > details')?.open");
}

try {
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('mednerds-sidebar-collapsed', 'true');
    window.sidebarScrollListeners = [];
    const original = window.addEventListener;
    window.addEventListener = function(type, listener, options) {
      if (type === 'scroll' && options?.signal) {
        window.sidebarScrollListeners.push({signal:options.signal,passive:options.passive});
      }
      return original.call(this,type,listener,options);
    };
  ` });
  await viewport(1600);
  await navigate(article);
  await collapsed(false);
  assert.equal(await activeGroupOpen(), true);
  const contentLeft = await evaluate("document.querySelector('.sl-markdown-content').getBoundingClientRect().left");
  await scrollTo(31);
  await collapsed(false);
  await scrollTo(100);
  await collapsed(true);
  assert.equal(await activeGroupOpen(), false);
  const collapsedContentLeft = await evaluate("document.querySelector('.sl-markdown-content').getBoundingClientRect().left");
  assert.ok(Math.abs(contentLeft - collapsedContentLeft) < 2, 'Wide desktop content must not shift');
  await scrollTo(300);
  await collapsed(true);
  await scrollTo(12);
  await collapsed(true);
  await scrollTo(2);
  await collapsed(false);
  assert.equal(await activeGroupOpen(), true);
  await scrollTo(1);
  await collapsed(false);
  await scrollTo(0);
  console.log('✓ Wide desktop starts expanded; 32px/2px hysteresis, accordion and content position');

  await clickToggle();
  await collapsed(true);
  await scrollTo(100);
  await scrollTo(0);
  await collapsed(true);
  await clickToggle();
  await collapsed(false);
  await scrollTo(100);
  await collapsed(true);
  await scrollTo(300);
  await clickToggle();
  await collapsed(false);
  await evaluate("window.dispatchEvent(new Event('scroll'))");
  await pause(350);
  await collapsed(false);
  await scrollTo(307);
  await collapsed(false);
  await scrollTo(310);
  await collapsed(true);
  assert.equal(await evaluate("localStorage.getItem('mednerds-sidebar-collapsed')"), 'true');
  console.log('✓ Manual lock, unlocking, no immediate re-collapse, 8px resume distance, no persistence writes');

  await scrollTo(0);
  await evaluate("document.activeElement.blur(); document.querySelector('.sidebar-content details a[aria-current=page]').focus()");
  await scrollTo(100);
  await collapsed(false);
  assert.equal(await evaluate("document.activeElement.matches('.sidebar-content details a[aria-current=page]')"), true);
  await evaluate("document.activeElement.blur(); window.dispatchEvent(new Event('scroll'))");
  await pause(300);
  await collapsed(true);
  await scrollTo(0);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' });
  await evaluate("document.querySelector('.mn-sidebar-toggle').focus()");
  assert.equal(await evaluate("document.activeElement.matches(':focus-visible')"), true);
  await scrollTo(100);
  await collapsed(false);
  await evaluate('document.activeElement.blur()');
  console.log('✓ Navigation and keyboard-toggle focus remain visible');

  await viewport(1100);
  await collapsed(true);
  await scrollTo(0);
  await collapsed(true);
  await clickToggle();
  await collapsed(false);
  await scrollTo(100);
  await collapsed(false);
  await viewport(390);
  await collapsed(false);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.mn-sidebar-toggle')).display"), 'none');
  await scrollTo(0);
  await scrollTo(100);
  await collapsed(false);
  assert.ok(await evaluate('document.documentElement.scrollWidth - innerWidth') <= 1);
  await viewport(1100);
  await collapsed(true);
  await viewport(1600);
  await collapsed(false);
  console.log('✓ Compact desktop stays collapsed by default and manually operable; mobile and resizing');

  await scrollTo(0);
  await clickToggle();
  await collapsed(true);
  for (let i = 0; i < 10; i++) await evaluate("document.dispatchEvent(new Event('astro:page-load'))");
  await collapsed(false);
  const listeners = await evaluate("window.sidebarScrollListeners.filter(({signal})=>!signal.aborted).map(({passive})=>passive)");
  assert.deepEqual(listeners, [true]);
  await clickToggle();
  await collapsed(true);
  await navigate('/meddocs/echokardiographie/grundlagen-technik/einfuehrung-echokardiographie/');
  await collapsed(false);
  console.log('✓ Page navigation resets manual lock; repeated astro:page-load keeps one passive scroll listener');

  for (const theme of ['light', 'dark']) {
    await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    await scrollTo(0);
    await collapsed(false);
    await scrollTo(100);
    await collapsed(true);
    assert.ok(await evaluate('document.documentElement.scrollWidth - innerWidth') <= 1);
  }
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.sidebar')).transitionDuration"), '0s');
  await scrollTo(0);
  await collapsed(false);
  await scrollTo(100);
  await collapsed(true);
  await navigate('/medtools/');
  assert.equal(await evaluate("!!document.querySelector('.mn-sidebar-toggle')"), false);
  await evaluate("window.scrollTo({top:100,behavior:'instant'}); document.dispatchEvent(new Event('astro:page-load'))");
  await pause(300);
  assert.equal(await evaluate("document.documentElement.classList.contains('mn-sidebar-collapsed')"), false);
  assert.deepEqual(errors, []);
  console.log('✓ Light/dark, reduced motion and no MedDocs automation on other product pages');
} finally {
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
