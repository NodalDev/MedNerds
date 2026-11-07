import type { Credential, Registry } from './config.ts';
import { base64url, decodeBase64url, hashBinding } from './passwords.ts';

export const SESSION_COOKIE = '__Host-mednerds_preview';
export const SESSION_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();
const message = (payload: string) => encoder.encode(`MedNerds Preview Access session v1.${payload}`);
const key = (secret: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

interface Session { v: 1; id: string; revision: number; binding: string; iat: number; exp: number; aud: string }

export async function createSession(entry: Credential, secret: Uint8Array<ArrayBuffer>, origin: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const session: Session = { v: 1, id: entry.id, revision: entry.revision, binding: await hashBinding(entry.passwordHash),
    iat: now, exp: now + SESSION_SECONDS, aud: origin };
  const payload = base64url(encoder.encode(JSON.stringify(session)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), message(payload)));
  return `v1.${payload}.${base64url(signature)}`;
}

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  if (header.length > 16_384) return;
  const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`));
  if (values.length === 1) return values[0].slice(SESSION_COOKIE.length + 1);
}

export async function validSession(token: string | undefined, registry: Registry, secret: Uint8Array<ArrayBuffer>, origin: string,
  now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  try {
    if (!token || token.length > 2048) return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return false;
    if (!await crypto.subtle.verify('HMAC', await key(secret), decodeBase64url(parts[2], 32), message(parts[1]))) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(parts[1])) return false;
    const json = atob(parts[1].replaceAll('-', '+').replaceAll('_', '/'));
    const session: Session = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(json, c => c.charCodeAt(0))));
    if (!session || typeof session !== 'object' || Object.keys(session).length !== 7 || session.v !== 1 || session.aud !== origin
      || !Number.isSafeInteger(session.iat) || !Number.isSafeInteger(session.exp) || session.iat > now + 60
      || session.exp - session.iat !== SESSION_SECONDS || session.exp <= now) return false;
    const entry = registry.credentials.find(item => item.id === session.id);
    return Boolean(entry?.enabled && entry.revision === session.revision && await hashBinding(entry.passwordHash) === session.binding);
  } catch { return false; }
}

export function sessionCookie(value: string, now = Date.now()): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Expires=${new Date(now + SESSION_SECONDS * 1000).toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
