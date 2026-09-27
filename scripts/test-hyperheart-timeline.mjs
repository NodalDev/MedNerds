// Existing TypeScript compiler + Node's built-in runner; no added framework.
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const modules = new Map();
async function moduleUrl(filename) {
  if (modules.has(filename.href)) return modules.get(filename.href);
  let source = await readFile(filename, 'utf8');
  for (const match of source.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)) {
    const dependency = new URL(match[2] + '.ts', filename);
    source = source.replace(match[0], `from '${await moduleUrl(dependency)}'`);
  }
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const result = 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
  modules.set(filename.href, result);
  return result;
}
const root = new URL('../src/lib/tools/hyperheart/', import.meta.url);
const load = async (name) => import(await moduleUrl(new URL(name + '.ts', root)));
const timeline = await load('timeline');
const { hyperHeartPhases } = await load('phases');
const { normalizePlaybackRate } = await load('playback');
const { interpolate, samplePathAtProgress } = await load('interpolation');
const { sampleMotion, motionTransform } = await load('motion');
const { flowElements, flowSymbols, sourceTimeMarkers } = await load('motion-data');
const { timelineToChartProgress } = await load('source-mapping');
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('normalization, phase boundaries, progress and seek navigation', () => {
  assert.equal(timeline.hyperHeartTimelineLength, 49);
  for (const [input, expected] of [[-1, 0], [100, 49], [NaN, 0], [Infinity, 0], [12.5, 12.5]]) assert.equal(timeline.normalizeSourceFrame(input), expected);
  close(timeline.progressToFrame(0.5), 24.5);
  close(timeline.frameToProgress(24.5), 0.5);
  for (const [index, phase] of hyperHeartPhases.entries()) {
    const start = phase.sourceFrames.start;
    assert.equal(timeline.phaseStartFrame(phase.id), start);
    assert.equal(timeline.phaseAtFrame(start).id, phase.id);
    assert.equal(timeline.phaseAtFrame(phase.sourceFrames.endExclusive - 0.001).id, phase.id);
    assert.equal(timeline.seekPhaseBoundary(start + 1, -1), start);
    assert.equal(timeline.seekPhaseBoundary(start + 0.1, -1), hyperHeartPhases[(index + 6) % 7].sourceFrames.start);
    assert.equal(timeline.seekPhaseBoundary(start, 1), hyperHeartPhases[(index + 1) % 7].sourceFrames.start);
  }
  assert.equal(timeline.phaseAtFrame(49).id, hyperHeartPhases.at(-1).id);
});

test('elapsed time, supported speeds, loop remainder and non-loop endpoint', () => {
  for (const rate of [0.5, 1, 1.5, 2]) close(timeline.advanceTimeline(0, 1000, rate, false).frame, 12 * rate);
  assert.equal(normalizePlaybackRate(NaN), 1);
  assert.equal(normalizePlaybackRate(3), 1);
  assert.deepEqual(timeline.advanceTimeline(48, 250, 1, true), { frame: 2, ended: false });
  assert.deepEqual(timeline.advanceTimeline(48, 250, 1, false), { frame: 49, ended: true });
  assert.deepEqual(timeline.advanceTimeline(23.7, 0, 2, true), { frame: 23.7, ended: false });
  close(timeline.advanceTimeline(0, 20000, 1, true).frame, 44);
  close(timeline.advanceTimeline(1, -100, 1, true).frame, 1);
});

test('distance sampling, exact path endpoints and tangent directions', () => {
  close(interpolate(0, 10, 0.25), 2.5);
  const straight = [0, 0, 10, 0, 20, 0];
  close(samplePathAtProgress(straight, 0.5).x, 10);
  close(samplePathAtProgress(straight, 0.5).angle, 0);
  const unequal = [0, 0, 5, 0, 10, 0, 10, 15, 10, 30];
  close(samplePathAtProgress(unequal, 0.5).x, 10);
  close(samplePathAtProgress(unequal, 0.5).y, 10);
  assert.throws(() => samplePathAtProgress([0, 1, 2], 0.5));
  for (const element of flowElements) for (const segment of element.segments) {
    const path = segment.target.guide?.path;
    if (!path) continue;
    const first = samplePathAtProgress(path, 0), last = samplePathAtProgress(path, 1);
    close(first.x, path[0]); close(first.y, path[1]);
    close(last.x, path.at(-2)); close(last.y, path.at(-1));
  }
});

test('source visibility windows, opacity, fixed orientation and repeatable arbitrary seeking', () => {
  assert.equal(flowElements.length, 58);
  const blue = flowElements.find((element) => element.id === 'instance_33');
  assert.equal(sampleMotion(blue, 16.99)._off, true);
  assert.equal(sampleMotion(blue, 17)._off, false);
  assert.equal(sampleMotion(blue, 37)._off, true);
  const yellow = flowElements.find((element) => element.id === 'instance_44');
  close(sampleMotion(yellow, 2).alpha, (0.9688 + 0.4414) / 2);
  assert.equal(sampleMotion(yellow, 4.99)._off, false);
  assert.equal(sampleMotion(yellow, 5)._off, true);
  const arrow = flowElements.find((element) => element.id === 'instance_37');
  const guide = arrow.segments.find((segment) => segment.target.guide).target.guide;
  close(sampleMotion(arrow, 15).rotation, arrow.initial.rotation + samplePathAtProgress(guide.path, 0.5).angle - samplePathAtProgress(guide.path, 0).angle);
  for (const element of flowElements) {
    assert.ok(flowSymbols[element.symbol]);
    for (const frame of [0, 3.41, 6, 9.5, 12.72, 23.5, 30, 37.25, 48.95, 49]) {
      const state = sampleMotion(element, frame);
      assert.ok(Object.entries(state).every(([key, value]) => key === '_off' ? typeof value === 'boolean' : Number.isFinite(value)));
      assert.ok(state.alpha >= 0 && state.alpha <= 1);
      assert.ok(!motionTransform(state).includes('NaN'));
      sampleMotion(element, 0); sampleMotion(element, 48);
      assert.deepEqual(sampleMotion(element, frame), state);
    }
  }
});

test('one canonical source cursor retains non-uniform source timing', () => {
  assert.deepEqual(sourceTimeMarkers.map((element) => element.id), ['instance_92', 'instance_100']);
  const marker = sourceTimeMarkers[1];
  const positions = [[0, 644.95], [6, 698.25], [10, 719.85], [16, 763.95], [24, 822.75], [30, 862.35], [38, 917.85], [49, 1013.55]];
  for (const [frame, x] of positions) close(sampleMotion(marker, frame).x, x);
  close(timelineToChartProgress(0), 0); close(timelineToChartProgress(49), 1);
  close(timelineToChartProgress(8), (709.05 - 644.95) / (1013.55 - 644.95));
  let previous = -1;
  for (let frame = 0; frame <= 49; frame += 0.01) {
    const progress = timelineToChartProgress(frame);
    assert.ok(progress >= previous && progress >= 0 && progress <= 1);
    previous = progress;
  }
});
