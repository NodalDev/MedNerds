import type { CreateSessionResponse, SessionTimerState } from './realtime-protocol';

export const EXAMINER_STORAGE_KEY = 'mednerds.medcases.realtime.examiner.v2';
const LEGACY_EXAMINER_STORAGE_KEY = 'mednerds.medcases.realtime.examiner.v1';
export const PATIENT_STORAGE_KEY = 'mednerds.medcases.realtime.patient.v1';
export const PATIENT_INVITE_STORAGE_KEY = 'mednerds.medcases.realtime.patient.invite.v1';
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const SESSION_ID = /^session_[a-f0-9]{32}$/;
const JOIN_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export interface StoredExaminerSession extends CreateSessionResponse {
  version: 2;
  caseId: string;
}

export interface StoredPatientSession {
  version: 1;
  sessionId: string;
  joinCode: string;
  patientCapability: string;
  expiresAtMs: number;
}

function sessionUrl(baseUrl: string, code: string, destination: 'join' | 'candidate' | 'display' | 'patient'): string {
  if (!JOIN_CODE.test(code)) throw new RangeError('Invalid session code.');
  const url = new URL(`/medcases/session/${destination}/`, baseUrl);
  url.searchParams.set('code', code);
  return url.toString();
}

export function sessionJoinUrl(baseUrl: string, code: string): string {
  return sessionUrl(baseUrl, code, 'join');
}

export function sessionCandidateUrl(baseUrl: string, code: string): string {
  return sessionUrl(baseUrl, code, 'candidate');
}

export function sessionDisplayUrl(baseUrl: string, code: string): string {
  return sessionUrl(baseUrl, code, 'display');
}

export function patientInviteUrl(baseUrl: string, code: string, capability: string): string {
  if (!CAPABILITY.test(capability)) throw new RangeError('Invalid patient capability.');
  const url = new URL(sessionUrl(baseUrl, code, 'patient'));
  url.hash = new URLSearchParams({ access: capability }).toString();
  return url.toString();
}

export function patientCapabilityFromFragment(fragment: string): string | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const capability = params.get('access');
  return [...params.keys()].length === 1 && capability && CAPABILITY.test(capability) ? capability : null;
}

export function normalizeSessionCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return JOIN_CODE.test(code) ? code : null;
}

export function validStoredSession(value: unknown, caseId: string, nowMs: number): value is StoredExaminerSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 7
    && entry.version === 2 && entry.caseId === caseId
    && typeof entry.sessionId === 'string' && SESSION_ID.test(entry.sessionId)
    && typeof entry.joinCode === 'string' && JOIN_CODE.test(entry.joinCode)
    && typeof entry.examinerCapability === 'string' && CAPABILITY.test(entry.examinerCapability)
    && typeof entry.patientCapability === 'string' && CAPABILITY.test(entry.patientCapability)
    && typeof entry.expiresAtMs === 'number' && Number.isSafeInteger(entry.expiresAtMs)
    && entry.expiresAtMs > nowMs;
}

export function validStoredPatientSession(value: unknown, nowMs: number): value is StoredPatientSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 5 && entry.version === 1
    && typeof entry.sessionId === 'string' && SESSION_ID.test(entry.sessionId)
    && typeof entry.joinCode === 'string' && JOIN_CODE.test(entry.joinCode)
    && typeof entry.patientCapability === 'string' && CAPABILITY.test(entry.patientCapability)
    && typeof entry.expiresAtMs === 'number' && Number.isSafeInteger(entry.expiresAtMs)
    && entry.expiresAtMs > nowMs;
}

export function restorePatientSession(storage: Pick<Storage, 'getItem' | 'removeItem'>, nowMs = Date.now()): StoredPatientSession | null {
  try {
    const raw = storage.getItem(PATIENT_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (validStoredPatientSession(value, nowMs)) return value;
    storage.removeItem(PATIENT_STORAGE_KEY);
  } catch {
    try { storage.removeItem(PATIENT_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
  }
  return null;
}

export function savePatientSession(storage: Pick<Storage, 'setItem'>, session: StoredPatientSession): boolean {
  try { storage.setItem(PATIENT_STORAGE_KEY, JSON.stringify(session)); return true; }
  catch { return false; }
}

export function clearPatientSession(storage: Pick<Storage, 'removeItem'>): void {
  try { storage.removeItem(PATIENT_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
  try { storage.removeItem(PATIENT_INVITE_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
}

export function restoreExaminerSession(storage: Pick<Storage, 'getItem' | 'removeItem'>, caseId: string, nowMs = Date.now()): StoredExaminerSession | null {
  try { storage.removeItem(LEGACY_EXAMINER_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
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
  try { storage.removeItem(LEGACY_EXAMINER_STORAGE_KEY); } catch { /* Storage may be blocked. */ }
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
