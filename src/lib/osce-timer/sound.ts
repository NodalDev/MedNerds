import type { TimerEvent } from './timer';

export type SoundCue = Extract<TimerEvent, 'start' | 'warning' | 'end'>;

export function isSoundCue(event: TimerEvent): event is SoundCue {
  return event === 'start' || event === 'warning' || event === 'end';
}

/** A delayed end takes precedence over a warning crossed in the same UI update. */
export function soundCuesForEvents(events: readonly TimerEvent[], enabled: boolean): SoundCue[] {
  if (!enabled) return [];
  if (events.includes('end')) return ['end'];
  return events.filter(isSoundCue);
}

const patterns: Record<SoundCue, readonly (readonly [frequency: number, offset: number, duration: number])[]> = {
  start: [[660, 0, 0.14]],
  warning: [[570, 0, 0.16], [570, 0.25, 0.16]],
  end: [[440, 0, 0.2], [350, 0.28, 0.2], [280, 0.56, 0.3]],
};

/** Short generated cues. AudioContext is created only after a user action. */
export class OsceTimerSound {
  private context?: AudioContext;

  async play(cue: SoundCue): Promise<boolean> {
    try {
      this.context ??= new AudioContext();
      if (this.context.state !== 'running') await this.context.resume();
      if (this.context.state !== 'running') return false;

      for (const [frequency, offset, duration] of patterns[cue]) {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        const start = this.context.currentTime + offset;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.1, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain).connect(this.context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
      }
      return true;
    } catch {
      const failedContext = this.context;
      this.context = undefined;
      if (failedContext) {
        try {
          await failedContext.close();
        } catch {
          // Audio cleanup must never affect the timer.
        }
      }
      return false;
    }
  }

  async close(): Promise<void> {
    if (!this.context) return;
    const context = this.context;
    this.context = undefined;
    try {
      await context.close();
    } catch {
      // The browser may have closed the context already.
    }
  }
}
