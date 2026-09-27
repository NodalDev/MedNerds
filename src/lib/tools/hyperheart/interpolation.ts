interface PathSample { x: number; y: number; angle: number }
interface PathSpan { start: number; end: number; curve: number; t0: number; t1: number }
interface PreparedPath { readonly spans: readonly PathSpan[]; readonly length: number }
const pathCache = new WeakMap<readonly number[], PreparedPath>();

export function interpolate(from: number, to: number, progress: number) {
  return from + (to - from) * Math.max(0, Math.min(1, progress));
}

function sampleCurve(path: readonly number[], curve: number, t: number): PathSample {
  const index = 2 + curve * 4;
  const [sx, sy, cx, cy, ex, ey] = path.slice(index - 2, index + 4);
  const inverse = 1 - t;
  return {
    x: inverse * inverse * sx + 2 * inverse * t * cx + t * t * ex,
    y: inverse * inverse * sy + 2 * inverse * t * cy + t * t * ey,
    angle: Math.atan2((cy - sy) * inverse + (ey - cy) * t, (cx - sx) * inverse + (ex - cx) * t) * 180 / Math.PI,
  };
}

function preparePath(path: readonly number[]): PreparedPath {
  const cached = pathCache.get(path);
  if (cached) return cached;
  if (path.length < 6 || (path.length - 2) % 4 || path.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid quadratic motion path');
  }
  const spans: PathSpan[] = [];
  let length = 0;
  // Ten distance samples per quadratic match the source guide's precision.
  // Positions themselves are evaluated on the curve, not on a polyline.
  for (let curve = 0; curve < (path.length - 2) / 4; curve++) {
    let previous = sampleCurve(path, curve, 0);
    for (let step = 1; step <= 10; step++) {
      const point = sampleCurve(path, curve, step / 10);
      const start = length;
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      if (length > start) spans.push({ start, end: length, curve, t0: (step - 1) / 10, t1: step / 10 });
      previous = point;
    }
  }
  const prepared = { spans, length };
  pathCache.set(path, prepared);
  return prepared;
}

/** Guide arrays are moveTo + quadratic control/end pairs, sampled by distance. */
export function samplePathAtProgress(path: readonly number[], progress: number): PathSample {
  const prepared = preparePath(path);
  if (!prepared.length) return sampleCurve(path, 0, 0);
  const fraction = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const distance = fraction * prepared.length;
  const span = prepared.spans.find((entry) => entry.end >= distance) ?? prepared.spans.at(-1)!;
  const t = interpolate(span.t0, span.t1, (distance - span.start) / (span.end - span.start));
  return sampleCurve(path, span.curve, t);
}
