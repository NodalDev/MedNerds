import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  clientAbuseKey,
  MAX_CONNECTIONS_BY_ROLE,
  MAX_HTTP_JSON_BODY_BYTES,
  RATE_LIMITS,
  RATE_LIMIT_WINDOW_SECONDS,
  rateLimitAllows,
  readJsonBodyWithLimit,
} from '../workers/medcases-realtime/src/abuse-protection.ts';

const url = 'http://local/sessions';
const jsonRequest = (body, headers = {}) => new Request(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
});

test('separate native limiter bindings use stable configuration and opaque client keys', async () => {
  const config = JSON.parse(await readFile(new URL('../workers/medcases-realtime/wrangler.jsonc', import.meta.url), 'utf8'));
  const expected = [
    ['SESSION_CREATE_RATE_LIMIT', RATE_LIMITS.sessionCreate],
    ['JOIN_LOOKUP_RATE_LIMIT', RATE_LIMITS.joinLookup],
    ['WEBSOCKET_CONNECT_RATE_LIMIT', RATE_LIMITS.websocketConnect],
    ['AUTH_ATTEMPT_RATE_LIMIT', RATE_LIMITS.authFailure],
  ];
  assert.deepEqual(config.ratelimits.map(({ name, simple }) => [name, simple.limit]), expected);
  assert.ok(config.ratelimits.every(({ simple }) => simple.period === RATE_LIMIT_WINDOW_SECONDS));
  assert.equal(new Set(config.ratelimits.map(({ namespace_id }) => namespace_id)).size, expected.length);

  const key = await clientAbuseKey(new Request(url, { headers: { 'CF-Connecting-IP': '198.51.100.1' } }));
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(!key.includes('198.51.100.1'));
  assert.notEqual(key, await clientAbuseKey(new Request(url, { headers: { 'CF-Connecting-IP': '198.51.100.2' } })));
  const calls = [];
  const fake = { async limit(options) { calls.push(options.key); return { success: calls.length < 3 }; } };
  assert.equal(await rateLimitAllows(fake, key), true);
  assert.equal(await rateLimitAllows(fake, key), true);
  assert.equal(await rateLimitAllows(fake, key), false);
  assert.deepEqual(calls, [key, key, key]);
  assert.deepEqual(MAX_CONNECTIONS_BY_ROLE, { examiner: 3, patient: 3, display: 12, observer: 3 });
});

test('bounded JSON reader accepts exactly 8 KiB and rejects the next byte', async () => {
  const body = ' '.repeat(MAX_HTTP_JSON_BODY_BYTES - 2) + '{}';
  assert.deepEqual(await readJsonBodyWithLimit(jsonRequest(body)), { ok: true, value: {} });
  assert.deepEqual(await readJsonBodyWithLimit(jsonRequest(`${body} `)), { ok: false, status: 413 });
  assert.deepEqual(await readJsonBodyWithLimit(jsonRequest('{}', { 'Content-Length': String(MAX_HTTP_JSON_BODY_BYTES + 1) })),
    { ok: false, status: 413 });
  assert.deepEqual(await readJsonBodyWithLimit(jsonRequest('{')), { ok: false, status: 400 });
  assert.deepEqual(await readJsonBodyWithLimit(new Request(url, { method: 'POST', body: '{}' })), { ok: false, status: 400 });
  assert.deepEqual(await readJsonBodyWithLimit(jsonRequest(' '.repeat(1022) + '{}'), 1024), { ok: true, value: {} });
  assert.deepEqual(await readJsonBodyWithLimit(jsonRequest(' '.repeat(1023) + '{}'), 1024), { ok: false, status: 413 });
});

test('stream byte limit cannot be bypassed by missing or forged Content-Length', async () => {
  for (const headers of [{}, { 'Content-Length': '2' }]) {
    let reads = 0;
    const body = new ReadableStream({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(1024));
        if (reads > 20) controller.close();
      },
    });
    const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, duplex: 'half' });
    assert.deepEqual(await readJsonBodyWithLimit(request), { ok: false, status: 413 });
    assert.ok(reads < 21);
  }
});
