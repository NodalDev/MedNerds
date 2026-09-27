import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Manual browser check: serve `dist/` on 4324 and start headless Chrome CDP on 9223.
const endpoint = 'http://127.0.0.1:9223';
const site = 'http://127.0.0.1:4324';
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
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((item) => item.value ?? item.description).join(' '));
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
  await new Promise((resolve) => setTimeout(resolve, 250));
}
async function click(selector) {
  const found = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  assert.ok(found, `missing ${selector}`);
}
async function setInput(selector, value) {
  const found = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(element, ${JSON.stringify(String(value))}); element.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  assert.ok(found, `missing ${selector}`);
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
  const root = '/medcases/osce/akuter-thoraxschmerz';
  await navigate('/medcases/');
  assert.ok(await evaluate("document.body.innerText.includes('OSCE-Prüfungen gemeinsam trainieren')"));
  const searchResults = await evaluate(`(async () => {
    const pagefind = await import('/pagefind/pagefind.js');
    const publicResults = await pagefind.search('OSCE');
    const privateResults = await pagefind.search('Kernproblem');
    const urls = await Promise.all(publicResults.results.map(async (result) => (await result.data()).url));
    return { urls, privateCount: privateResults.results.length };
  })()`);
  assert.ok(searchResults.urls.some((url) => url === '/medcases/'));
  assert.equal(searchResults.privateCount, 0);
  await navigate(`${root}/`);
  assert.ok(await evaluate("document.body.innerText.includes('Als Prüfer starten')"));
  await navigate('/medcases/join/');
  await waitFor("document.querySelector('#osce-code') !== null");
  await setInput('#osce-code', 'BAD999');
  await click('.osce-join button[type=submit]');
  await waitFor("document.body.innerText.includes('nicht gefunden')");
  await setInput('#osce-code', 'K7P4MX');
  await click('.osce-join button[type=submit]');
  await waitFor("document.body.innerText.includes('Welche Rolle')");
  assert.ok(await evaluate("document.querySelector('a[href*=" + JSON.stringify('/candidate/') + "]') !== null"));
  assert.ok(await evaluate("document.querySelector('a[href*=" + JSON.stringify('/candidate/') + "]').href.endsWith('/candidate/')"));
  await navigate('/medcases/join/?case=K7P4MX&duration=600&warning=180');
  await waitFor("document.querySelector('.osce-role-link') !== null");
  assert.ok(await evaluate("document.querySelector('.osce-role-link').href.includes('duration=600&warning=180')"));
  await navigate(`${root}/candidate/?duration=60&warning=30`);
  await waitFor("document.querySelector('.osce-timer__display') !== null");
  assert.equal(await evaluate("document.querySelector('.osce-timer__display').textContent"), '01:00');
  assert.equal(await evaluate("document.body.innerText.includes('Kernproblem')"), false);
  assert.equal(await evaluate("document.body.innerText.includes('Bluthochdruck')"), false);
  await click('.osce-timer button');
  assert.ok(await evaluate("document.body.innerText.includes('LÄUFT')"));
  await navigate(`${root}/patient/`);
  await waitFor("document.querySelector('.osce-timer__display') !== null");
  assert.ok(await evaluate("document.body.innerText.includes('Nur auf Nachfrage')"));
  assert.equal(await evaluate("document.body.innerText.includes('Checkliste')"), false);
  for (const width of [320, 375, 430, 768, 1440, 1920]) {
    for (const theme of ['dark', 'light']) await viewport(width, 850, theme);
  }
  await navigate(`${root}/master/`);
  await waitFor("document.querySelector('.osce-qr') !== null");
  assert.equal(await evaluate("document.querySelector('.osce-timer__display').textContent"), '13:00');
  assert.ok(await evaluate("document.body.innerText.includes('K7P4MX')"));
  const decodedQr = await evaluate(`(async () => {
    if (!('BarcodeDetector' in window)) return null;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const svg = document.querySelector('.osce-qr');
    const image = await createImageBitmap(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    return (await detector.detect(image))[0]?.rawValue ?? null;
  })()`);
  if (decodedQr) assert.ok(decodedQr.includes('/medcases/join/?case=K7P4MX&duration=780&warning=120'));
  await click('.osce-master-grid__side > .osce-panel:nth-of-type(3) .osce-actions button:nth-of-type(1)');
  await click('.osce-master-grid__side > .osce-panel:nth-of-type(3) .osce-actions button:nth-of-type(2)');
  await click('.osce-master-grid__side > .osce-panel:nth-of-type(3) .osce-actions button:nth-of-type(3)');
  await click('.osce-toggle input');
  assert.equal(await evaluate("document.querySelector('.osce-toggle input').checked"), false);
  await click('.osce-toggle input');
  await setInput('#osce-duration', '10');
  await setInput('#osce-warning', '3');
  await waitFor("document.querySelector('.osce-timer__display').textContent === '10:00'");
  assert.ok(await evaluate("document.querySelector('.osce-text-link').href.includes('duration=600&warning=180')"));
  await setInput('#osce-warning', '0');
  assert.ok(await evaluate("document.querySelector('.osce-text-link').href.includes('warning=0')"));
  await setInput('#osce-duration', '0');
  assert.ok(await evaluate("document.querySelector('.osce-timer button').disabled"));
  await setInput('#osce-duration', '10');
  await click('.osce-timer button');
  await waitFor("document.body.innerText.includes('LÄUFT')");
  await click('.osce-timer button:nth-of-type(1)');
  await waitFor("document.body.innerText.includes('PAUSIERT')");
  await click('.osce-timer button:nth-of-type(1)');
  await waitFor("document.body.innerText.includes('LÄUFT')");
  await click('.osce-timer button:nth-of-type(2)');
  await waitFor("document.body.innerText.includes('BEREIT')");
  await click('.osce-checklist__item input');
  assert.ok(await evaluate("document.querySelector('.osce-score').textContent.includes('1 / 12')"));
  await click('.osce-panel button[aria-expanded]');
  assert.ok(await evaluate("document.body.innerText.includes('Lernziele')"));
  for (const width of [320, 375, 430, 768, 1440, 1920]) {
    for (const theme of ['dark', 'light']) await viewport(width, 850, theme);
  }
  await viewport(1440, 900, 'light');
  const lightShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), 'medcases-master-light-test.png'), Buffer.from(lightShot.data, 'base64'));
  await viewport(375, 812, 'dark');
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), 'medcases-browser-test.png'), Buffer.from(screenshot.data, 'base64'));
  await navigate(`${root}/candidate/?duration=60&warning=30`);
  for (const width of [320, 375, 430, 768, 1440, 1920]) {
    for (const theme of ['dark', 'light']) await viewport(width, 850, theme);
  }
  await viewport(375, 812, 'dark');
  const candidateShot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), 'medcases-candidate-test.png'), Buffer.from(candidateShot.data, 'base64'));
  await click('.osce-timer button');
  await command('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 31000 });
  await waitFor("document.querySelector('.osce-timer__display').textContent <= '00:30'");
  assert.ok(await evaluate("document.querySelector('.osce-timer').classList.contains('osce-timer--warning')"));
  await command('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 32000 });
  await waitFor("document.body.innerText.includes('ZEIT ABGELAUFEN')");
  assert.deepEqual(errors, []);
  console.log('MedCases browser tests passed: routes, join, role privacy, timer controls, warning/end, checklist, debrief, 12 viewport/theme combinations.');
} finally {
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
}
