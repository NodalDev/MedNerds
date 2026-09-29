/** Security identifiers are generated only on the server with Web Crypto. */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_ATTEMPTS = 8;

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export function createSessionId(): string {
  return `session_${hex(crypto.getRandomValues(new Uint8Array(16)))}`;
}

export function createJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  // The alphabet has exactly 32 symbols, so each five-bit value is unbiased.
  return Array.from(bytes, (byte) => JOIN_CODE_ALPHABET[byte & 31]).join('');
}

export function normalizeJoinCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(normalized) ? normalized : null;
}

export function createExaminerCapability(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashCapability(capability: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability));
  return hex(new Uint8Array(digest));
}

/** Compare equal-length SHA-256 byte arrays without returning at the first mismatch. */
export function equalCapabilityHashes(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i += 2) {
    difference |= Number.parseInt(left.slice(i, i + 2), 16) ^ Number.parseInt(right.slice(i, i + 2), 16);
  }
  return difference === 0;
}

/** Reservation happens in JoinCodeEntry; a collision only retries the random code. */
export async function reserveUniqueJoinCode(
  reserve: (code: string) => Promise<boolean>,
  generate: () => string = createJoinCode,
  maxAttempts = JOIN_CODE_ATTEMPTS,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generate();
    if (await reserve(code)) return code;
  }
  return null;
}
