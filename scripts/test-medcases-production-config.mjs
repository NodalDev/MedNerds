import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  environmentKind, productionOrigins, validateRequestOrigin,
} from '../workers/medcases-realtime/src/environment.ts';
import {
  configuredRealtimeOrigin, publicRealtimeOrigin, realtimeWebSocketUrl,
} from '../src/lib/medcases/realtime-url.ts';

const request = (origin) => new Request('https://worker.example.invalid/sessions', origin === undefined
  ? undefined : { headers: { Origin: origin } });

test('explicit environments fail closed and production origins use exact HTTPS matches', () => {
  assert.equal(environmentKind({ ENVIRONMENT: 'development' }), 'development');
  assert.equal(environmentKind({ ENVIRONMENT: 'production' }), 'production');
  for (const value of [undefined, 'unexpected', 'Development']) {
    assert.equal(environmentKind({ ENVIRONMENT: value }), null);
  }

  const production = { ENVIRONMENT: 'production', ALLOWED_ORIGINS: ' https://mednerds.ch , , https://preview.example.invalid ' };
  assert.deepEqual([...productionOrigins(production)], ['https://mednerds.ch', 'https://preview.example.invalid']);
  assert.equal(validateRequestOrigin(request('https://mednerds.ch'), production).allowed, true);
  for (const origin of [undefined, 'null', 'http://mednerds.ch', 'https://evil.mednerds.ch',
    'https://mednerds.ch.attacker.example', 'https://mednerds.ch:444',
    'http://localhost:4321', 'http://127.0.0.1:4321']) {
    assert.equal(validateRequestOrigin(request(origin), production).allowed, false, String(origin));
  }
  assert.equal(validateRequestOrigin(request('https://mednerds.ch'), { ENVIRONMENT: 'production' }).allowed, false);
  assert.deepEqual([...productionOrigins({ ALLOWED_ORIGINS: 'http://mednerds.ch, https://localhost:4321, https://mednerds.ch/path' })], []);

  const development = { ENVIRONMENT: 'development' };
  for (const origin of [undefined, 'http://localhost:4321', 'http://127.0.0.1:4321']) {
    assert.equal(validateRequestOrigin(request(origin), development).allowed, true, String(origin));
  }
  assert.equal(validateRequestOrigin(request('https://mednerds.ch'), development).allowed, false);
  assert.equal(validateRequestOrigin(request('http://localhost:4321'), { ENVIRONMENT: 'unexpected' }).allowed, false);
});

test('production Realtime URL only accepts HTTPS and maps it to WSS', () => {
  assert.equal(publicRealtimeOrigin('https://example.invalid', false), 'https://example.invalid');
  assert.equal(realtimeWebSocketUrl('https://example.invalid', 'session_test', false),
    'wss://example.invalid/sessions/session_test/connect');
  for (const value of ['http://example.invalid', 'ws://example.invalid', 'wss://example.invalid',
    'http://localhost:8787', 'https://localhost:8787', 'javascript:alert(1)', 'relative/path',
    'data:text/plain,test', 'file:///tmp/test', 'https://example.invalid/path',
    'https://user:pass@example.invalid']) {
    assert.equal(publicRealtimeOrigin(value, false), null, value);
    assert.throws(() => realtimeWebSocketUrl(value, 'session_test', false), RangeError);
  }
  assert.equal(configuredRealtimeOrigin(undefined, false), null);
  assert.equal(configuredRealtimeOrigin('http://example.invalid', false), null);
  assert.equal(configuredRealtimeOrigin(undefined, true), 'http://127.0.0.1:8787');
  assert.equal(publicRealtimeOrigin('http://localhost:8787', true), 'http://localhost:8787');
  assert.equal(realtimeWebSocketUrl('http://localhost:8787', 'session_test', true),
    'ws://localhost:8787/sessions/session_test/connect');
});

test('deployable Wrangler config defaults to production without changing bindings', async () => {
  const config = JSON.parse(await readFile('workers/medcases-realtime/wrangler.jsonc', 'utf8'));
  assert.deepEqual(config.vars, { ENVIRONMENT: 'production', ALLOWED_ORIGINS: 'https://mednerds.ch' });
  assert.deepEqual(config.ratelimits.map(({ namespace_id }) => namespace_id), ['680201', '680202', '680203', '680204']);
  assert.equal(config.durable_objects.bindings.length, 2);
  assert.equal(config.migrations.length, 2);
});
