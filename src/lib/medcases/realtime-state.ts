import type { SessionState, SessionTimerState, TimerCommand, TimerEventType } from './realtime-protocol.ts';

/** Local prototype retention. Production policy belongs to a later phase. */
export const DEVELOPMENT_SESSION_TTL_MS = 60 * 60 * 1000;
export const MAX_SESSION_DURATION_MS = 30 * 60 * 1000;

export interface SessionConfig {
  sessionId: string;
  caseId: string;
  durationSeconds: number;
  warningRemainingSeconds: number;
}

export interface StateChange {
  state: SessionState;
  events: TimerEventType[];
}

export type TimerActionResult = StateChange | { error: 'INVALID_STATE_TRANSITION' };

export function validSessionConfig(value: unknown): value is SessionConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 4) return false;
  const duration = input.durationSeconds;
  const warning = input.warningRemainingSeconds;
  return typeof input.sessionId === 'string'
    && /^session_[a-f0-9]{20}$/.test(input.sessionId)
    && typeof input.caseId === 'string'
    && /^case-[a-f0-9]{10}$/.test(input.caseId)
    && typeof duration === 'number'
    && Number.isSafeInteger(duration)
    && duration > 0
    && duration * 1000 <= MAX_SESSION_DURATION_MS
    && typeof warning === 'number'
    && Number.isSafeInteger(warning)
    && warning >= 0
    && warning < duration;
}

export function createSession(config: SessionConfig, nowMs: number): SessionState {
  if (!validSessionConfig(config)) throw new RangeError('Invalid session configuration.');
  return {
    version: 1,
    sessionId: config.sessionId,
    caseId: config.caseId,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + DEVELOPMENT_SESSION_TTL_MS,
    timer: {
      status: 'ready',
      durationMs: config.durationSeconds * 1000,
      warningRemainingMs: config.warningRemainingSeconds * 1000,
      startedAtMs: null,
      endsAtMs: null,
      remainingAtPauseMs: null,
      warningEmitted: false,
    },
    releasedMaterialIds: [],
  };
}

export function remainingMs(timer: SessionTimerState, nowMs: number): number {
  switch (timer.status) {
    case 'ready': return timer.durationMs;
    case 'running': return Math.max(0, (timer.endsAtMs ?? nowMs) - nowMs);
    case 'paused': return timer.remainingAtPauseMs ?? 0;
    case 'ended': return 0;
  }
}

/** Settle crossed thresholds in warning → end order, including a late alarm. */
export function advanceSession(state: SessionState, nowMs: number): StateChange {
  if (state.timer.status !== 'running') return { state, events: [] };
  const timer = { ...state.timer };
  const events: TimerEventType[] = [];
  const remaining = remainingMs(timer, nowMs);
  if (timer.warningRemainingMs > 0 && !timer.warningEmitted && remaining <= timer.warningRemainingMs) {
    timer.warningEmitted = true;
    events.push('timer.warning');
  }
  if (remaining === 0) {
    timer.status = 'ended';
    timer.endsAtMs = null;
    timer.remainingAtPauseMs = 0;
    events.push('timer.ended');
  }
  return events.length ? { state: { ...state, timer }, events } : { state, events };
}

/** Caller first settles due thresholds; commands never supply timestamps. */
export function applyTimerCommand(state: SessionState, command: TimerCommand, nowMs: number): TimerActionResult {
  const timer = { ...state.timer };
  let event: TimerEventType;
  switch (command) {
    case 'timer.start':
      if (timer.status !== 'ready') return { error: 'INVALID_STATE_TRANSITION' };
      timer.status = 'running';
      timer.startedAtMs = nowMs;
      timer.endsAtMs = nowMs + timer.durationMs;
      timer.remainingAtPauseMs = null;
      timer.warningEmitted = false;
      event = 'timer.started';
      break;
    case 'timer.pause':
      if (timer.status !== 'running') return { error: 'INVALID_STATE_TRANSITION' };
      timer.remainingAtPauseMs = remainingMs(timer, nowMs);
      timer.endsAtMs = null;
      timer.status = 'paused';
      event = 'timer.paused';
      break;
    case 'timer.resume':
      if (timer.status !== 'paused') return { error: 'INVALID_STATE_TRANSITION' };
      timer.endsAtMs = nowMs + (timer.remainingAtPauseMs ?? 0);
      timer.remainingAtPauseMs = null;
      timer.status = 'running';
      event = 'timer.resumed';
      break;
    case 'timer.reset':
      if (timer.status === 'ready') return { error: 'INVALID_STATE_TRANSITION' };
      timer.status = 'ready';
      timer.startedAtMs = null;
      timer.endsAtMs = null;
      timer.remainingAtPauseMs = null;
      timer.warningEmitted = false;
      event = 'timer.reset';
      break;
  }
  return { state: { ...state, timer }, events: [event] };
}

/** A Durable Object has one alarm: use it for the next threshold or expiry. */
export function nextAlarmAt(state: SessionState): number {
  const candidates = [state.expiresAtMs];
  const timer = state.timer;
  if (timer.status === 'running' && timer.endsAtMs !== null) {
    candidates.push(timer.endsAtMs);
    if (timer.warningRemainingMs > 0 && !timer.warningEmitted) {
      candidates.push(timer.endsAtMs - timer.warningRemainingMs);
    }
  }
  return Math.min(...candidates);
}
