import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import gate, { config as gateRoute } from '../netlify/edge-functions/preview-access.ts';
import login, { config as loginRoute } from '../netlify/edge-functions/preview-access-login.ts';
import { handleAccess, handleLogin, safeReturnPath } from '../netlify/lib/preview-access/handler.ts';
import { matchingCredentials, parseRegistry, readAccessConfig } from '../netlify/lib/preview-access/config.ts';
import { decodeBase64url, hashPassword, parsePasswordHash, passwordMatches, randomSecret } from '../netlify/lib/preview-access/passwords.ts';
import { createSession, readSessionCookie, validSession, SESSION_COOKIE } from '../netlify/lib/preview-access/sessions.ts';

// Ephemeral in-memory fixtures only. No passwords/secrets or tokens are printed or saved.
const passwords = [randomSecret(), randomSecret(), randomSecret()];
const registry = { version: 1, credentials: await Promise.all(passwords.map(async (password, i) => ({
  id: `test-${i}`, enabled: i !== 2, passwordHash: await hashPassword(password), revision: 1,
}))) };
const secretString = randomSecret();
const secret = decodeBase64url(secretString, 32);
const origin = 'https://preview.mednerds.test';
const values = { MEDNERDS_ACCESS_GATE: 'enabled', MEDNERDS_ACCESS_CREDENTIALS: JSON.stringify(registry), MEDNERDS_ACCESS_SESSION_SECRET: secretString };
const env = (name) => values[name];
const upstream = () => new Response('protected article', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=999', 'X-Existing': 'preserved' } });
const context = { next: async () => upstream() };
const req = (path = '/meddocs/', headers = {}) => new Request(origin + path, { headers });
const post = (password, headers = {}, extra = {}) => new Request(origin + '/_preview-access/login', {
  method: 'POST', body: new URLSearchParams({ password, ...extra }), headers: { Origin: origin, Accept: 'application/json', ...headers },
});
const withRegistry = (config) => (name) => name === 'MEDNERDS_ACCESS_CREDENTIALS' ? JSON.stringify(config) : env(name);

test('PBKDF2 format, random salts and independent passwords', async (t) => {
  const started = performance.now();
  assert.equal(await passwordMatches(passwords[0], registry.credentials[0].passwordHash), true);
  t.diagnostic(`One 600000-iteration verification: ${Math.round(performance.now() - started)} ms local wall time; not a Netlify CPU benchmark.`);
  assert.equal(await passwordMatches(passwords[1], registry.credentials[0].passwordHash), false);
  const secondHash = await hashPassword(passwords[0]);
  assert.notEqual(secondHash, registry.credentials[0].passwordHash);
  assert.equal(await passwordMatches(passwords[0], secondHash), true);
  for (const value of ['', 'pbkdf2-sha1$1$600000$x$x', registry.credentials[0].passwordHash.replace('$600000$', '$1$'),
    registry.credentials[0].passwordHash.replace('$1$', '$2$')]) assert.throws(() => parsePasswordHash(value));
  await assert.rejects(hashPassword(''));
  await assert.rejects(hashPassword(randomSecret().repeat(10)));
});

test('strict configuration: IDs, boolean flags, revisions, limits and secrets fail closed', async () => {
  assert.deepEqual(parseRegistry(JSON.stringify(registry)), registry);
  for (const flag of [undefined, '', 'false', 'true', 'ENABLED']) assert.throws(() => readAccessConfig(name => name === 'MEDNERDS_ACCESS_GATE' ? flag : env(name)));
  assert.deepEqual(readAccessConfig(() => 'disabled'), { enabled: false });
  for (const change of [
    { ...registry, version: 2 }, { ...registry, credentials: [] },
    { ...registry, credentials: Array(9).fill(registry.credentials[0]) },
    { ...registry, credentials: [registry.credentials[0], registry.credentials[0]] },
    { ...registry, credentials: [{ ...registry.credentials[0], enabled: 'true' }] },
    { ...registry, credentials: [{ ...registry.credentials[0], revision: 0 }] },
    { ...registry, credentials: [{ ...registry.credentials[0], id: '../bad' }] },
    { ...registry, credentials: [{ ...registry.credentials[0], unexpected: true }] },
    { ...registry, credentials: [{ ...registry.credentials[0], passwordHash: 'invalid' }] },
    { ...registry, credentials: [registry.credentials[0], { ...registry.credentials[0], id: 'other' }] },
  ]) assert.throws(() => parseRegistry(JSON.stringify(change)));
  for (const value of [undefined, '', 'invalid', randomSecret() + '=']) {
    const response = await handleAccess(req(), { next: () => { throw Error('Upstream must not run'); } }, name => name === 'MEDNERDS_ACCESS_SESSION_SECRET' ? value : env(name));
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(secretString));
  }
});

test('login accepts multiple independent active codes, hides disabled/wrong and rejects ambiguous passwords', async () => {
  for (const password of passwords.slice(0, 2)) {
    const response = await handleLogin(post(password), context, env);
    assert.equal(response.status, 204);
    const cookie = response.headers.get('set-cookie');
    for (const part of [`${SESSION_COOKIE}=v1.`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=86400']) assert.ok(cookie.includes(part));
    assert.ok(!cookie.includes('Domain=') && !cookie.includes(password));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  const disabled = await handleLogin(post(passwords[2]), context, env);
  const wrong = await handleLogin(post(randomSecret()), context, env);
  assert.equal(disabled.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(await disabled.text(), await wrong.text());
  const duplicate = { ...registry, credentials: [registry.credentials[0], { id: 'duplicate', enabled: true,
    revision: 1, passwordHash: await hashPassword(passwords[0]) }] };
  assert.equal((await matchingCredentials(passwords[0], duplicate)).length, 2);
  assert.equal((await handleLogin(post(passwords[0]), context, withRegistry(duplicate))).status, 401);
});

test('session integrity, expiry, audience, disabled IDs, revisions, password replacement and global rotation', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createSession(registry.credentials[0], secret, origin, now);
  assert.equal(await validSession(token, registry, secret, origin, now), true);
  for (const broken of [undefined, '', token + '.extra', token.slice(0, -2) + 'xx', 'v1.!.!', token.replace('v1.', 'v2.')]) {
    assert.equal(await validSession(broken, registry, secret, origin, now), false);
  }
  assert.equal(await validSession(token, registry, secret, origin, now + 86400), false);
  assert.equal(await validSession(token, registry, secret, 'https://another.mednerds.test', now), false);
  assert.equal(await validSession(token, registry, decodeBase64url(randomSecret(), 32), origin, now), false);
  for (const patch of [{ enabled: false }, { revision: 2 }, { id: 'replaced' }, { passwordHash: registry.credentials[1].passwordHash }]) {
    const changed = { ...registry, credentials: [{ ...registry.credentials[0], ...patch }] };
    assert.equal(await validSession(token, changed, secret, origin, now), false);
  }
  assert.equal(await validSession(await createSession(registry.credentials[0], secret, origin, now + 120), registry, secret, origin, now), false);
  const cookie = `${SESSION_COOKIE}=${token}`;
  assert.equal(readSessionCookie(req('/', { Cookie: cookie + '; ' + cookie })), undefined);
});

test('HTML, assets, Pagefind, JSON, sitemap, proxy and alternate paths require the same session', async () => {
  for (const path of ['/', '/meddocs/anaesthesie/article/?q=test', '/pagefind/pagefind.js', '/pagefind/fragment/a.pf_fragment',
    '/meddocs-previews/anaesthesie/article.json', '/_astro/site.css', '/_astro/site.js', '/sitemap-index.xml', '/media-assets/file.png',
    '/.netlify/images?url=secret', '/account/', '/medcases/session/patient/?code=ABC234']) {
    let called = false;
    const response = await handleAccess(req(path, { Accept: 'text/html' }), { next: async () => { called = true; return upstream(); } }, env);
    assert.equal(called, false);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
    assert.ok(!(await response.text()).includes('protected article'));
  }
  const token = await createSession(registry.credentials[0], secret, origin);
  for (const path of ['/meddocs/', '/pagefind/pagefind.js', '/_astro/app.js', '/_astro/app.css', '/media-assets/a.png']) {
    const response = await handleAccess(req(path, { Cookie: `${SESSION_COOKIE}=${token}` }), context, env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'protected article');
    assert.equal(response.headers.get('x-existing'), 'preserved');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal((await handleAccess(new Request(origin + '/', { method: 'HEAD', headers: { Accept: 'text/html' } }), context, env)).body, null);
  for (const headers of [{ Range: 'bytes=0-10' }, { 'If-None-Match': 'previous' },
    { Authorization: `Bearer ${randomSecret()}`, Cookie: `sb-test-auth-token=${randomSecret()}` }]) {
    assert.equal((await handleAccess(req('/_astro/file.js', headers), context, env)).status, 401);
  }
  const partial = await handleAccess(req('/media-assets/file.png', { Cookie: `${SESSION_COOKIE}=${token}`, Range: 'bytes=0-2' }),
    { next: async () => new Response('PNG', { status: 206, headers: { 'Content-Type': 'image/png', 'Content-Range': 'bytes 0-2/10' } }) }, env);
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 0-2/10');
  assert.equal(await partial.text(), 'PNG');
});

test('small login page works without protected CSS/scripts; robots and logo-only exceptions', async () => {
  const page = await handleAccess(req('/meddocs/?query=a%2Bb', { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' }), context, env);
  const html = await page.text();
  assert.ok(html.includes('Willkommen bei MedNerds') && html.includes('Zugangspasswort'));
  assert.ok(html.includes('returnTo') && html.includes('/meddocs/?query=a%2Bb'));
  assert.ok(!html.includes('/_astro/') && !html.includes('localStorage') && !html.includes('sessionStorage'));
  assert.ok(!html.includes(secretString) && !html.includes(registry.credentials[0].passwordHash));
  assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin');
  assert.equal(await (await handleAccess(req('/robots.txt'), context, env)).text(), 'User-agent: *\nDisallow: /\n');
  assert.equal((await handleAccess(req('/preview-access/logo-light.svg'), context, env)).status, 200);
  assert.equal((await handleAccess(req('/_preview-access/other.svg'), context, env)).status, 401);
});

test('Origin/HTTPS, input bounds, no GET passwords, native fallback and safe returns', async () => {
  for (const headers of [{ Origin: 'null' }, { Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal((await handleLogin(post(passwords[0], headers), context, env)).status, 403);
  }
  assert.equal((await handleLogin(new Request(origin + '/_preview-access/login'), context, env)).status, 405);
  assert.equal((await handleLogin(new Request('http://preview.mednerds.test/_preview-access/login', { method: 'POST', body: '' }), context, env)).status, 400);
  assert.equal((await handleLogin(post(passwords[0], { 'Content-Type': 'application/json' }), context, env)).status, 400);
  assert.equal((await handleLogin(post(randomSecret().repeat(120)), context, env)).status, 400);
  const repeated = post(passwords[0]);
  const body = await repeated.text();
  assert.equal((await handleLogin(new Request(repeated, { body: body + '&password=second' }), context, env)).status, 400);
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/\n/evil', '/_preview-access/login', '/article#fragment',
    '/%5cevil.test', '/%2f%2fevil.test', '/%0aevil.test', '/%5fpreview-access/login']) assert.equal(safeReturnPath(value, origin), '/');
  assert.equal(safeReturnPath('/meddocs/?q=a%2Bb', origin), '/meddocs/?q=a%2Bb');
  const response = await handleLogin(post(passwords[0], { Accept: 'text/html' }, { returnTo: '//evil.test' }), context, env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
});

test('logout is POST-only for changes, verifies Origin and clears only the preview cookie', async () => {
  const get = await handleAccess(req('/_preview-access/logout'), context, env);
  assert.equal(get.headers.has('set-cookie'), false);
  assert.ok((await get.text()).includes('Vorschauzugang abmelden'));
  for (const originHeader of ['https://evil.test', 'null']) {
    const request = new Request(origin + '/_preview-access/logout', { method: 'POST', headers: { Origin: originHeader } });
    assert.equal((await handleAccess(request, context, env)).status, 403);
  }
  const response = await handleAccess(new Request(origin + '/_preview-access/logout', { method: 'POST', headers: { Origin: origin } }), context, env);
  assert.equal(response.status, 303);
  assert.ok(response.headers.get('set-cookie').startsWith(`${SESSION_COOKIE}=;`));
  assert.ok(response.headers.get('set-cookie').includes('Max-Age=0'));
});

test('explicitly disabled is a byte/header-preserving passthrough, including normal SEO', async () => {
  for (const handler of [handleAccess, handleLogin]) {
    const response = await handler(req(), context, () => 'disabled');
    assert.equal(await response.text(), 'protected article');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=999');
    assert.equal(response.headers.has('x-robots-tag'), false);
    assert.equal(response.headers.has('set-cookie'), false);
  }
  assert.equal((await handleAccess(req(), { next: async () => { throw Error('unavailable'); } }, env)).status, 401);
  const token = await createSession(registry.credentials[0], secret, origin);
  assert.equal((await handleAccess(req('/', { Cookie: `${SESSION_COOKIE}=${token}` }), { next: async () => { throw Error('unavailable'); } }, env)).status, 503);
});

test('real entry points fail closed without platform env; native login rate limit never applies to assets', async () => {
  assert.equal((await gate(req(), context)).status, 503);
  assert.equal((await login(post(passwords[0]), context)).status, 503);
  const previous = globalThis.Netlify;
  try {
    globalThis.Netlify = { env: { get: env } };
    const response = await login(post(passwords[0]), context);
    assert.equal(response.status, 204);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await gate(req('/meddocs/', { Cookie: cookie }), context)).status, 200);
  } finally {
    if (previous === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = previous;
  }
  assert.equal(gateRoute.path, '/*');
  assert.equal(gateRoute.onError, 'fail');
  assert.deepEqual(gateRoute.excludedPath, loginRoute.path);
  assert.equal(gateRoute.cache, undefined);
  assert.equal(loginRoute.onError, 'fail');
  assert.deepEqual(loginRoute.rateLimit, { windowLimit: 10, windowSize: 60, aggregateBy: ['ip'], action: 'rate_limit' });
  const toml = await readFile('netlify.toml', 'utf8');
  assert.ok(toml.includes('/media-assets/*') && !toml.includes('onError = "bypass"'));
  const cli = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/preview-access.mjs', 'session-secret'], { env: { ...process.env, CI: '1' }, encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, '');
});

if (process.argv.includes('--built')) test('built assets contain only the standalone logos, no gate config, verifiers or session secret', async () => {
  for (const name of ['logo-light', 'logo-dark']) {
    assert.ok((await readFile(`dist/preview-access/${name}.svg`, 'utf8')).includes('<svg'));
  }
  for (const file of (await readdir('dist', { recursive: true })).filter(file => /\.(html|js|json)$/.test(file))) {
    const content = await readFile(`dist/${file}`, 'utf8');
    assert.doesNotMatch(content, /MEDNERDS_ACCESS_(?:CREDENTIALS|SESSION_SECRET)|pbkdf2-sha256\$1\$/,
      `Server-only configuration leaked into ${file}`);
    assert.ok(!content.includes(secretString) && !content.includes(passwords[0]), `Test secret leaked into ${file}`);
  }
});

