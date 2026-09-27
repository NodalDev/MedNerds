import { sourceTimeMarkers } from './motion-data';
import { sampleMotion } from './motion';
import { normalizeSourceFrame } from './timeline';

// Static calibration against the original left wall/right heart contours
// (shape_6627 / shape_6722) and atlas landmarks. This is a raster projection,
// not a new anatomical model; phase snapshots do not deform continuously.
export const heartProjection = 'translate(-65 -13) scale(0.618)';

// instance_100 has all seven phase boundaries; instance_92 differs slightly
// around frame 23. Use one canonical source cursor for exact panel sync.
const marker = sourceTimeMarkers.find((element) => element.id === 'instance_100')!;
const startX = marker.initial.x;
const endX = sampleMotion(marker, 49).x;
export function timelineToChartProgress(sourceFrame: number) {
  return Math.max(0, Math.min(1, (sampleMotion(marker, normalizeSourceFrame(sourceFrame)).x - startX) / (endX - startX)));
}

// Visible atlas plot bounds, excluding labels/margins. Wiggers is truncated
// in the supplied atlas; see SOURCE_ANALYSIS.md for this projection limitation.
export const chartProjections = {
  wiggers: { width: 237, height: 280, left: 35, right: 235, top: 40, bottom: 251 },
  ecg: { width: 237, height: 100, left: 14, right: 217, top: 15, bottom: 69 },
  sounds: { width: 237, height: 100, left: 18, right: 220, top: 15, bottom: 69 },
} as const;
