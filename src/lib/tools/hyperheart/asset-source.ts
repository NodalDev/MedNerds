import type { HyperHeartPhaseId, HyperHeartVisual } from './types';

/**
 * Development-only sprite relationships from HyperHeart's tutorial frames 50–56.
 * Original assets: CC BY-NC 4.0; attribution in third_party/hyperheart/NOTICE.md.
 * The extraction script resolves these symbols against the read-only source export.
 */
export const hyperHeartSourceSymbols = {
  'atrial-systole': {
    heart: 'atrialheart5', wiggers: 'atrsyswig2', ecg: 'atrsyselectro', sounds: 'atrsyssound1',
  },
  'isovolumetric-contraction': {
    heart: 'isocontrcthrt1', wiggers: 'isovolcontrctwig1', ecg: 'isovolcelectro1', sounds: 'isovolsound1',
  },
  'rapid-ejection': {
    heart: 'rapejecheart1', wiggers: 'rapejecwig1', ecg: 'rapejecelectro1', sounds: 'rapidejectsound1',
  },
  'reduced-ejection': {
    heart: 'redejectheart1', wiggers: 'redejectwig1', ecg: 'redejectelectro1', sounds: 'redejectsound1',
  },
  'isovolumetric-relaxation': {
    heart: 'isovolrelheart1', wiggers: 'isovolrelwig1', ecg: 'isovolrelelectro1', sounds: 'isovolrelsound1',
  },
  'rapid-ventricular-filling': {
    heart: 'rapventfillheart1', wiggers: 'rapventfillwig1', ecg: 'rapventfillelectro1', sounds: 'rapventfillsound1',
  },
  'reduced-ventricular-filling': {
    heart: 'redventfillheart1', wiggers: 'redventfillwig1', ecg: 'redventfillelectro1', sounds: 'redventfillsound1',
  },
} as const satisfies Record<HyperHeartPhaseId, Record<HyperHeartVisual, string>>;
