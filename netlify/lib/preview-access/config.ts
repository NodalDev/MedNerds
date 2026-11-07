import { decodeBase64url, parsePasswordHash, passwordMatches } from './passwords.ts';

export interface Credential {
  id: string;
  enabled: boolean;
  passwordHash: string;
  revision: number;
}
export interface Registry { version: 1; credentials: Credential[] }
export type Environment = (name: string) => string | undefined;
export type AccessConfig = { enabled: false } | { enabled: true; registry: Registry; secret: Uint8Array<ArrayBuffer> };
export const MAX_CREDENTIALS = 8;

export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(value);
}

function exactKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function parseRegistry(raw: string): Registry {
  if (raw.length > 8192) throw new Error('Invalid access configuration.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !exactKeys(value, ['version', 'credentials'])) throw new Error('Invalid registry.');
  const registry = value as Registry;
  if (registry.version !== 1 || !Array.isArray(registry.credentials) || registry.credentials.length < 1
    || registry.credentials.length > MAX_CREDENTIALS) throw new Error('Invalid registry.');
  const ids = new Set<string>();
  const salts = new Set<string>();
  for (const item of registry.credentials) {
    if (!item || typeof item !== 'object' || !exactKeys(item, ['id', 'enabled', 'passwordHash', 'revision'])
      || !validId(item.id) || typeof item.enabled !== 'boolean' || typeof item.passwordHash !== 'string'
      || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.revision > 2_147_483_647
      || ids.has(item.id)) throw new Error('Invalid credential.');
    parsePasswordHash(item.passwordHash);
    const salt = item.passwordHash.split('$')[3];
    if (salts.has(salt)) throw new Error('Duplicate salt.');
    ids.add(item.id);
    salts.add(salt);
  }
  return registry;
}

export function readAccessConfig(env: Environment): AccessConfig {
  const flag = env('MEDNERDS_ACCESS_GATE');
  if (flag === 'disabled') return { enabled: false };
  if (flag !== 'enabled') throw new Error('Access gate must be explicitly configured.');
  return { enabled: true, registry: parseRegistry(env('MEDNERDS_ACCESS_CREDENTIALS') ?? ''),
    secret: decodeBase64url(env('MEDNERDS_ACCESS_SESSION_SECRET') ?? '', 32) };
}

/** Check all entries, including disabled ones. Never authenticate an ambiguous shared password. */
export async function matchingCredentials(password: string, registry: Registry): Promise<Credential[]> {
  const matches: Credential[] = [];
  for (const entry of registry.credentials) {
    if (await passwordMatches(password, entry.passwordHash)) matches.push(entry);
  }
  return matches;
}
