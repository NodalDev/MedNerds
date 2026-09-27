import type { TimerCue } from './timer';

// When MedNerds-owned audio files are available, add their local paths here.
// Without files, the WebAudio patterns below work offline and avoid 404 requests.
const cueFiles: Partial<Record<TimerCue, string>> = {};

export class OsceAudio {
  private context?: AudioContext;

  async unlock(): Promise<void> {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async play(cue: TimerCue): Promise<void> {
    try {
      await this.unlock();
      const file = cueFiles[cue];
      if (file) {
        try {
          const element = new Audio(file);
          await element.play();
          return;
        } catch {
          // Browser or file playback failed; use the built-in tone pattern.
        }
      }
      this.playFallback(cue);
    } catch {
      // Audio may be blocked by the browser; the visual timer still works.
    }
  }

  private playFallback(cue: TimerCue): void {
    const context = this.context;
    if (!context) return;
    const tones = cue === 'start'
      ? [[660, 0, 0.18]]
      : cue === 'warning'
        ? [[520, 0, 0.16], [520, 0.26, 0.16]]
        : [[390, 0, 0.18], [310, 0.25, 0.18], [260, 0.5, 0.35]];
    for (const [frequency, delay, duration] of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + delay;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.01);
    }
  }
}
