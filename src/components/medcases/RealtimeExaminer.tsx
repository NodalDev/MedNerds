import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimerConfig } from '../../data/medcases/types';
import type { TimerStatus } from '../../lib/medcases/timer';
import { createRealtimeSession } from '../../lib/medcases/MedCasesRealtimeClient';
import { realtimeConfig } from '../../lib/medcases/realtime-config';
import {
  clearExaminerSession, cueForLiveEvent, restoreExaminerSession, saveExaminerSession, sessionJoinUrl,
  validStoredSession, type StoredExaminerSession,
} from '../../lib/medcases/realtime-ui';
import { useRealtimeSession } from './useRealtimeSession';
import RealtimeTimer from './RealtimeTimer';

export default function RealtimeExaminer({
  caseId, timer, localStatus, onActiveChange, onCue,
}: {
  caseId: string;
  timer: TimerConfig;
  localStatus: TimerStatus;
  onActiveChange(active: boolean): void;
  onCue(cue: 'start' | 'warning' | 'end'): void;
}) {
  const [credentials, setCredentials] = useState<StoredExaminerSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const creatingRef = useRef(false);
  const workerUrl = realtimeConfig.workerUrl;

  useEffect(() => {
    const restored = restoreExaminerSession(window.sessionStorage, caseId);
    setCredentials(restored);
    setRestoring(false);
  }, [caseId]);
  useEffect(() => onActiveChange(!!credentials), [credentials, onActiveChange]);

  const onTerminal = useCallback((reason: 'expired' | 'auth-failed') => {
    clearExaminerSession(window.sessionStorage);
    setCredentials(null);
    setExpired(reason === 'expired');
    if (reason === 'auth-failed') setError('Die Prüferberechtigung ist ungültig. Bitte erstelle eine neue Live-Session.');
  }, []);
  const onLiveEvent = useCallback((type: string) => {
    if (document.hidden) return;
    const cue = cueForLiveEvent(type);
    if (cue) onCue(cue);
  }, [onCue]);
  const { status, session, serverNowMs, pending, command } = useRealtimeSession(
    credentials && workerUrl ? {
      baseUrl: workerUrl, sessionId: credentials.sessionId, expiresAtMs: credentials.expiresAtMs,
      joinCode: credentials.joinCode, role: 'examiner', capability: credentials.examinerCapability,
    } : null,
    onTerminal, onLiveEvent,
  );

  if (!workerUrl) return null;
  const joinUrl = credentials
    ? sessionJoinUrl(realtimeConfig.joinBaseUrl ?? window.location.origin, credentials.joinCode)
    : null;

  const create = async () => {
    if (creatingRef.current || localStatus !== 'ready' || credentials) return;
    creatingRef.current = true;
    setCreating(true);
    setError('');
    setExpired(false);
    try {
      const response = await createRealtimeSession(workerUrl, {
        caseId, durationSeconds: timer.durationSeconds, warningRemainingSeconds: timer.warningRemainingSeconds,
      });
      const next: StoredExaminerSession = { ...response, version: 1, caseId };
      if (!validStoredSession(next, caseId, Date.now())) throw new Error('invalid-response');
      saveExaminerSession(window.sessionStorage, next);
      setCredentials(next);
    } catch {
      setError('Die Live-Session konnte nicht erstellt werden. Prüfe die lokale Worker-Verbindung und versuche es erneut.');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };
  const discard = () => {
    clearExaminerSession(window.sessionStorage);
    setCredentials(null);
    setExpired(false);
    setError('');
  };
  const copyLink = async () => {
    if (!joinUrl) return;
    try { await navigator.clipboard.writeText(joinUrl); setCopied(true); }
    catch { setCopied(false); }
  };
  const connectionText = {
    idle: 'Nicht verbunden', connecting: 'Verbindung wird aufgebaut …',
    authenticating: 'Authentifizierung läuft …', connected: 'Verbunden',
    reconnecting: typeof navigator === 'undefined' || navigator.onLine ? 'Verbindung wird wiederhergestellt …' : 'Offline – Verbindung wird wiederhergestellt, sobald du online bist.',
    expired: 'Abgelaufen', error: 'Verbindung fehlgeschlagen',
  }[status];

  return <div className="osce-live-stack">
    <section className="osce-panel osce-live">
      <p className="osce-eyebrow">Lokaler Prototyp</p>
      <h2>Live-Session</h2>
      {!credentials ? <>
        <p>Synchronisiere den OSCE-Timer mit weiteren Geräten.</p>
        {expired && <p role="status">Diese Live-Session ist abgelaufen.</p>}
        {localStatus !== 'ready' && <p className="osce-muted">Setze zuerst den lokalen Timer zurück, bevor du eine Live-Session erstellst.</p>}
        <button className="osce-button" type="button" onClick={create} disabled={creating || restoring || localStatus !== 'ready'}>
          {creating ? 'Live-Session wird erstellt …' : 'Live-Session erstellen'}
        </button>
      </> : <>
        <p className="osce-live__status" role="status" aria-live="polite">{connectionText}</p>
        <p className="osce-muted">Diese temporäre Session läuft spätestens um {new Date(credentials.expiresAtMs).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })} ab.</p>
        {joinUrl && <div className="osce-live__invite">
          <div className="osce-live__qr" role="img" aria-label="QR-Code mit dem Beitrittslink zur Live-Session">
            <QRCodeSVG value={joinUrl} level="M" marginSize={4} bgColor="#ffffff" fgColor="#000000" size={192} aria-hidden="true" />
          </div>
          <div className="osce-live__details">
            <p className="osce-label">Session-Code</p>
            <strong className="osce-join-code">{credentials.joinCode}</strong>
            <a className="osce-live__link" href={joinUrl}>{joinUrl}</a>
            <button className="osce-button osce-button--secondary" type="button" onClick={copyLink}>{copied ? 'Link kopiert' : 'Link kopieren'}</button>
          </div>
        </div>}
        <button className="osce-button osce-button--secondary" type="button" onClick={discard}>Live-Ansicht verlassen</button>
      </>}
      {error && <p className="osce-error" role="alert">{error}</p>}
    </section>
    {credentials && session && status === 'connected' && <RealtimeTimer state={session} serverNowMs={serverNowMs} pending={pending} command={command} />}
  </div>;
}
