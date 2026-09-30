import assert from 'node:assert/strict';

const cdp = 'http://127.0.0.1:9224';
const site = process.env.MEDCASES_TEST_SITE ?? 'http://localhost:4321';
const examinerPath = '/medcases/osce/case-2bf98914ed/examiner/';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createSession(ttlMs, caseId = 'case-2bf98914ed') {
  const response = await fetch('http://127.0.0.1:8787/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(ttlMs ? { 'X-MedNerds-Test-TTL-Ms': String(ttlMs) } : {}) },
    body: JSON.stringify({ caseId, durationSeconds: 780, warningRemainingSeconds: 120 }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function releaseAsExaminer(session, materialId) {
  const socket = new WebSocket(`ws://127.0.0.1:8787/sessions/${session.sessionId}/connect`);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const next = () => new Promise((resolve) => socket.addEventListener('message', ({ data }) => resolve(JSON.parse(data)), { once: true }));
  socket.send(JSON.stringify({ type: 'session.authenticate', role: 'examiner', capability: session.examinerCapability }));
  assert.equal((await next()).type, 'session.snapshot');
  socket.send(JSON.stringify({ type: 'material.release', materialId }));
  assert.equal((await next()).type, 'material.released');
  socket.close();
}

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
      try {
        const value = await evaluate(expression);
        if (value) return value;
      } catch { /* A navigation can briefly replace the JavaScript context. */ }
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
const patient = await tab();
const display = await tab();
const unauthorized = await tab();
const networkFailure = await tab();
try {
  await examiner.navigate(examinerPath);
  await examiner.waitFor("[...document.querySelectorAll('.osce-live button')].some(b => b.textContent.includes('Live-Session erstellen') && !b.disabled)");
  await examiner.click('.osce-live button', 'Live-Session erstellen');
  await examiner.waitFor("document.querySelector('.osce-live__status')?.textContent === 'Verbunden'");
  const info = await examiner.evaluate(`(() => ({
    code: document.querySelector('.osce-live__invite .osce-join-code')?.textContent,
    qr: !!document.querySelector('.osce-live__invite svg'),
    stored: JSON.parse(sessionStorage.getItem('mednerds.medcases.realtime.examiner.v2')),
    visibleUrl: !!document.querySelector('.osce-live__invite .osce-live__link'),
    inviteColumns: getComputedStyle(document.querySelector('.osce-live__invite')).gridTemplateColumns.split(' ').length,
  }))()`);
  assert.match(info.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(info.qr, true);
  assert.equal(info.visibleUrl, false);
  assert.equal(info.inviteColumns, 1);
  assert.match(info.stored.patientCapability, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(info.stored.patientCapability !== info.stored.examinerCapability);
  const inviteUrl = `${site}/medcases/session/patient/?code=${info.code}#access=${info.stored.patientCapability}`;
  assert.ok(!inviteUrl.includes(info.stored.examinerCapability));
  assert.equal(new URL(inviteUrl).searchParams.has('access'), false);
  await examiner.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async (value) => { window.__copiedPatientLink = value; } } })`);
  await examiner.click('.osce-live__invite button', 'Patientenlink kopieren');
  assert.equal(await examiner.evaluate('window.__copiedPatientLink'), inviteUrl);

  await unauthorized.navigate(`/medcases/session/patient/?code=${info.code}`);
  await unauthorized.waitFor("document.body.innerText.includes('Patienteneinladung ist ungültig')");
  assert.equal(await unauthorized.evaluate("document.body.innerText.includes('Deine Rolle')"), false);
  await patient.navigate(`${site}/medcases/session/patient/?code=${info.code}#access=invalid`);
  await patient.waitFor("document.body.innerText.includes('Patienteneinladung ist ungültig')");
  assert.equal(await patient.evaluate('location.hash'), '');
  await patient.navigate(`${site}/medcases/session/patient/?code=K7P4M0#access=${info.stored.patientCapability}`);
  await patient.waitFor("document.body.innerText.includes('Patienteneinladung ist ungültig')");
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1')"), null);
  await patient.navigate(`${site}/medcases/session/patient/?code=ZZZZZZ#access=${info.stored.patientCapability}`);
  await patient.waitFor("document.body.innerText.includes('Patienteneinladung ist ungültig')");
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1')"), null);
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.v1')"), null);

  await patient.navigate(`${site}/medcases/session/patient/?code=${info.code}#access=${'a'.repeat(43)}`);
  await patient.waitFor("document.body.innerText.includes('Patienteneinladung ist ungültig')");
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.v1')"), null);
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1')"), null);

  const expiredBeforeJoin = await createSession(1000);
  await delay(1200);
  await patient.navigate(`${site}/medcases/session/patient/?code=${expiredBeforeJoin.joinCode}#access=${expiredBeforeJoin.patientCapability}`);
  await patient.waitFor("document.body.innerText.includes('Patienteneinladung ist ungültig')");
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1')"), null);

  await networkFailure.command('Page.addScriptToEvaluateOnNewDocument', { source: `
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => new URL(input, location.href).pathname === '/sessions/join'
      ? Promise.reject(new TypeError('Network unavailable')) : originalFetch(input, init);
  ` });
  await networkFailure.navigate(inviteUrl);
  await networkFailure.waitFor("document.body.innerText.includes('Live-Dienst ist derzeit nicht erreichbar')");
  assert.equal(await networkFailure.evaluate('location.hash'), '');
  assert.ok(await networkFailure.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1') !== null"));
  await networkFailure.command('Page.reload', { ignoreCache: true });
  await networkFailure.waitFor("document.body.innerText.includes('Live-Dienst ist derzeit nicht erreichbar')");
  assert.ok(await networkFailure.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1') !== null"));

  await patient.command('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__initialHashLength = location.hash.length;' });
  await patient.navigate(inviteUrl);
  try {
    await patient.waitFor("location.pathname === '/medcases/session/patient/case-2bf98914ed/'", 15_000);
  } catch (error) {
    const diagnosis = await patient.evaluate(`(async () => ({
      path: location.pathname, search: location.search, initialHashLength: window.__initialHashLength,
      text: document.querySelector('.osce')?.innerText,
      stored: !!sessionStorage.getItem('mednerds.medcases.realtime.patient.v1'),
      resolveStatus: (await fetch('http://127.0.0.1:8787/sessions/join', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ joinCode: ${JSON.stringify(info.code)} }) })).status,
    }))()`);
    throw new Error(`Patient entry did not redirect: ${JSON.stringify(diagnosis)}`, { cause: error });
  }
  await patient.waitFor("document.body.innerText.includes('Live-Session verbunden') && document.body.innerText.includes('Deine Rolle')");
  assert.equal(await patient.evaluate('location.hash'), '');
  assert.equal(await patient.evaluate("JSON.parse(sessionStorage.getItem('mednerds.medcases.realtime.patient.v1')).patientCapability"), info.stored.patientCapability);
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.invite.v1')"), null);
  assert.equal(await patient.evaluate("document.querySelector('.osce-timer__display') === null"), true);
  assert.equal(await patient.evaluate("document.querySelectorAll('.osce-material').length"), 0);
  assert.equal(await patient.evaluate("document.body.innerText.includes('Kernproblem') || document.body.innerText.includes('Checkliste')"), false);

  await display.navigate(`/medcases/session/display/?code=${info.code}`);
  await display.waitFor("document.querySelector('.osce-display__connection')?.textContent === 'Verbunden'");
  assert.equal(await display.evaluate("document.body.innerText.includes('Vitalparameter')"), false);
  await examiner.waitFor("[...document.querySelectorAll('.osce-live-materials__row')].some(row => row.textContent.includes('Vitalparameter'))");
  await examiner.click('.osce-live-materials button', 'Freigeben');
  await examiner.waitFor("document.querySelector('.osce-live-materials__row')?.textContent.includes('Freigegeben')");
  await patient.waitFor("document.querySelector('.osce-material')?.textContent.includes('Vitalparameter')");
  assert.equal(await display.evaluate("document.body.innerText.includes('Vitalparameter')"), false);
  await patient.command('Page.reload', { ignoreCache: true });
  await patient.waitFor("document.body.innerText.includes('Live-Session verbunden') && document.querySelector('.osce-material')?.textContent.includes('Vitalparameter')");
  assert.equal(await patient.evaluate('location.hash'), '');

  await examiner.click('.osce-timer button', 'Timer starten');
  await display.waitFor("document.querySelector('.osce-display__state')?.textContent === 'Läuft'");
  await examiner.click('.osce-timer button', 'Pausieren');
  await display.waitFor("document.querySelector('.osce-display__state')?.textContent === 'Pausiert'");
  await examiner.click('.osce-timer button', 'Fortsetzen');
  await display.waitFor("document.querySelector('.osce-display__state')?.textContent === 'Läuft'");
  assert.equal(await patient.evaluate("document.querySelector('.osce-timer__display') === null"), true);
  assert.equal(await patient.evaluate("document.querySelector('.osce-material')?.textContent.includes('Vitalparameter')"), true);

  for (const current of [examiner, patient]) {
    for (const width of [160, 320, 375, 768]) {
      await current.command('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
      for (const theme of ['dark', 'light']) {
        await current.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        const size = await current.evaluate('({ viewport: innerWidth, page: document.documentElement.scrollWidth })');
        assert.ok(size.page <= size.viewport + 1, `${width}px ${theme}: horizontal overflow`);
      }
    }
  }
  const offlineSession = await createSession();
  await patient.navigate(`${site}/medcases/session/patient/?code=${offlineSession.joinCode}#access=${offlineSession.patientCapability}`);
  await patient.waitFor("location.pathname === '/medcases/session/patient/case-2bf98914ed/' && document.body.innerText.includes('Live-Session verbunden')");
  assert.equal(await patient.evaluate("document.querySelectorAll('.osce-material').length"), 0);
  await patient.command('Page.navigate', { url: 'about:blank' });
  await releaseAsExaminer(offlineSession, 'vitals-1');
  await patient.navigate('/medcases/session/patient/case-2bf98914ed/');
  await patient.waitFor("document.body.innerText.includes('Live-Session verbunden') && document.querySelector('.osce-material')?.textContent.includes('Vitalparameter')");

  const expiringSession = await createSession(3000);
  await patient.navigate(`${site}/medcases/session/patient/?code=${expiringSession.joinCode}#access=${expiringSession.patientCapability}`);
  await patient.waitFor("location.pathname === '/medcases/session/patient/case-2bf98914ed/' && document.body.innerText.includes('Live-Session verbunden')");
  await patient.waitFor("document.body.innerText.includes('Diese Live-Session ist abgelaufen.')", 10_000);
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.v1')"), null);
  const mismatched = await createSession(undefined, 'case-ffffffffee');
  const storedMismatch = { version: 1, sessionId: mismatched.sessionId, joinCode: mismatched.joinCode,
    patientCapability: mismatched.patientCapability, expiresAtMs: mismatched.expiresAtMs };
  await patient.evaluate(`sessionStorage.setItem('mednerds.medcases.realtime.patient.v1', ${JSON.stringify(JSON.stringify(storedMismatch))})`);
  await patient.navigate('/medcases/session/patient/case-2bf98914ed/');
  await patient.waitFor("document.body.innerText.includes('anderen Fall')");
  assert.equal(await patient.evaluate("document.querySelector('.osce-intro') === null"), true);
  assert.equal(await patient.evaluate("sessionStorage.getItem('mednerds.medcases.realtime.patient.v1')"), null);
  console.log('Examiner, patient and display: invite, release, reload, offline snapshot, expiry, timer and responsive themes passed.');
} finally {
  await Promise.all([examiner, patient, display, unauthorized, networkFailure].map((current) => current.close()));
}
