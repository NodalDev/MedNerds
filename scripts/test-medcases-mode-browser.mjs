import assert from 'node:assert/strict';

// Run with local Astro (4321), the development Worker (8787), and Chrome CDP (9224).
const cdp = 'http://127.0.0.1:9224';
const site = 'http://localhost:4321';
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
};
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, userGesture = false) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector) {
  assert.equal(await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`, true), true, `Missing ${selector}`);
}

try {
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Page.navigate', { url: `${site}/medcases/osce/case-2bf98914ed/examiner/?mode=local` });
  await waitFor("document.querySelector('.osce-mode-switch')?.textContent.includes('Modus: Lokaler Timer')");
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer__display')?.textContent"), '13:00');
  await command('Page.navigate', { url: `${site}/medcases/osce/case-2bf98914ed/examiner/` });
  await waitFor("document.querySelector('.osce-mode-switch') !== null");
  await waitFor("[...document.querySelectorAll('.osce-live button')].some((button) => button.textContent.includes('Live-Session erstellen') && !button.disabled)");
  assert.equal(await evaluate("document.querySelector('.osce-mode-switch').textContent.includes('Modus: Live-OSCE')"), true);
  assert.equal(await evaluate("document.querySelector('.osce-mode-picker')"), null);
  assert.equal(await evaluate("document.body.innerText.includes('Statischer Fallbeitritt')"), false);
  await click('.osce-mode-switch button');
  await waitFor("document.querySelector('.osce-mode-switch').textContent.includes('Modus: Lokaler Timer')");
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-sound__status')?.textContent"), '○ Noch nicht getestet');
  await click('.osce-mode-content:not([hidden]) .osce-sound > button');
  await waitFor("document.querySelector('.osce-mode-content:not([hidden]) .osce-sound__status')?.textContent === '✓ Ton getestet'");
  await click('.osce-mode-switch button');
  await waitFor("document.querySelector('.osce-mode-switch').textContent.includes('Modus: Live-OSCE')");
  await waitFor("[...document.querySelectorAll('.osce-live button')].some((button) => button.textContent.includes('Live-Session erstellen') && !button.disabled)");
  await click('.osce-live button');
  await waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  const code = await evaluate("document.querySelector('.osce-live .osce-join-code').textContent");
  const stored = await evaluate("sessionStorage.getItem('mednerds.medcases.realtime.examiner.v2')");

  await click('.osce-mode-switch button');
  assert.equal(await evaluate("document.querySelector('.osce-mode-content[hidden] .osce-live__status')?.textContent"), 'Verbunden');
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer__display')?.textContent"), '13:00');
  assert.equal(await evaluate("sessionStorage.getItem('mednerds.medcases.realtime.examiner.v2')"), stored);
  await click('.osce-mode-content:not([hidden]) .osce-sound summary');
  assert.equal(await evaluate("document.querySelectorAll('.osce-mode-content:not([hidden]) .osce-sound button').length"), 4);
  await click('.osce-mode-switch button');
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-live .osce-join-code')?.textContent"), code);
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-live__status')?.textContent"), 'Verbunden');

  await click('.osce-mode-content:not([hidden]) .osce-timer button');
  await waitFor("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer__state')?.textContent === 'LÄUFT'");
  await evaluate("window.__modeConfirmCalls = 0; window.confirm = () => { window.__modeConfirmCalls++; return false; }");
  await click('.osce-mode-switch button');
  assert.equal(await evaluate("document.querySelector('.osce-mode-switch').textContent.includes('Modus: Live-OSCE')"), true);
  assert.equal(await evaluate('window.__modeConfirmCalls'), 1);
  await evaluate("window.confirm = () => { window.__modeConfirmCalls++; return true; }");
  await click('.osce-mode-switch button');
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer__display')?.textContent"), '13:00');
  assert.equal(await evaluate("document.querySelector('.osce-mode-content[hidden] .osce-live .osce-join-code')?.textContent"), code);
  await click('.osce-mode-content:not([hidden]) .osce-timer button');
  await waitFor("document.querySelector('.osce-mode-content:not([hidden]) .osce-timer__state')?.textContent === 'LÄUFT'");
  await click('.osce-mode-switch button');
  assert.equal(await evaluate('window.__modeConfirmCalls'), 3);
  assert.equal(await evaluate("document.querySelector('.osce-mode-content:not([hidden]) .osce-live .osce-join-code')?.textContent"), code);
  assert.equal(await evaluate("document.querySelector('.osce-mode-content[hidden] .osce-timer__state')?.textContent"), 'LÄUFT');
  assert.equal(await evaluate("sessionStorage.getItem('mednerds.medcases.realtime.examiner.v2')"), stored);

  for (const width of [320, 375, 768, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width < 600 });
    for (const theme of ['dark', 'light']) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      const size = await evaluate('({ viewport: innerWidth, page: document.documentElement.scrollWidth })');
      assert.ok(size.page <= size.viewport + 1, `${width}px ${theme}: horizontal overflow ${JSON.stringify(size)}`);
    }
  }
  console.log('MedCases mode browser checks passed: default, sound, active session retention, live/local timers, confirmation, and responsive themes.');
} finally {
  socket.close();
  await fetch(`${cdp}/json/close/${target.id}`).catch(() => {});
}
