import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../../lib/medcases/timer';
import { visibleRemainingMs } from '../../lib/medcases/realtime-ui';
import { useDisplayWakeLock } from './useDisplayWakeLock';
import { useSessionCodeConnection } from './useSessionCodeConnection';

const timerStatus = { ready: 'Bereit', running: 'Läuft', paused: 'Pausiert', ended: 'Zeit abgelaufen' } as const;

export default function RealtimeDisplay() {
  const { code, setCode, connection, joining, error, expired, workerUrl, join, status, session, serverNowMs } = useSessionCodeConnection('display');
  const display = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const wake = useDisplayWakeLock();

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === display.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenError('');
    try {
      if (fullscreen) await document.exitFullscreen();
      else if (display.current?.requestFullscreen) await display.current.requestFullscreen();
      else setFullscreenError('Vollbild wird von diesem Browser nicht unterstützt.');
    } catch {
      setFullscreenError('Vollbild konnte nicht gestartet werden.');
    }
  };

  const connected = status === 'connected';
  const disconnected = status === 'reconnecting';
  const timer = session?.timer;
  const warning = timer?.status === 'running' && timer.warningEmitted;
  const stateText = timer ? warning ? 'Noch wenig Zeit · Läuft' : timerStatus[timer.status] : 'Warte auf Timer';
  const connectionText = connected ? 'Verbunden' : disconnected
    ? 'Verbindung unterbrochen – Wiederverbindung läuft. Anzeige nicht bestätigt.'
    : status === 'connecting' || status === 'authenticating' ? 'Verbindung wird aufgebaut …'
      : status === 'expired' || expired ? 'Diese Live-Session ist abgelaufen.' : 'Nicht verbunden';

  if (!workerUrl) return <p className="osce-panel">Live-Sessions sind derzeit nicht verfügbar.</p>;

  return <div className="osce-display-page">
    {!connection && !expired && <form className="osce-panel osce-display-join" onSubmit={(event) => { event.preventDefault(); void join(code); }}>
      <h2>Timer-Display verbinden</h2>
      <label className="osce-label" htmlFor="osce-display-code">Session-Code</label>
      <div className="osce-join__row">
        <input id="osce-display-code" className="osce-input osce-code-input" autoComplete="off" autoCapitalize="characters"
          maxLength={6} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="K7P4MX" required />
        <button className="osce-button" type="submit" disabled={joining}>{joining ? 'Verbinde …' : 'Display verbinden'}</button>
      </div>
      {error && <p className="osce-error" role="alert">{error}</p>}
    </form>}
    {(connection || expired) && <section ref={display} className={`osce-display${warning ? ' osce-display--warning' : ''}${timer?.status === 'ended' ? ' osce-display--ended' : ''}`} aria-label="Passives OSCE-Timer-Display">
      <div className="osce-display__body">
        <p className="osce-eyebrow">OSCE Timer</p>
        {timer && !expired ? <div className="osce-display__time" role="timer" aria-live="off" aria-label={`${formatTime(visibleRemainingMs(timer, serverNowMs) / 1000)} verbleibend`}>
          {formatTime(visibleRemainingMs(timer, serverNowMs) / 1000)}
        </div> : <p className="osce-display__placeholder">—:—</p>}
        {timer && !expired && <p className="osce-display__state" role="status" aria-live="polite">{stateText}</p>}
        <p className={`osce-display__connection${disconnected ? ' osce-display__connection--lost' : ''}`} role="status" aria-live="polite">{connectionText}</p>
      </div>
      <div className="osce-display__actions">
        <button className="osce-button osce-button--secondary" type="button" onClick={toggleFullscreen}>
          {fullscreen ? 'Vollbild verlassen' : 'Vollbild starten'}
        </button>
        <button className="osce-button osce-button--secondary" type="button" onClick={wake.toggle}>
          {wake.enabled ? 'Bildschirm wach halten ausschalten' : 'Bildschirm wach halten'}
        </button>
      </div>
      {fullscreenError && <p className="osce-fineprint" role="alert">{fullscreenError}</p>}
      {wake.state === 'active' && <p className="osce-fineprint" role="status">Bildschirm bleibt wach.</p>}
      {wake.state === 'suspended' && <p className="osce-fineprint" role="status">Bildschirm-Wachhalten ist unterbrochen.</p>}
      {wake.state === 'unsupported' && <p className="osce-fineprint" role="status">Bildschirm wach halten wird von diesem Browser nicht unterstützt.</p>}
      {wake.state === 'error' && <p className="osce-fineprint" role="alert">Bildschirm konnte nicht wach gehalten werden.</p>}
    </section>}
    {expired && <p role="status">Diese Live-Session ist abgelaufen.</p>}
    {error && connection && <p className="osce-error" role="alert">{error}</p>}
  </div>;
}
