import { hyperHeartPhases } from './phases';

export const hyperHeartPlaybackRates = [0.5, 1, 1.5, 2] as const;
export type HyperHeartPlaybackRate = (typeof hyperHeartPlaybackRates)[number];

export function resolvePhase(id?: string) {
  return hyperHeartPhases.find((phase) => phase.id === id) ?? hyperHeartPhases[0];
}

export function normalizePlaybackRate(rate: number): HyperHeartPlaybackRate {
  return hyperHeartPlaybackRates.find((supported) => supported === rate) ?? 1;
}
