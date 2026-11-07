const encoder = new TextEncoder();
export const PASSWORD_ITERATIONS = 600_000;
const checkMessage = encoder.encode('MedNerds Preview Access password check v1');

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeBase64url(value: string, length: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding.');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (bytes.length !== length || base64url(bytes) !== value) throw new Error('Invalid encoding.');
  return bytes;
}

export function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function parsePasswordHash(hash: string) {
  const parts = hash.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '1'
    || parts[2] !== String(PASSWORD_ITERATIONS)) throw new Error('Unsupported password hash.');
  return { salt: decodeBase64url(parts[3], 16), derived: decodeBase64url(parts[4], 32) };
}

function passwordBytes(password: string): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(password);
  if (bytes.length < 16 || bytes.length > 256) throw new Error('Password must contain 16–256 UTF-8 bytes.');
  return bytes;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', passwordBytes(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = new Uint8Array(await derive(password, salt));
  return `pbkdf2-sha256$1$${PASSWORD_ITERATIONS}$${base64url(salt)}$${base64url(derived)}`;
}

/** Compare through Web Crypto's HMAC verification, with no JS string comparison of derived keys. */
export async function passwordMatches(password: string, passwordHash: string): Promise<boolean> {
  const { salt, derived } = parsePasswordHash(passwordHash);
  const candidate = await crypto.subtle.importKey('raw', await derive(password, salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', expected, await crypto.subtle.sign('HMAC', candidate, checkMessage), checkMessage);
}

export async function hashBinding(passwordHash: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(passwordHash))));
}
