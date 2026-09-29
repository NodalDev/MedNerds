import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const BASE = 'http://127.0.0.1:8787';
const CASE_ID = 'case-2bf98914ed';
const mode = process.argv[2] ?? 'multi-client';
const makeId = () => `session_${randomBytes(10).toString('hex')}`;
const pathFor = (id) => `/__dev/sessions/${id}`;

async function initialize(id, durationSeconds, warningRemainingSeconds) {
  const response = await fetch(`${BASE}${pathFor(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: id, caseId: CASE_ID, durationSeconds, warningRemainingSeconds }),
  });
  assert.equal(response.status, 201, await response.text());
}

async function stateFor(id) {
  const response = await fetch(`${BASE}${pathFor(id)}/state`);
  if (response.status !== 200) throw new Error(`State request failed: ${response.status} ${await response.text()}`);
  return (await response.json()).state;
}

class Client {
  constructor(id, role) {
    this.messages = [];
    this.socket = new WebSocket(`${BASE.replace('http:', 'ws:')}${pathFor(id)}/connect?role=${role}`);
    this.socket.addEventListener('message', (event) => this.messages.push(JSON.parse(event.data)));
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    return this;
  }

  send(type, extra = {}) {
    this.socket.send(JSON.stringify({ type, ...extra }));
  }

  async take(type, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex((message) => message.type === type);
      if (index !== -1) return this.messages.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`No ${type} message received; queued: ${this.messages.map(({ type: queued }) => queued).join(', ')}`);
  }

  close() {
    this.socket.close();
  }
}

if (mode === 'persistence-create') {
  const id = makeId();
  await initialize(id, 600, 60);
  const examiner = await new Client(id, 'examiner').open();
  await examiner.take('session.snapshot');
  examiner.send('timer.start');
  await examiner.take('timer.started');
  examiner.send('timer.pause');
  await examiner.take('timer.paused');
  examiner.close();
  assert.equal((await stateFor(id)).timer.status, 'paused');
  console.log(id);
} else if (mode === 'persistence-check') {
  const id = process.argv[3];
  assert.match(id ?? '', /^session_[a-f0-9]{20}$/);
  const state = await stateFor(id);
  assert.equal(state.timer.status, 'paused');
  assert.ok(state.timer.remainingAtPauseMs > 0);
  const observer = await new Client(id, 'observer').open();
  const snapshot = await observer.take('session.snapshot');
  assert.deepEqual(snapshot.state, state);
  observer.close();
  console.log('Persistent state survived local Wrangler restart.');
} else {
  assert.deepEqual(await (await fetch(`${BASE}/health`)).json(), { ok: true });
  const id = makeId();
  assert.equal((await fetch(`${BASE}${pathFor(id)}/state`, { headers: { Origin: 'https://example.org' } })).status, 403);
  assert.equal((await fetch(`${BASE}${pathFor(id)}/state`)).status, 404);
  await initialize(id, 4, 2);
  const otherId = makeId();
  await initialize(otherId, 600, 60);
  assert.equal((await stateFor(otherId)).timer.status, 'ready');
  assert.equal((await fetch(`${BASE}${pathFor(id)}`, {
    method: 'POST',
    body: JSON.stringify({ sessionId: id, caseId: CASE_ID, durationSeconds: 4, warningRemainingSeconds: 2 }),
  })).status, 409);
  const examiner = await new Client(id, 'examiner').open();
  const observerA = await new Client(id, 'observer').open();
  const observerB = await new Client(id, 'observer').open();
  assert.equal((await examiner.take('session.snapshot')).state.timer.status, 'ready');
  assert.equal((await observerA.take('session.snapshot')).state.timer.status, 'ready');
  assert.equal((await observerB.take('session.snapshot')).state.timer.status, 'ready');

  examiner.send('timer.start');
  const started = await Promise.all([examiner, observerA, observerB].map((client) => client.take('timer.started')));
  assert.equal(new Set(started.map((message) => message.state.timer.startedAtMs)).size, 1);
  assert.equal(new Set(started.map((message) => message.state.timer.endsAtMs)).size, 1);
  assert.equal((await stateFor(otherId)).timer.status, 'ready');

  const lateObserver = await new Client(id, 'observer').open();
  assert.equal((await lateObserver.take('session.snapshot')).state.timer.endsAtMs, started[0].state.timer.endsAtMs);
  observerA.send('timer.pause');
  assert.equal((await observerA.take('error')).code, 'FORBIDDEN');
  observerA.socket.send('{');
  assert.equal((await observerA.take('error')).code, 'INVALID_MESSAGE');
  observerA.send('timer.warp');
  assert.equal((await observerA.take('error')).code, 'UNKNOWN_MESSAGE_TYPE');
  observerA.send('time.ping', { clientSentAtMs: 123 });
  const pong = await observerA.take('time.pong');
  assert.equal(pong.clientSentAtMs, 123);
  assert.ok(Number.isSafeInteger(pong.serverNowMs));

  examiner.send('timer.pause');
  const paused = await Promise.all([examiner, observerA, observerB, lateObserver].map((client) => client.take('timer.paused')));
  assert.equal(new Set(paused.map((message) => message.state.timer.remainingAtPauseMs)).size, 1);
  assert.equal(paused[0].state.timer.status, 'paused');
  examiner.send('timer.resume');
  const resumed = await Promise.all([examiner, observerA, observerB, lateObserver].map((client) => client.take('timer.resumed')));
  assert.equal(new Set(resumed.map((message) => message.state.timer.endsAtMs)).size, 1);
  examiner.send('timer.reset');
  const reset = await Promise.all([examiner, observerA, observerB, lateObserver].map((client) => client.take('timer.reset')));
  assert.ok(reset.every((message) => message.state.timer.status === 'ready'));

  examiner.send('timer.start');
  await Promise.all([examiner, observerA, observerB, lateObserver].map((client) => client.take('timer.started')));
  await Promise.all([examiner, observerA, observerB, lateObserver].map((client) => client.take('timer.warning', 6000)));
  await Promise.all([examiner, observerA, observerB, lateObserver].map((client) => client.take('timer.ended', 6000)));
  assert.equal((await stateFor(id)).timer.status, 'ended');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok([examiner, observerA, observerB, lateObserver].every((client) => !client.messages.some(({ type }) => type === 'timer.warning' || type === 'timer.ended')));

  for (const client of [examiner, observerA, observerB, lateObserver]) client.close();
  console.log('Local Durable Object multi-client checks passed.');
}
