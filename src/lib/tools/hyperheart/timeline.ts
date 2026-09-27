import { hyperHeartPhases, hyperHeartSourceFps } from './phases';
import { normalizePlaybackRate, resolvePhase } from './playback';
import type { HyperHeartPhaseId } from './types';

// frame_49 resets to frame 0. Tutorial frames 50–56 are outside playback.
export const hyperHeartTimelineLength = 49;

export function normalizeSourceFrame(frame: number) {
  return Number.isFinite(frame) ? Math.max(0, Math.min(hyperHeartTimelineLength, frame)) : 0;
}

export function frameToProgress(frame: number) {
  return normalizeSourceFrame(frame) / hyperHeartTimelineLength;
}

export function progressToFrame(progress: number) {
  return normalizeSourceFrame(progress * hyperHeartTimelineLength);
}

export function phaseAtFrame(frame: number) {
  const value = normalizeSourceFrame(frame);
  return hyperHeartPhases.find((phase) => value < phase.sourceFrames.endExclusive) ?? hyperHeartPhases.at(-1)!;
}

export function phaseStartFrame(id: HyperHeartPhaseId) {
  return resolvePhase(id).sourceFrames.start;
}

export function seekPhaseBoundary(frame: number, direction: -1 | 1) {
  const phase = phaseAtFrame(frame);
  if (direction === -1 && normalizeSourceFrame(frame) - phase.sourceFrames.start > 0.2) return phase.sourceFrames.start;
  return hyperHeartPhases[(phase.order - 1 + direction + hyperHeartPhases.length) % hyperHeartPhases.length].sourceFrames.start;
}

export function advanceTimeline(frame: number, elapsedMs: number, rate: number, loop: boolean) {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const next = normalizeSourceFrame(frame) + elapsed / 1000 * hyperHeartSourceFps * normalizePlaybackRate(rate);
  return {
    frame: loop ? next % hyperHeartTimelineLength : normalizeSourceFrame(next),
    ended: !loop && next >= hyperHeartTimelineLength,
  };
}
