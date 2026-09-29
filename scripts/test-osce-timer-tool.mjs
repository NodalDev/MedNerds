import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTimerSettings } from '../src/lib/osce-timer/settings.ts';
import { OsceTimerSound, soundCuesForEvents } from '../src/lib/osce-timer/sound.ts';

test('settings accept defaults, custom values and a disabled warning', () => {
  assert.deepEqual(validateTimerSettings('13', '2').config, {
    durationSeconds: 780, warningRemainingSeconds: 120,
  });
  assert.deepEqual(validateTimerSettings('30', '0').config, {
    durationSeconds: 1800, warningRemainingSeconds: 0,
  });
  assert.deepEqual(validateTimerSettings('1', '0').config, {
    durationSeconds: 60, warningRemainingSeconds: 0,
  });
});

test('settings reject empty, nonnumeric, fractional and out-of-range entries', () => {
  for (const [duration, warning] of [
    ['', '2'], ['0', '0'], ['-1', '0'], ['31', '2'], ['x', '2'], ['1.5', '0'],
    ['13', ''], ['13', '-1'], ['13', 'abc'], ['13', '1.5'], ['13', '13'], ['13', '14'],
  ]) {
    const result = validateTimerSettings(duration, warning);
    assert.equal(result.config, undefined, `${duration}/${warning} should be invalid`);
    assert.ok(result.durationError || result.warningError);
  }
});

test('sound selection respects mute and prioritizes an expired timer', () => {
  assert.deepEqual(soundCuesForEvents(['start'], true), ['start']);
  assert.deepEqual(soundCuesForEvents(['warning'], true), ['warning']);
  assert.deepEqual(soundCuesForEvents(['warning', 'end'], true), ['end']);
  assert.deepEqual(soundCuesForEvents(['pause', 'resume', 'reset'], true), []);
  assert.deepEqual(soundCuesForEvents(['warning', 'end'], false), []);
});

test('audio failures are contained without throwing or blocking later attempts', async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = class {
    state = 'suspended';
    async resume() { throw new Error('Audio blocked'); }
  };
  try {
    const sound = new OsceTimerSound();
    assert.equal(await sound.play('start'), false);
    assert.equal(await sound.play('warning'), false);
  } finally {
    globalThis.AudioContext = original;
  }
});

test('generated cues schedule short distinct tone patterns', async () => {
  const original = globalThis.AudioContext;
  const tones = [];
  globalThis.AudioContext = class {
    state = 'running';
    currentTime = 0;
    destination = {};
    createOscillator() {
      const tone = { frequency: { value: 0 }, connect: () => ({ connect() {} }), start() {}, stop() {} };
      tones.push(tone);
      return tone;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    async close() { this.state = 'closed'; }
  };
  try {
    const sound = new OsceTimerSound();
    assert.equal(await sound.play('start'), true);
    assert.equal(tones.length, 1);
    assert.equal(await sound.play('warning'), true);
    assert.equal(tones.length, 3);
    assert.equal(await sound.play('end'), true);
    assert.equal(tones.length, 6);
    assert.notEqual(tones[0].frequency.value, tones[1].frequency.value);
    assert.notEqual(tones[1].frequency.value, tones[3].frequency.value);
    await sound.close();
  } finally {
    globalThis.AudioContext = original;
  }
});
