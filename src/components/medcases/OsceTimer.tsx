import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimerConfig } from '../../data/medcases/types';
import { formatTime, type TimerCue, type TimerStatus } from '../../lib/medcases/timer';
import { OsceTimerEngine, type TimerEvent } from '../../lib/osce-timer/timer';

interface Props {
  config: TimerConfig;
  master?: boolean;
  disabled?: boolean;
  onCue?: (cue: TimerCue) => void;
  onStatusChange?: (status: TimerStatus) => void;
}

export default function OsceTimer({ config, master = false, disabled = false, onCue, onStatusChange }: Props) {
  const timerRef = useRef<OsceTimerEngine | null>(null);
  timerRef.current ??= new OsceTimerEngine(config);
  const [snapshot, setSnapshot] = useState(() => timerRef.current!.getSnapshot());
  const statusRef = useRef<TimerStatus>(snapshot.status);
  const cueCallback = useRef(onCue);
  cueCallback.current = onCue;
  const statusCallback = useRef(onStatusChange);
  statusCallback.current = onStatusChange;

  const commit = useCallback((events: readonly TimerEvent[], playCues = true) => {
    const next = timerRef.current!.getSnapshot();
    setSnapshot((previous) => previous.status === next.status && previous.remainingSeconds === next.remainingSeconds
      ? previous
      : next);
    if (statusRef.current !== next.status) {
      statusRef.current = next.status;
      statusCallback.current?.(next.status);
    }
    if (playCues && !document.hidden) {
      for (const event of events) {
        if (event === 'start' || event === 'warning' || event === 'end') cueCallback.current?.(event);
      }
    }
  }, []);

  useEffect(() => {
    const timer = timerRef.current!;
    if (statusRef.current !== 'ready'
      || (timer.config.durationSeconds === config.durationSeconds
        && timer.config.warningRemainingSeconds === config.warningRemainingSeconds)) return;
    timerRef.current = new OsceTimerEngine(config);
    setSnapshot(timerRef.current.getSnapshot());
  }, [config.durationSeconds, config.warningRemainingSeconds]);

  useEffect(() => {
    if (snapshot.status !== 'running') return;
    const update = () => commit(timerRef.current!.update());
    const onVisibility = () => {
      if (!document.hidden) commit(timerRef.current!.update(), false);
    };
    const interval = window.setInterval(update, 200);
    document.addEventListener('visibilitychange', onVisibility);
    update();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [snapshot.status, commit]);

  const start = () => {
    if (!disabled) commit(timerRef.current!.start());
  };
  const pause = () => commit(timerRef.current!.pause());
  const resume = () => commit(timerRef.current!.resume());
  const reset = () => commit(timerRef.current!.reset());

  const { status, remainingSeconds: remaining } = snapshot;
  const warning = status === 'running' && config.warningRemainingSeconds > 0 && remaining <= config.warningRemainingSeconds;
  const statusText = status === 'ready' ? 'BEREIT' : status === 'paused' ? 'PAUSIERT' : status === 'ended' ? 'ZEIT ABGELAUFEN' : warning ? `Warnung ab ${formatTime(config.warningRemainingSeconds)} Restzeit` : 'LÄUFT';

  return <section className={`osce-timer${warning ? ' osce-timer--warning' : ''}${status === 'ended' ? ' osce-timer--ended' : ''}`} aria-label="Lokaler OSCE-Timer">
    <p className="osce-eyebrow">Lokaler Timer</p>
    <div className="osce-timer__display" role="timer" aria-label={`${formatTime(remaining)} verbleibend`}>{formatTime(remaining)}</div>
    <p className="osce-timer__state" role="status" aria-live="polite">{statusText}</p>
    {status === 'ready' && <p className="osce-muted">Warnung bei {config.warningRemainingSeconds ? formatTime(config.warningRemainingSeconds) : 'deaktiviert'}. Starte nach deinem verbalen Kommando.</p>}
    <div className="osce-actions">
      {status === 'ready' && <button className="osce-button" type="button" onClick={start} disabled={disabled}>Start</button>}
      {master && status === 'running' && <button className="osce-button osce-button--secondary" type="button" onClick={pause}>Lokal pausieren</button>}
      {master && status === 'paused' && <button className="osce-button" type="button" onClick={resume}>Fortsetzen</button>}
      {master && status !== 'ready' && <button className="osce-button osce-button--secondary" type="button" onClick={reset}>Zurücksetzen</button>}
    </div>
    {master && <p className="osce-fineprint">Pause und Reset betreffen nur dieses Gerät.</p>}
  </section>;
}
