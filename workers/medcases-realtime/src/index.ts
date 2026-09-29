import { DurableObject } from 'cloudflare:workers';
import {
  MAX_CONTROL_MESSAGE_BYTES,
  mayControlTimer,
  parseClientMessage,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type ErrorCode,
  type JoinSessionResponse,
  type ServerMessage,
  type SessionRole,
  type SessionState,
  type TimerEventType,
} from '../../../src/lib/medcases/realtime-protocol.ts';
import {
  advanceSession,
  applyTimerCommand,
  createSession,
  nextAlarmAt,
  validCreateSessionRequest,
  validSessionConfig,
  DEVELOPMENT_SESSION_TTL_MS,
} from '../../../src/lib/medcases/realtime-state.ts';
import {
  createExaminerCapability,
  createSessionId,
  equalCapabilityHashes,
  hashCapability,
  normalizeJoinCode,
  reserveUniqueJoinCode,
} from './identity.ts';
import { JoinCodeEntry, type JoinCodeMapping } from './JoinCodeEntry.ts';

export { JoinCodeEntry };

interface WorkerEnv {
  MEDCASE_SESSIONS: DurableObjectNamespace<MedCaseSession>;
  JOIN_CODE_ENTRIES: DurableObjectNamespace<JoinCodeEntry>;
  /** Supplied only by `npm run realtime:dev`; never in deployable config. */
  ENVIRONMENT?: string;
}

interface StoredSession {
  state: SessionState;
  joinCode: string;
  examinerCapabilityHash: string;
}

interface ConnectionAttachment {
  connectionId: string;
  authenticated: boolean;
  role: SessionRole | null;
  failedAuthAttempts: number;
}

const SESSION_ROUTE = /^\/sessions\/(session_[a-f0-9]{32})\/connect$/;
const DEBUG_STATE_ROUTE = /^\/__dev\/sessions\/(session_[a-f0-9]{32})\/state$/;
const DEBUG_CODE_ROUTE = /^\/__dev\/join-codes\/([A-HJ-NP-Z2-9]{6})\/(reserve|lookup|release)$/;
const ALLOWED_ORIGINS = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);
const STATE_KEY = 'session';
const MIN_TEST_TTL_MS = 1000;
const MAX_TEST_TTL_MS = 60_000;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function withLocalCors(response: Response, request: Request): Response {
  if (response.status === 101) return response;
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  // Origin-less non-browser test clients are accepted only in this dev-only router.
  return origin === null || ALLOWED_ORIGINS.has(origin);
}

async function readSmallJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return { ok: false };
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (contentLength > MAX_CONTROL_MESSAGE_BYTES) return { ok: false };
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_CONTROL_MESSAGE_BYTES) return { ok: false };
  try { return { ok: true, value: JSON.parse(body) }; } catch { return { ok: false }; }
}

function sessionStub(env: WorkerEnv, sessionId: string): DurableObjectStub<MedCaseSession> {
  return env.MEDCASE_SESSIONS.get(env.MEDCASE_SESSIONS.idFromName(sessionId));
}

function codeStub(env: WorkerEnv, code: string): DurableObjectStub<JoinCodeEntry> {
  return env.JOIN_CODE_ENTRIES.get(env.JOIN_CODE_ENTRIES.idFromName(code));
}

function internalRequest(path: string, method = 'GET', body?: unknown): Request {
  return new Request(`http://internal${path}`, body === undefined ? { method } : {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function releaseCode(env: WorkerEnv, code: string, expectedSessionId: string): Promise<void> {
  try {
    await codeStub(env, code).fetch(internalRequest('/release', 'POST', { sessionId: expectedSessionId }));
  } catch {
    // The entry's own expiry alarm is the fallback after a partial failure.
  }
}

function testTtl(request: Request): number | null {
  const raw = request.headers.get('X-MedNerds-Test-TTL-Ms');
  if (raw === null) return DEVELOPMENT_SESSION_TTL_MS;
  if (!/^\d{1,5}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= MIN_TEST_TTL_MS && value <= MAX_TEST_TTL_MS ? value : null;
}

async function createSessionResponse(request: Request, env: WorkerEnv): Promise<Response> {
  const parsed = await readSmallJson(request);
  if (!parsed.ok || !validCreateSessionRequest(parsed.value)) return json({ code: 'INVALID_REQUEST' }, 400);
  const ttlMs = testTtl(request);
  if (ttlMs === null) return json({ code: 'INVALID_REQUEST' }, 400);

  const config: CreateSessionRequest = parsed.value;
  const sessionId = createSessionId();
  const examinerCapability = createExaminerCapability();
  const examinerCapabilityHash = await hashCapability(examinerCapability);
  const state = createSession({ ...config, sessionId }, Date.now(), ttlMs);
  let attemptedCode: string | null = null;
  let joinCode: string | null;

  try {
    joinCode = await reserveUniqueJoinCode(async (code) => {
      attemptedCode = code;
      const mapping: JoinCodeMapping = { version: 1, sessionId, expiresAtMs: state.expiresAtMs };
      const result = await codeStub(env, code).fetch(internalRequest('/reserve', 'POST', mapping));
      if (result.status === 201) return true;
      if (result.status === 409) return false;
      throw new Error('Join-code reservation failed.');
    });
  } catch {
    if (attemptedCode) await releaseCode(env, attemptedCode, sessionId);
    return json({ code: 'SESSION_CREATION_FAILED' }, 503);
  }
  if (!joinCode) return json({ code: 'SESSION_CREATION_FAILED' }, 503);

  try {
    const result = await sessionStub(env, sessionId).fetch(internalRequest('/initialize', 'POST', {
      state, joinCode, examinerCapabilityHash,
    } satisfies StoredSession));
    if (result.status !== 201) throw new Error('Session initialization failed.');
  } catch {
    await releaseCode(env, joinCode, sessionId);
    return json({ code: 'SESSION_CREATION_FAILED' }, 503);
  }

  const body: CreateSessionResponse = {
    sessionId, joinCode, examinerCapability, expiresAtMs: state.expiresAtMs,
  };
  return json(body, 201);
}

async function joinSessionResponse(request: Request, env: WorkerEnv): Promise<Response> {
  const parsed = await readSmallJson(request);
  const value = parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown> : null;
  const code = value && Object.keys(value).length === 1 ? normalizeJoinCode(value.joinCode) : null;
  if (!code) return json({ code: 'JOIN_CODE_INVALID' }, 404);

  const lookup = await codeStub(env, code).fetch(internalRequest('/lookup'));
  if (lookup.status !== 200) return json({ code: 'JOIN_CODE_INVALID' }, 404);
  const mapping = await lookup.json() as JoinSessionResponse;
  // A failed cross-object initialization must never leave a joinable ghost session.
  const active = await sessionStub(env, mapping.sessionId).fetch(internalRequest('/exists'));
  if (active.status !== 200) {
    await releaseCode(env, code, mapping.sessionId);
    return json({ code: 'JOIN_CODE_INVALID' }, 404);
  }
  return json({ sessionId: mapping.sessionId, expiresAtMs: mapping.expiresAtMs } satisfies JoinSessionResponse);
}

/** Development-only direct access for reservation race and cleanup tests. */
async function debugCodeResponse(request: Request, env: WorkerEnv, code: string, action: string): Promise<Response> {
  const method = action === 'lookup' ? 'GET' : 'POST';
  if (request.method !== method) return json({ code: 'INVALID_REQUEST' }, 405);
  if (method === 'GET') return codeStub(env, code).fetch(internalRequest('/lookup'));
  const body = await readSmallJson(request);
  if (!body.ok) return json({ code: 'INVALID_REQUEST' }, 400);
  return codeStub(env, code).fetch(internalRequest(`/${action}`, 'POST', body.value));
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });

    // No production session API exists until abuse protection and public auth are designed.
    if (env.ENVIRONMENT !== 'development') return new Response('Not found', { status: 404 });
    if (!originAllowed(request)) return new Response('Forbidden origin', { status: 403 });

    let result: Response;
    if (request.method === 'OPTIONS' && (url.pathname === '/sessions' || url.pathname === '/sessions/join')) {
      result = new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-MedNerds-Test-TTL-Ms' },
      });
    } else if (url.pathname === '/sessions' && request.method === 'POST') {
      result = await createSessionResponse(request, env);
    } else if (url.pathname === '/sessions/join' && request.method === 'POST') {
      result = await joinSessionResponse(request, env);
    } else {
      const connect = SESSION_ROUTE.exec(url.pathname);
      const debug = DEBUG_STATE_ROUTE.exec(url.pathname);
      const debugCode = DEBUG_CODE_ROUTE.exec(url.pathname);
      if (connect && request.method === 'GET') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
        // `?role=examiner` is ignored: only the first WebSocket auth message grants rights.
        if ([...url.searchParams.keys()].some((key) => key !== 'role')) return new Response('Invalid connection request', { status: 400 });
        return sessionStub(env, connect[1]).fetch(request);
      }
      if (debugCode) {
        result = await debugCodeResponse(request, env, debugCode[1], debugCode[2]);
      } else if (debug && request.method === 'GET') {
        result = await sessionStub(env, debug[1]).fetch(internalRequest('/state'));
      } else {
        result = new Response('Not found', { status: 404 });
      }
    }
    return withLocalCors(result, request);
  },
};

function validStoredSession(value: unknown): value is StoredSession {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const stored = value as Record<string, unknown>;
  if (typeof stored.joinCode !== 'string' || normalizeJoinCode(stored.joinCode) !== stored.joinCode
    || typeof stored.examinerCapabilityHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(stored.examinerCapabilityHash)) return false;
  const state = stored.state as SessionState | undefined;
  if (!state || state.version !== 1 || !state.timer || !Array.isArray(state.releasedMaterialIds)
    || state.timer.status !== 'ready' || state.timer.startedAtMs !== null
    || state.timer.endsAtMs !== null || state.timer.remainingAtPauseMs !== null
    || state.timer.warningEmitted !== false || !Number.isSafeInteger(state.createdAtMs)
    || !Number.isSafeInteger(state.expiresAtMs)) return false;
  const ttlMs = state.expiresAtMs - state.createdAtMs;
  return ttlMs > 0 && ttlMs <= DEVELOPMENT_SESSION_TTL_MS
    && validSessionConfig({
      sessionId: state.sessionId,
      caseId: state.caseId,
      durationSeconds: state.timer.durationMs / 1000,
      warningRemainingSeconds: state.timer.warningRemainingMs / 1000,
    });
}

export class MedCaseSession extends DurableObject<WorkerEnv> {
  private async load(): Promise<StoredSession | null> {
    const stored = await this.ctx.storage.get<StoredSession>(STATE_KEY);
    return stored?.state?.version === 1 ? stored : null;
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try { socket.send(JSON.stringify(message)); } catch { /* Socket may have disconnected. */ }
  }

  private broadcast(message: ServerMessage): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.authenticated) this.send(socket, message);
    }
  }

  private error(socket: WebSocket, code: ErrorCode): void {
    const messages: Record<ErrorCode, string> = {
      INVALID_MESSAGE: 'Invalid control message.',
      UNKNOWN_MESSAGE_TYPE: 'Unknown control message.',
      FORBIDDEN: 'This role cannot change the timer.',
      INVALID_STATE_TRANSITION: 'Timer command is not valid in the current state.',
      SESSION_EXPIRED: 'Session is unavailable or expired.',
      AUTH_REQUIRED: 'Authenticate before using this session.',
      AUTH_FAILED: 'Authentication failed.',
    };
    this.send(socket, { type: 'error', code, message: messages[code] });
  }

  private broadcastEvents(events: readonly TimerEventType[], state: SessionState, nowMs: number): void {
    for (const type of events) this.broadcast({ type, state, serverNowMs: nowMs });
  }

  private async scheduleNextAlarm(state: SessionState): Promise<void> {
    await this.ctx.storage.setAlarm(nextAlarmAt(state));
  }

  private async expire(stored: StoredSession, nowMs: number): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.broadcast({ type: 'session.expired', serverNowMs: nowMs });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(1000, 'Session expired'); } catch { /* Already disconnected. */ }
    }
    await releaseCode(this.env, stored.joinCode, stored.state.sessionId);
  }

  private async settle(stored: StoredSession, nowMs: number): Promise<StoredSession | null> {
    if (nowMs >= stored.state.expiresAtMs) {
      await this.expire(stored, nowMs);
      return null;
    }
    const change = advanceSession(stored.state, nowMs);
    if (change.events.length) {
      stored = { ...stored, state: change.state };
      await this.ctx.storage.put(STATE_KEY, stored);
      await this.scheduleNextAlarm(stored.state);
      this.broadcastEvents(change.events, stored.state, nowMs);
    }
    return stored;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.env.ENVIRONMENT !== 'development') return new Response('Not found', { status: 404 });
    const path = new URL(request.url).pathname;
    const nowMs = Date.now();

    if (path === '/initialize' && request.method === 'POST') {
      if (await this.load()) return json({ code: 'SESSION_ALREADY_INITIALIZED' }, 409);
      let value: unknown;
      try { value = await request.json(); } catch { return json({ code: 'INVALID_REQUEST' }, 400); }
      if (!validStoredSession(value) || value.state.expiresAtMs <= nowMs) return json({ code: 'INVALID_REQUEST' }, 400);
      await this.ctx.storage.put(STATE_KEY, value);
      await this.scheduleNextAlarm(value.state);
      return json({ created: true }, 201);
    }

    const persisted = await this.load();
    if (!persisted) return json({ code: 'SESSION_NOT_FOUND' }, 404);
    const stored = await this.settle(persisted, nowMs);
    if (!stored) return json({ code: 'SESSION_EXPIRED' }, 410);
    if (path === '/exists' && request.method === 'GET') return json({ active: true });
    if (path === '/state' && request.method === 'GET') return json({ state: stored.state, serverNowMs: nowMs });

    if (path.endsWith('/connect') && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        connectionId: crypto.randomUUID(), authenticated: false, role: null, failedAuthAttempts: 0,
      } satisfies ConnectionAttachment);
      // The first snapshot is sent only after a valid authentication message.
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, payload: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment || typeof attachment.connectionId !== 'string') {
      socket.close(1008, 'Invalid connection');
      return;
    }
    const parsed = parseClientMessage(payload);
    if (!parsed.ok) {
      this.error(socket, parsed.code);
      return;
    }
    const nowMs = Date.now();
    const persisted = await this.load();
    const stored = persisted && await this.settle(persisted, nowMs);
    if (!stored) {
      this.error(socket, 'SESSION_EXPIRED');
      return;
    }

    if (!attachment.authenticated) {
      if (parsed.message.type !== 'session.authenticate') {
        this.error(socket, 'AUTH_REQUIRED');
        return;
      }
      if (parsed.message.role === 'examiner') {
        const candidateHash = await hashCapability(parsed.message.capability);
        if (!equalCapabilityHashes(candidateHash, stored.examinerCapabilityHash)) {
          attachment.failedAuthAttempts += 1;
          socket.serializeAttachment(attachment);
          this.error(socket, 'AUTH_FAILED');
          if (attachment.failedAuthAttempts >= 3) socket.close(1008, 'Authentication failed');
          return;
        }
      }
      socket.serializeAttachment({ ...attachment, authenticated: true, role: parsed.message.role } satisfies ConnectionAttachment);
      this.send(socket, { type: 'session.snapshot', state: stored.state, serverNowMs: nowMs });
      return;
    }

    if (parsed.message.type === 'session.authenticate') {
      this.error(socket, 'INVALID_STATE_TRANSITION');
      return;
    }
    if (parsed.message.type === 'time.ping') {
      this.send(socket, { type: 'time.pong', clientSentAtMs: parsed.message.clientSentAtMs, serverNowMs: Date.now() });
      return;
    }
    if (!attachment.role || !mayControlTimer(attachment.role)) {
      this.error(socket, 'FORBIDDEN');
      return;
    }
    const change = applyTimerCommand(stored.state, parsed.message.type, nowMs);
    if ('error' in change) {
      this.error(socket, change.error);
      return;
    }
    const updated = { ...stored, state: change.state };
    await this.ctx.storage.put(STATE_KEY, updated);
    await this.scheduleNextAlarm(updated.state);
    this.broadcastEvents(change.events, updated.state, nowMs);
  }

  async alarm(): Promise<void> {
    const stored = await this.load();
    if (!stored) return;
    const settled = await this.settle(stored, Date.now());
    if (settled) await this.scheduleNextAlarm(settled.state);
  }

  webSocketClose(): void {
    // The runtime owns hibernatable sockets; there is no in-memory connection map.
  }

  webSocketError(socket: WebSocket): void {
    try { socket.close(1011, 'Connection error'); } catch { /* Already disconnected. */ }
  }
}
