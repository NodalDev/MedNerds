import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerMessage, SessionViewState, SessionRole, TimerCommand } from '../../lib/medcases/realtime-protocol';
import { MedCasesRealtimeClient, type ConnectionStatus } from '../../lib/medcases/MedCasesRealtimeClient';

export interface RealtimeConnection {
  baseUrl: string;
  sessionId: string;
  expiresAtMs: number;
  joinCode?: string;
  role: SessionRole;
  capability?: string;
}

export function useRealtimeSession(
  connection: RealtimeConnection | null,
  onTerminal?: (reason: 'expired' | 'auth-failed') => void,
  onLiveEvent?: (type: string) => void,
) {
  const [status, setStatus] = useState<ConnectionStatus | 'idle'>('idle');
  const [session, setSession] = useState<SessionViewState | null>(null);
  const [serverNowMs, setServerNowMs] = useState(Date.now());
  const [pending, setPending] = useState<TimerCommand | null>(null);
  const [pendingMaterialId, setPendingMaterialId] = useState<string | null>(null);
  const [materialError, setMaterialError] = useState('');
  const client = useRef<MedCasesRealtimeClient | null>(null);
  const pendingTimeout = useRef<number | null>(null);
  const materialTimeout = useRef<number | null>(null);
  const materialRequest = useRef<string | null>(null);
  const terminalCallback = useRef(onTerminal);
  const liveCallback = useRef(onLiveEvent);
  terminalCallback.current = onTerminal;
  liveCallback.current = onLiveEvent;

  const clearPending = useCallback(() => {
    if (pendingTimeout.current !== null) window.clearTimeout(pendingTimeout.current);
    pendingTimeout.current = null;
    setPending(null);
  }, []);

  const clearMaterialPending = useCallback(() => {
    if (materialTimeout.current !== null) window.clearTimeout(materialTimeout.current);
    materialTimeout.current = null;
    materialRequest.current = null;
    setPendingMaterialId(null);
  }, []);

  useEffect(() => {
    if (!connection) {
      setStatus('idle');
      setSession(null);
      return;
    }
    const instance = new MedCasesRealtimeClient({
      ...connection,
      onStatus: (next) => {
        setStatus(next);
        if (next !== 'connected') { clearPending(); clearMaterialPending(); }
      },
      onTerminal: (reason) => terminalCallback.current?.(reason),
      onMessage: (message: ServerMessage) => {
        if (message.type === 'time.pong') {
          setServerNowMs(instance.getServerNowMs());
          return;
        }
        if (message.type === 'error') {
          clearPending();
          if (materialRequest.current && (message.code === 'FORBIDDEN' || message.code === 'INVALID_MESSAGE'
            || message.code === 'RESOURCE_LIMIT_REACHED')) {
            setMaterialError('Das Material konnte nicht freigegeben werden.');
          }
          clearMaterialPending();
          return;
        }
        if ('state' in message) {
          setSession(message.state);
          setServerNowMs(instance.getServerNowMs());
          if (message.type === 'material.released') { clearMaterialPending(); setMaterialError(''); }
          if (message.type !== 'session.snapshot') {
            if (message.type !== 'material.released') clearPending();
            liveCallback.current?.(message.type);
          }
        }
      },
    });
    client.current = instance;
    instance.start();
    return () => {
      instance.stop();
      if (client.current === instance) client.current = null;
      clearPending();
      clearMaterialPending();
    };
  }, [connection?.baseUrl, connection?.sessionId, connection?.expiresAtMs, connection?.joinCode, connection?.role, connection?.capability, clearPending, clearMaterialPending]);

  useEffect(() => {
    if ((status !== 'connected' && !(connection?.role === 'display' && status === 'reconnecting'))
      || session?.timer?.status !== 'running') return;
    const tick = window.setInterval(() => setServerNowMs(client.current?.getServerNowMs() ?? Date.now()), 200);
    return () => window.clearInterval(tick);
  }, [status, session?.timer?.status, connection?.role]);

  const command = useCallback((type: TimerCommand) => {
    if (pending || !client.current?.sendCommand(type)) return;
    setPending(type);
    pendingTimeout.current = window.setTimeout(clearPending, 5000);
  }, [pending, clearPending]);

  const releaseMaterial = useCallback((materialId: string) => {
    if (materialRequest.current || !/^[a-z][a-z0-9-]{0,63}$/.test(materialId)
      || !client.current?.sendMaterialRelease(materialId)) return;
    materialRequest.current = materialId;
    setMaterialError('');
    setPendingMaterialId(materialId);
    materialTimeout.current = window.setTimeout(() => {
      setMaterialError('Keine Serverbestätigung erhalten. Bitte erneut versuchen.');
      clearMaterialPending();
    }, 5000);
  }, [clearMaterialPending]);

  return { status, session, serverNowMs, pending, command, pendingMaterialId, materialError, releaseMaterial };
}
