import { matchingCredentials, readAccessConfig, type Credential, type Environment } from './config.ts';
import { randomSecret } from './passwords.ts';
import { clearSessionCookie, createSession, readSessionCookie, sessionCookie, validSession } from './sessions.ts';
import { accessPage, LOGIN_PATH, LOGO_PATHS, LOGOUT_PATH } from './page.ts';

/** Only the documented context.next() API is needed; no runtime SDK dependency. */
export interface EdgeContext { next(): Promise<Response> }
export const netlifyEnvironment: Environment = (name) => {
  const runtime = globalThis as typeof globalThis & { Netlify?: { env: { get(key: string): string | undefined } } };
  return runtime.Netlify?.env.get(name);
};

function protectedHeaders(headers = new Headers()): Headers {
  headers.set('Cache-Control', 'private, no-store');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Netlify-CDN-Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('X-Content-Type-Options', 'nosniff');
  // Retain Origin on native form POSTs, without forwarding paths, queries or fragments.
  headers.set('Referrer-Policy', 'strict-origin');
  const vary = headers.get('Vary');
  if (!vary?.split(',').some(value => value.trim().toLowerCase() === 'cookie')) headers.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');
  return headers;
}

function reply(request: Request, text: string, status: number, headers = new Headers()): Response {
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(request.method === 'HEAD' || status === 204 || status === 304 ? null : text, { status, headers: protectedHeaders(headers) });
}

function page(request: Request, status: number, options: Parameters<typeof accessPage>[1] = {}): Response {
  const nonce = randomSecret();
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` });
  return reply(request, accessPage(nonce, options), status, headers);
}

function secureOrigin(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
}

function sameOriginPost(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin
    && !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '');
}

export function safeReturnPath(value: string, origin: string): string {
  if (value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020#]/.test(value)) return '/';
  try {
    const url = new URL(value, origin);
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.origin !== origin || decodedPath.startsWith('//') || /[\\\u0000-\u0020]/.test(decodedPath)
      || decodedPath.startsWith('/_preview-access/')) return '/';
    return url.pathname + url.search;
  } catch { return '/'; }
}

function htmlNavigation(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return ['GET', 'HEAD'].includes(request.method) && request.headers.get('accept')?.includes('text/html') === true
    && !/^\/(?:pagefind|meddocs-previews|_astro|media-assets|\.netlify)(?:\/|$)/.test(path)
    && (!/\/[^/]*\.[^/]+$/.test(path) || path.endsWith('.html'))
    && ['document', ''].includes(request.headers.get('sec-fetch-dest') ?? '');
}

/** Gate the incoming path before context.next() evaluates rewrites/static content. */
export async function handleAccess(request: Request, context: EdgeContext, env: Environment = netlifyEnvironment): Promise<Response> {
  try {
    const config = readAccessConfig(env);
    if (!config.enabled) return await context.next();
    const url = new URL(request.url);
    if (!secureOrigin(url)) return reply(request, 'HTTPS erforderlich.', 400);
    if (url.pathname === '/robots.txt') return reply(request, 'User-agent: *\nDisallow: /\n', 200);
    if (LOGO_PATHS.includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
      const response = await context.next();
      const headers = protectedHeaders(new Headers(response.headers));
      headers.set('Content-Type', 'image/svg+xml');
      headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.pathname === LOGOUT_PATH || url.pathname === `${LOGOUT_PATH}/`) {
      if (request.method === 'POST') {
        if (!sameOriginPost(request)) return reply(request, 'Anfrage nicht erlaubt.', 403);
        return reply(request, '', 303, new Headers({ Location: '/', 'Set-Cookie': clearSessionCookie() }));
      }
      if (request.method !== 'GET') return reply(request, 'Methode nicht erlaubt.', 405, new Headers({ Allow: 'GET, POST' }));
      return page(request, 200, { logout: true });
    }
    const valid = await validSession(readSessionCookie(request), config.registry, config.secret, url.origin);
    if (!valid) return htmlNavigation(request)
      ? page(request, 401, { returnTo: safeReturnPath(url.pathname + url.search, url.origin) })
      : reply(request, 'Vorschauzugang erforderlich.', 401);
    const response = await context.next();
    return new Response(response.body, { status: response.status, statusText: response.statusText,
      headers: protectedHeaders(new Headers(response.headers)) });
  } catch {
    // No upstream request on configuration/authentication errors; never log secrets or requests.
    return reply(request, 'Der Vorschauzugang ist momentan nicht verfügbar.', 503);
  }
}

async function boundedForm(request: Request): Promise<URLSearchParams> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new Error('Invalid body.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 4096) throw new Error('Body too large.');
      chunks.push(part.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(body));
  if (form.getAll('password').length !== 1 || form.getAll('returnTo').length > 1
    || [...form.keys()].some(key => !['password', 'returnTo'].includes(key))) throw new Error('Invalid body.');
  return form;
}

/** Dedicated path: Netlify applies its native rate limit before this expensive KDF. */
export async function handleLogin(request: Request, context: EdgeContext, env: Environment = netlifyEnvironment): Promise<Response> {
  try {
    const config = readAccessConfig(env);
    if (!config.enabled) return await context.next();
    const url = new URL(request.url);
    if (![LOGIN_PATH, `${LOGIN_PATH}/`].includes(url.pathname)) return reply(request, 'Nicht gefunden.', 404);
    if (!secureOrigin(url)) return reply(request, 'HTTPS erforderlich.', 400);
    if (request.method !== 'POST') return reply(request, 'Methode nicht erlaubt.', 405, new Headers({ Allow: 'POST' }));
    if (!sameOriginPost(request)) return reply(request, 'Anfrage nicht erlaubt.', 403);
    let form: URLSearchParams;
    try { form = await boundedForm(request); } catch { return reply(request, 'Ungültige Anfrage.', 400); }
    let matches: Credential[];
    try { matches = await matchingCredentials(form.get('password') ?? '', config.registry); }
    catch { matches = []; }
    if (matches.length !== 1 || !matches[0].enabled) {
      if (request.headers.get('accept')?.includes('application/json')) return reply(request, 'Zugangspasswort nicht gültig.', 401);
      return page(request, 401, { error: 'Dieses Zugangspasswort ist nicht gültig.', returnTo: safeReturnPath(form.get('returnTo') ?? '/', url.origin) });
    }
    const token = await createSession(matches[0], config.secret, url.origin);
    const headers = new Headers({ 'Set-Cookie': sessionCookie(token) });
    if (request.headers.get('accept')?.includes('application/json')) return reply(request, '', 204, headers);
    headers.set('Location', safeReturnPath(form.get('returnTo') ?? '/', url.origin));
    return reply(request, '', 303, headers);
  } catch { return reply(request, 'Der Vorschauzugang ist momentan nicht verfügbar.', 503); }
}
