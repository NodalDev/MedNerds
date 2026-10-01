import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Serve the production build locally and launch headless Chrome with a CDP port.
// MEDBLOG_SITE and MEDBLOG_CDP can override these defaults; no browser dependency is needed.
const site = process.env.MEDBLOG_SITE ?? 'http://127.0.0.1:4324';
const endpoint = process.env.MEDBLOG_CDP ?? 'http://127.0.0.1:9223';
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
  for (let i = 0; i < 70; i++) {
    if (await evaluate(expression)) return;
    await pause(75);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function navigate(path) {
  await command('Page.navigate', { url: `${site}${path}` });
  await waitFor("document.querySelector('medblog-archive [data-filter-panel]')?.hidden === false");
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function state() {
  return evaluate(`(() => {
    const root = document.querySelector('medblog-archive');
    const cards = [...root.querySelectorAll('[data-blog-post]')];
    return {
      visible: cards.filter(c => !c.hidden).map(c => c.querySelector('.title-link').pathname),
      total: cards.length, count: root.querySelector('[data-result-count]').textContent.trim(),
      featured: !root.querySelector('[aria-labelledby="blog-featured"]').hidden,
      empty: !root.querySelector('[data-empty]').hidden,
      reset: !root.querySelector('.result-toolbar [data-reset]').hidden,
      active: Object.fromEntries(['type','area','tag'].map(key => [key, root.querySelector('[data-filter-option="'+key+'"][aria-current]')?.dataset.value])),
      query: location.search,
    };
  })()`);
}
async function viewport(width, theme) {
  await command('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 600 });
  await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
  await pause(180);
  const result = await evaluate(`(() => {
    const root=document.querySelector('medblog-archive'), sidebar=root.querySelector('aside'), feed=root.querySelector('.blog-feed');
    const sr=sidebar.getBoundingClientRect(), fr=feed.getBoundingClientRect();
    return {overflow:document.documentElement.scrollWidth-innerWidth,sidebarRight:sr.right,feedLeft:fr.left,
      disclosureOpen:root.querySelector('details').open, summaryVisible:getComputedStyle(root.querySelector('summary')).display!=='none',
      gridColumns:getComputedStyle(root.querySelector('.blog-grid')).gridTemplateColumns.split(' ').length,
      featuredColumns:getComputedStyle(root.querySelector('.blog-card--editorial')).gridTemplateColumns.split(' ').length,
      h1s:document.querySelectorAll('h1').length,
      touchTargets:[...root.querySelectorAll('.type-navigation a')].every(a=>a.getBoundingClientRect().height>=44)};
  })()`);
  assert.ok(result.overflow <= 1, `Overflow: ${width}px ${theme} ${JSON.stringify(result)}`);
  assert.equal(result.h1s, 1); assert.equal(result.touchTargets, true);
  if (width >= 1024) { assert.ok(result.sidebarRight < result.feedLeft); assert.equal(result.disclosureOpen, true); assert.equal(result.summaryVisible, false); }
  else { assert.equal(result.disclosureOpen, false); assert.equal(result.summaryVisible, true); }
  if (width < 800) assert.equal(result.gridColumns, 1);
  if (width >= 1440) { assert.equal(result.gridColumns, 2); assert.equal(result.featuredColumns, 2); }
  return { width, theme, ...result };
}
async function capture(name) {
  await evaluate("document.querySelector('medblog-archive').scrollIntoView({block:'start'})");
  await pause(100);
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = join(tmpdir(), name);
  await writeFile(path, Buffer.from(result.data, 'base64'));
  console.log(`Screenshot: ${path}`);
}

try {
  await command('Page.enable'); await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await navigate('/medblog/');
  const initial = await state();
  assert.equal(initial.total, 3); assert.equal(initial.visible.length, 3); assert.equal(initial.count, '3 Beiträge');
  assert.equal(new Set(initial.visible).size, 3); assert.equal(initial.featured, true); assert.equal(initial.reset, false);
  assert.deepEqual(initial.visible, ['/medblog/artikel/wissen-strukturiert-zugaenglich/', '/medblog/news/neuer-lagetyptrainer/', '/medblog/updates/navigation-ueberarbeitet/']);
  for (const path of initial.visible) assert.equal((await fetch(`${site}${path}`)).status, 200);
  assert.equal(await evaluate("document.querySelector('medblog-archive #blog-updates') === null"), true);
  await click('[data-filter-option="type"][data-value="news"]');
  assert.equal((await state()).count, '1 Beitrag'); assert.equal((await state()).featured, false);
  await click('[data-filter-option="area"][data-value="medtools"]');
  await click('[data-filter-option="tag"][data-value="EKG"]');
  const combined = await state();
  assert.equal(combined.count, '1 Beitrag'); assert.deepEqual(combined.active, { type: 'news', area: 'medtools', tag: 'EKG' });
  assert.equal(new URL(`${site}${combined.query}`).searchParams.get('tag'), 'EKG');
  await click('[data-filter-option="area"][data-value="meddocs"]');
  assert.equal((await state()).count, '0 Beiträge'); assert.equal((await state()).empty, true); assert.equal((await state()).reset, true);
  await evaluate('history.back()'); await waitFor("new URLSearchParams(location.search).get('area') === 'medtools'");
  assert.equal((await state()).count, '1 Beitrag');
  await evaluate('history.forward()'); await waitFor("new URLSearchParams(location.search).get('area') === 'meddocs'");
  assert.equal((await state()).empty, true);
  await click('.empty-state [data-reset]'); assert.deepEqual((await state()).visible, initial.visible); assert.equal((await state()).reset, false);
  assert.equal(await evaluate("document.activeElement?.matches('[data-filter-option=type][data-value=\"\"]')"),true);
  await navigate('/medblog/?type=article&area=meddocs&tag=Lernen');
  assert.equal((await state()).count, '1 Beitrag'); assert.equal((await state()).featured, true);
  assert.equal((await state()).visible.filter(path => path.includes('wissen-strukturiert')).length, 1);
  await navigate('/medblog/?type=unknown&area=unknown&tag=unknown');
  assert.deepEqual((await state()).visible, initial.visible); assert.deepEqual((await state()).active, {type:'',area:'',tag:''});
  await navigate('/medblog/');
  const layouts = [];
  for (const width of [320,390,768,1024,1440,1920]) for (const theme of ['dark','light']) layouts.push(await viewport(width,theme));
  console.log('Layouts: '+JSON.stringify(layouts));
  await viewport(1440,'dark'); await capture('medblog-archive-desktop.png');
  await viewport(390,'light');
  await evaluate("document.querySelector('medblog-archive summary').focus()");
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor("document.querySelector('medblog-archive details').open === true");
  await click('[data-filter-option="area"][data-value="medtools"]'); assert.equal((await state()).count,'1 Beitrag');
  await click('.result-toolbar [data-reset]');
  await evaluate("document.querySelector('medblog-archive details').open=false"); await capture('medblog-archive-mobile.png');
  await command('Emulation.setScriptExecutionDisabled',{value:true});
  await command('Page.navigate',{url:`${site}/medblog/`});
  await waitFor("document.querySelector('medblog-archive') !== null");
  assert.equal(await evaluate("document.querySelectorAll('medblog-archive [data-blog-post]:not([hidden])').length"),3);
  assert.equal(await evaluate("document.querySelector('medblog-archive [data-filter-panel]').hidden"),true);
  assert.equal(await evaluate("document.querySelector('medblog-archive [data-filter-option=type][data-value=article]').pathname"),'/medblog/artikel/');
  assert.equal(await evaluate("document.querySelector('meta[name=robots]')?.content.includes('noindex') ?? false"),false);
  await command('Emulation.setScriptExecutionDisabled',{value:false});
  await command('Page.navigate',{url:`${site}/medblog/artikel/`});
  await waitFor("document.querySelector('medblog-hub[data-fixed-type=article]') !== null");
  assert.equal(await evaluate("document.querySelectorAll('medblog-archive').length"),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: counts, combined type/area/tag filters, reset, empty state, featured without duplicates, URLs, back/forward, valid article links, responsive themes, keyboard disclosure, no-JS fallback, existing type overview.');
} finally {
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
}
