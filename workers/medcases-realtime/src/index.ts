import { DurableObject } from 'cloudflare:workers';
import {
  MAX_CONTROL_MESSAGE_BYTES,
  mayControlTimer,
  parseClientMessage,
  type ErrorCode,
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
  validSessionConfig,
} from '../../../src/lib/medcases/realtime-state.ts';

interface WorkerEnv {
  MEDCASE_SESSIONS: DurableObjectNamespace<MedCaseSession>;
  /** Only supplied by `npm run realtime:dev`; omitted from deployable config. */
  ENVIRONMENT?: string;
}

interface ConnectionAttachment {
  connectionId: string;
  role: SessionRole;
}

const SESSION_PATH = /^\/__dev\/sessions\/(session_[a-f0-9]{20})(?:\/(connect|state))?$/;
const ALLOWED_ORIGINS = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);
const STATE_KEY = 'session';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  // Non-browser test clients may omit Origin only in this development-only router.
  return origin === null || ALLOWED_ORIGINS.has(origin);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });

    // Phase 6A exposes no production session endpoint or query-based authorization.
    if (env.ENVIRONMENT !== 'development') return new Response('Not found', { status: 404 });
    if (!originAllowed(request)) return new Response('Forbidden origin', { status: 403 });

    const route = SESSION_PATH.exec(url.pathname);
    if (!route) return new Response('Not found', { status: 404 });
    const [, sessionId, action] = route;
    if (action === 'connect' && (request.method !== 'GET' || !['examiner', 'observer'].includes(url.searchParams.get('role') ?? ''))) {
      return new Response('Invalid connection request', { status: 400 });
    }
    if (action === 'connect' && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    if (action === 'state' && request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (!action && request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // A stable random session ID maps to exactly one Durable Object instance.
    const id = env.MEDCASE_SESSIONS.idFromName(sessionId);
    return env.MEDCASE_SESSIONS.get(id).fetch(request);
  },
};

export class MedCaseSession extends DurableObject<WorkerEnv> {
  private async load(): Promise<SessionState | null> {
    const state = await this.ctx.storage.get<SessionState>(STATE_KEY);
    return state?.version === 1 ? state : null;
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // Hibernated/disconnected sockets are recovered from ctx.getWebSockets().
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, message);
  }

  private error(socket: WebSocket, code: ErrorCode): void {
    const messages: Record<ErrorCode, string> = {
      INVALID_MESSAGE: 'Invalid control message.',
      UNKNOWN_MESSAGE_TYPE: 'Unknown control message.',
      FORBIDDEN: 'This role cannot change the timer.',
      INVALID_STATE_TRANSITION: 'Timer command is not valid in the current state.',
      SESSION_EXPIRED: 'Session is unavailable or expired.',
    };
    this.send(socket, { type: 'error', code, message: messages[code] });
  }

  private broadcastEvents(events: readonly TimerEventType[], state: SessionState, nowMs: number): void {
    for (const type of events) this.broadcast({ type, state, serverNowMs: nowMs });
  }

  private async scheduleNextAlarm(state: SessionState): Promise<void> {
    await this.ctx.storage.setAlarm(nextAlarmAt(state));
  }

  private async expire(nowMs: number): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.broadcast({ type: 'session.expired', serverNowMs: nowMs });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(1000, 'Session expired'); } catch { /* Socket may already be closed. */ }
    }
  }

  private async settle(state: SessionState, nowMs: number): Promise<SessionState | null> {
    if (nowMs >= state.expiresAtMs) {
      await this.expire(nowMs);
      return null;
    }
    const change = advanceSession(state, nowMs);
    if (change.events.length) {
      await this.ctx.storage.put(STATE_KEY, change.state);
      await this.scheduleNextAlarm(change.state);
      this.broadcastEvents(change.events, change.state, nowMs);
    }
    return change.state;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.env.ENVIRONMENT !== 'development') return new Response('Not found', { status: 404 });
    const url = new URL(request.url);
    const nowMs = Date.now();

    if (request.method === 'POST' && SESSION_PATH.test(url.pathname) && !url.pathname.endsWith('/connect') && !url.pathname.endsWith('/state')) {
      if (await this.load()) return json({ error: 'Session already initialized.' }, 409);
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_CONTROL_MESSAGE_BYTES) return json({ error: 'Invalid configuration.' }, 400);
      let config: unknown;
      try { config = JSON.parse(body); } catch { return json({ error: 'Invalid configuration.' }, 400); }
      const sessionId = SESSION_PATH.exec(url.pathname)?.[1];
      if (!validSessionConfig(config) || config.sessionId !== sessionId) return json({ error: 'Invalid configuration.' }, 400);
      const state = createSession(config, nowMs);
      await this.ctx.storage.put(STATE_KEY, state);
      await this.scheduleNextAlarm(state);
      return json({ state }, 201);
    }

    const persisted = await this.load();
    if (!persisted) return json({ error: 'Session not found.' }, 404);
    const state = await this.settle(persisted, nowMs);
    if (!state) return json({ error: 'Session expired.' }, 410);

    if (url.pathname.endsWith('/state') && request.method === 'GET') {
      return json({ state, serverNowMs: nowMs });
    }
    if (url.pathname.endsWith('/connect') && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const role = url.searchParams.get('role');
      if (role !== 'examiner' && role !== 'observer') return json({ error: 'Invalid role.' }, 400);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ connectionId: crypto.randomUUID(), role } satisfies ConnectionAttachment);
      this.send(server, { type: 'session.snapshot', state, serverNowMs: nowMs });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, payload: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment || (attachment.role !== 'examiner' && attachment.role !== 'observer')) {
      this.error(socket, 'FORBIDDEN');
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
    const state = persisted && await this.settle(persisted, nowMs);
    if (!state) {
      this.error(socket, 'SESSION_EXPIRED');
      return;
    }
    if (parsed.message.type === 'time.ping') {
      this.send(socket, { type: 'time.pong', clientSentAtMs: parsed.message.clientSentAtMs, serverNowMs: Date.now() });
      return;
    }
    if (!mayControlTimer(attachment.role)) {
      this.error(socket, 'FORBIDDEN');
      return;
    }
    const change = applyTimerCommand(state, parsed.message.type, nowMs);
    if ('error' in change) {
      this.error(socket, change.error);
      return;
    }
    await this.ctx.storage.put(STATE_KEY, change.state);
    await this.scheduleNextAlarm(change.state);
    this.broadcastEvents(change.events, change.state, nowMs);
  }

  async alarm(): Promise<void> {
    const state = await this.load();
    if (!state) return;
    const settled = await this.settle(state, Date.now());
    if (settled) await this.scheduleNextAlarm(settled);
  }

  webSocketClose(): void {
    // No connection map to clean up: the runtime owns hibernatable sockets.
  }

  webSocketError(socket: WebSocket): void {
    try { socket.close(1011, 'Connection error'); } catch { /* Already disconnected. */ }
  }
}
