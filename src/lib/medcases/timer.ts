import type { TimerConfig } from '../../data/medcases/types';

export type TimerStatus = 'ready' | 'running' | 'paused' | 'ended';
export type TimerCue = 'start' | 'warning' | 'end';

export function validTimerConfig(config: TimerConfig): boolean {
  return Number.isInteger(config.durationSeconds)
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

export function timerFromQuery(search: string, defaults: TimerConfig): TimerConfig {
  const params = new URLSearchParams(search);
  const duration = params.get('duration');
  const warning = params.get('warning');
  if (duration === null || warning === null || !/^\d+$/.test(duration) || !/^\d+$/.test(warning)) return defaults;
  const config = { durationSeconds: Number(duration), warningRemainingSeconds: Number(warning) };
  return validTimerConfig(config) ? config : defaults;
}

export function joinUrl(origin: string, code: string, config: TimerConfig): string {
  const url = new URL('/medcases/join/', origin);
  url.searchParams.set('case', code);
  url.searchParams.set('duration', String(config.durationSeconds));
  url.searchParams.set('warning', String(config.warningRemainingSeconds));
  return url.toString();
}
