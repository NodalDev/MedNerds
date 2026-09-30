import assert from 'node:assert/strict';

// Run with local Astro (4321), development Worker (8787), and Chrome CDP (9224).
const cdp = 'http://127.0.0.1:9224';
const site = 'http://localhost:4321';
const caseId = 'case-2bf98914ed';
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
async function waitFor(expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return; } catch { /* Navigation replaces the execution context. */ }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function navigate(path) {
  await command('Page.navigate', { url: new URL(path, site).toString() });
  await waitFor("document.readyState === 'complete' && document.querySelector('.osce') !== null");
}
async function createSession(ttlMs) {
  const response = await fetch('http://127.0.0.1:8787/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ttlMs ? { 'X-MedNerds-Test-TTL-Ms': String(ttlMs) } : {}) },
    body: JSON.stringify({ caseId, durationSeconds: 780, warningRemainingSeconds: 120 }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

try {
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__candidateWebSockets = 0; const NativeSocket = window.WebSocket; window.WebSocket = class extends NativeSocket { constructor(...args) { if (String(args[0]).includes(":8787")) window.__candidateWebSockets++; super(...args); } };' });
  await navigate('/medcases/');
  assert.equal(await evaluate("document.body.innerText.includes('Akuter Thoraxschmerz')"), false);
  assert.equal(await evaluate("document.querySelector('form[action=\"/medcases/session/candidate/\"]') !== null"), true);
  await navigate('/medcases/session/candidate/?code=ZZZZZZ');
  await waitFor("document.body.innerText.includes('Diese Session ist nicht verfügbar.')");
  assert.equal(await evaluate('window.__candidateWebSockets'), 0);
  assert.equal(await evaluate("document.body.innerText.includes('Akuter Thoraxschmerz')"), false);

  const expired = await createSession(1000);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await navigate(`/medcases/session/candidate/?code=${expired.joinCode}`);
  await waitFor("document.body.innerText.includes('Diese Session ist nicht verfügbar.')");
  assert.equal(await evaluate('window.__candidateWebSockets'), 0);

  const active = await createSession();
  await navigate(`/medcases/session/candidate/?code=${active.joinCode.toLowerCase()}`);
  await waitFor(`location.pathname === '/medcases/osce/${caseId}/candidate/'`);
  assert.equal(await evaluate("document.body.innerText.includes('Akuter Thoraxschmerz')"), false);
  assert.equal(await evaluate("document.body.innerText.includes('Ausgangssituation')"), true);
  assert.equal(await evaluate('window.__candidateWebSockets'), 0);
  for (const width of [320, 768, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 600 });
    for (const theme of ['dark', 'light']) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      const size = await evaluate('({ viewport: innerWidth, page: document.documentElement.scrollWidth })');
      assert.ok(size.page <= size.viewport + 1, `${width}px ${theme}: horizontal overflow`);
    }
  }
  console.log('Candidate join browser checks passed: neutral landing, invalid/expired codes, active redirect, no WebSocket, responsive themes.');
} finally {
  socket.close();
  await fetch(`${cdp}/json/close/${target.id}`).catch(() => {});
}
