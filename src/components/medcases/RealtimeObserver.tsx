import RealtimeTimer from './RealtimeTimer';
import { useSessionCodeConnection } from './useSessionCodeConnection';

export default function RealtimeObserver() {
  const { code, setCode, connection, joining, error, expired, workerUrl, join, status, session, serverNowMs } = useSessionCodeConnection('observer');

  if (!workerUrl) return <p className="osce-panel">Live-Sessions sind derzeit nicht verfügbar.</p>;
  const statusText = {
    idle: 'Nicht verbunden', connecting: 'Verbindung wird aufgebaut …',
    authenticating: 'Beitritt wird bestätigt …', connected: 'Verbunden',
    reconnecting: 'Verbindung unterbrochen – Wiederherstellung läuft …',
    expired: 'Session abgelaufen', error: 'Verbindung fehlgeschlagen',
  }[status];

  return <div className="osce-join">
    <form className="osce-panel" onSubmit={(event) => { event.preventDefault(); void join(code); }}>
      <label className="osce-label" htmlFor="osce-session-code">Session-Code</label>
      <div className="osce-join__row">
        <input id="osce-session-code" className="osce-input osce-code-input" autoComplete="off" autoCapitalize="characters"
          maxLength={6} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="K7P4MX" required />
        <button className="osce-button" type="submit" disabled={joining}>{joining ? 'Beitritt läuft …' : 'Beitreten'}</button>
      </div>
      {error && <p className="osce-error" role="alert">{error}</p>}
      {expired && <p role="status">Diese Live-Session ist abgelaufen.</p>}
    </form>
    {connection && <p className="osce-panel osce-live__status" role="status" aria-live="polite">{statusText}</p>}
    {connection && session?.timer && status === 'connected' && <RealtimeTimer state={{ timer: session.timer }} serverNowMs={serverNowMs} />}
  </div>;
}
