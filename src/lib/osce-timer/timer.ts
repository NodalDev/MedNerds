export interface TimerConfig {
  readonly durationSeconds: number;
  readonly warningRemainingSeconds: number;
}

/** A monotonic time source returning milliseconds. */
export interface Clock {
  now(): number;
}

export type TimerStatus = 'ready' | 'running' | 'paused' | 'ended';
export type TimerEvent = 'start' | 'pause' | 'resume' | 'reset' | 'warning' | 'end';

export interface TimerSnapshot {
  readonly status: TimerStatus;
  readonly remainingMilliseconds: number;
  readonly remainingSeconds: number;
}

const monotonicClock: Clock = { now: () => performance.now() };

/** Local countdown core. Invalid state transitions are no-ops and return no events.
 * Call update() to collect crossed thresholds; getSnapshot() never consumes them.
 */
export class OsceTimerEngine {
  readonly config: Readonly<TimerConfig>;

  private readonly clock: Clock;
  private readonly durationMilliseconds: number;
  private readonly warningMilliseconds: number;
  private status: TimerStatus = 'ready';
  private remainingWhenStoppedMilliseconds: number;
  private deadlineMilliseconds: number | null = null;
  private warningEmitted = false;

  constructor(config: TimerConfig, clock: Clock = monotonicClock) {
    const durationMilliseconds = config.durationSeconds * 1000;
    const warningMilliseconds = config.warningRemainingSeconds * 1000;
    if (typeof config.durationSeconds !== 'number'
      || typeof config.warningRemainingSeconds !== 'number'
      || !Number.isFinite(durationMilliseconds) || durationMilliseconds <= 0
      || durationMilliseconds > Number.MAX_SAFE_INTEGER
      || !Number.isFinite(warningMilliseconds) || warningMilliseconds < 0
      || warningMilliseconds >= durationMilliseconds) {
      throw new RangeError('Invalid OSCE timer duration or warning threshold.');
    }

    this.config = Object.freeze({ ...config });
    this.clock = clock;
    this.durationMilliseconds = durationMilliseconds;
    this.warningMilliseconds = warningMilliseconds;
    this.remainingWhenStoppedMilliseconds = durationMilliseconds;
  }

  getSnapshot(): TimerSnapshot {
    const remainingMilliseconds = this.remainingAt(this.clock.now());
    return {
      status: this.status === 'running' && remainingMilliseconds === 0 ? 'ended' : this.status,
      remainingMilliseconds,
      remainingSeconds: Math.ceil(remainingMilliseconds / 1000),
    };
  }

  start(): readonly TimerEvent[] {
    if (this.status !== 'ready') return [];
    this.deadlineMilliseconds = this.clock.now() + this.durationMilliseconds;
    this.status = 'running';
    return ['start'];
  }

  /** Reports crossed thresholds once, in warning-then-end order if both were skipped. */
  update(): readonly TimerEvent[] {
    return this.advanceTo(this.clock.now());
  }

  pause(): readonly TimerEvent[] {
    if (this.status !== 'running') return [];
    const now = this.clock.now();
    const events = this.advanceTo(now);
    if (this.status !== 'running') return events;
    this.remainingWhenStoppedMilliseconds = this.remainingAt(now);
    this.deadlineMilliseconds = null;
    this.status = 'paused';
    return [...events, 'pause'];
  }

  resume(): readonly TimerEvent[] {
    if (this.status !== 'paused') return [];
    this.deadlineMilliseconds = this.clock.now() + this.remainingWhenStoppedMilliseconds;
    this.status = 'running';
    return ['resume'];
  }

  reset(): readonly TimerEvent[] {
    if (this.status === 'ready') return [];
    this.status = 'ready';
    this.deadlineMilliseconds = null;
    this.remainingWhenStoppedMilliseconds = this.durationMilliseconds;
    this.warningEmitted = false;
    return ['reset'];
  }

  private remainingAt(now: number): number {
    return this.status === 'running'
      ? Math.max(0, this.deadlineMilliseconds! - now)
      : this.remainingWhenStoppedMilliseconds;
  }

  private advanceTo(now: number): TimerEvent[] {
    if (this.status !== 'running') return [];
    const remainingMilliseconds = this.remainingAt(now);
    const events: TimerEvent[] = [];
    if (this.warningMilliseconds > 0 && !this.warningEmitted
      && remainingMilliseconds <= this.warningMilliseconds) {
      this.warningEmitted = true;
      events.push('warning');
    }
    if (remainingMilliseconds === 0) {
      this.status = 'ended';
      this.deadlineMilliseconds = null;
      this.remainingWhenStoppedMilliseconds = 0;
      events.push('end');
    }
    return events;
  }
}
