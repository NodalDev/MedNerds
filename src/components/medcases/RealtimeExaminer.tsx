import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CaseMaterial, TimerConfig } from '../../data/medcases/types';
import type { TimerStatus } from '../../lib/medcases/timer';
import { createRealtimeSession } from '../../lib/medcases/MedCasesRealtimeClient';
import { realtimeConfig } from '../../lib/medcases/realtime-config';
import {
  clearExaminerSession, cueForLiveEvent, patientInviteUrl, restoreExaminerSession, saveExaminerSession, sessionCandidateUrl, sessionDisplayUrl,
  validStoredSession, type StoredExaminerSession,
} from '../../lib/medcases/realtime-ui';
import { useRealtimeSession } from './useRealtimeSession';
import RealtimeTimer from './RealtimeTimer';
import SessionQrCode from './SessionQrCode';

export default function RealtimeExaminer({
  caseId, timer, materials, onActiveChange, onTimerStatusChange, onUseLocalTimer, onCue, soundControls,
}: {
  caseId: string;
  timer: TimerConfig;
  materials: CaseMaterial[];
  onActiveChange(active: boolean): void;
  onTimerStatusChange(status: TimerStatus | null): void;
  onUseLocalTimer(): void;
  onCue(cue: 'start' | 'warning' | 'end'): void;
  soundControls: ReactNode;
}) {
  const [credentials, setCredentials] = useState<StoredExaminerSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'candidate' | 'patient' | 'display' | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [patientInviteOpen, setPatientInviteOpen] = useState(false);
  const [displayInviteOpen, setDisplayInviteOpen] = useState(false);
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
  const { status, session, serverNowMs, pending, command, pendingMaterialId, materialError, releaseMaterial } = useRealtimeSession(
    credentials && workerUrl ? {
      baseUrl: workerUrl, sessionId: credentials.sessionId, expiresAtMs: credentials.expiresAtMs,
      joinCode: credentials.joinCode, role: 'examiner', capability: credentials.examinerCapability,
    } : null,
    onTerminal, onLiveEvent,
  );
  useEffect(() => onTimerStatusChange(credentials ? session?.timer?.status ?? null : null),
    [credentials, session?.timer?.status, onTimerStatusChange]);

  if (!workerUrl) return <section className="osce-panel osce-live" role="status">
    <p className="osce-eyebrow">Live-Session</p>
    <p>Live-OSCE ist derzeit nicht verfügbar.</p>
    <button className="osce-button osce-button--secondary" type="button" onClick={onUseLocalTimer}>Lokalen Timer verwenden</button>
  </section>;
  const candidateUrl = credentials
    ? sessionCandidateUrl(realtimeConfig.joinBaseUrl ?? window.location.origin, credentials.joinCode)
    : null;
  const patientUrl = credentials
    ? patientInviteUrl(realtimeConfig.joinBaseUrl ?? window.location.origin, credentials.joinCode, credentials.patientCapability)
    : null;
  const displayUrl = credentials
    ? sessionDisplayUrl(realtimeConfig.joinBaseUrl ?? window.location.origin, credentials.joinCode)
    : null;

  const create = async () => {
    if (creatingRef.current || credentials) return;
    creatingRef.current = true;
    setCreating(true);
    setError('');
    setExpired(false);
    try {
      const response = await createRealtimeSession(workerUrl, {
        caseId, durationSeconds: timer.durationSeconds, warningRemainingSeconds: timer.warningRemainingSeconds,
      });
      const next: StoredExaminerSession = { ...response, version: 2, caseId };
      if (!validStoredSession(next, caseId, Date.now())) throw new Error('invalid-response');
      saveExaminerSession(window.sessionStorage, next);
      setCredentials(next);
    } catch {
      setError('Die Live-Session konnte nicht erstellt werden. Prüfe deine Verbindung und versuche es erneut.');
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
  const copyLink = async (url: string, kind: 'candidate' | 'patient' | 'display') => {
    try { await navigator.clipboard.writeText(url); setCopied(kind); setCopyError(false); }
    catch { setCopied(null); setCopyError(true); }
  };
  const connectionText = {
    idle: 'Nicht verbunden', connecting: 'Verbindung wird aufgebaut …',
    authenticating: 'Authentifizierung läuft …', connected: 'Verbunden',
    reconnecting: typeof navigator === 'undefined' || navigator.onLine ? 'Verbindung wird wiederhergestellt …' : 'Offline – Verbindung wird wiederhergestellt, sobald du online bist.',
    expired: 'Abgelaufen', error: 'Verbindung fehlgeschlagen',
  }[status];

  return <div className="osce-live-stack">
    <section className="osce-panel osce-live">
      <p className="osce-eyebrow">Live-OSCE</p>
      <h2>Live-Session</h2>
      {!credentials ? <>
        <p>Synchronisiere den OSCE-Timer mit weiteren Geräten.</p>
        {expired && <p role="status">Diese Live-Session ist abgelaufen.</p>}
        <button className="osce-button" type="button" onClick={create} disabled={creating || restoring}>
          {creating ? 'Live-Session wird erstellt …' : 'Live-Session erstellen'}
        </button>
      </> : <>
        <p className="osce-live__status" role="status" aria-live="polite">{connectionText}</p>
        <p className="osce-muted">Diese temporäre Session läuft spätestens um {new Date(credentials.expiresAtMs).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })} ab.</p>
        {candidateUrl && <div className="osce-live__invite">
          <p className="osce-label">Prüfling verbinden</p>
          <SessionQrCode url={candidateUrl} label="QR-Code zum Beitritt als Prüfling" />
          <div className="osce-live__details">
            <p className="osce-label">Session-Code</p>
            <strong className="osce-join-code">{credentials.joinCode}</strong>
            <button className="osce-button osce-button--secondary" type="button" onClick={() => copyLink(candidateUrl, 'candidate')}>{copied === 'candidate' ? 'Beitrittslink kopiert' : 'Beitrittslink kopieren'}</button>
          </div>
        </div>}
        {patientUrl && <div className="osce-live__display-invite">
          <button className="osce-button osce-button--secondary" type="button" aria-expanded={patientInviteOpen}
            onClick={() => setPatientInviteOpen((open) => !open)}>Schauspielpatient einladen</button>
          {patientInviteOpen && <div className="osce-live__invite">
            <p className="osce-label">Persönliche Patienteneinladung</p>
            <SessionQrCode url={patientUrl} label="QR-Code mit temporärem Zugang zur Schauspielpatientenansicht" />
            <button className="osce-button osce-button--secondary" type="button" onClick={() => copyLink(patientUrl, 'patient')}>
              {copied === 'patient' ? 'Patientenlink kopiert' : 'Patientenlink kopieren'}
            </button>
          </div>}
        </div>}
        {displayUrl && <div className="osce-live__display-invite">
          <button className="osce-button osce-button--secondary" type="button" aria-expanded={displayInviteOpen}
            onClick={() => setDisplayInviteOpen((open) => !open)}>Timer-Display hinzufügen</button>
          {displayInviteOpen && <div className="osce-live__invite">
            <SessionQrCode url={displayUrl} label="QR-Code für ein passives Timer-Display" />
            <div className="osce-live__details">
              <p className="osce-label">Display-Code</p>
              <strong className="osce-join-code">{credentials.joinCode}</strong>
              <button className="osce-button osce-button--secondary" type="button" onClick={() => copyLink(displayUrl, 'display')}>
                {copied === 'display' ? 'Display-Link kopiert' : 'Display-Link kopieren'}
              </button>
            </div>
          </div>}
        </div>}
        <button className="osce-button osce-button--secondary" type="button" onClick={discard}>Live-Ansicht verlassen</button>
      </>}
      {error && <p className="osce-error" role="alert">{error}</p>}
      {error && !credentials && <button className="osce-button osce-button--secondary" type="button" onClick={onUseLocalTimer}>Lokalen Timer verwenden</button>}
      {copyError && <p className="osce-error" role="alert">Der Link konnte nicht kopiert werden.</p>}
      {soundControls}
    </section>
    {credentials && status === 'connected' && materials.length > 0 && <section className="osce-panel osce-live-materials">
      <h2>Materialien freigeben</h2>
      <p className="osce-fineprint">Freigaben bleiben bis zum Ende dieser Session sichtbar.</p>
      {materials.map((material) => {
        const released = session?.releasedMaterialIds?.includes(material.id) ?? false;
        return <div className="osce-live-materials__row" key={material.id}>
          <span>{material.title}</span>
          {released ? <strong>Freigegeben</strong> : <button className="osce-button osce-button--secondary" type="button"
            disabled={!!pendingMaterialId || !session} onClick={() => releaseMaterial(material.id)}>
            {pendingMaterialId === material.id ? 'Freigabe läuft …' : 'Freigeben'}
          </button>}
        </div>;
      })}
      {materialError && <p className="osce-error" role="alert">{materialError}</p>}
    </section>}
    {credentials && session?.timer && status === 'connected' && <RealtimeTimer state={{ timer: session.timer }} serverNowMs={serverNowMs} pending={pending} command={command} />}
  </div>;
}
