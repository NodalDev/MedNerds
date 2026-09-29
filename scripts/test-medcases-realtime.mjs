import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage, mayControlTimer, MAX_CONTROL_MESSAGE_BYTES } from '../src/lib/medcases/realtime-protocol.ts';
import {
  advanceSession,
  applyTimerCommand,
  createSession,
  nextAlarmAt,
  remainingMs,
  validSessionConfig,
  DEVELOPMENT_SESSION_TTL_MS,
} from '../src/lib/medcases/realtime-state.ts';

const config = {
  sessionId: 'session_abcdef1234567890abcd',
  caseId: 'case-2bf98914ed',
  durationSeconds: 13,
  warningRemainingSeconds: 2,
};

test('strictly validates small control messages and roles', () => {
  assert.deepEqual(parseClientMessage('{"type":"timer.start"}'), { ok: true, message: { type: 'timer.start' } });
  assert.deepEqual(parseClientMessage('{"type":"time.ping","clientSentAtMs":123}'), { ok: true, message: { type: 'time.ping', clientSentAtMs: 123 } });
  for (const payload of ['{', '[]', 'null', '{"type":"timer.start","endsAtMs":5}', '{"type":"time.ping","clientSentAtMs":"1"}', 'x'.repeat(MAX_CONTROL_MESSAGE_BYTES + 1), new ArrayBuffer(4)]) {
    assert.equal(parseClientMessage(payload).ok, false);
  }
  assert.deepEqual(parseClientMessage('{"type":"timer.end"}'), { ok: false, code: 'UNKNOWN_MESSAGE_TYPE' });
  assert.equal(mayControlTimer('examiner'), true);
  assert.equal(mayControlTimer('observer'), false);
});

test('validates IDs and timer configuration, persists only dynamic session state', () => {
  assert.equal(validSessionConfig(config), true);
  assert.equal(validSessionConfig({ ...config, warningRemainingSeconds: 0 }), true);
  assert.equal(validSessionConfig({ ...config, caseId: 'akuter-thoraxschmerz' }), false);
  assert.equal(validSessionConfig({ ...config, durationSeconds: 0 }), false);
  assert.equal(validSessionConfig({ ...config, warningRemainingSeconds: 13 }), false);
  assert.equal(validSessionConfig({ ...config, diagnosis: 'No medical content' }), false);
  const state = createSession(config, 100_000);
  assert.equal(state.expiresAtMs, 100_000 + DEVELOPMENT_SESSION_TTL_MS);
  assert.equal(nextAlarmAt(state), state.expiresAtMs);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  assert.deepEqual(state.releasedMaterialIds, []);
  assert.deepEqual(Object.keys(state), ['version', 'sessionId', 'caseId', 'createdAtMs', 'expiresAtMs', 'timer', 'releasedMaterialIds']);
});

test('start, pause, resume and reset use server time without losing pause duration', () => {
  let state = createSession(config, 100_000);
  let change = applyTimerCommand(state, 'timer.start', 101_000);
  assert.deepEqual(change.events, ['timer.started']);
  state = change.state;
  assert.equal(state.timer.startedAtMs, 101_000);
  assert.equal(state.timer.endsAtMs, 114_000);
  assert.equal(nextAlarmAt(state), 112_000);
  assert.equal(remainingMs(state.timer, 104_000), 10_000);
  assert.deepEqual(applyTimerCommand(state, 'timer.start', 104_000), { error: 'INVALID_STATE_TRANSITION' });

  change = applyTimerCommand(state, 'timer.pause', 104_000);
  state = change.state;
  assert.deepEqual(change.events, ['timer.paused']);
  assert.equal(state.timer.remainingAtPauseMs, 10_000);
  assert.equal(state.timer.endsAtMs, null);
  assert.equal(remainingMs(state.timer, 500_000), 10_000);
  assert.equal(nextAlarmAt(state), state.expiresAtMs);

  change = applyTimerCommand(state, 'timer.resume', 108_000);
  state = change.state;
  assert.deepEqual(change.events, ['timer.resumed']);
  assert.equal(state.timer.endsAtMs, 118_000);
  assert.equal(nextAlarmAt(state), 116_000);

  change = applyTimerCommand(state, 'timer.reset', 109_000);
  state = change.state;
  assert.deepEqual(change.events, ['timer.reset']);
  assert.equal(state.timer.status, 'ready');
  assert.equal(state.timer.startedAtMs, null);
  assert.equal(state.timer.warningEmitted, false);
  assert.equal(remainingMs(state.timer, 900_000), 13_000);
});

test('warning and end are idempotent, even when both thresholds are crossed before a late alarm', () => {
  let state = applyTimerCommand(createSession(config, 100_000), 'timer.start', 101_000).state;
  let change = advanceSession(state, 112_000);
  assert.deepEqual(change.events, ['timer.warning']);
  state = change.state;
  assert.equal(state.timer.warningEmitted, true);
  assert.equal(nextAlarmAt(state), 114_000);
  assert.deepEqual(advanceSession(state, 113_000).events, []);
  change = advanceSession(state, 114_500);
  assert.deepEqual(change.events, ['timer.ended']);
  assert.equal(change.state.timer.status, 'ended');
  assert.deepEqual(advanceSession(change.state, 115_000).events, []);

  state = applyTimerCommand(createSession(config, 100_000), 'timer.start', 101_000).state;
  change = advanceSession(state, 120_000);
  assert.deepEqual(change.events, ['timer.warning', 'timer.ended']);
  assert.deepEqual(advanceSession(change.state, 120_001).events, []);
});

test('zero warning disables intermediate signal; reset allows a new run', () => {
  const noWarning = createSession({ ...config, warningRemainingSeconds: 0 }, 100_000);
  let state = applyTimerCommand(noWarning, 'timer.start', 101_000).state;
  assert.equal(nextAlarmAt(state), 114_000);
  const ended = advanceSession(state, 115_000);
  assert.deepEqual(ended.events, ['timer.ended']);
  state = applyTimerCommand(ended.state, 'timer.reset', 116_000).state;
  assert.equal(state.timer.status, 'ready');
  assert.equal(state.timer.warningEmitted, false);
  assert.equal(applyTimerCommand(state, 'timer.pause', 117_000).error, 'INVALID_STATE_TRANSITION');
});
