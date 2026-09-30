import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

const BASE = 'http://127.0.0.1:8787';
const CASE_ID = 'case-2bf98914ed';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomTestIp = () => {
  const [third, fourth] = randomBytes(2);
  return `198.18.${third}.${fourth}`;
};
const requestBody = { caseId: CASE_ID, durationSeconds: 780, warningRemainingSeconds: 120 };

async function post(path, body, ip) {
  return fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

class Client {
  constructor(sessionId) {
    this.messages = [];
    this.socket = new WebSocket(`${BASE.replace('http:', 'ws:')}/sessions/${sessionId}/connect`);
    this.socket.addEventListener('message', (event) => this.messages.push(JSON.parse(event.data)));
    this.closed = new Promise((resolve) => this.socket.addEventListener('close', resolve, { once: true }));
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    return this;
  }
  auth(role, capability) {
    this.socket.send(JSON.stringify(capability
      ? { type: 'session.authenticate', role, capability }
      : { type: 'session.authenticate', role }));
  }
  async take(type) {
    for (let i = 0; i < 200; i++) {
      const index = this.messages.findIndex((message) => message.type === type);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await delay(10);
    }
    throw new Error(`No ${type} message`);
  }
  close() { this.socket.close(); }
}

async function rawUpgrade(sessionId, ip) {
  const key = randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const socket = createConnection(8787, '127.0.0.1');
    let response = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('Upgrade timeout')); });
    socket.on('error', reject);
    socket.on('connect', () => socket.write([
      `GET /sessions/${sessionId}/connect HTTP/1.1`,
      'Host: 127.0.0.1:8787',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${key}`,
      `CF-Connecting-IP: ${ip}`,
      '', '',
    ].join('\r\n')));
    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (!response.includes('\r\n\r\n')) return;
      socket.destroy();
      resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(response)?.[1]));
    });
  });
}

assert.deepEqual(await (await fetch(`${BASE}/health`)).json(), { ok: true });
const createIp = randomTestIp();
const first = await post('/sessions', requestBody, createIp);
assert.equal(first.status, 201);
const session = await first.json();
const stateUrl = `${BASE}/__dev/sessions/${session.sessionId}/state`;
const initialState = (await (await fetch(stateUrl)).json()).state;

for (let i = 0; i < 9; i++) assert.equal((await post('/sessions', {}, createIp)).status, 400);
const createDenied = await post('/sessions', requestBody, createIp);
assert.equal(createDenied.status, 429);
assert.deepEqual(await createDenied.json(), { code: 'RATE_LIMITED' });
assert.equal(createDenied.headers.get('Retry-After'), '60');
assert.deepEqual((await (await fetch(stateUrl)).json()).state, initialState);
console.log('Session creation limit verified.');

const joinIp = randomTestIp();
assert.equal((await post('/sessions/join', { joinCode: session.joinCode }, joinIp)).status, 200);
for (let i = 0; i < 119; i++) {
  assert.equal((await post('/sessions/join', { joinCode: 'ABCDEF' }, joinIp)).status, 404);
}
const joinDenied = await post('/sessions/join', { joinCode: session.joinCode }, joinIp);
assert.equal(joinDenied.status, 429);
assert.deepEqual(await joinDenied.json(), { code: 'RATE_LIMITED' });
assert.equal(joinDenied.headers.get('Retry-After'), '60');
console.log('Join lookup limit verified.');

const bodyIp = randomTestIp();
const oversized = await post('/sessions/join', { joinCode: 'A'.repeat(8192) }, bodyIp);
assert.equal(oversized.status, 413);
assert.deepEqual(await oversized.json(), { code: 'PAYLOAD_TOO_LARGE' });
assert.deepEqual((await (await fetch(stateUrl)).json()).state, initialState);
console.log('HTTP body limit verified.');

for (const [role, cap, count] of [
  ['examiner', session.examinerCapability, 3],
  ['patient', session.patientCapability, 3],
  ['observer', undefined, 3],
  ['display', undefined, 12],
]) {
  const clients = [];
  for (let i = 0; i < count; i++) {
    const client = await new Client(session.sessionId).open();
    client.auth(role, cap);
    assert.equal((await client.take('session.snapshot')).type, 'session.snapshot');
    clients.push(client);
  }
  const denied = await new Client(session.sessionId).open();
  denied.auth(role, cap);
  assert.equal((await denied.take('error')).code, 'CONNECTION_LIMIT_REACHED');
  await denied.closed;
  clients[0].close();
  await clients[0].closed;
  const replacement = await new Client(session.sessionId).open();
  replacement.auth(role, cap);
  assert.equal((await replacement.take('session.snapshot')).type, 'session.snapshot');
  replacement.close();
  for (const client of clients.slice(1)) client.close();
  await Promise.all([replacement.closed, ...clients.slice(1).map((client) => client.closed)]);
  console.log(`${role} connection cap verified.`);
}

const wrong = 'A'.repeat(43);
const sameSocket = await new Client(session.sessionId).open();
for (let i = 0; i < 3; i++) {
  sameSocket.auth('examiner', wrong);
  assert.equal((await sameSocket.take('error')).code, 'AUTH_FAILED');
}
await sameSocket.closed;
for (let i = 0; i < 27; i++) {
  const client = await new Client(session.sessionId).open();
  client.auth('patient', wrong);
  assert.equal((await client.take('error')).code, 'AUTH_FAILED');
  client.close();
}
const authDenied = await new Client(session.sessionId).open();
authDenied.auth('examiner', wrong);
assert.equal((await authDenied.take('error')).code, 'AUTH_FAILED');
await authDenied.closed;
const validReconnect = await new Client(session.sessionId).open();
validReconnect.auth('examiner', session.examinerCapability);
assert.equal((await validReconnect.take('session.snapshot')).type, 'session.snapshot');
validReconnect.close();
await validReconnect.closed;
console.log('Cross-connection authentication limit verified.');

const materialExaminer = await new Client(session.sessionId).open();
materialExaminer.auth('examiner', session.examinerCapability);
assert.equal((await materialExaminer.take('session.snapshot')).type, 'session.snapshot');
for (let i = 0; i < 64; i++) {
  materialExaminer.socket.send(JSON.stringify({ type: 'material.release', materialId: `material-${i}` }));
  assert.equal((await materialExaminer.take('material.released')).materialId, `material-${i}`);
}
materialExaminer.socket.send(JSON.stringify({ type: 'material.release', materialId: 'material-64' }));
assert.equal((await materialExaminer.take('error')).code, 'RESOURCE_LIMIT_REACHED');
materialExaminer.socket.send(JSON.stringify({ type: 'material.release', materialId: 'material-0' }));
assert.equal((await materialExaminer.take('material.released')).materialId, 'material-0');
assert.equal((await (await fetch(stateUrl)).json()).state.releasedMaterialIds.length, 64);
materialExaminer.socket.send(JSON.stringify({ type: 'timer.start' }));
await materialExaminer.take('timer.started');
materialExaminer.socket.send(JSON.stringify({ type: 'timer.reset' }));
assert.equal((await materialExaminer.take('timer.reset')).state.releasedMaterialIds.length, 64);
materialExaminer.close();
await materialExaminer.closed;
console.log('Material cap and idempotent release verified.');

const upgradeIp = randomTestIp();
for (let i = 0; i < 120; i++) {
  assert.equal(await rawUpgrade(session.sessionId, upgradeIp), 101);
  if ((i + 1) % 20 === 0) console.log(`${i + 1} WebSocket upgrades verified.`);
}
assert.equal(await rawUpgrade(session.sessionId, upgradeIp), 429);
assert.equal((await (await fetch(stateUrl)).json()).state.releasedMaterialIds.length, 64);
console.log('6F.2 local endpoint limits, auth attempts, connection caps and body limit passed.');
