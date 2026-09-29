/** Shared wire contract for MedCases sessions. No medical case content crosses this boundary. */
export const MAX_CONTROL_MESSAGE_BYTES = 1024;

export type SessionRole = 'examiner' | 'observer';
export type TimerCommand = 'timer.start' | 'timer.pause' | 'timer.resume' | 'timer.reset';
export type TimerStatus = 'ready' | 'running' | 'paused' | 'ended';

export interface SessionTimerState {
  status: TimerStatus;
  durationMs: number;
  warningRemainingMs: number;
  startedAtMs: number | null;
  endsAtMs: number | null;
  remainingAtPauseMs: number | null;
  warningEmitted: boolean;
}

export interface SessionState {
  version: 1;
  sessionId: string;
  caseId: string;
  createdAtMs: number;
  expiresAtMs: number;
  timer: SessionTimerState;
  releasedMaterialIds: string[];
}

export type ClientMessage =
  | { type: TimerCommand }
  | { type: 'time.ping'; clientSentAtMs: number }
  | { type: 'session.authenticate'; role: 'observer' }
  | { type: 'session.authenticate'; role: 'examiner'; capability: string };

export interface CreateSessionRequest {
  caseId: string;
  durationSeconds: number;
  warningRemainingSeconds: number;
}

export interface CreateSessionResponse {
  sessionId: string;
  joinCode: string;
  examinerCapability: string;
  expiresAtMs: number;
}

export interface JoinSessionRequest {
  joinCode: string;
}

export interface JoinSessionResponse {
  sessionId: string;
  expiresAtMs: number;
}

export type TimerEventType =
  | 'timer.started'
  | 'timer.paused'
  | 'timer.resumed'
  | 'timer.reset'
  | 'timer.warning'
  | 'timer.ended';

export type ServerMessage =
  | { type: 'session.snapshot'; state: SessionState; serverNowMs: number }
  | { type: TimerEventType; state: SessionState; serverNowMs: number }
  | { type: 'session.expired'; serverNowMs: number }
  | { type: 'time.pong'; clientSentAtMs: number; serverNowMs: number }
  | { type: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'FORBIDDEN'
  | 'INVALID_STATE_TRANSITION'
  | 'SESSION_EXPIRED'
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED';

export type MessageParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'INVALID_MESSAGE' | 'UNKNOWN_MESSAGE_TYPE' };

const commands = new Set<TimerCommand>(['timer.start', 'timer.pause', 'timer.resume', 'timer.reset']);

export function parseClientMessage(payload: string | ArrayBuffer): MessageParseResult {
  if (typeof payload !== 'string' || new TextEncoder().encode(payload).byteLength > MAX_CONTROL_MESSAGE_BYTES) {
    return { ok: false, code: 'INVALID_MESSAGE' };
  }

  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return { ok: false, code: 'INVALID_MESSAGE' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'INVALID_MESSAGE' };
  }

  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string') return { ok: false, code: 'INVALID_MESSAGE' };
  if (commands.has(record.type as TimerCommand)) {
    return Object.keys(record).length === 1
      ? { ok: true, message: { type: record.type as TimerCommand } }
      : { ok: false, code: 'INVALID_MESSAGE' };
  }
  if (record.type === 'time.ping') {
    return Object.keys(record).length === 2
      && typeof record.clientSentAtMs === 'number'
      && Number.isSafeInteger(record.clientSentAtMs)
      && record.clientSentAtMs >= 0
      ? { ok: true, message: { type: 'time.ping', clientSentAtMs: record.clientSentAtMs } }
      : { ok: false, code: 'INVALID_MESSAGE' };
  }
  if (record.type === 'session.authenticate') {
    if (record.role === 'observer' && Object.keys(record).length === 2) {
      return { ok: true, message: { type: 'session.authenticate', role: 'observer' } };
    }
    if (record.role === 'examiner' && Object.keys(record).length === 3
      && typeof record.capability === 'string' && /^[A-Za-z0-9_-]{43}$/.test(record.capability)) {
      return { ok: true, message: { type: 'session.authenticate', role: 'examiner', capability: record.capability } };
    }
    return { ok: false, code: 'INVALID_MESSAGE' };
  }
  return { ok: false, code: 'UNKNOWN_MESSAGE_TYPE' };
}

export function mayControlTimer(role: SessionRole): boolean {
  return role === 'examiner';
}
