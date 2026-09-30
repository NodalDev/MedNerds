import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Manual browser check: serve dist/ on 4324 and run headless Chrome CDP on 9223.
const endpoint = 'http://127.0.0.1:9223';
const site = 'http://127.0.0.1:4324';
const root = '/medcases/osce/case-2bf98914ed';
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
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args.map((item) => item.value ?? item.description).join(' '));
  }
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function navigate(path) {
  await command('Page.navigate', { url: `${site}${path}` });
  await waitFor("document.readyState === 'complete' && document.querySelector('.osce') !== null");
}
async function click(selector) {
  assert.ok(await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`), `Missing ${selector}`);
}
async function setInput(selector, value) {
  assert.ok(await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${JSON.stringify(value)}); node.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`), `Missing ${selector}`);
}
async function viewport(width, height, theme) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
  const dimensions = await evaluate('({ viewport: innerWidth, page: document.documentElement.scrollWidth })');
  assert.ok(dimensions.page <= dimensions.viewport + 1, `${width}px ${theme}: horizontal overflow ${JSON.stringify(dimensions)}`);
}

try {
  await command('Page.enable');
  await command('Runtime.enable');
  await navigate('/medcases/');
  await viewport(1440, 900, 'dark');
  const entryCards = await evaluate(`[...document.querySelectorAll('.osce-entry-card')].map((card) => {
    const cardBox = card.getBoundingClientRect();
    const actionBox = card.querySelector('.osce-button').getBoundingClientRect();
    return { x: cardBox.x, y: cardBox.y, width: cardBox.width, height: cardBox.height, actionTop: actionBox.top };
  })`);
  assert.equal(entryCards.length, 2);
  assert.ok(Math.abs(entryCards[0].width - entryCards[1].width) < 1);
  assert.ok(Math.abs(entryCards[0].height - entryCards[1].height) < 1);
  assert.ok(Math.abs(entryCards[0].actionTop - entryCards[1].actionTop) < 1, JSON.stringify(entryCards));
  assert.ok(entryCards[1].x > entryCards[0].x);
  assert.equal(await evaluate("document.querySelector('#medcases-session-code').placeholder"), 'Session-Code');
  assert.equal(await evaluate("document.querySelector('label[for=medcases-session-code]').classList.contains('sr-only')"), true);
  for (const width of [832, 1024, 1280]) {
    await viewport(width, 900, 'dark');
    const cards = await evaluate(`[...document.querySelectorAll('.osce-entry-card')].map((card) => {
      const box = card.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, actionTop: card.querySelector('.osce-button').getBoundingClientRect().top };
    })`);
    assert.ok(Math.abs(cards[0].width - cards[1].width) < 1 && Math.abs(cards[0].height - cards[1].height) < 1, `${width}px: ${JSON.stringify(cards)}`);
    assert.ok(Math.abs(cards[0].actionTop - cards[1].actionTop) < 1, `${width}px: ${JSON.stringify(cards)}`);
  }
  await viewport(320, 800, 'dark');
  assert.equal(await evaluate("document.querySelectorAll('.osce-entry-card')[1].getBoundingClientRect().top > document.querySelectorAll('.osce-entry-card')[0].getBoundingClientRect().bottom"), true);
  await viewport(1440, 900, 'dark');
  assert.equal(await evaluate("document.body.innerText.includes('Akuter Thoraxschmerz')"), false);
  assert.equal(await evaluate("document.body.innerText.includes('Session beitreten')"), true);
  const search = await evaluate(`(async () => {
    const pagefind = await import('/pagefind/pagefind.js');
    const publicResults = await pagefind.search('OSCE');
    const spoilerResults = await Promise.all(['Kernproblem', 'Vorerkrankungen erst auf Nachfrage geben', 'Stellt sich vor und erklärt das Vorgehen'].map((term) => pagefind.search(term)));
    const urls = await Promise.all(publicResults.results.map(async (result) => (await result.data()).url));
    const spoilerUrls = await Promise.all(spoilerResults.map(async (group) => Promise.all(group.results.map(async (result) => (await result.data()).url))));
    return { urls, spoilerUrls };
  })()`);
  assert.ok(search.urls.includes('/medcases/'));
  await navigate('/medcases/osce/');
  assert.equal(await evaluate("document.body.innerText.includes('Akuter Thoraxschmerz')"), true);
  assert.deepEqual(search.spoilerUrls, [[], [], []]);
  assert.ok(search.spoilerUrls.every((group) => group.every((url) => !url.startsWith('/medcases/osce/') && url !== '/medcases/join/')));
  await navigate(`${root}/`);
  assert.ok(await evaluate("document.body.innerText.includes('Live-OSCE starten')"));
  assert.equal(await evaluate(`document.querySelector('a[href$="/examiner/?mode=live"]') !== null`), true);
  assert.equal(await evaluate(`document.querySelector('a[href$="/examiner/?mode=local"]') !== null`), true);
  assert.equal(await evaluate("document.body.innerText.includes('Mit Fallcode beitreten')"), false);

  await navigate('/medcases/join/');
  await waitFor("document.querySelector('#osce-code') !== null");
  await setInput('#osce-code', 'BAD999');
  await click('.osce-join button[type=submit]');
  await waitFor("document.body.innerText.includes('nicht gefunden')");
  await setInput('#osce-code', 'K7P4MX');
  await click('.osce-join button[type=submit]');
  await waitFor("document.body.innerText.includes('Welche Rolle')");
  assert.equal(await evaluate("document.querySelectorAll('.osce-role-link').length"), 2);
  assert.equal(await evaluate(`document.querySelector('.osce-role-link').getAttribute('href')`), `${root}/candidate/`);
  assert.equal(await evaluate(`document.querySelector('a[href$="/examiner/"]')`), null);
  await navigate('/medcases/join/?case=K7P4MX');
  await waitFor("document.querySelector('.osce-role-link') !== null");
  assert.equal(await evaluate(`document.querySelector('.osce-role-link').getAttribute('href')`), `${root}/candidate/`);

  await navigate(`${root}/candidate/`);
  assert.equal(await evaluate("document.body.innerText.includes('Akuter Thoraxschmerz')"), false);
  assert.equal(await evaluate("document.body.innerText.includes('Ausgangssituation')"), true);
  assert.equal(await evaluate("document.querySelector('.osce-timer')"), null);
  assert.equal(await evaluate("document.body.innerText.includes('Kernproblem')"), false);
  assert.equal(await evaluate("document.body.innerText.includes('Bluthochdruck')"), false);
  for (const width of [320, 375, 768, 1440, 1920]) {
    for (const theme of ['dark', 'light']) await viewport(width, 850, theme);
  }
  await viewport(375, 812, 'dark');
  const candidateShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), 'medcases-candidate-test.png'), Buffer.from(candidateShot.data, 'base64'));

  await navigate(`${root}/patient/`);
  assert.equal(await evaluate("document.body.innerText.includes('Nur auf Nachfrage')"), true);
  assert.equal(await evaluate("document.querySelector('.osce-timer')"), null);
  assert.equal(await evaluate("document.body.innerText.includes('Checkliste')"), false);
  for (const width of [320, 375, 768, 1440, 1920]) {
    for (const theme of ['dark', 'light']) await viewport(width, 850, theme);
  }

  await navigate(`${root}/examiner/?mode=live`);
  await waitFor("document.querySelector('.osce-mode-switch') !== null");
  assert.equal(await evaluate("document.querySelector('.osce-mode-switch').textContent.includes('Modus: Live-OSCE')"), true);
  assert.equal(await evaluate("document.body.innerText.includes('Statischer Fallbeitritt')"), false);
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer')"), null);
  assert.equal(await evaluate("document.body.innerText.includes('Live-OSCE ist derzeit nicht verfügbar.')"), true);
  await click('.osce-mode-switch button');
  assert.equal(await evaluate("document.querySelector('.osce-mode-switch').textContent.includes('Lokaler Timer')"), true);
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer__display').textContent"), '13:00');
  await click('.osce-mode-content:not([hidden]) .osce-toggle input');
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-toggle input').checked"), false);
  await click('.osce-mode-content:not([hidden]) .osce-toggle input');
  await click('.osce-mode-content:not([hidden]) .osce-sound summary');
  assert.equal(await evaluate("document.querySelectorAll('.osce-mode-content:not([hidden]) .osce-sound button').length"), 4);
  await click('.osce-mode-content:not([hidden]) .osce-timer button');
  await waitFor("document.body.innerText.includes('LÄUFT')");
  await evaluate('window.__modeConfirmCalls = 0; window.confirm = () => { window.__modeConfirmCalls++; return false; }');
  await click('.osce-mode-switch button');
  assert.equal(await evaluate("document.querySelector('.osce-mode-switch').textContent.includes('Lokaler Timer')"), true);
  assert.equal(await evaluate('window.__modeConfirmCalls'), 1);
  await evaluate('window.confirm = () => { window.__modeConfirmCalls++; return true; }');
  await click('.osce-mode-switch button');
  assert.equal(await evaluate("document.querySelector('.osce-mode-switch').textContent.includes('Live-OSCE')"), true);
  assert.equal(await evaluate("document.querySelector('.osce-mode-content[hidden] .osce-timer__state').textContent"), 'LÄUFT');
  await click('.osce-mode-switch button');
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer__state').textContent"), 'LÄUFT');
  await click('.osce-mode-content:not([hidden]) .osce-timer button:first-child');
  await waitFor("document.body.innerText.includes('PAUSIERT')");
  await click('.osce-mode-content:not([hidden]) .osce-timer button:first-child');
  await waitFor("document.body.innerText.includes('LÄUFT')");
  await click('.osce-mode-content:not([hidden]) .osce-timer button:nth-child(2)');
  await waitFor("document.body.innerText.includes('BEREIT')");
  await click('.osce-checklist__item input');
  assert.ok(await evaluate("document.querySelector('.osce-score').textContent.includes('1 / 12')"));
  await click('.osce-panel button[aria-expanded]');
  assert.equal(await evaluate("document.body.innerText.includes('Lernziele')"), true);
  for (const width of [320, 375, 768, 1440, 1920]) {
    for (const theme of ['dark', 'light']) await viewport(width, 850, theme);
  }
  await viewport(1440, 900, 'light');
  const examinerShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), 'medcases-examiner-light-test.png'), Buffer.from(examinerShot.data, 'base64'));

  await click('.osce-mode-content:not([hidden]) .osce-timer button');
  await command('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 661000 });
  await waitFor("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer').classList.contains('osce-timer--warning')");
  await command('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 120000 });
  await waitFor("document.body.innerText.includes('ZEIT ABGELAUFEN')");
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer__display').textContent"), '00:00');

  for (const path of [`${root}/unknown/`, '/medcases/osce/case-ffffffffee/candidate/', '/medcases/osce/akuter-thoraxschmerz/candidate/']) {
    assert.equal(await evaluate(`(async () => (await fetch(${JSON.stringify(path)})).status)()`), 404);
  }
  // A production build without a Worker URL deliberately reports unavailable Realtime.
  assert.deepEqual(errors.filter((error) => !error.startsWith('MedCases Realtime ist nicht konfiguriert:')), []);
  console.log('MedCases browser checks passed: opake routes, join, spoiler-free search, role isolation, examiner mode switch, local timer and checklist, 30 viewport/theme combinations.');
} finally {
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
}
