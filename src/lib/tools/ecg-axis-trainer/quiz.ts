/**
 * Quiz case exclusions and grading adapted from ECG Axis Trainer by
 * David Schaack (MIT License): https://github.com/david-shrk/ecgaxistrainer
 */
import { classifyAxis, type AxisTypeId } from './axis';

export const quizAnswers: readonly AxisTypeId[] = [
  'left',
  'indifferent',
  'vertical',
  'right',
  'extreme-left',
  'extreme-right',
];

export interface AxisQuizAnswerResult {
  correct: boolean;
  expected: AxisTypeId;
  answer: AxisTypeId;
  angle: number;
}

/** Keep the exact upstream exclusion intervals, including Northwest cases. */
export function isQuizAngleAllowed(degree: number): boolean {
  return !(
    (degree >= 170 && degree < 280) ||
    (degree > 320 && degree < 340) ||
    (degree > 20 && degree < 35) ||
    (degree > 55 && degree < 65) ||
    (degree > 85 && degree < 95) ||
    (degree > 115 && degree < 130)
  );
}

export function randomQuizAngle(random: () => number = Math.random): number {
  let degree: number;
  do {
    degree = Math.floor(random() * 360);
  } while (!isQuizAngleAllowed(degree));
  return degree;
}

export function gradeQuizAnswer(angle: number, answer: AxisTypeId): AxisQuizAnswerResult {
  const expected = classifyAxis(angle);
  return { correct: expected === answer, expected, answer, angle };
}
