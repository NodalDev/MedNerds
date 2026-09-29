import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXAMINER_STORAGE_KEY, clearExaminerSession, cueForLiveEvent, normalizeSessionCode, restoreExaminerSession,
  saveExaminerSession, sessionJoinUrl, validStoredSession, visibleRemainingMs,
} from '../src/lib/medcases/realtime-ui.ts';

const caseId = 'case-2bf98914ed';
const valid = {
  version: 1, caseId, sessionId: 'session_abcdef1234567890abcdef1234567890',
  joinCode: 'K7P4MX', examinerCapability: 'a'.repeat(43), expiresAtMs: 200_000,
};
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('join link contains only the code and stays separate from static V1', () => {
  assert.equal(sessionJoinUrl('http://localhost:4321/other/', 'K7P4MX'),
    'http://localhost:4321/medcases/session/join/?code=K7P4MX');
  assert.equal(normalizeSessionCode(' k7p4mx '), 'K7P4MX');
  assert.equal(normalizeSessionCode('K7P4M0'), null);
  assert.ok(!sessionJoinUrl('http://localhost:4321/', valid.joinCode).includes(valid.examinerCapability));
  assert.ok(!sessionJoinUrl('http://localhost:4321/', valid.joinCode).includes(valid.sessionId));
});

test('sessionStorage restores only a complete, matching, unexpired examiner session', () => {
  const storage = memoryStorage();
  assert.equal(saveExaminerSession(storage, valid), true);
  assert.deepEqual(restoreExaminerSession(storage, caseId, 100_000), valid);
  assert.equal(validStoredSession({ ...valid, version: 2 }, caseId, 100_000), false);
  assert.equal(validStoredSession({ ...valid, examinerCapability: '' }, caseId, 100_000), false);
  assert.equal(validStoredSession({ ...valid, joinCode: undefined }, caseId, 100_000), false);
  assert.equal(validStoredSession(valid, 'case-ffffffffee', 100_000), false);
  assert.equal(restoreExaminerSession(storage, caseId, 200_000), null);
  assert.equal(storage.getItem(EXAMINER_STORAGE_KEY), null);
  storage.setItem(EXAMINER_STORAGE_KEY, '{');
  assert.equal(restoreExaminerSession(storage, caseId, 100_000), null);
  assert.equal(storage.getItem(EXAMINER_STORAGE_KEY), null);
  saveExaminerSession(storage, valid);
  clearExaminerSession(storage);
  assert.equal(storage.getItem(EXAMINER_STORAGE_KEY), null);
});

test('display calculation clamps running time and keeps ready, paused and ended states', () => {
  const timer = { status: 'ready', durationMs: 780000, warningRemainingMs: 120000,
    startedAtMs: null, endsAtMs: null, remainingAtPauseMs: null, warningEmitted: false };
  assert.equal(visibleRemainingMs(timer, 1000), 780000);
  assert.equal(visibleRemainingMs({ ...timer, status: 'running', endsAtMs: 5000 }, 2000), 3000);
  assert.equal(visibleRemainingMs({ ...timer, status: 'running', endsAtMs: 5000 }, 6000), 0);
  assert.equal(visibleRemainingMs({ ...timer, status: 'paused', remainingAtPauseMs: 2500 }, 6000), 2500);
  assert.equal(visibleRemainingMs({ ...timer, status: 'ended' }, 6000), 0);
});

test('only new live timer events request sounds, never snapshots or reconnect state', () => {
  assert.equal(cueForLiveEvent('session.snapshot'), null);
  assert.equal(cueForLiveEvent('time.pong'), null);
  assert.equal(cueForLiveEvent('timer.started'), 'start');
  assert.equal(cueForLiveEvent('timer.warning'), 'warning');
  assert.equal(cueForLiveEvent('timer.ended'), 'end');
});
