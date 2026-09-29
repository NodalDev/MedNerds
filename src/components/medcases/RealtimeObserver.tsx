import { useEffect, useRef, useState } from 'react';
import { resolveRealtimeCode } from '../../lib/medcases/MedCasesRealtimeClient';
import { realtimeConfig } from '../../lib/medcases/realtime-config';
import { normalizeSessionCode, sessionJoinUrl } from '../../lib/medcases/realtime-ui';
import { useRealtimeSession, type RealtimeConnection } from './useRealtimeSession';
import RealtimeTimer from './RealtimeTimer';

export default function RealtimeObserver() {
  const [code, setCode] = useState('');
  const [connection, setConnection] = useState<RealtimeConnection | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const requestId = useRef(0);
  const workerUrl = realtimeConfig.workerUrl;
  const { status, session, serverNowMs } = useRealtimeSession(connection, (reason) => {
    setConnection(null);
    if (reason === 'expired') setExpired(true);
    else setError('Der Beitritt zur Live-Session wurde abgelehnt.');
  });

  const join = async (input: string) => {
    const normalized = normalizeSessionCode(input);
    setCode(input.toUpperCase());
    setError('');
    setExpired(false);
    setConnection(null);
    if (!normalized) { setError('Dieser Session-Code ist ungültig oder nicht mehr aktiv.'); return; }
    if (!workerUrl) return;
    const currentRequest = ++requestId.current;
    setJoining(true);
    try {
      const result = await resolveRealtimeCode(workerUrl, normalized);
      if (currentRequest !== requestId.current) return;
      if (!/^session_[a-f0-9]{32}$/.test(result.sessionId) || !Number.isSafeInteger(result.expiresAtMs)
        || result.expiresAtMs <= Date.now()) throw new Error('invalid-response');
      window.history.replaceState(null, '', sessionJoinUrl(window.location.origin, normalized));
      setConnection({ baseUrl: workerUrl, sessionId: result.sessionId, expiresAtMs: result.expiresAtMs, joinCode: normalized, role: 'observer' });
    } catch (cause) {
      if (currentRequest !== requestId.current) return;
      setError(cause instanceof Error && cause.message === 'not-found'
        ? 'Dieser Session-Code ist ungültig oder nicht mehr aktiv.'
        : 'Der Live-Dienst ist derzeit nicht erreichbar. Bitte versuche es später erneut.');
    } finally {
      if (currentRequest === requestId.current) setJoining(false);
    }
  };

  useEffect(() => {
    const initialCode = new URLSearchParams(window.location.search).get('code');
    if (initialCode) void join(initialCode);
    return () => { requestId.current += 1; };
  }, []);

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
    {connection && session && status === 'connected' && <RealtimeTimer state={session} serverNowMs={serverNowMs} />}
  </div>;
}
