import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Manual integration check: serve dist/ on 4324 and run headless Chrome CDP on 9223.
const site = 'http://127.0.0.1:4324';
const endpoint = 'http://127.0.0.1:9223';
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
    const result = await evaluate(expression);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector) {
  assert.ok(await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`), `Missing ${selector}`);
}
async function setInput(selector, value) {
  assert.ok(await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`), `Missing ${selector}`);
}
async function viewport(width, height, theme) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
  const widths = await evaluate('({ viewport: innerWidth, document: document.documentElement.scrollWidth })');
  assert.ok(widths.document <= widths.viewport + 1, `${width}px ${theme}: horizontal overflow ${JSON.stringify(widths)}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
}

try {
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Page.navigate', { url: `${site}/medtools/osce-timer/` });
  await waitFor("document.querySelector('astro-island')?.hasAttribute('ssr') === false");
  assert.equal(await evaluate("document.title.includes('OSCE-Timer')"), true);
  assert.equal(await evaluate("document.querySelector('.mn-osce-tool__readout').textContent"), '13:00');
  assert.equal(await evaluate("document.querySelector('.mn-osce-tool__state').textContent"), 'Bereit');
  assert.equal(await evaluate("document.querySelector('#mn-osce-duration').labels.length"), 1);
  assert.equal(await evaluate("document.querySelector('#mn-osce-warning').labels.length"), 1);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate("(() => { const button = document.querySelector('.mn-osce-tool__actions button'); button.focus(); return getComputedStyle(button).outlineStyle === 'solid'; })()"), true);

  await setInput('#mn-osce-duration', '0');
  await waitFor("document.querySelector('#mn-osce-duration').getAttribute('aria-invalid') === 'true'");
  assert.equal(await evaluate("document.querySelector('.mn-osce-tool__actions button').disabled"), true);
  await setInput('#mn-osce-duration', '1');
  await setInput('#mn-osce-warning', '1');
  await waitFor("document.querySelector('#mn-osce-warning').getAttribute('aria-invalid') === 'true'");
  await setInput('#mn-osce-warning', '0');
  await waitFor("document.querySelector('.mn-osce-tool__readout').textContent === '01:00'");
  await click('.mn-osce-tool__sound button[aria-pressed]');
  assert.equal(await evaluate("document.querySelector('.mn-osce-tool__sound button[aria-pressed]').getAttribute('aria-pressed')"), 'false');
  await click('.mn-osce-tool__sound button:last-child');
  await click('.mn-osce-tool__actions button');
  await waitFor("document.querySelector('.mn-osce-tool__state').textContent === 'Läuft'");
  assert.equal(await evaluate("document.querySelector('#mn-osce-duration').disabled"), true);
  await click('.mn-osce-tool__actions button:first-child');
  await waitFor("document.querySelector('.mn-osce-tool__state').textContent === 'Pausiert'");
  await click('.mn-osce-tool__actions button:first-child');
  await waitFor("document.querySelector('.mn-osce-tool__state').textContent === 'Läuft'");
  await click('.mn-osce-tool__actions button:nth-child(2)');
  await waitFor("document.querySelector('.mn-osce-tool__state').textContent === 'Bereit'");

  for (const width of [320, 375, 768, 1440]) {
    for (const theme of ['dark', 'light']) await viewport(width, 900, theme);
  }
  await viewport(1440, 900, 'dark');
  const desktop = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), 'mednerds-osce-timer-desktop.png'), Buffer.from(desktop.data, 'base64'));
  await viewport(320, 700, 'light');
  const mobile = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(tmpdir(), 'mednerds-osce-timer-mobile.png'), Buffer.from(mobile.data, 'base64'));

  await click('.mn-osce-tool__actions button:last-child');
  await waitFor("document.fullscreenElement !== null || document.querySelector('.mn-osce-tool__feedback') !== null");
  const fullscreenEntered = await evaluate('document.fullscreenElement !== null');
  let escapeExited = false;
  if (fullscreenEntered) {
    assert.equal(await evaluate("document.querySelector('.mn-osce-tool__actions button:last-child').textContent"), 'Vollbild verlassen');
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    escapeExited = await evaluate('document.fullscreenElement === null');
    if (!escapeExited) await click('.mn-osce-tool__actions button:last-child');
    await waitFor('document.fullscreenElement === null');
  }

  await setInput('#mn-osce-duration', '2');
  await setInput('#mn-osce-warning', '1');
  await click('.mn-osce-tool__actions button');
  await command('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 61000 });
  await waitFor("document.querySelector('.mn-osce-tool__state').textContent === 'Warnphase'");
  await command('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 61000 });
  await waitFor("document.querySelector('.mn-osce-tool__state').textContent === 'Zeit abgelaufen'");
  assert.equal(await evaluate("document.querySelector('.mn-osce-tool__readout').textContent"), '00:00');
  assert.deepEqual(errors, []);
  console.log(`OSCE timer browser checks passed: settings, controls, mute, fullscreen ${fullscreenEntered ? `opened and exited (Escape in headless: ${escapeExited})` : 'gracefully declined'}, warning/end, responsive light/dark layouts.`);
} finally {
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
}
