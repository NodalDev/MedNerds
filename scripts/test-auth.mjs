import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAuthConfiguration } from '../src/lib/auth/config.ts';
import { AuthStore } from '../src/lib/auth/auth-store.ts';
import { authFailure } from '../src/lib/auth/errors.ts';
import { getSupabaseBrowserClient, getBrowserAuthStore } from '../src/lib/auth/supabase-client.ts';
import { TurnstileChallenge } from '../src/lib/auth/turnstile.ts';

const environment = { PUBLIC_SUPABASE_URL: 'https://auth.example.test', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only', PUBLIC_TURNSTILE_SITE_KEY: 'test-only' };
const session = (email = 'demo@example.test') => ({ user: { id: 'test-user', email } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function mockAuth(initialSession = null) {
  const calls = { session: 0, subscriptions: 0, unsubscribed: 0, send: [], verify: [], logout: 0 };
  const listeners = new Set();
  const api = {
    async getSession() { calls.session++; return { data: { session: initialSession }, error: null }; },
    onAuthStateChange(callback) {
      calls.subscriptions++; listeners.add(callback);
      return { data: { subscription: { unsubscribe() { calls.unsubscribed++; listeners.delete(callback); } } } };
    },
    async signInWithOtp(credentials) { calls.send.push(credentials); return { error: null }; },
    async verifyOtp(credentials) { calls.verify.push(credentials); return { data: { session: session(credentials.email) }, error: null }; },
    async signOut() { calls.logout++; return { error: null }; },
  };
  return { api, calls, emit: (event, value) => { for (const listener of listeners) listener(event, value); } };
}

test('only complete public configuration is accepted; no client is initialized on the server', () => {
  assert.equal(readAuthConfiguration(environment).ok, true);
  assert.equal(readAuthConfiguration({}).ok, false);
  for (const field of Object.keys(environment)) assert.equal(readAuthConfiguration({ ...environment, [field]: '' }).ok, false);
  for (const url of ['bad', 'javascript:alert(1)', 'http://remote.example.test', 'https://user:password@example.test', 'https://example.test/?token=value']) {
    assert.equal(readAuthConfiguration({ ...environment, PUBLIC_SUPABASE_URL: url }).ok, false);
  }
  assert.equal(readAuthConfiguration({ ...environment, PUBLIC_SUPABASE_URL: 'http://localhost:54321' }).ok, true);
  assert.equal(readAuthConfiguration({ ...environment, PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test_only' }).ok, false);
  assert.equal(getSupabaseBrowserClient(), undefined);
  assert.equal(getBrowserAuthStore(), undefined);
});

test('one session initialization/subscription serves multiple consumers and cleans up/reconnects', async () => {
  const mock = mockAuth(session());
  const store = new AuthStore(mock.api);
  const first = store.subscribe(() => {}), second = store.subscribe(() => {});
  await store.initialize();
  assert.equal(mock.calls.session, 1); assert.equal(mock.calls.subscriptions, 1);
  assert.deepEqual(store.state, { status: 'signed-in', email: 'demo@example.test', userId: 'test-user', busy: null });
  mock.emit('TOKEN_REFRESHED', session('updated@example.test'));
  assert.equal(store.state.email, 'updated@example.test');
  mock.emit('SIGNED_OUT', null); assert.equal(store.state.status, 'signed-out');
  first(); assert.equal(mock.calls.unsubscribed, 0);
  second(); assert.equal(mock.calls.unsubscribed, 1);
  const third = store.subscribe(() => {}); await store.initialize();
  assert.equal(mock.calls.subscriptions, 2); third();
  assert.equal(mock.calls.unsubscribed, 2);
});

test('late getSession cannot overwrite newer auth events or update a disconnected consumer', async () => {
  const mock = mockAuth(), pending = deferred();
  mock.api.getSession = () => pending.promise;
  const store = new AuthStore(mock.api);
  const stop = store.subscribe(() => {});
  mock.emit('SIGNED_IN', session());
  pending.resolve({ data: { session: null }, error: null });
  await store.initialize(); assert.equal(store.state.status, 'signed-in'); stop();
  const next = deferred(); mock.api.getSession = () => next.promise;
  let updates = 0; const unsubscribe = store.subscribe(() => { updates++; });
  const initialization = store.initialize(); unsubscribe(); const count = updates;
  next.resolve({ data: { session: session() }, error: null }); await initialization;
  assert.equal(updates, count);
});

test('session initialization failures are contained', async () => {
  for (const reject of [false, true]) {
    const mock = mockAuth();
    mock.api.getSession = async () => { if (reject) throw new Error('private diagnostic'); return { data: { session: null }, error: new Error('private diagnostic') }; };
    const store = new AuthStore(mock.api); const stop = store.subscribe(() => {});
    await store.initialize(); assert.equal(store.state.status, 'error'); stop();
  }
});

test('OTP request requires email and CAPTCHA and uses the official options', async () => {
  const mock = mockAuth(), store = new AuthStore(mock.api);
  assert.equal((await store.requestCode('bad-email', 'test-captcha')).field, 'email');
  for (const token of [undefined, '', '   ']) assert.equal((await store.requestCode('demo@example.test', token)).field, 'captcha');
  assert.equal(mock.calls.send.length, 0);
  assert.equal((await store.requestCode(' demo@example.test ', 'test-captcha')).ok, true);
  assert.deepEqual(mock.calls.send, [{ email: 'demo@example.test', options: { shouldCreateUser: true, captchaToken: 'test-captcha' } }]);
});

test('duplicate sends are rejected and the 60-second cooldown also applies after email changes', async () => {
  let now = 10_000;
  const mock = mockAuth(), pending = deferred();
  mock.api.signInWithOtp = async (credentials) => { mock.calls.send.push(credentials); return pending.promise; };
  const store = new AuthStore(mock.api, () => now);
  const first = store.requestCode('demo@example.test', 'test-captcha');
  assert.equal((await store.requestCode('demo@example.test', 'second-captcha')).ok, false);
  assert.equal(mock.calls.send.length, 1); assert.equal(store.state.busy, 'send');
  pending.resolve({ error: null }); await first;
  assert.equal(store.state.busy, null); assert.equal(store.resendSeconds, 60);
  assert.equal((await store.requestCode('changed@example.test', 'fresh-captcha')).ok, false);
  now += 59_001; assert.equal(store.resendSeconds, 1);
  now += 999; assert.equal((await store.requestCode('changed@example.test', 'fresh-captcha')).ok, true);
  assert.equal(mock.calls.send.length, 2);
});

test('rate-limit, CAPTCHA, SMTP and network failures remain generic and release the request lock', async () => {
  for (const error of [{ status: 429 }, { code: 'over_email_send_rate_limit' }, { code: 'captcha_failed' }, { status: 500, message: 'SMTP credential private diagnostic' }]) {
    const mock = mockAuth(); mock.api.signInWithOtp = async () => ({ error });
    const store = new AuthStore(mock.api); const result = await store.requestCode('demo@example.test', 'captcha');
    assert.equal(result.ok, false); assert.ok(!result.message.includes('private diagnostic')); assert.equal(store.state.busy, null);
    if (error.status === 429 || error.code === 'over_email_send_rate_limit') assert.equal(store.resendSeconds, 60);
  }
  const mock = mockAuth(); mock.api.signInWithOtp = async () => { throw new Error('private diagnostic'); };
  const store = new AuthStore(mock.api); assert.equal((await store.requestCode('demo@example.test', 'captcha')).ok, false);
  assert.equal(store.state.busy, null);
});

test('verification preserves leading zeros, rejects malformed codes, and updates the session', async () => {
  const mock = mockAuth(), store = new AuthStore(mock.api);
  for (const code of ['12345', '1234567', 'abcdef', '1e0000', '']) assert.equal((await store.verifyCode('demo@example.test', code)).field, 'otp');
  assert.equal(mock.calls.verify.length, 0);
  assert.equal((await store.verifyCode('demo@example.test', '000012')).ok, true);
  assert.deepEqual(mock.calls.verify, [{ email: 'demo@example.test', token: '000012', type: 'email' }]);
  assert.equal(store.state.status, 'signed-in');
  for (const code of ['otp_expired', 'invalid_credentials']) {
    mock.api.verifyOtp = async () => ({ data: { session: null }, error: { code } });
    const result = await store.verifyCode('demo@example.test', '123456');
    assert.equal(result.ok, false); assert.equal(result.field, 'otp'); assert.match(result.message, /ungültig oder abgelaufen/);
  }
});

test('logout clears auth state only on success', async () => {
  const mock = mockAuth(session()), store = new AuthStore(mock.api);
  const stop = store.subscribe(() => {}); await store.initialize();
  mock.api.signOut = async () => ({ error: { message: 'private diagnostic' } });
  assert.equal((await store.signOut()).ok, false); assert.equal(store.state.status, 'signed-in');
  mock.api.signOut = async () => ({ error: null });
  assert.equal((await store.signOut()).ok, true); assert.equal(store.state.status, 'signed-out'); stop();
  assert.equal(authFailure(new Error('private diagnostic'), 'logout').message.includes('private diagnostic'), false);
});

test('Turnstile supplies single-use tokens, resets expired/failed requests, and ignores removed callbacks', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { dataset: { theme: 'light' } } };
  try {
    let options, expired = false, resets = 0, removals = 0;
    const states = [];
    const api = { render(_host, value) { options = value; return 'test-widget'; }, reset() { resets++; }, remove() { removals++; }, isExpired() { return expired; } };
    const challenge = new TurnstileChallenge({ clientWidth: 240 }, 'test-site', (...state) => states.push(state), async () => api);
    await challenge.mount(); assert.equal(options.size, 'compact'); assert.equal(options.theme, 'light');
    assert.equal(challenge.takeToken(), undefined);
    options.callback('test-token'); assert.equal(challenge.takeToken(), 'test-token'); assert.equal(challenge.takeToken(), undefined);
    options.callback('expired-token'); expired = true; assert.equal(challenge.takeToken(), undefined);
    options['expired-callback'](); assert.equal(resets, 1);
    options['timeout-callback'](); assert.equal(resets, 2);
    options['error-callback'](); assert.match(states.at(-1)[1], /fehlgeschlagen/);
    challenge.reset(); assert.equal(resets, 3);
    challenge.dispose(); assert.equal(removals, 1); const count = states.length;
    options.callback('removed-token'); assert.equal(states.length, count);
    assert.equal(challenge.takeToken(), undefined);
  } finally { globalThis.document = previousDocument; }
});

test('SDK local sign-out with failed remote revocation stays signed out without claiming full success', async () => {
  const mock = mockAuth(session()), store = new AuthStore(mock.api);
  const stop = store.subscribe(() => {}); await store.initialize();
  mock.api.signOut = async () => { mock.emit('SIGNED_OUT', null); return { error: { status: 500 } }; };
  const result = await store.signOut();
  assert.equal(result.ok, false); assert.equal(store.state.status, 'signed-out');
  assert.match(result.message, /vollständige Abmeldung konnte nicht bestätigt/); stop();
});

test('pending or failed Turnstile scripts cannot create a stale widget after navigation', async () => {
  const pending = deferred(); let renders = 0;
  const challenge = new TurnstileChallenge({}, 'test-site', () => {}, () => pending.promise);
  const mounting = challenge.mount(); challenge.dispose();
  pending.resolve({ render() { renders++; } }); await mounting; assert.equal(renders, 0);
  let message;
  const failed = new TurnstileChallenge({}, 'test-site', (_ready, error) => { message = error; }, async () => { throw new Error('private diagnostic'); });
  await failed.mount(); assert.match(message, /konnte nicht geladen werden/); assert.ok(!message.includes('private diagnostic'));
});
