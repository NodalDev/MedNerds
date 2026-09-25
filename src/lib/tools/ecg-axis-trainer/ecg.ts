/**
 * Lead projection adapted from ECG Axis Trainer by David Schaack (MIT License).
 * https://github.com/david-shrk/ecgaxistrainer
 */

export const limbLeads = [
  { id: 'I', degree: 0 },
  { id: 'II', degree: 60 },
  { id: 'III', degree: 120 },
  { id: 'aVR', degree: 210 },
  { id: 'aVL', degree: 330 },
  { id: 'aVF', degree: 90 },
] as const;

export type LimbLeadId = (typeof limbLeads)[number]['id'];

export function calculateAmplitude(angle: number, leadDegree: number): number {
  return Math.cos(((angle - leadDegree) * Math.PI) / 180);
}

export function calculateLimbLeadAmplitudes(angle: number) {
  return limbLeads.map(({ id, degree }) => ({
    id,
    amplitude: calculateAmplitude(angle, degree),
  }));
}
