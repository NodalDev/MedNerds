import { DurableObject } from 'cloudflare:workers';

export interface JoinCodeMapping {
  version: 1;
  sessionId: string;
  expiresAtMs: number;
}

const MAPPING_KEY = 'mapping';
const SESSION_ID = /^session_[a-f0-9]{32}$/;

function validMapping(value: unknown): value is JoinCodeMapping {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const mapping = value as Record<string, unknown>;
  return Object.keys(mapping).length === 3
    && mapping.version === 1
    && typeof mapping.sessionId === 'string'
    && SESSION_ID.test(mapping.sessionId)
    && typeof mapping.expiresAtMs === 'number'
    && Number.isSafeInteger(mapping.expiresAtMs);
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** One SQLite-backed object per code; no global registry or in-memory map. */
export class JoinCodeEntry extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/reserve' && request.method === 'POST') {
      let candidate: unknown;
      try { candidate = await request.json(); } catch { return response({ error: 'Invalid mapping.' }, 400); }
      if (!validMapping(candidate) || candidate.expiresAtMs <= Date.now()) {
        return response({ error: 'Invalid mapping.' }, 400);
      }

      // The transaction makes check + write one atomic reservation for this code.
      const reserved = await this.ctx.storage.transaction(async (storage) => {
        const current = await storage.get<JoinCodeMapping>(MAPPING_KEY);
        if (current && current.expiresAtMs > Date.now()) return false;
        await storage.put(MAPPING_KEY, candidate);
        await storage.setAlarm(candidate.expiresAtMs);
        return true;
      });
      if (!reserved) return response({ reserved: false }, 409);
      return response({ reserved: true }, 201);
    }

    if (path === '/lookup' && request.method === 'GET') {
      const mapping = await this.ctx.storage.transaction(async (storage) => {
        const current = await storage.get<JoinCodeMapping>(MAPPING_KEY);
        if (current && current.expiresAtMs <= Date.now()) {
          await storage.delete(MAPPING_KEY);
          return null;
        }
        return current ?? null;
      });
      if (!mapping) {
        return response({ found: false }, 404);
      }
      return response({ sessionId: mapping.sessionId, expiresAtMs: mapping.expiresAtMs });
    }

    if (path === '/release' && request.method === 'POST') {
      let body: unknown;
      try { body = await request.json(); } catch { return response({ released: false }, 400); }
      const expected = body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).sessionId : null;
      if (typeof expected !== 'string' || !SESSION_ID.test(expected)) return response({ released: false }, 400);
      const released = await this.ctx.storage.transaction(async (storage) => {
        const mapping = await storage.get<JoinCodeMapping>(MAPPING_KEY);
        if (!mapping || mapping.sessionId !== expected) return false;
        await storage.delete(MAPPING_KEY);
        return true;
      });
      // A stale alarm is harmless and avoids racing a new reservation's alarm.
      return response({ released });
    }

    return new Response('Not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.transaction(async (storage) => {
      const mapping = await storage.get<JoinCodeMapping>(MAPPING_KEY);
      if (!mapping) return;
      if (mapping.expiresAtMs <= Date.now()) await storage.delete(MAPPING_KEY);
      else await storage.setAlarm(mapping.expiresAtMs);
    });
  }
}
