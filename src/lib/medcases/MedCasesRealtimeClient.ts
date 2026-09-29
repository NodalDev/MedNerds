import type {
  CreateSessionRequest, CreateSessionResponse, JoinSessionResponse, ServerMessage, SessionRole, TimerCommand,
} from './realtime-protocol';

export type ConnectionStatus = 'connecting' | 'authenticating' | 'connected' | 'reconnecting' | 'expired' | 'error';
interface ClientOptions {
  baseUrl: string;
  sessionId: string;
  expiresAtMs: number;
  joinCode?: string;
  role: SessionRole;
  capability?: string;
  onStatus(status: ConnectionStatus): void;
  onMessage(message: ServerMessage): void;
  onTerminal(reason: 'expired' | 'auth-failed'): void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
const SYNC_INTERVAL_MS = 60_000;
const SYNC_SAMPLES = 3;

function endpoint(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint(baseUrl, path), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'not-found' : 'unavailable');
  return response.json() as Promise<T>;
}

export function createRealtimeSession(baseUrl: string, request: CreateSessionRequest): Promise<CreateSessionResponse> {
  return postJson(baseUrl, '/sessions', request);
}

export function resolveRealtimeCode(baseUrl: string, code: string): Promise<JoinSessionResponse> {
  return postJson(baseUrl, '/sessions/join', { joinCode: code });
}

/** Native WebSocket transport with one authoritative snapshot and bounded reconnect delay. */
export class MedCasesRealtimeClient {
  private socket: WebSocket | null = null;
  private closed = false;
  private terminal = false;
  private connected = false;
  private retries = 0;
  private retryTimer: number | null = null;
  private syncTimer: number | null = null;
  private expiryTimer: number | null = null;
  private pendingPing: { sentAtMs: number; perfMs: number } | null = null;
  private samples = 0;
  private bestRtt = Infinity;
  private offsetMs: number | null = null;
  private anchorPerfMs = 0;
  private anchorServerMs = 0;

  constructor(private readonly options: ClientOptions) {}

  start(): void {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.expiryTimer = window.setTimeout(() => this.expire(), Math.max(0, this.options.expiresAtMs - Date.now()));
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
    if (this.expiryTimer !== null) window.clearTimeout(this.expiryTimer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    this.socket?.close();
    this.socket = null;
  }

  getServerNowMs(): number {
    return this.anchorPerfMs ? this.anchorServerMs + performance.now() - this.anchorPerfMs : Date.now();
  }

  sendCommand(command: TimerCommand): boolean {
    if (this.options.role !== 'examiner' || !this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: command }));
    return true;
  }

  private readonly onOnline = () => {
    if (!this.closed && !this.terminal && (!this.socket || this.socket.readyState === WebSocket.CLOSED)) this.connect();
  };
  private readonly onOffline = () => {
    if (!this.closed && !this.terminal) this.options.onStatus('reconnecting');
  };

  private expire(): void {
    if (this.closed || this.terminal) return;
    this.terminal = true;
    this.options.onStatus('expired');
    this.options.onTerminal('expired');
    this.stop();
  }

  private connect(): void {
    if (this.closed || this.terminal) return;
    if (Date.now() >= this.options.expiresAtMs) { this.expire(); return; }
    if (!navigator.onLine) { this.options.onStatus('reconnecting'); return; }
    this.options.onStatus(this.retries ? 'reconnecting' : 'connecting');
    this.connected = false;
    this.offsetMs = null;
    this.pendingPing = null;
    this.bestRtt = Infinity;
    this.samples = 0;
    const url = new URL(`/sessions/${this.options.sessionId}/connect`, this.options.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    let authenticated = false;
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.closed || this.socket !== socket) return;
      this.options.onStatus('authenticating');
      socket.send(JSON.stringify(this.options.role === 'examiner'
        ? { type: 'session.authenticate', role: 'examiner', capability: this.options.capability }
        : { type: 'session.authenticate', role: 'observer' }));
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      if (this.closed || this.socket !== socket) return;
      let message: ServerMessage;
      try { message = JSON.parse(event.data) as ServerMessage; } catch { return; }
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'error' && message.code === 'AUTH_FAILED') {
        this.terminal = true;
        this.options.onTerminal('auth-failed');
        this.options.onStatus('error');
        this.stop();
        return;
      }
      if (message.type === 'session.expired' || (message.type === 'error' && message.code === 'SESSION_EXPIRED')) {
        this.expire();
        return;
      }
      if (message.type === 'time.pong') { this.receivePong(message); return; }
      if ('state' in message && typeof message.serverNowMs === 'number') {
        this.anchorPerfMs = performance.now();
        this.anchorServerMs = this.offsetMs === null ? message.serverNowMs : Date.now() + this.offsetMs;
        if (message.type === 'session.snapshot') {
          authenticated = true;
          this.connected = true;
          this.retries = 0;
          this.options.onStatus('connected');
          this.syncClock();
          if (this.syncTimer === null) this.syncTimer = window.setInterval(() => this.syncClock(), SYNC_INTERVAL_MS);
        }
      }
      this.options.onMessage(message);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected = false;
      if (this.syncTimer !== null) { window.clearInterval(this.syncTimer); this.syncTimer = null; }
      if (!this.closed && !this.terminal) void this.reconnectAfterClose(authenticated);
    });
    socket.addEventListener('error', () => { /* close drives reconnect without exposing URL or credentials */ });
  }

  private async reconnectAfterClose(wasAuthenticated: boolean): Promise<void> {
    if (!wasAuthenticated && this.options.joinCode) {
      try {
        await resolveRealtimeCode(this.options.baseUrl, this.options.joinCode);
      } catch (error) {
        if (error instanceof Error && error.message === 'not-found') { this.expire(); return; }
      }
    }
    if (!this.closed && !this.terminal) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.options.onStatus('reconnecting');
    if (!navigator.onLine || this.retryTimer !== null) return;
    const base = BACKOFF_MS[Math.min(this.retries, BACKOFF_MS.length - 1)];
    this.retries += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, base + Math.random() * Math.min(250, base / 4));
  }

  private syncClock(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.pendingPing) return;
    const sentAtMs = Date.now();
    this.pendingPing = { sentAtMs, perfMs: performance.now() };
    this.socket.send(JSON.stringify({ type: 'time.ping', clientSentAtMs: sentAtMs }));
  }

  private receivePong(message: Extract<ServerMessage, { type: 'time.pong' }>): void {
    const ping = this.pendingPing;
    if (!ping || ping.sentAtMs !== message.clientSentAtMs) return;
    this.pendingPing = null;
    const rtt = performance.now() - ping.perfMs;
    this.samples += 1;
    if (rtt < this.bestRtt) {
      this.bestRtt = rtt;
      this.offsetMs = message.serverNowMs - (ping.sentAtMs + rtt / 2);
      this.anchorPerfMs = performance.now();
      this.anchorServerMs = Date.now() + this.offsetMs;
      this.options.onMessage(message);
    }
    if (this.samples < SYNC_SAMPLES) this.syncClock();
  }
}
