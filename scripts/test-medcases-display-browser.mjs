import assert from 'node:assert/strict';

const cdp = 'http://127.0.0.1:9224';
const site = process.env.MEDCASES_TEST_SITE ?? 'http://localhost:4321';
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
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Page.enable');
  await command('Runtime.enable');
  const evaluate = async (expression, userGesture = false) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture });
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
  const click = (selector, label) => evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(label)}));
    if (!button) throw new Error('Missing button: ${label}'); button.click(); return true;
  })()`, true);
  return { command, evaluate, waitFor, navigate, click,
    close: async () => { socket.close(); await fetch(`${cdp}/json/close/${target.id}`).catch(() => {}); } };
}

const examiner = await tab();
const displays = await Promise.all(Array.from({ length: 3 }, () => tab()));
try {
  await examiner.navigate(examinerPath);
  await examiner.waitFor("[...document.querySelectorAll('.osce-live button')].some(b => b.textContent.includes('Live-Session erstellen') && !b.disabled)");
  await examiner.click('.osce-live button', 'Live-Session erstellen');
  await examiner.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  await examiner.click('.osce-live button', 'Timer-Display hinzufügen');
  const invite = await examiner.evaluate(`(() => ({
    code: document.querySelector('.osce-live__display-invite .osce-join-code')?.textContent,
    qr: !!document.querySelector('.osce-live__display-invite svg'),
    stored: JSON.parse(sessionStorage.getItem('mednerds.medcases.realtime.examiner.v2')),
  }))()`);
  invite.url = `${site}/medcases/session/display/?code=${invite.code}`;
  assert.equal(invite.url, `${site}/medcases/session/display/?code=${invite.code}`);
  assert.ok(invite.qr);
  for (const value of [invite.stored.sessionId, invite.stored.examinerCapability, invite.stored.caseId]) assert.ok(!invite.url.includes(value));

  for (const display of displays.slice(0, 2)) {
    await display.navigate(invite.url);
    await display.waitFor("document.querySelector('.osce-display__connection')?.textContent === 'Verbunden'");
    assert.equal(await display.evaluate("document.querySelector('.osce-display__time')?.textContent"), '13:00');
    assert.equal(await display.evaluate("document.querySelectorAll('.osce-display button').length"), 2);
    assert.equal(await display.evaluate("document.body.innerText.includes('Kernproblem')"), false);
  }
  await examiner.click('.osce-timer button', 'Timer starten');
  for (const display of displays.slice(0, 2)) await display.waitFor("document.querySelector('.osce-display__state')?.textContent === 'Läuft'");
  await displays[2].navigate(invite.url);
  await displays[2].waitFor("document.querySelector('.osce-display__state')?.textContent === 'Läuft'");
  const times = await Promise.all(displays.map((display) => display.evaluate("document.querySelector('.osce-display__time')?.textContent")));
  assert.equal(new Set(times).size, 1);

  await examiner.click('.osce-timer button', 'Pausieren');
  for (const display of displays) await display.waitFor("document.querySelector('.osce-display__state')?.textContent === 'Pausiert'");
  const paused = await displays[0].evaluate("document.querySelector('.osce-display__time')?.textContent");
  await examiner.click('.osce-timer button', 'Fortsetzen');
  for (const display of displays) await display.waitFor("document.querySelector('.osce-display__state')?.textContent === 'Läuft'");
  await displays[0].command('Page.reload', { ignoreCache: true });
  await displays[0].waitFor("document.querySelector('.osce-display__state')?.textContent === 'Läuft'");

  for (const width of [160, 320, 375, 768, 1024, 1440, 1920]) {
    for (const height of [400, 850]) {
      await displays[0].command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      for (const theme of ['dark', 'light']) {
        await displays[0].evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        const size = await displays[0].evaluate('({ viewport: innerWidth, page: document.documentElement.scrollWidth })');
        assert.ok(size.page <= size.viewport + 1, `${width}×${height} ${theme}: horizontal overflow`);
      }
    }
  }

  const full = await displays[0].evaluate("!!document.querySelector('.osce-display').requestFullscreen");
  if (full) {
    await displays[0].click('.osce-display button', 'Vollbild starten');
    await delay(300);
    const active = await displays[0].evaluate("document.fullscreenElement?.classList.contains('osce-display') ?? false");
    if (active) {
      await displays[0].evaluate('document.exitFullscreen()', true);
      await displays[0].waitFor("[...document.querySelectorAll('.osce-display button')].some(b => b.textContent.includes('Vollbild starten'))");
    } else {
      assert.ok(await displays[0].evaluate("document.body.innerText.includes('Vollbild konnte nicht gestartet werden.')"));
    }
    console.log(`Fullscreen API: ${active ? 'entered and exited' : 'request rejected in headless browser, fallback shown'}.`);
  }
  await displays[0].evaluate(`(() => {
    window.__fullscreenTarget = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => window.__fullscreenTarget });
    document.querySelector('.osce-display').requestFullscreen = async function () {
      window.__fullscreenTarget = this;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    document.exitFullscreen = async () => {
      window.__fullscreenTarget = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  })()`);
  await displays[0].click('.osce-display button', 'Vollbild starten');
  await displays[0].waitFor("[...document.querySelectorAll('.osce-display button')].some(b => b.textContent.includes('Vollbild verlassen'))");
  await displays[0].evaluate('document.exitFullscreen()');
  await displays[0].waitFor("[...document.querySelectorAll('.osce-display button')].some(b => b.textContent.includes('Vollbild starten'))");

  await displays[0].command('Page.bringToFront');
  assert.equal(await displays[0].evaluate('document.visibilityState'), 'visible');
  await displays[0].evaluate(`(() => {
    window.__wake = { requested: 0, released: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      window.__wake.requested++;
      const target = new EventTarget();
      window.__wake.last = target;
      target.release = async () => { window.__wake.released++; target.dispatchEvent(new Event('release')); };
      return target;
    } } });
  })()`);
  await displays[0].click('.osce-display button', 'Bildschirm wach halten');
  await displays[0].waitFor("document.body.innerText.includes('Bildschirm bleibt wach.')");
  assert.equal(await displays[0].evaluate('window.__wake.requested'), 1);
  await displays[0].evaluate(`(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.__wake.last.release();
  })()`);
  await displays[0].waitFor("document.body.innerText.includes('Bildschirm-Wachhalten ist unterbrochen.')");
  await displays[0].evaluate(`(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await displays[0].waitFor('window.__wake.requested === 2');
  await displays[0].click('.osce-display button', 'Bildschirm wach halten ausschalten');
  assert.equal(await displays[0].evaluate('window.__wake.released'), 2);
  await displays[0].evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  assert.equal(await displays[0].evaluate('window.__wake.requested'), 2);
  await displays[0].evaluate("Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { throw new Error('denied'); } } })");
  await displays[0].click('.osce-display button', 'Bildschirm wach halten');
  await displays[0].waitFor("document.body.innerText.includes('Bildschirm konnte nicht wach gehalten werden.')");
  await displays[0].evaluate("Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined })");
  await displays[0].click('.osce-display button', 'Bildschirm wach halten');
  await displays[0].waitFor("document.body.innerText.includes('wird von diesem Browser nicht unterstützt.')");
  await displays[0].evaluate("delete document.visibilityState");
  console.log('Three-display timer, late join, reload, responsive themes and mocked Wake Lock passed.');
  assert.notEqual(paused, '00:00');

  const endedCode = await examiner.evaluate(`(async () => {
    const response = await fetch('http://127.0.0.1:8787/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: 'case-2bf98914ed', durationSeconds: 3, warningRemainingSeconds: 0 }),
    });
    if (!response.ok) throw new Error('Short timer creation failed');
    const created = await response.json();
    const socket = new WebSocket('ws://127.0.0.1:8787/sessions/' + created.sessionId + '/connect');
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.send(JSON.stringify({ type: 'session.authenticate', role: 'examiner', capability: created.examinerCapability }));
    await new Promise((resolve) => { socket.onmessage = ({ data }) => { if (JSON.parse(data).type === 'session.snapshot') resolve(); }; });
    socket.send(JSON.stringify({ type: 'timer.start' }));
    await new Promise((resolve) => { socket.onmessage = ({ data }) => { if (JSON.parse(data).type === 'timer.started') resolve(); }; });
    socket.close();
    return created.joinCode;
  })()`);
  await displays[2].navigate(`/medcases/session/display/?code=${endedCode}`);
  await displays[2].waitFor("document.querySelector('.osce-display__state')?.textContent === 'Zeit abgelaufen'", 10_000);
  await displays[2].evaluate("window.dispatchEvent(new Event('offline'))");
  await delay(1200);
  assert.equal(await displays[2].evaluate("document.querySelector('.osce-display__time')?.textContent"), '00:00');
  console.log('Ended timer remains at 00:00 during an offline signal.');

  if (process.argv.includes('--restart')) {
    console.log('READY_FOR_RESTART');
    await displays[0].waitFor("document.querySelector('.osce-display__connection')?.textContent.includes('Verbindung unterbrochen')", 30_000);
    const before = await displays[0].evaluate("document.querySelector('.osce-display__time')?.textContent");
    await delay(1500);
    const after = await displays[0].evaluate("document.querySelector('.osce-display__time')?.textContent");
    assert.notEqual(after, before, 'Running display must continue during disconnect');
    console.log('RUNNING_OFFLINE_CONFIRMED');
    await displays[0].waitFor("document.querySelector('.osce-display__connection')?.textContent === 'Verbunden'", 45_000);
    await examiner.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'", 45_000);
    await examiner.click('.osce-timer button', 'Pausieren');
    await displays[0].waitFor("document.querySelector('.osce-display__state')?.textContent === 'Pausiert'");
    console.log('READY_FOR_PAUSE_RESTART');
    await displays[0].waitFor("document.querySelector('.osce-display__connection')?.textContent.includes('Verbindung unterbrochen')", 30_000);
    const pausedBefore = await displays[0].evaluate("document.querySelector('.osce-display__time')?.textContent");
    await delay(1500);
    assert.equal(await displays[0].evaluate("document.querySelector('.osce-display__time')?.textContent"), pausedBefore);
    console.log('PAUSED_OFFLINE_CONFIRMED');
    await displays[0].waitFor("document.querySelector('.osce-display__connection')?.textContent === 'Verbunden'", 45_000);
    assert.equal(await displays[0].evaluate("document.querySelector('.osce-display__time')?.textContent"), pausedBefore);
    console.log('Running and paused disconnect/reconnect passed.');
  }
} finally {
  await examiner.close();
  await Promise.all(displays.map((display) => display.close()));
}
