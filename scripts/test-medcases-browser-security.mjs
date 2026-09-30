import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('public/_headers', 'utf8');
const published = await readFile('dist/_headers', 'utf8');
const headers = new Map(source.trim().split(/\r?\n/).slice(1).map((line) => {
  const separator = line.indexOf(':');
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
}));

test('Netlify publishes one site-wide security header policy', () => {
  assert.equal(published, source);
  assert.equal(source.trim().split(/\r?\n/)[0], '/*');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('X-Frame-Options'), 'SAMEORIGIN');
  assert.match(headers.get('Permissions-Policy'), /(?:^|, )fullscreen=\(self\)(?:,|$)/);
  assert.match(headers.get('Permissions-Policy'), /(?:^|, )screen-wake-lock=\(self\)(?:,|$)/);
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
    assert.match(headers.get('Permissions-Policy'), new RegExp(`(?:^|, )${feature}=\\(\\)(?:,|$)`));
  }
  assert.equal(headers.has('Content-Security-Policy'), false);
  assert.equal(headers.has('Strict-Transport-Security'), false);
});

test('Report-Only CSP matches actual site dependencies without broad sources', () => {
  const csp = headers.get('Content-Security-Policy-Report-Only');
  assert.ok(csp);
  const directives = new Map(csp.split(';').map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values.join(' ')];
  }));
  for (const name of ['default-src', 'script-src', 'style-src', 'img-src', 'font-src',
    'connect-src', 'frame-src', 'frame-ancestors', 'base-uri', 'form-action', 'object-src']) {
    assert.ok(directives.has(name), `${name} missing`);
  }
  assert.equal(directives.get('default-src'), "'self'");
  assert.equal(directives.get('object-src'), "'none'");
  assert.equal(directives.get('base-uri'), "'self'");
  assert.equal(directives.get('frame-ancestors'), "'self'");
  assert.equal(directives.get('img-src'), "'self' data:");
  assert.equal(directives.get('font-src'), "'self'");
  for (const name of ['script-src', 'connect-src', 'form-action']) {
    assert.match(directives.get(name), /https:\/\/newsletter\.infomaniak\.com/);
  }
  assert.equal(directives.get('script-src').includes("'unsafe-inline'"), true);
  assert.equal(directives.get('style-src').includes("'unsafe-inline'"), true);
  assert.doesNotMatch(csp, /\*|'unsafe-eval'|workers\.dev|localhost|127\.0\.0\.1|session_|#access=/);
  assert.equal(directives.has('report-uri') || directives.has('report-to'), false);
});

test('published patient entry contains no invite capability', async () => {
  const html = await readFile('dist/medcases/session/patient/index.html', 'utf8');
  assert.doesNotMatch(html, /#access=|patientCapability|mednerds\.medcases\.realtime\.patient\.invite/);
});
