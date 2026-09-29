import type { TimerConfig, TimerEvent } from '../osce-timer/timer';

export type { TimerStatus } from '../osce-timer/timer';
export type TimerCue = Extract<TimerEvent, 'start' | 'warning' | 'end'>;

export function validTimerConfig(config: TimerConfig | undefined): config is TimerConfig {
  return config != null
    && Number.isInteger(config.durationSeconds)
    && config.durationSeconds >= 60
    && config.durationSeconds <= 1800
    && Number.isInteger(config.warningRemainingSeconds)
    && config.warningRemainingSeconds >= 0
    && config.warningRemainingSeconds < config.durationSeconds;
}

export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function joinUrl(origin: string, code: string): string {
  const url = new URL('/medcases/join/', origin);
  url.searchParams.set('case', code);
  return url.toString();
}
