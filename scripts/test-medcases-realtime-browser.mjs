import assert from 'node:assert/strict';

const cdp = 'http://127.0.0.1:9224';
const site = 'http://127.0.0.1:4321';
const examinerPath = '/medcases/osce/case-2bf98914ed/examiner/';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tab() {
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
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Page.enable');
  await command('Runtime.enable');
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, timeoutMs = 12_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await evaluate(expression);
      if (value) return value;
      await delay(80);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const navigate = async (url) => {
    await command('Page.navigate', { url: new URL(url, site).toString() });
    await waitFor("document.readyState === 'complete' && document.querySelector('.osce') !== null");
  };
  const clickText = async (selector, text) => {
    assert.equal(await evaluate(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.includes(${JSON.stringify(text)}));
      if (!element) return false; element.click(); return true;
    })()`), true, `Missing button: ${text}`);
  };
  return {
    command, evaluate, waitFor, navigate, clickText,
    close: async () => { socket.close(); await fetch(`${cdp}/json/close/${target.id}`).catch(() => {}); },
  };
}

const examiner = await tab();
const observer = await tab();
try {
  await examiner.navigate(examinerPath);
  await examiner.waitFor("document.body.innerText.includes('Live-Session erstellen')");
  await examiner.waitFor("[...document.querySelectorAll('.osce-live button')].some((button) => button.textContent.includes('Live-Session erstellen') && !button.disabled)");
  await examiner.clickText('.osce-live button', 'Live-Session erstellen');
  await examiner.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  const info = await examiner.evaluate(`(() => ({
    code: document.querySelector('.osce-live .osce-join-code')?.textContent,
    url: document.querySelector('.osce-live__link')?.href,
    qrValue: document.querySelector('.osce-live__qr svg')?.getAttribute('viewBox'),
    storage: sessionStorage.getItem('mednerds.medcases.realtime.examiner.v1'),
    html: document.body.innerHTML,
  }))()`);
  assert.match(info.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(info.url, `${site}/medcases/session/join/?code=${info.code}`);
  assert.ok(info.qrValue);
  const stored = JSON.parse(info.storage);
  assert.ok(!info.html.includes(stored.examinerCapability));
  assert.ok(!info.url.includes(stored.examinerCapability));
  assert.ok(!info.url.includes(stored.sessionId));
  assert.equal(await examiner.evaluate("document.querySelector('.osce-timer__display')?.textContent"), '13:00');

  await observer.navigate(info.url);
  await observer.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  assert.equal(await observer.evaluate("document.querySelector('.osce-timer__display')?.textContent"), '13:00');
  assert.equal(await observer.evaluate("document.querySelectorAll('.osce-timer button').length"), 0);
  for (const current of [examiner, observer]) {
    for (const width of [320, 375, 768, 1440]) {
      await current.command('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width < 600 });
      for (const theme of ['dark', 'light']) {
        await current.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        const dimensions = await current.evaluate('({ viewport: innerWidth, page: document.documentElement.scrollWidth })');
        assert.ok(dimensions.page <= dimensions.viewport + 1, `${width}px ${theme}: horizontal overflow`);
      }
    }
  }
  await examiner.clickText('.osce-timer button', 'Timer starten');
  await examiner.waitFor("document.querySelector('.osce-timer__state')?.textContent === 'LÄUFT'");
  await observer.waitFor("document.querySelector('.osce-timer__state')?.textContent === 'LÄUFT'");
  await examiner.clickText('.osce-timer button', 'Pausieren');
  await examiner.waitFor("document.querySelector('.osce-timer__state')?.textContent === 'PAUSIERT'");
  await observer.waitFor("document.querySelector('.osce-timer__state')?.textContent === 'PAUSIERT'");
  assert.equal(await examiner.evaluate("document.querySelector('.osce-timer__display')?.textContent"),
    await observer.evaluate("document.querySelector('.osce-timer__display')?.textContent"));
  await examiner.clickText('.osce-timer button', 'Fortsetzen');
  await observer.waitFor("document.querySelector('.osce-timer__state')?.textContent === 'LÄUFT'");

  await observer.command('Page.reload', { ignoreCache: true });
  await observer.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  assert.equal(await observer.evaluate("document.querySelector('.osce-timer__state')?.textContent"), 'LÄUFT');
  await examiner.command('Page.reload', { ignoreCache: true });
  await examiner.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  await examiner.waitFor("document.querySelector('.osce-timer__state')?.textContent === 'LÄUFT'");
  assert.equal(await examiner.evaluate("document.querySelector('.osce-timer__state')?.textContent"), 'LÄUFT');
  assert.ok(await examiner.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.examiner.v1') !== null"));
  console.log('Two-tab create, QR/link, observer, timer, and both reloads passed.');
  console.log('READY_FOR_RESTART');
  await examiner.waitFor("document.querySelector('.osce-live__status')?.textContent.includes('wiederhergestellt')", 30_000);
  await examiner.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'", 45_000);
  await observer.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'", 45_000);
  assert.equal(await examiner.evaluate("document.querySelector('.osce-timer__state')?.textContent"), 'LÄUFT');
  console.log('Both browser clients reconnected after Worker restart.');

  const shortCode = await examiner.evaluate(`(async () => {
    const response = await fetch('http://127.0.0.1:8787/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-MedNerds-Test-TTL-Ms': '8000' },
      body: JSON.stringify({ caseId: 'case-2bf98914ed', durationSeconds: 780, warningRemainingSeconds: 120 }),
    });
    if (!response.ok) throw new Error('Short-lived session creation failed');
    const created = await response.json();
    sessionStorage.setItem('mednerds.medcases.realtime.examiner.v1',
      JSON.stringify({ ...created, version: 1, caseId: 'case-2bf98914ed' }));
    return created.joinCode;
  })()`);
  await examiner.command('Page.reload', { ignoreCache: true });
  await examiner.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  await observer.navigate(`/medcases/session/join/?code=${shortCode}`);
  await observer.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  await examiner.waitFor("document.body.innerText.includes('Diese Live-Session ist abgelaufen.')", 15_000);
  await observer.waitFor("document.body.innerText.includes('Diese Live-Session ist abgelaufen.')", 15_000);
  assert.equal(await examiner.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.examiner.v1')"), null);
  console.log('Short-lived session expired and examiner credentials were removed.');
} finally {
  await examiner.close();
  await observer.close();
}
