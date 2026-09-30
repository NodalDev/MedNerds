import { useEffect, useRef, useState } from 'react';
import { resolveRealtimeCode } from '../../lib/medcases/MedCasesRealtimeClient';
import { realtimeConfig } from '../../lib/medcases/realtime-config';
import {
  clearPatientSession, normalizeSessionCode, PATIENT_INVITE_STORAGE_KEY, patientCapabilityFromFragment,
  restorePatientSession, savePatientSession, type StoredPatientSession,
} from '../../lib/medcases/realtime-ui';
import { useRealtimeSession, type RealtimeConnection } from './useRealtimeSession';

export default function PatientSessionEntry() {
  const [connection, setConnection] = useState<RealtimeConnection | null>(null);
  const [message, setMessage] = useState('Einladung wird geprüft …');
  const importedCapability = useRef<string | null>(null);
  const { status, session } = useRealtimeSession(connection, (reason) => {
    importedCapability.current = null;
    clearPatientSession(window.sessionStorage);
    setConnection(null);
    setMessage(reason === 'expired' ? 'Diese Live-Session ist abgelaufen.' : 'Diese Patienteneinladung ist ungültig.');
  });

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const clearInvalidInvite = () => {
      importedCapability.current = null;
      clearPatientSession(window.sessionStorage);
      setConnection(null);
    };
    const join = () => {
      const currentRequest = ++requestId;
      setMessage('Einladung wird geprüft …');
      const code = normalizeSessionCode(new URLSearchParams(window.location.search).get('code') ?? '');
      const fragment = window.location.hash;
      const capability = patientCapabilityFromFragment(fragment);
      if (fragment) {
        importedCapability.current = capability;
        try {
          if (code && capability) window.sessionStorage.setItem(PATIENT_INVITE_STORAGE_KEY,
            JSON.stringify({ joinCode: code, patientCapability: capability }));
          else window.sessionStorage.removeItem(PATIENT_INVITE_STORAGE_KEY);
        } catch { /* A blocked sessionStorage is reported below. */ }
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      const stored = restorePatientSession(window.sessionStorage);
      let staged: { joinCode: string; patientCapability: string } | null = null;
      try {
        const raw = window.sessionStorage.getItem(PATIENT_INVITE_STORAGE_KEY);
        if (raw) staged = JSON.parse(raw);
      } catch { /* Invalid staged data cannot grant access. */ }
      const stagedCapability = staged?.joinCode === code
        ? patientCapabilityFromFragment(`#access=${staged.patientCapability}`) : null;
      const access = fragment ? capability : importedCapability.current ?? stagedCapability
        ?? (stored?.joinCode === code ? stored.patientCapability : null);
      const workerUrl = realtimeConfig.workerUrl;
      if (!code || !access) {
        clearInvalidInvite();
        setMessage('Diese Patienteneinladung ist ungültig oder nicht mehr aktiv.');
        return;
      }
      if (!workerUrl) {
        setMessage('Der Live-Dienst ist derzeit nicht erreichbar. Bitte versuche es später erneut.');
        return;
      }
      void (async () => {
        try {
          const resolved = await resolveRealtimeCode(workerUrl, code);
          if (cancelled || currentRequest !== requestId) return;
          const next: StoredPatientSession = {
            version: 1, sessionId: resolved.sessionId, joinCode: code,
            patientCapability: access, expiresAtMs: resolved.expiresAtMs,
          };
          if (!/^session_[a-f0-9]{32}$/.test(next.sessionId) || !Number.isSafeInteger(next.expiresAtMs)) {
            throw new Error('invalid-response');
          }
          if (next.expiresAtMs <= Date.now()) throw new Error('expired');
          if (!savePatientSession(window.sessionStorage, next)) throw new Error('storage-unavailable');
          window.sessionStorage.removeItem(PATIENT_INVITE_STORAGE_KEY);
          importedCapability.current = null;
          setConnection({ baseUrl: workerUrl, sessionId: next.sessionId, joinCode: code,
            expiresAtMs: next.expiresAtMs, role: 'patient', capability: access });
        } catch (error) {
          if (cancelled || currentRequest !== requestId) return;
          const terminal = error instanceof Error && (error.message === 'not-found' || error.message === 'expired');
          if (terminal) clearInvalidInvite();
          setMessage(terminal ? 'Diese Patienteneinladung ist ungültig oder nicht mehr aktiv.'
            : 'Der Live-Dienst ist derzeit nicht erreichbar. Bitte versuche es später erneut.');
        }
      })();
    };
    window.addEventListener('hashchange', join);
    join();
    return () => { cancelled = true; window.removeEventListener('hashchange', join); };
  }, []);

  useEffect(() => {
    if (status !== 'connected' || !session) return;
    if (!session.caseId || !/^case-[a-f0-9]{10}$/.test(session.caseId)) {
      importedCapability.current = null;
      clearPatientSession(window.sessionStorage);
      setMessage('Dieser Fall ist nicht verfügbar.');
      setConnection(null);
      return;
    }
    window.location.replace(`/medcases/session/patient/${session.caseId}/`);
  }, [status, session?.caseId]);

  return <section className="osce-panel" aria-label="Patienteneinladung">
    <h2>Schauspielpatient verbinden</h2>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
