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
  const search = await evaluate(`(async () => {
    const pagefind = await import('/pagefind/pagefind.js');
    const publicResults = await pagefind.search('OSCE');
    const spoilerResults = await Promise.all(['Kernproblem', 'Vorerkrankungen erst auf Nachfrage geben', 'Stellt sich vor und erklärt das Vorgehen'].map((term) => pagefind.search(term)));
    const urls = await Promise.all(publicResults.results.map(async (result) => (await result.data()).url));
    const spoilerUrls = await Promise.all(spoilerResults.map(async (group) => Promise.all(group.results.map(async (result) => (await result.data()).url))));
    return { urls, spoilerUrls };
  })()`);
  assert.ok(search.urls.includes('/medcases/'));
  assert.deepEqual(search.spoilerUrls, [[], [], []]);
  assert.ok(search.spoilerUrls.every((group) => group.every((url) => !url.startsWith('/medcases/osce/') && url !== '/medcases/join/')));
  await navigate(`${root}/`);
  assert.ok(await evaluate("document.body.innerText.includes('Als Prüfer starten')"));
  assert.equal(await evaluate(`document.querySelector('a[href$="/examiner/"]') !== null`), true);

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

  await navigate(`${root}/examiner/`);
  await waitFor("document.querySelector('.osce-qr') !== null");
  assert.equal(await evaluate("document.querySelector('.osce-timer__display').textContent"), '13:00');
  assert.equal(await evaluate("document.body.innerText.includes('K7P4MX')"), true);
  assert.equal(await evaluate("document.querySelector('.osce-text-link').href"), 'https://mednerds.ch/medcases/join/?case=K7P4MX');
  const decodedQr = await evaluate(`(async () => {
    if (!('BarcodeDetector' in window)) return null;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const svg = document.querySelector('.osce-qr');
    const image = await createImageBitmap(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    return (await detector.detect(image))[0]?.rawValue ?? null;
  })()`);
  if (decodedQr) assert.equal(decodedQr, 'https://mednerds.ch/medcases/join/?case=K7P4MX');
  await click('.osce-toggle input');
  assert.equal(await evaluate("document.querySelector('.osce-toggle input').checked"), false);
  await click('.osce-toggle input');
  await click('.osce-timer button');
  await waitFor("document.body.innerText.includes('LÄUFT')");
  await click('.osce-timer button:first-child');
  await waitFor("document.body.innerText.includes('PAUSIERT')");
  await click('.osce-timer button:first-child');
  await waitFor("document.body.innerText.includes('LÄUFT')");
  await click('.osce-timer button:nth-child(2)');
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

  await click('.osce-timer button');
  await command('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 661000 });
  await waitFor("document.querySelector('.osce-timer').classList.contains('osce-timer--warning')");
  await command('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 120000 });
  await waitFor("document.body.innerText.includes('ZEIT ABGELAUFEN')");
  assert.equal(await evaluate("document.querySelector('.osce-timer__display').textContent"), '00:00');

  for (const path of [`${root}/unknown/`, '/medcases/osce/case-ffffffffee/candidate/', '/medcases/osce/akuter-thoraxschmerz/candidate/']) {
    assert.equal(await evaluate(`(async () => (await fetch(${JSON.stringify(path)})).status)()`), 404);
  }
  assert.deepEqual(errors, []);
  console.log('MedCases browser checks passed: opake routes, join, spoiler-free search, role isolation, examiner timer and checklist, 30 viewport/theme combinations.');
} finally {
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
}
