import { useCallback, useEffect, useState } from 'react';
import type { PatientCase } from '../../data/medcases/types';
import { realtimeConfig } from '../../lib/medcases/realtime-config';
import { clearPatientSession, restorePatientSession, type StoredPatientSession } from '../../lib/medcases/realtime-ui';
import OsceParticipant from './OsceParticipant';
import { useRealtimeSession } from './useRealtimeSession';

export default function RealtimePatient({ item }: { item: PatientCase }) {
  const [credentials, setCredentials] = useState<StoredPatientSession | null>(null);
  const [message, setMessage] = useState('Live-Session wird verbunden …');
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const restored = restorePatientSession(window.sessionStorage);
    setCredentials(restored);
    if (!restored) setMessage('Eine gültige Patienteneinladung ist erforderlich.');
  }, []);
  const onTerminal = useCallback((reason: 'expired' | 'auth-failed') => {
    clearPatientSession(window.sessionStorage);
    setCredentials(null);
    setMessage(reason === 'expired' ? 'Diese Live-Session ist abgelaufen.' : 'Die Patienteneinladung ist ungültig.');
  }, []);
  const onLiveEvent = useCallback((type: string) => {
    if (type === 'material.released') setAnnouncement('Neues Material wurde freigegeben.');
  }, []);
  const workerUrl = realtimeConfig.workerUrl;
  const { status, session } = useRealtimeSession(credentials && workerUrl ? {
    baseUrl: workerUrl, sessionId: credentials.sessionId, joinCode: credentials.joinCode,
    expiresAtMs: credentials.expiresAtMs, role: 'patient', capability: credentials.patientCapability,
  } : null, onTerminal, onLiveEvent);

  const mismatch = status === 'connected' && !!session && session.caseId !== item.id;
  useEffect(() => {
    if (!mismatch) return;
    clearPatientSession(window.sessionStorage);
    setCredentials(null);
    setMessage('Diese Live-Session gehört zu einem anderen Fall.');
  }, [mismatch]);
  const visible = session?.caseId === item.id && (status === 'connected' || status === 'reconnecting');
  const statusText = status === 'connected' ? 'Live-Session verbunden'
    : status === 'reconnecting' ? 'Verbindung wird wiederhergestellt …'
      : status === 'expired' ? 'Diese Live-Session ist abgelaufen.'
        : status === 'error' ? 'Die Verbindung wurde abgelehnt.' : message;

  if (mismatch) return <p className="osce-panel osce-error" role="alert">Diese Live-Session gehört zu einem anderen Fall.</p>;
  return <div className="osce-workspace">
    <p className="osce-panel osce-live__status" role="status" aria-live="polite">{statusText}</p>
    {visible && <OsceParticipant role="patient" item={item} releasedMaterialIds={session?.releasedMaterialIds ?? []} />}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
