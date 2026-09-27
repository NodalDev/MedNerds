import type { HyperHeartPhase } from './types';

/**
 * Phase sequence and source animation frames adapted from HyperHeart (CC BY-NC 4.0).
 * https://library.med.utah.edu/kw/pharm/hyperheart/
 * These are educational animation frames, NOT physiological durations.
 * See third_party/hyperheart/SOURCE_ANALYSIS.md for the reset-at-frame-49 detail.
 */
export const hyperHeartSourceFps = 12;

export const hyperHeartPhases = [
  {
    id: 'atrial-systole', label: 'Vorhofsystole', sourceLabel: 'Atrial systole', order: 1,
    sourceFrames: { start: 0, endExclusive: 6 }, tutorialFrame: 50,
  },
  {
    id: 'isovolumetric-contraction', label: 'Isovolumetrische Kontraktion', sourceLabel: 'Isovolumetric contraction', order: 2,
    sourceFrames: { start: 6, endExclusive: 10 }, tutorialFrame: 51,
  },
  {
    id: 'rapid-ejection', label: 'Rasche Austreibungsphase', sourceLabel: 'Rapid ejection', order: 3,
    sourceFrames: { start: 10, endExclusive: 16 }, tutorialFrame: 52,
  },
  {
    id: 'reduced-ejection', label: 'Reduzierte Austreibungsphase', sourceLabel: 'Reduced ejection', order: 4,
    sourceFrames: { start: 16, endExclusive: 24 }, tutorialFrame: 53,
  },
  {
    id: 'isovolumetric-relaxation', label: 'Isovolumetrische Relaxation', sourceLabel: 'Isovolumetric relaxation', order: 5,
    sourceFrames: { start: 24, endExclusive: 30 }, tutorialFrame: 54,
  },
  {
    id: 'rapid-ventricular-filling', label: 'Rasche Ventrikelfüllung', sourceLabel: 'Rapid ventricular filling', order: 6,
    sourceFrames: { start: 30, endExclusive: 38 }, tutorialFrame: 55,
  },
  {
    id: 'reduced-ventricular-filling', label: 'Reduzierte Ventrikelfüllung', sourceLabel: 'Reduced ventricular filling', order: 7,
    sourceFrames: { start: 38, endExclusive: 49 }, tutorialFrame: 56,
  },
] as const satisfies readonly HyperHeartPhase[];
