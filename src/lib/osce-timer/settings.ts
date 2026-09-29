import type { TimerConfig } from './timer';

export interface TimerSettingsResult {
  readonly config?: TimerConfig;
  readonly durationError?: string;
  readonly warningError?: string;
}

/** UI limits only; the reusable timer core accepts any technically valid duration. */
export function validateTimerSettings(duration: string, warning: string): TimerSettingsResult {
  const minutes = Number(duration);
  const warningMinutes = Number(warning);
  const durationError = !/^\d+$/.test(duration) || !Number.isInteger(minutes) || minutes < 1 || minutes > 30
    ? 'Bitte eine ganze Dauer zwischen 1 und 30 Minuten eingeben.'
    : undefined;
  const warningError = !/^\d+$/.test(warning) || !Number.isInteger(warningMinutes) || warningMinutes < 0
    ? 'Bitte eine ganze Warnzeit ab 0 Minuten eingeben.'
    : !durationError && warningMinutes >= minutes
      ? 'Die Warnzeit muss kleiner als die Dauer sein.'
      : undefined;

  return durationError || warningError
    ? { durationError, warningError }
    : { config: { durationSeconds: minutes * 60, warningRemainingSeconds: warningMinutes * 60 } };
}
