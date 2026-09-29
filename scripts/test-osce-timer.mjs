import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OsceTimerEngine } from '../src/lib/osce-timer/timer.ts';

function createTimer(durationSeconds = 60, warningRemainingSeconds = 10) {
  const clock = { time: 0, now() { return this.time; } };
  const timer = new OsceTimerEngine({ durationSeconds, warningRemainingSeconds }, clock);
  return { clock, timer };
}

test('validates technical configuration independently of UI limits', () => {
  for (const config of [
    { durationSeconds: 0, warningRemainingSeconds: 0 },
    { durationSeconds: -1, warningRemainingSeconds: 0 },
    { durationSeconds: 60, warningRemainingSeconds: -1 },
    { durationSeconds: 60, warningRemainingSeconds: 60 },
    { durationSeconds: 60, warningRemainingSeconds: 61 },
    { durationSeconds: Number.NaN, warningRemainingSeconds: 0 },
    { durationSeconds: Number.POSITIVE_INFINITY, warningRemainingSeconds: 0 },
    { durationSeconds: 60, warningRemainingSeconds: Number.NaN },
    { durationSeconds: 60, warningRemainingSeconds: Number.POSITIVE_INFINITY },
    { durationSeconds: '60', warningRemainingSeconds: 10 },
  ]) {
    assert.throws(() => new OsceTimerEngine(config), RangeError);
  }
  assert.equal(createTimer(3600, 120).timer.getSnapshot().remainingSeconds, 3600);
});

test('starts with full duration and derives elapsed time from the clock', () => {
  const { clock, timer } = createTimer();
  assert.deepEqual(timer.getSnapshot(), {
    status: 'ready', remainingMilliseconds: 60000, remainingSeconds: 60,
  });
  assert.deepEqual(timer.start(), ['start']);
  assert.deepEqual(timer.start(), []);
  clock.time = 10000;
  assert.deepEqual(timer.getSnapshot(), {
    status: 'running', remainingMilliseconds: 50000, remainingSeconds: 50,
  });
  assert.deepEqual(timer.update(), []);
});

test('pause freezes exact milliseconds across a long break and resume continues them', () => {
  const { clock, timer } = createTimer();
  timer.start();
  clock.time = 12501;
  assert.deepEqual(timer.pause(), ['pause']);
  assert.equal(timer.getSnapshot().remainingMilliseconds, 47499);
  clock.time = 612501;
  assert.equal(timer.getSnapshot().remainingMilliseconds, 47499);
  assert.deepEqual(timer.update(), []);
  assert.deepEqual(timer.resume(), ['resume']);
  clock.time += 7499;
  assert.equal(timer.getSnapshot().remainingMilliseconds, 40000);
});

test('warning fires at its threshold only once despite repeated reads and updates', () => {
  const { clock, timer } = createTimer();
  timer.start();
  clock.time = 49999;
  assert.deepEqual(timer.update(), []);
  clock.time = 50000;
  for (let index = 0; index < 10; index++) timer.getSnapshot();
  assert.deepEqual(timer.update(), ['warning']);
  assert.deepEqual(timer.update(), []);
  clock.time = 55000;
  assert.deepEqual(timer.update(), []);
});

test('a skipped warning threshold is still reported', () => {
  const { clock, timer } = createTimer(180, 120);
  timer.start();
  clock.time = 50000;
  assert.deepEqual(timer.update(), []);
  clock.time = 70000;
  assert.deepEqual(timer.update(), ['warning']);
  assert.equal(timer.getSnapshot().remainingSeconds, 110);
});

test('warning is disabled by zero but end still fires once and remaining never goes negative', () => {
  const { clock, timer } = createTimer(60, 0);
  timer.start();
  clock.time = 60000;
  assert.deepEqual(timer.update(), ['end']);
  assert.deepEqual(timer.getSnapshot(), {
    status: 'ended', remainingMilliseconds: 0, remainingSeconds: 0,
  });
  clock.time = 900000;
  assert.deepEqual(timer.update(), []);
  assert.equal(timer.getSnapshot().remainingMilliseconds, 0);
});

test('one large jump reports warning before end, both once', () => {
  const { clock, timer } = createTimer(180, 120);
  timer.start();
  clock.time = 50000;
  timer.update();
  clock.time = 400000;
  assert.equal(timer.getSnapshot().status, 'ended');
  assert.deepEqual(timer.update(), ['warning', 'end']);
  assert.deepEqual(timer.update(), []);
  assert.equal(timer.getSnapshot().remainingSeconds, 0);
});

test('pause before warning defers it until the resumed countdown reaches the threshold', () => {
  const { clock, timer } = createTimer();
  timer.start();
  clock.time = 40000;
  assert.deepEqual(timer.pause(), ['pause']);
  clock.time = 900000;
  assert.deepEqual(timer.update(), []);
  assert.deepEqual(timer.resume(), ['resume']);
  clock.time += 9999;
  assert.deepEqual(timer.update(), []);
  clock.time += 1;
  assert.deepEqual(timer.update(), ['warning']);
});

test('reset after warning and end enables a complete new run', () => {
  const { clock, timer } = createTimer();
  timer.start();
  clock.time = 50000;
  assert.deepEqual(timer.update(), ['warning']);
  assert.deepEqual(timer.reset(), ['reset']);
  assert.equal(timer.getSnapshot().remainingSeconds, 60);
  timer.start();
  clock.time += 50000;
  assert.deepEqual(timer.update(), ['warning']);
  clock.time += 10000;
  assert.deepEqual(timer.update(), ['end']);
  assert.deepEqual(timer.reset(), ['reset']);
  assert.deepEqual(timer.start(), ['start']);
  assert.equal(timer.getSnapshot().remainingSeconds, 60);
});

test('invalid transitions are no-ops and rapid changes keep a valid state', () => {
  const { timer } = createTimer();
  assert.deepEqual(timer.pause(), []);
  assert.deepEqual(timer.resume(), []);
  assert.deepEqual(timer.reset(), []);
  assert.deepEqual(timer.start(), ['start']);
  assert.deepEqual(timer.resume(), []);
  assert.deepEqual(timer.pause(), ['pause']);
  assert.deepEqual(timer.start(), []);
  assert.deepEqual(timer.resume(), ['resume']);
  assert.deepEqual(timer.pause(), ['pause']);
  assert.deepEqual(timer.resume(), ['resume']);
  assert.deepEqual(timer.reset(), ['reset']);
  assert.deepEqual(timer.start(), ['start']);
  assert.equal(timer.getSnapshot().status, 'running');
});

test('pause after elapsed deadline settles warning and end without entering paused', () => {
  const { clock, timer } = createTimer();
  timer.start();
  clock.time = 61000;
  assert.deepEqual(timer.pause(), ['warning', 'end']);
  assert.equal(timer.getSnapshot().status, 'ended');
  assert.deepEqual(timer.pause(), []);
});
