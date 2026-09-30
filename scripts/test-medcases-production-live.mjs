import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

const BASE = 'http://127.0.0.1:8787';
const MODE = process.argv[2];
const PRODUCTION_ORIGIN = 'https://mednerds.ch';
const LOCAL_ORIGINS = ['http://localhost:4321', 'http://127.0.0.1:4321'];
const BODY = { caseId: 'case-2bf98914ed', durationSeconds: 780, warningRemainingSeconds: 120 };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path, body, origin, extraHeaders = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json',
      ...(origin ? { Origin: origin } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  });
}

/** Small native WebSocket test client, so production Origin tests need no test dependency. */
async function upgrade(sessionId, origin, query = '') {
  const socket = createConnection(8787, '127.0.0.1');
  const messages = [];
  let buffer = Buffer.alloc(0);
  let status = 0;
  let complete = false;
  const ready = new Promise((resolve, reject) => {
    socket.setTimeout(5000, () => reject(new Error('WebSocket handshake timed out')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write([
      `GET /sessions/${sessionId}/connect${query} HTTP/1.1`,
      'Host: 127.0.0.1:8787', 'Connection: Upgrade', 'Upgrade: websocket',
      'Sec-WebSocket-Version: 13', `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
      ...(origin ? [`Origin: ${origin}`] : []), '', '',
    ].join('\r\n')));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!complete) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        status = Number(/^HTTP\/1\.1 (\d{3})/.exec(buffer.toString('utf8', 0, end))?.[1]);
        buffer = buffer.subarray(end + 4);
        complete = true;
        socket.setTimeout(0);
        resolve(status);
        if (status !== 101) { socket.destroy(); return; }
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        let length = buffer[1] & 127;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + length) return;
        if (opcode === 1) messages.push(JSON.parse(buffer.toString('utf8', offset, offset + length)));
        buffer = buffer.subarray(offset + length);
      }
    });
  });
  const result = await ready;
  const client = {
    status: result,
    messages,
    send(message) {
      const body = Buffer.from(JSON.stringify(message));
      const mask = randomBytes(4);
      const header = body.length < 126 ? Buffer.alloc(6) : Buffer.alloc(8);
      header[0] = 0x81;
      if (body.length < 126) header[1] = 0x80 | body.length;
      else { header[1] = 0x80 | 126; header.writeUInt16BE(body.length, 2); }
      mask.copy(header, header.length - 4);
      const masked = Buffer.from(body);
      for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
      socket.write(Buffer.concat([header, masked]));
    },
    async take(type) {
      for (let i = 0; i < 300; i++) {
        const index = messages.findIndex((message) => message.type === type);
        if (index >= 0) return messages.splice(index, 1)[0];
        await delay(10);
      }
      throw new Error(`No ${type}; queued ${messages.map((message) => message.type).join(', ')}`);
    },
    close() { socket.destroy(); },
  };
  return client;
}

assert.deepEqual(await (await fetch(`${BASE}/health`)).json(), { ok: true });

if (MODE === 'production') {
  const createdAt = Date.now();
  const created = await post('/sessions', BODY, PRODUCTION_ORIGIN);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
  const session = await created.json();
  assert.ok(session.expiresAtMs >= createdAt + 3_590_000 && session.expiresAtMs <= Date.now() + 3_610_000);
  assert.equal((await post('/sessions/join', { joinCode: session.joinCode }, PRODUCTION_ORIGIN)).status, 200);
  const preflight = await fetch(`${BASE}/sessions`, { method: 'OPTIONS', headers: { Origin: PRODUCTION_ORIGIN } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), PRODUCTION_ORIGIN);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type');

  for (const path of [`/__dev/sessions/${session.sessionId}/state`,
    `/__dev/join-codes/${session.joinCode}/lookup`, '/__dev/join-codes/AAAAAA/reserve',
    '/__dev/join-codes/AAAAAA/release']) {
    const response = await fetch(`${BASE}${path}`, { method: path.endsWith('/lookup') || path.endsWith('/state') ? 'GET' : 'POST',
      headers: { Origin: PRODUCTION_ORIGIN } });
    assert.equal(response.status, 404, path);
  }
  assert.equal((await post('/sessions', BODY, PRODUCTION_ORIGIN, { 'X-MedNerds-Test-TTL-Ms': '1000' })).status, 400);
  assert.equal((await post('/sessions', { ...BODY, padding: 'x'.repeat(8192) }, PRODUCTION_ORIGIN)).status, 413);

  for (const origin of [undefined, ...LOCAL_ORIGINS, 'http://mednerds.ch', 'https://evil.mednerds.ch',
    'https://mednerds.ch.attacker.example', 'https://mednerds.ch:444']) {
    assert.equal((await post('/sessions/join', { joinCode: session.joinCode }, origin)).status, 403, String(origin));
    assert.equal((await upgrade(session.sessionId, origin)).status, 403, String(origin));
  }

  const sockets = [];
  try {
    const examiner = await upgrade(session.sessionId, PRODUCTION_ORIGIN);
    assert.equal(examiner.status, 101);
    sockets.push(examiner);
    await delay(50);
    assert.equal(examiner.messages.length, 0);
    examiner.send({ type: 'session.authenticate', role: 'examiner', capability: 'a'.repeat(43) });
    assert.equal((await examiner.take('error')).code, 'AUTH_FAILED');
    examiner.send({ type: 'session.authenticate', role: 'examiner', capability: session.examinerCapability });
    assert.equal((await examiner.take('session.snapshot')).state.sessionId, session.sessionId);

    const patient = await upgrade(session.sessionId, PRODUCTION_ORIGIN);
    sockets.push(patient);
    patient.send({ type: 'session.authenticate', role: 'patient', capability: session.patientCapability });
    assert.equal((await patient.take('session.snapshot')).state.caseId, BODY.caseId);
    for (const role of ['display', 'observer']) {
      const client = await upgrade(session.sessionId, PRODUCTION_ORIGIN);
      sockets.push(client);
      client.send({ type: 'session.authenticate', role });
      assert.equal((await client.take('session.snapshot')).state.sessionId, session.sessionId);
      client.send({ type: 'timer.start' });
      assert.equal((await client.take('error')).code, 'FORBIDDEN');
    }
    patient.send({ type: 'material.release', materialId: 'vitals-1' });
    assert.equal((await patient.take('error')).code, 'FORBIDDEN');
    examiner.send({ type: 'timer.start' });
    assert.equal((await examiner.take('timer.started')).state.timer.status, 'running');
    examiner.send({ type: 'material.release', materialId: 'vitals-1' });
    assert.equal((await patient.take('material.released')).materialId, 'vitals-1');
  } finally { for (const socket of sockets) socket.close(); }

  const ip = '198.18.204.14';
  for (let i = 0; i < 10; i++) {
    assert.equal((await post('/sessions', {}, PRODUCTION_ORIGIN, { 'CF-Connecting-IP': ip })).status, 400);
  }
  const limited = await post('/sessions', BODY, PRODUCTION_ORIGIN, { 'CF-Connecting-IP': ip });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
  console.log('Production API, origins, debug isolation, roles, TTL and rate limit passed.');
} else if (MODE === 'development') {
  for (const origin of [undefined, ...LOCAL_ORIGINS]) {
    const created = await post('/sessions', BODY, origin, { 'X-MedNerds-Test-TTL-Ms': '5000' });
    assert.equal(created.status, 201, String(origin));
    const session = await created.json();
    assert.ok(session.expiresAtMs <= Date.now() + 5000);
    assert.equal((await post('/sessions/join', { joinCode: session.joinCode }, origin)).status, 200);
    assert.equal((await fetch(`${BASE}/__dev/sessions/${session.sessionId}/state`,
      origin ? { headers: { Origin: origin } } : undefined)).status, 200);
    const socket = await upgrade(session.sessionId, origin);
    assert.equal(socket.status, 101);
    socket.send({ type: 'session.authenticate', role: 'examiner', capability: session.examinerCapability });
    assert.equal((await socket.take('session.snapshot')).state.sessionId, session.sessionId);
    socket.close();
  }
  assert.equal((await post('/sessions', BODY, PRODUCTION_ORIGIN)).status, 403);
  console.log('Development API, local origins, debug state and test TTL passed.');
} else if (MODE === 'unknown') {
  for (const path of ['/sessions', '/sessions/join', '/__dev/join-codes/AAAAAA/reserve']) {
    assert.equal((await post(path, BODY, PRODUCTION_ORIGIN)).status, 404);
  }
  assert.equal((await fetch(`${BASE}/__dev/sessions/session_${'a'.repeat(32)}/state`,
    { headers: { Origin: PRODUCTION_ORIGIN } })).status, 404);
  assert.equal((await upgrade(`session_${'a'.repeat(32)}`, PRODUCTION_ORIGIN)).status, 404);
  console.log('Unknown environment fails closed.');
} else {
  throw new Error('Choose production, development or unknown.');
}
