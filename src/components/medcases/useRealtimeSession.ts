import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerMessage, SessionState, SessionRole, TimerCommand } from '../../lib/medcases/realtime-protocol';
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
  const [session, setSession] = useState<SessionState | null>(null);
  const [serverNowMs, setServerNowMs] = useState(Date.now());
  const [pending, setPending] = useState<TimerCommand | null>(null);
  const client = useRef<MedCasesRealtimeClient | null>(null);
  const pendingTimeout = useRef<number | null>(null);
  const terminalCallback = useRef(onTerminal);
  const liveCallback = useRef(onLiveEvent);
  terminalCallback.current = onTerminal;
  liveCallback.current = onLiveEvent;

  const clearPending = useCallback(() => {
    if (pendingTimeout.current !== null) window.clearTimeout(pendingTimeout.current);
    pendingTimeout.current = null;
    setPending(null);
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
        if (next !== 'connected') clearPending();
      },
      onTerminal: (reason) => terminalCallback.current?.(reason),
      onMessage: (message: ServerMessage) => {
        if (message.type === 'time.pong') {
          setServerNowMs(instance.getServerNowMs());
          return;
        }
        if (message.type === 'error') {
          clearPending();
          return;
        }
        if ('state' in message) {
          setSession(message.state);
          setServerNowMs(instance.getServerNowMs());
          if (message.type !== 'session.snapshot') {
            clearPending();
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
    };
  }, [connection?.baseUrl, connection?.sessionId, connection?.expiresAtMs, connection?.joinCode, connection?.role, connection?.capability, clearPending]);

  useEffect(() => {
    if (status !== 'connected' || session?.timer.status !== 'running') return;
    const tick = window.setInterval(() => setServerNowMs(client.current?.getServerNowMs() ?? Date.now()), 200);
    return () => window.clearInterval(tick);
  }, [status, session?.timer.status]);

  const command = useCallback((type: TimerCommand) => {
    if (pending || !client.current?.sendCommand(type)) return;
    setPending(type);
    pendingTimeout.current = window.setTimeout(clearPending, 5000);
  }, [pending, clearPending]);

  return { status, session, serverNowMs, pending, command };
}
