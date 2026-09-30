import { useEffect, useRef, useState } from 'react';
import { resolveRealtimeCode } from '../../lib/medcases/MedCasesRealtimeClient';
import { realtimeConfig } from '../../lib/medcases/realtime-config';
import { normalizeSessionCode, sessionDisplayUrl, sessionJoinUrl } from '../../lib/medcases/realtime-ui';
import { useRealtimeSession, type RealtimeConnection } from './useRealtimeSession';

export function useSessionCodeConnection(role: 'observer' | 'display') {
  const [code, setCode] = useState('');
  const [connection, setConnection] = useState<RealtimeConnection | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const requestId = useRef(0);
  const workerUrl = realtimeConfig.workerUrl;
  const live = useRealtimeSession(connection, (reason) => {
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
    const currentRequest = ++requestId.current;
    if (!normalized) { setError('Dieser Session-Code ist ungültig oder nicht mehr aktiv.'); return; }
    if (!workerUrl) return;
    setJoining(true);
    try {
      const result = await resolveRealtimeCode(workerUrl, normalized);
      if (currentRequest !== requestId.current) return;
      if (!/^session_[a-f0-9]{32}$/.test(result.sessionId) || !Number.isSafeInteger(result.expiresAtMs)
        || result.expiresAtMs <= Date.now()) throw new Error('invalid-response');
      const url = role === 'display' ? sessionDisplayUrl : sessionJoinUrl;
      window.history.replaceState(null, '', url(window.location.origin, normalized));
      setConnection({ baseUrl: workerUrl, sessionId: result.sessionId, expiresAtMs: result.expiresAtMs, joinCode: normalized, role });
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

  return { code, setCode, connection, joining, error, expired, workerUrl, join, ...live };
}
