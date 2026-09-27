import { interpolate, samplePathAtProgress } from './interpolation';
import type { MotionElement, MotionSegment, MotionState } from './motion-types';

interface PreparedSegment { source: MotionSegment; before: MotionState; after: MotionState }
const motionCache = new WeakMap<MotionElement, readonly PreparedSegment[]>();

function evaluateSegment(before: MotionState, segment: MotionSegment, progress: number): MotionState {
  const state = { ...before };
  const { guide, ...target } = segment.target;
  for (const key of Object.keys(target) as (keyof MotionState)[]) {
    if (key === '_off') {
      // Boolean activation is a step, never a fade halfway through the tween.
      if (progress >= 1) state._off = target._off!;
    } else state[key] = interpolate(before[key], target[key] as number, progress);
  }
  if (guide) {
    const point = samplePathAtProgress(guide.path, progress);
    state.x = point.x;
    state.y = point.y;
    if (guide.orient === 'fixed') {
      // Original guide orientation overrides its explicit end rotation.
      state.rotation = before.rotation + point.angle - samplePathAtProgress(guide.path, 0).angle;
    }
  }
  return state;
}

function prepareMotion(element: MotionElement) {
  const cached = motionCache.get(element);
  if (cached) return cached;
  const prepared: PreparedSegment[] = [];
  let state = { ...element.initial };
  for (const source of element.segments) {
    const after = evaluateSegment(state, source, 1);
    prepared.push({ source, before: state, after });
    state = after;
  }
  motionCache.set(element, prepared);
  return prepared;
}

/** Pure, seekable sampling: no dependence on earlier rendered frames. */
export function sampleMotion(element: MotionElement, sourceFrame: number): MotionState {
  const frame = Number.isFinite(sourceFrame) ? Math.max(0, sourceFrame) : 0;
  let state = { ...element.initial };
  for (const segment of prepareMotion(element)) {
    if (frame < segment.source.start) break;
    if (frame >= segment.source.end) { state = segment.after; continue; }
    return evaluateSegment(segment.before, segment.source,
      (frame - segment.source.start) / (segment.source.end - segment.source.start));
  }
  return state;
}

/** Source transform order: translation, skew, rotation/scale, registration. */
export function motionTransform(state: MotionState) {
  const sx = state.skewX * Math.PI / 180;
  const sy = state.skewY * Math.PI / 180;
  return `translate(${state.x} ${state.y}) matrix(${Math.cos(sy)} ${Math.sin(sy)} ${-Math.sin(sx)} ${Math.cos(sx)} 0 0) rotate(${state.rotation}) scale(${state.scaleX} ${state.scaleY}) translate(${-state.regX} ${-state.regY})`;
}
