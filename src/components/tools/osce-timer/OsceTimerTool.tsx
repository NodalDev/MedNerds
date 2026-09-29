import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateTimerSettings } from '../../../lib/osce-timer/settings';
import { OsceTimerSound, soundCuesForEvents } from '../../../lib/osce-timer/sound';
import { OsceTimerEngine, type TimerEvent, type TimerSnapshot } from '../../../lib/osce-timer/timer';
import './osce-timer-tool.css';

const defaultConfig = { durationSeconds: 13 * 60, warningRemainingSeconds: 2 * 60 };

function formatTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const announcements: Record<TimerEvent, string> = {
  start: 'Timer gestartet.',
  pause: 'Timer pausiert.',
  resume: 'Timer fortgesetzt.',
  reset: 'Timer zurückgesetzt.',
  warning: 'Warnschwelle erreicht.',
  end: 'Zeit abgelaufen.',
};

export default function OsceTimerTool() {
  const timerRef = useRef<OsceTimerEngine | null>(null);
  timerRef.current ??= new OsceTimerEngine(defaultConfig);
  const toolRef = useRef<HTMLElement>(null);
  const soundRef = useRef<OsceTimerSound | null>(null);

  const [snapshot, setSnapshot] = useState<TimerSnapshot>(() => timerRef.current!.getSnapshot());
  const [duration, setDuration] = useState('13');
  const [warning, setWarning] = useState('2');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [audioMessage, setAudioMessage] = useState('');
  const [fullscreenMessage, setFullscreenMessage] = useState('');

  const settings = useMemo(() => validateTimerSettings(duration, warning), [duration, warning]);
  const maxWarningMinutes = /^\d+$/.test(duration) && Number(duration) >= 1 && Number(duration) <= 30
    ? Number(duration) - 1 : undefined;
  const { status, remainingMilliseconds, remainingSeconds } = snapshot;
  const warningPhase = status === 'running'
    && timerRef.current.config.warningRemainingSeconds > 0
    && remainingMilliseconds <= timerRef.current.config.warningRemainingSeconds * 1000;
  const statusText = status === 'ended' ? 'Zeit abgelaufen'
    : status === 'paused' ? 'Pausiert'
      : warningPhase ? 'Warnphase'
        : status === 'running' ? 'Läuft' : 'Bereit';

  const playCue = useCallback((cue: 'start' | 'warning' | 'end') => {
    soundRef.current ??= new OsceTimerSound();
    void soundRef.current.play(cue).then((played) => {
      if (!played) setAudioMessage('Ton konnte nicht abgespielt werden. Bitte Browser- und Geräteeinstellungen prüfen.');
    });
  }, []);

  const commit = useCallback((events: readonly TimerEvent[]) => {
    const next = timerRef.current!.getSnapshot();
    setSnapshot((previous) => previous.status === next.status && previous.remainingSeconds === next.remainingSeconds
      ? previous : next);
    if (events.length > 0) setAnnouncement(announcements[events[events.length - 1]]);
    for (const cue of soundCuesForEvents(events, soundEnabled)) playCue(cue);
  }, [playCue, soundEnabled]);

  useEffect(() => {
    if (status !== 'running') return;
    const update = () => commit(timerRef.current!.update());
    const interval = window.setInterval(update, 250);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [status, commit]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === toolRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => () => { void soundRef.current?.close(); }, []);

  const changeSettings = (nextDuration: string, nextWarning: string) => {
    if (timerRef.current!.getSnapshot().status !== 'ready') return;
    setDuration(nextDuration);
    setWarning(nextWarning);
    const next = validateTimerSettings(nextDuration, nextWarning);
    if (next.config) {
      timerRef.current = new OsceTimerEngine(next.config);
      setSnapshot(timerRef.current.getSnapshot());
    }
  };

  const start = () => {
    if (!settings.config || timerRef.current!.getSnapshot().status !== 'ready') return;
    timerRef.current = new OsceTimerEngine(settings.config);
    commit(timerRef.current.start());
  };

  const toggleFullscreen = async () => {
    setFullscreenMessage('');
    try {
      if (document.fullscreenElement === toolRef.current) {
        await document.exitFullscreen();
      } else if (toolRef.current?.requestFullscreen) {
        await toolRef.current.requestFullscreen();
      } else {
        setFullscreenMessage('Vollbild wird von diesem Browser nicht unterstützt.');
      }
    } catch {
      setFullscreenMessage('Vollbild konnte nicht geöffnet werden.');
    }
  };

  const testSound = () => {
    setAudioMessage('');
    playCue('start');
  };

  return (
    <section ref={toolRef} className={`mn-osce-tool not-content${warningPhase ? ' mn-osce-tool--warning' : ''}${status === 'ended' ? ' mn-osce-tool--ended' : ''}`} aria-labelledby="mn-osce-tool-title">
      <div className="mn-osce-tool__heading">
        <div>
          <p className="mn-osce-tool__eyebrow">MedTools · lokal im Browser</p>
          <h2 id="mn-osce-tool-title">Lokaler Timer</h2>
        </div>
      </div>

      <div className="mn-osce-tool__grid">
        <div className="mn-osce-tool__timer">
          <div className="mn-osce-tool__readout" role="timer" aria-live="off" aria-label="Verbleibende Zeit">
            {status === 'ready' && !settings.config ? '--:--' : formatTime(remainingSeconds)}
          </div>
          <p className="mn-osce-tool__state">{statusText}</p>
          {warningPhase && <p className="mn-osce-tool__detail">Warnschwelle: {formatTime(timerRef.current.config.warningRemainingSeconds)} Restzeit</p>}
          {status === 'ready' && <p className="mn-osce-tool__detail">Dauer und Warnzeit einstellen, dann starten.</p>}
          <div className="mn-osce-tool__actions">
            {status === 'ready' && <button type="button" className="mn-osce-tool__button mn-osce-tool__button--primary" disabled={!settings.config} onClick={start}>Start</button>}
            {status === 'running' && <button type="button" className="mn-osce-tool__button mn-osce-tool__button--primary" onClick={() => commit(timerRef.current!.pause())}>Pause</button>}
            {status === 'paused' && <button type="button" className="mn-osce-tool__button mn-osce-tool__button--primary" onClick={() => commit(timerRef.current!.resume())}>Fortsetzen</button>}
            {status !== 'ready' && <button type="button" className="mn-osce-tool__button mn-osce-tool__button--quiet" onClick={() => commit(timerRef.current!.reset())}>Zurücksetzen</button>}
            <button type="button" className="mn-osce-tool__button mn-osce-tool__button--quiet" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Vollbild verlassen' : 'Vollbild öffnen'}>
              {isFullscreen ? 'Vollbild verlassen' : 'Vollbild öffnen'}
            </button>
          </div>
        </div>
        <section className="mn-osce-tool__settings" aria-labelledby="mn-osce-settings-title">
          <h3 id="mn-osce-settings-title">Einstellungen</h3>
          <div className="mn-osce-tool__fields">
            <div className="mn-osce-tool__field">
              <label htmlFor="mn-osce-duration">Dauer <span>in Minuten</span></label>
              <input id="mn-osce-duration" type="number" inputMode="numeric" min="1" max="30" step="1" value={duration}
                disabled={status !== 'ready'} aria-invalid={Boolean(settings.durationError)}
                aria-describedby={settings.durationError ? 'mn-osce-duration-error' : undefined}
                onChange={(event) => changeSettings(event.target.value, warning)} />
              {settings.durationError && <p id="mn-osce-duration-error" className="mn-osce-tool__error">{settings.durationError}</p>}
            </div>
            <div className="mn-osce-tool__field">
              <label htmlFor="mn-osce-warning">Warnung <span>Minuten vor Ende · 0 = aus</span></label>
              <input id="mn-osce-warning" type="number" inputMode="numeric" min="0" max={maxWarningMinutes} step="1" value={warning}
                disabled={status !== 'ready'} aria-invalid={Boolean(settings.warningError)}
                aria-describedby={settings.warningError ? 'mn-osce-warning-error' : undefined}
                onChange={(event) => changeSettings(duration, event.target.value)} />
              {settings.warningError && <p id="mn-osce-warning-error" className="mn-osce-tool__error">{settings.warningError}</p>}
            </div>
          </div>
          <div className="mn-osce-tool__sound">
            <button type="button" className="mn-osce-tool__button mn-osce-tool__button--quiet" aria-pressed={soundEnabled} onClick={() => { setSoundEnabled((enabled) => !enabled); setAudioMessage(''); }}>
              Ton: {soundEnabled ? 'Ein' : 'Aus'}
            </button>
            <button type="button" className="mn-osce-tool__button mn-osce-tool__button--quiet" onClick={testSound}>Ton testen</button>
          </div>
          {audioMessage && <p className="mn-osce-tool__feedback" role="status">{audioMessage}</p>}
        </section>

      </div>
      {fullscreenMessage && <p className="mn-osce-tool__feedback" role="status">{fullscreenMessage}</p>}
      <p className="mn-osce-tool__sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}
