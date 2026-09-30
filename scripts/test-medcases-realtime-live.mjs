import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:8787';
const CASE_ID = 'case-2bf98914ed';
const mode = process.argv[2] ?? 'multi-client';
const persistenceFile = process.argv[3] ?? join(tmpdir(), 'mednerds-realtime-persistence.json');
const persistedMaterials = ['vitals-1', ...Array.from({ length: 63 }, (_, index) => `material-${index}`)];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const statePath = (id) => `/__dev/sessions/${id}/state`;

async function create(durationSeconds, warningRemainingSeconds, ttlMs) {
  const response = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ttlMs ? { 'X-MedNerds-Test-TTL-Ms': String(ttlMs) } : {}) },
    body: JSON.stringify({ caseId: CASE_ID, durationSeconds, warningRemainingSeconds }),
  });
  assert.equal(response.status, 201, `Create failed: ${response.status}`);
  const session = await response.json();
  assert.match(session.sessionId, /^session_[a-f0-9]{32}$/);
  assert.match(session.joinCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(session.examinerCapability, /^[A-Za-z0-9_-]{43}$/);
  assert.match(session.patientCapability, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(session.patientCapability, session.examinerCapability);
  assert.ok(Number.isSafeInteger(session.expiresAtMs));
  return session;
}

async function resolveCode(joinCode) {
  const response = await fetch(`${BASE}/sessions/join`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ joinCode }),
  });
  return { status: response.status, body: await response.json() };
}

async function debugCode(code, action, body) {
  const response = await fetch(`${BASE}/__dev/join-codes/${code}/${action}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function stateFor(id) {
  const response = await fetch(`${BASE}${statePath(id)}`);
  assert.equal(response.status, 200, `State request failed: ${response.status}`);
  return (await response.json()).state;
}

class Client {
  constructor(id, query = '') {
    this.messages = [];
    this.socket = new WebSocket(`${BASE.replace('http:', 'ws:')}/sessions/${id}/connect${query}`);
    this.socket.addEventListener('message', (event) => this.messages.push(JSON.parse(event.data)));
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    return this;
  }
  send(type, extra = {}) { this.socket.send(JSON.stringify({ type, ...extra })); }
  async authenticate(role, capability) {
    this.send('session.authenticate', role === 'examiner' || role === 'patient' ? { role, capability } : { role });
    return this.take('session.snapshot');
  }
  async take(type, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex((message) => message.type === type);
      if (index !== -1) return this.messages.splice(index, 1)[0];
      await delay(15);
    }
    throw new Error(`No ${type}; queued: ${this.messages.map(({ type: queued }) => queued).join(', ')}`);
  }
  close() { this.socket.close(); }
}

if (mode === 'persistence-create') {
  const session = await create(600, 60);
  const examiner = await new Client(session.sessionId).open();
  await examiner.authenticate('examiner', session.examinerCapability);
  examiner.send('timer.start');
  await examiner.take('timer.started');
  examiner.send('timer.pause');
  await examiner.take('timer.paused');
  examiner.send('material.release', { materialId: 'vitals-1' });
  await examiner.take('material.released');
  for (const materialId of persistedMaterials.slice(1)) {
    examiner.send('material.release', { materialId });
    await examiner.take('material.released');
  }
  examiner.close();
  assert.equal((await stateFor(session.sessionId)).timer.status, 'paused');
  assert.deepEqual((await stateFor(session.sessionId)).releasedMaterialIds, persistedMaterials);
  await writeFile(persistenceFile, JSON.stringify(session), { mode: 0o600 });
  console.log(`Persistence fixture outside repository: ${persistenceFile}`);
} else if (mode === 'persistence-check') {
  const session = JSON.parse(await readFile(persistenceFile, 'utf8'));
  const state = await stateFor(session.sessionId);
  assert.equal(state.timer.status, 'paused');
  assert.ok(state.timer.remainingAtPauseMs > 0);
  assert.deepEqual(state.releasedMaterialIds, persistedMaterials);
  assert.deepEqual((await resolveCode(session.joinCode.toLowerCase())).body, {
    sessionId: session.sessionId, expiresAtMs: session.expiresAtMs,
  });
  const examiner = await new Client(session.sessionId).open();
  assert.deepEqual((await examiner.authenticate('examiner', session.examinerCapability)).state, state);
  const patient = await new Client(session.sessionId).open();
  const patientSnapshot = await patient.authenticate('patient', session.patientCapability);
  assert.deepEqual(patientSnapshot.state.releasedMaterialIds, persistedMaterials);
  assert.equal('timer' in patientSnapshot.state, false);
  examiner.send('material.release', { materialId: 'material-64' });
  assert.equal((await examiner.take('error')).code, 'RESOURCE_LIMIT_REACHED');
  examiner.send('material.release', { materialId: 'vitals-1' });
  assert.deepEqual((await examiner.take('material.released')).state.releasedMaterialIds, persistedMaterials);
  examiner.send('timer.resume');
  assert.equal((await examiner.take('timer.resumed')).state.timer.status, 'running');
  examiner.close();
  patient.close();
  await unlink(persistenceFile);
  console.log('Session, join code, patient auth and material release survived a local Wrangler restart.');
} else {
  assert.deepEqual(await (await fetch(`${BASE}/health`)).json(), { ok: true });
  assert.equal((await fetch(`${BASE}/sessions`, { method: 'POST', headers: { Origin: 'https://example.org' } })).status, 403);
  assert.equal((await fetch(`${BASE}/sessions/join`, { method: 'POST', headers: { Origin: 'https://example.org' } })).status, 403);
  assert.equal((await fetch(`${BASE}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  assert.equal((await resolveCode('ABCDEF')).status, 404);
  assert.equal((await resolveCode('ABC0EF')).status, 404);

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const raceCode = Array.from(randomBytes(6), (byte) => alphabet[byte & 31]).join('');
  const raceIds = [
    `session_${randomBytes(16).toString('hex')}`,
    `session_${randomBytes(16).toString('hex')}`,
  ];
  const expiresAtMs = Date.now() + 1500;
  const reservations = await Promise.all(raceIds.map((sessionId) => debugCode(raceCode, 'reserve', {
    version: 1, sessionId, expiresAtMs,
  })));
  assert.deepEqual(reservations.map(({ status }) => status).sort(), [201, 409]);
  const winner = (await debugCode(raceCode, 'lookup')).body.sessionId;
  assert.ok(raceIds.includes(winner));
  const loser = raceIds.find((id) => id !== winner);
  assert.equal((await debugCode(raceCode, 'release', { sessionId: loser })).body.released, false);
  assert.equal((await debugCode(raceCode, 'lookup')).body.sessionId, winner);
  await delay(1750);
  assert.equal((await debugCode(raceCode, 'lookup')).status, 404);
  assert.equal((await debugCode(raceCode, 'reserve', {
    version: 1, sessionId: loser, expiresAtMs: Date.now() + 5000,
  })).status, 201);
  assert.equal((await debugCode(raceCode, 'release', { sessionId: winner })).body.released, false);
  assert.equal((await debugCode(raceCode, 'lookup')).body.sessionId, loser);
  assert.equal((await debugCode(raceCode, 'release', { sessionId: loser })).body.released, true);

  const session = await create(4, 2);
  const other = await create(600, 60);
  assert.notEqual(session.sessionId, other.sessionId);
  assert.notEqual(session.joinCode, other.joinCode);
  assert.notEqual(session.examinerCapability, other.examinerCapability);
  assert.notEqual(session.patientCapability, other.patientCapability);
  assert.equal((await stateFor(other.sessionId)).timer.status, 'ready');
  assert.deepEqual((await resolveCode(session.joinCode.toLowerCase())).body, {
    sessionId: session.sessionId, expiresAtMs: session.expiresAtMs,
  });

  const examiner = await new Client(session.sessionId).open();
  const observerA = await new Client(session.sessionId).open();
  const observerB = await new Client(session.sessionId).open();
  const displays = await Promise.all(Array.from({ length: 3 }, async () => new Client(session.sessionId).open()));
  const roleQuery = await new Client(session.sessionId, '?role=examiner').open();
  for (const client of [examiner, observerA, observerB, roleQuery, ...displays]) {
    assert.ok(!client.socket.url.includes(session.examinerCapability));
  }
  await delay(150);
  assert.ok([examiner, observerA, observerB, roleQuery, ...displays].every((client) => client.messages.length === 0));
  roleQuery.send('timer.start');
  assert.equal((await roleQuery.take('error')).code, 'AUTH_REQUIRED');
  assert.equal((await stateFor(session.sessionId)).timer.status, 'ready');
  roleQuery.send('session.authenticate', { role: 'examiner', capability: other.examinerCapability });
  assert.equal((await roleQuery.take('error')).code, 'AUTH_FAILED');
  roleQuery.send('timer.start');
  assert.equal((await roleQuery.take('error')).code, 'AUTH_REQUIRED');
  assert.equal((await observerA.authenticate('observer')).state.timer.status, 'ready');
  assert.equal((await observerB.authenticate('observer')).state.timer.status, 'ready');
  for (const display of displays.slice(0, 2)) {
    assert.equal((await display.authenticate('display')).state.timer.status, 'ready');
    display.send('time.ping', { clientSentAtMs: 456 });
    assert.equal((await display.take('time.pong')).clientSentAtMs, 456);
    for (const command of ['timer.start', 'timer.pause', 'timer.resume', 'timer.reset']) {
      display.send(command);
      assert.equal((await display.take('error')).code, 'FORBIDDEN');
    }
  }
  assert.equal((await examiner.authenticate('examiner', session.examinerCapability)).state.timer.status, 'ready');
  await roleQuery.authenticate('observer');
  roleQuery.send('timer.start');
  assert.equal((await roleQuery.take('error')).code, 'FORBIDDEN');
  const publicState = JSON.stringify(await stateFor(session.sessionId));
  assert.ok(!publicState.includes(session.examinerCapability) && !publicState.includes('examinerCapabilityHash')
    && !publicState.includes(session.patientCapability) && !publicState.includes('patientCapabilityHash'));

  examiner.send('timer.start');
  const clients = [examiner, observerA, observerB, roleQuery, ...displays.slice(0, 2)];
  const started = await Promise.all(clients.map((client) => client.take('timer.started')));
  assert.equal(new Set(started.map(({ state }) => state.timer.endsAtMs)).size, 1);
  assert.ok(!JSON.stringify(started).includes(session.examinerCapability));
  assert.equal((await stateFor(other.sessionId)).timer.status, 'ready');
  roleQuery.close();
  const lateObserver = await new Client(session.sessionId).open();
  assert.equal((await lateObserver.authenticate('observer')).state.timer.endsAtMs, started[0].state.timer.endsAtMs);
  assert.equal((await displays[2].authenticate('display')).state.timer.endsAtMs, started[0].state.timer.endsAtMs);
  observerA.send('timer.pause');
  assert.equal((await observerA.take('error')).code, 'FORBIDDEN');
  observerA.socket.send('{');
  assert.equal((await observerA.take('error')).code, 'INVALID_MESSAGE');
  observerA.send('timer.warp');
  assert.equal((await observerA.take('error')).code, 'UNKNOWN_MESSAGE_TYPE');
  observerA.send('time.ping', { clientSentAtMs: 123 });
  assert.equal((await observerA.take('time.pong')).clientSentAtMs, 123);
  const all = [...clients.filter((client) => client !== roleQuery), lateObserver, displays[2]];
  examiner.send('timer.pause');
  assert.equal(new Set((await Promise.all(all.map((client) => client.take('timer.paused')))).map(({ state }) => state.timer.remainingAtPauseMs)).size, 1);
  examiner.send('timer.resume');
  assert.equal(new Set((await Promise.all(all.map((client) => client.take('timer.resumed')))).map(({ state }) => state.timer.endsAtMs)).size, 1);
  examiner.send('timer.reset');
  assert.ok((await Promise.all(all.map((client) => client.take('timer.reset')))).every(({ state }) => state.timer.status === 'ready'));
  examiner.send('timer.start');
  await Promise.all(all.map((client) => client.take('timer.started')));
  await Promise.all(all.map((client) => client.take('timer.warning', 6000)));
  await Promise.all(all.map((client) => client.take('timer.ended', 6000)));
  assert.equal((await stateFor(session.sessionId)).timer.status, 'ended');
  await delay(250);
  assert.ok(all.every((client) => !client.messages.some(({ type }) => type === 'timer.warning' || type === 'timer.ended')));
  all.forEach((client) => client.close());

  const materialSession = await create(600, 60);
  const materialExaminer = await new Client(materialSession.sessionId).open();
  const materialPatient = await new Client(materialSession.sessionId).open();
  const materialDisplay = await new Client(materialSession.sessionId).open();
  const materialObserver = await new Client(materialSession.sessionId).open();
  materialPatient.send('material.release', { materialId: 'vitals-1' });
  assert.equal((await materialPatient.take('error')).code, 'AUTH_REQUIRED');
  materialPatient.send('session.authenticate', { role: 'patient' });
  assert.equal((await materialPatient.take('error')).code, 'INVALID_MESSAGE');
  materialPatient.send('session.authenticate', { role: 'patient', capability: session.patientCapability });
  assert.equal((await materialPatient.take('error')).code, 'AUTH_FAILED');
  const patientSnapshot = await materialPatient.authenticate('patient', materialSession.patientCapability);
  assert.equal(patientSnapshot.state.caseId, CASE_ID);
  assert.deepEqual(patientSnapshot.state.releasedMaterialIds, []);
  assert.equal('timer' in patientSnapshot.state, false);
  const displaySnapshot = await materialDisplay.authenticate('display');
  assert.equal(displaySnapshot.state.timer.status, 'ready');
  assert.equal('releasedMaterialIds' in displaySnapshot.state, false);
  assert.equal('caseId' in displaySnapshot.state, false);
  assert.deepEqual((await materialObserver.authenticate('observer')).state.releasedMaterialIds, []);
  assert.deepEqual((await materialExaminer.authenticate('examiner', materialSession.examinerCapability)).state.releasedMaterialIds, []);
  for (const client of [materialPatient, materialDisplay, materialObserver]) {
    client.send('material.release', { materialId: 'vitals-1' });
    assert.equal((await client.take('error')).code, 'FORBIDDEN');
  }
  materialExaminer.send('material.release', { materialId: '../bad' });
  assert.equal((await materialExaminer.take('error')).code, 'INVALID_MESSAGE');
  materialExaminer.send('material.release', { materialId: 'vitals-1' });
  const firstRelease = await materialPatient.take('material.released');
  assert.equal(firstRelease.materialId, 'vitals-1');
  assert.deepEqual(firstRelease.state.releasedMaterialIds, ['vitals-1']);
  assert.equal('timer' in firstRelease.state, false);
  await materialExaminer.take('material.released');
  await materialObserver.take('material.released');
  assert.equal(materialDisplay.messages.some(({ type }) => type === 'material.released'), false);
  assert.deepEqual((await stateFor(materialSession.sessionId)).releasedMaterialIds, ['vitals-1']);
  materialExaminer.send('material.release', { materialId: 'vitals-1' });
  assert.deepEqual((await materialExaminer.take('material.released')).state.releasedMaterialIds, ['vitals-1']);
  assert.equal(materialPatient.messages.some(({ type }) => type === 'material.released'), false);
  materialPatient.close();
  materialExaminer.send('material.release', { materialId: 'demo-2' });
  await materialExaminer.take('material.released');
  await materialObserver.take('material.released');
  const returningPatient = await new Client(materialSession.sessionId).open();
  assert.deepEqual((await returningPatient.authenticate('patient', materialSession.patientCapability)).state.releasedMaterialIds,
    ['vitals-1', 'demo-2']);
  materialExaminer.send('timer.start');
  await materialExaminer.take('timer.started');
  materialExaminer.send('timer.reset');
  assert.deepEqual((await materialExaminer.take('timer.reset')).state.releasedMaterialIds, ['vitals-1', 'demo-2']);
  for (const client of [materialExaminer, materialDisplay, materialObserver, returningPatient]) client.close();

  const expiring = await create(30, 5, 1500);
  const expiringExaminer = await new Client(expiring.sessionId).open();
  const expiringDisplay = await new Client(expiring.sessionId).open();
  const expiringPatient = await new Client(expiring.sessionId).open();
  await expiringExaminer.authenticate('examiner', expiring.examinerCapability);
  await expiringDisplay.authenticate('display');
  await expiringPatient.authenticate('patient', expiring.patientCapability);
  assert.equal((await expiringDisplay.take('session.expired', 5000)).type, 'session.expired');
  assert.equal((await expiringPatient.take('session.expired', 5000)).type, 'session.expired');
  await delay(1750);
  assert.equal((await resolveCode(expiring.joinCode)).status, 404);
  assert.notEqual((await fetch(`${BASE}${statePath(expiring.sessionId)}`)).status, 200);
  await assert.rejects(new Client(expiring.sessionId).open());
  expiringExaminer.close();
  expiringDisplay.close();
  expiringPatient.close();
  console.log('Local create/join/auth, patient capability, material release, three displays, isolation and expiry checks passed.');
}
