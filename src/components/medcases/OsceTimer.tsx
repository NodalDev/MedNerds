import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimerConfig } from '../../data/medcases/types';
import { formatTime, type TimerCue, type TimerStatus } from '../../lib/medcases/timer';

interface Props {
  config: TimerConfig;
  master?: boolean;
  disabled?: boolean;
  onCue?: (cue: TimerCue) => void;
  onStatusChange?: (status: TimerStatus) => void;
}

export default function OsceTimer({ config, master = false, disabled = false, onCue, onStatusChange }: Props) {
  const [status, setStatus] = useState<TimerStatus>('ready');
  const [remaining, setRemaining] = useState(config.durationSeconds);
  const deadline = useRef<number | null>(null);
  const emitted = useRef(new Set<TimerCue>());
  const cueCallback = useRef(onCue);
  cueCallback.current = onCue;
  const statusCallback = useRef(onStatusChange);
  statusCallback.current = onStatusChange;

  const emit = useCallback((cue: TimerCue) => {
    if (emitted.current.has(cue)) return;
    emitted.current.add(cue);
    cueCallback.current?.(cue);
  }, []);

  useEffect(() => {
    if (status === 'ready') setRemaining(config.durationSeconds);
  }, [config.durationSeconds, status]);

  useEffect(() => {
    if (status !== 'running') return;
    const update = () => {
      const next = Math.max(0, Math.ceil(((deadline.current ?? performance.now()) - performance.now()) / 1000));
      setRemaining(next);
      if (document.hidden) return;
      if (next <= 0) {
        emit('end');
        setStatus('ended');
        statusCallback.current?.('ended');
      } else if (config.warningRemainingSeconds > 0 && next <= config.warningRemainingSeconds) {
        emit('warning');
      }
    };
    const onVisibility = () => {
      if (document.hidden) return;
      const next = Math.max(0, Math.ceil(((deadline.current ?? performance.now()) - performance.now()) / 1000));
      if (next <= config.warningRemainingSeconds) emitted.current.add('warning');
      if (next <= 0) emitted.current.add('end');
      update();
    };
    const interval = window.setInterval(update, 200);
    document.addEventListener('visibilitychange', onVisibility);
    update();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, config.warningRemainingSeconds, emit]);

  const start = () => {
    if (status !== 'ready' || disabled) return;
    emitted.current.clear();
    deadline.current = performance.now() + config.durationSeconds * 1000;
    setRemaining(config.durationSeconds);
    setStatus('running');
    statusCallback.current?.('running');
    emit('start');
  };
  const pause = () => {
    if (status !== 'running') return;
    setRemaining(Math.max(0, Math.ceil(((deadline.current ?? performance.now()) - performance.now()) / 1000)));
    setStatus('paused');
    statusCallback.current?.('paused');
  };
  const resume = () => {
    if (status !== 'paused') return;
    deadline.current = performance.now() + remaining * 1000;
    setStatus('running');
    statusCallback.current?.('running');
  };
  const reset = () => {
    deadline.current = null;
    emitted.current.clear();
    setRemaining(config.durationSeconds);
    setStatus('ready');
    statusCallback.current?.('ready');
  };

  const warning = status === 'running' && config.warningRemainingSeconds > 0 && remaining <= config.warningRemainingSeconds;
  const statusText = status === 'ready' ? 'BEREIT' : status === 'paused' ? 'PAUSIERT' : status === 'ended' ? 'ZEIT ABGELAUFEN' : warning ? `Warnung ab ${formatTime(config.warningRemainingSeconds)} Restzeit` : 'LÄUFT';

  return <section className={`osce-timer${warning ? ' osce-timer--warning' : ''}${status === 'ended' ? ' osce-timer--ended' : ''}`} aria-label="Lokaler OSCE-Timer">
    <p className="osce-eyebrow">Lokaler Timer</p>
    <div className="osce-timer__display" role="timer" aria-label={`${formatTime(remaining)} verbleibend`}>{formatTime(remaining)}</div>
    <p className="osce-timer__state" role="status" aria-live="polite">{statusText}</p>
    {status === 'ready' && <p className="osce-muted">Warnung bei {config.warningRemainingSeconds ? formatTime(config.warningRemainingSeconds) : 'deaktiviert'}. Warte auf das verbale Startkommando des Prüfers.</p>}
    <div className="osce-actions">
      {status === 'ready' && <button className="osce-button" type="button" onClick={start} disabled={disabled}>Start</button>}
      {master && status === 'running' && <button className="osce-button osce-button--secondary" type="button" onClick={pause}>Lokal pausieren</button>}
      {master && status === 'paused' && <button className="osce-button" type="button" onClick={resume}>Fortsetzen</button>}
      {master && status !== 'ready' && <button className="osce-button osce-button--secondary" type="button" onClick={reset}>Zurücksetzen</button>}
    </div>
    {master && <p className="osce-fineprint">Pause und Reset betreffen nur dieses Gerät.</p>}
  </section>;
}
