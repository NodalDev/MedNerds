import { hashCapability } from './identity.ts';

export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const RATE_LIMITS = {
  sessionCreate: 10,
  joinLookup: 120,
  websocketConnect: 120,
  authFailure: 30,
} as const;

export const MAX_HTTP_JSON_BODY_BYTES = 8192;
export const MAX_CONNECTIONS_BY_ROLE = {
  examiner: 3,
  patient: 3,
  display: 12,
  observer: 3,
} as const;

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The IP is only used transiently; the fixed-size hash is never logged or returned. */
export function clientAbuseKey(request: Request): Promise<string> {
  return hashCapability(`medcases-rate:${request.headers.get('CF-Connecting-IP') ?? 'local-client'}`);
}

export async function rateLimitAllows(binding: RateLimitBinding, key: string): Promise<boolean> {
  return (await binding.limit({ key })).success;
}

export type JsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 };

/** Stop reading as soon as the byte limit is exceeded, including without Content-Length. */
export async function readJsonBodyWithLimit(request: Request, maxBytes = MAX_HTTP_JSON_BODY_BYTES): Promise<JsonReadResult> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    return { ok: false, status: 400 };
  }
  const length = request.headers.get('Content-Length');
  if (length !== null) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) return { ok: false, status: 400 };
    if (Number(length) > maxBytes) return { ok: false, status: 413 };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        try { await reader.cancel(); } catch { /* The size limit still applies. */ }
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}
