import type { CreateSessionResponse, SessionTimerState } from './realtime-protocol';

export const EXAMINER_STORAGE_KEY = 'mednerds.medcases.realtime.examiner.v1';
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const SESSION_ID = /^session_[a-f0-9]{32}$/;
const JOIN_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export interface StoredExaminerSession extends CreateSessionResponse {
  version: 1;
  caseId: string;
}

export function sessionJoinUrl(baseUrl: string, code: string): string {
  if (!JOIN_CODE.test(code)) throw new RangeError('Invalid session code.');
  const url = new URL('/medcases/session/join/', baseUrl);
  url.searchParams.set('code', code);
  return url.toString();
}

export function normalizeSessionCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return JOIN_CODE.test(code) ? code : null;
}

export function validStoredSession(value: unknown, caseId: string, nowMs: number): value is StoredExaminerSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 6
    && entry.version === 1 && entry.caseId === caseId
    && typeof entry.sessionId === 'string' && SESSION_ID.test(entry.sessionId)
    && typeof entry.joinCode === 'string' && JOIN_CODE.test(entry.joinCode)
    && typeof entry.examinerCapability === 'string' && CAPABILITY.test(entry.examinerCapability)
    && typeof entry.expiresAtMs === 'number' && Number.isSafeInteger(entry.expiresAtMs)
    && entry.expiresAtMs > nowMs;
}

export function restoreExaminerSession(storage: Pick<Storage, 'getItem' | 'removeItem'>, caseId: string, nowMs = Date.now()): StoredExaminerSession | null {
  try {
    const raw = storage.getItem(EXAMINER_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (validStoredSession(value, caseId, nowMs)) return value;
    storage.removeItem(EXAMINER_STORAGE_KEY);
  } catch {
    try { storage.removeItem(EXAMINER_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
  }
  return null;
}

export function saveExaminerSession(storage: Pick<Storage, 'setItem'>, session: StoredExaminerSession): boolean {
  try { storage.setItem(EXAMINER_STORAGE_KEY, JSON.stringify(session)); return true; }
  catch { return false; }
}

export function clearExaminerSession(storage: Pick<Storage, 'removeItem'>): void {
  try { storage.removeItem(EXAMINER_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
}

/** Render-only calculation; the server remains the authority for status and deadlines. */
export function visibleRemainingMs(timer: SessionTimerState, serverNowMs: number): number {
  if (timer.status === 'ready') return timer.durationMs;
  if (timer.status === 'paused') return Math.max(0, timer.remainingAtPauseMs ?? 0);
  if (timer.status === 'ended') return 0;
  return Math.max(0, (timer.endsAtMs ?? serverNowMs) - serverNowMs);
}

/** Snapshots and reconnects never replay an old cue. */
export function cueForLiveEvent(type: string): 'start' | 'warning' | 'end' | null {
  if (type === 'timer.started') return 'start';
  if (type === 'timer.warning') return 'warning';
  if (type === 'timer.ended') return 'end';
  return null;
}
