/**
 * Based on ECG Axis Trainer by David Schaack (MIT License).
 * https://github.com/david-shrk/ecgaxistrainer
 * Adapted for MedNerds from upstream revision 27c77d1033f9b086965f290a395b4cffd28b1857.
 */

export type AxisTypeId =
  | 'left'
  | 'indifferent'
  | 'vertical'
  | 'right'
  | 'extreme-right'
  | 'northwest'
  | 'extreme-left';

export const axisLabels: Record<AxisTypeId, string> = {
  left: 'Linkstyp',
  indifferent: 'Indifferenztyp',
  vertical: 'Steiltyp',
  right: 'Rechtstyp',
  'extreme-right': 'Überdrehter Rechtstyp',
  northwest: 'Northwest-Typ',
  'extreme-left': 'Überdrehter Linkstyp',
};

export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) throw new RangeError('Der Winkel muss endlich sein.');
  return ((angle % 360) + 360) % 360;
}

/** 0° points right; angles increase clockwise, as in the upstream Cabrera circle. */
export function angleFromPoint(centerX: number, centerY: number, x: number, y: number): number {
  return normalizeAngle((Math.atan2(y - centerY, x - centerX) * 180) / Math.PI);
}

export function classifyAxis(angle: number): AxisTypeId {
  const degree = normalizeAngle(angle);
  if (degree >= 30 && degree < 60) return 'indifferent';
  if (degree >= 60 && degree < 90) return 'vertical';
  if (degree >= 90 && degree < 120) return 'right';
  if (degree >= 120 && degree < 180) return 'extreme-right';
  if (degree >= 180 && degree < 270) return 'northwest';
  if (degree >= 270 && degree < 330) return 'extreme-left';
  return 'left';
}
