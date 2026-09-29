import type { SessionState, TimerCommand } from '../../lib/medcases/realtime-protocol';
import { formatTime } from '../../lib/medcases/timer';
import { visibleRemainingMs } from '../../lib/medcases/realtime-ui';

const statusText = {
  ready: 'BEREIT',
  running: 'LÄUFT',
  paused: 'PAUSIERT',
  ended: 'ZEIT ABGELAUFEN',
} as const;

export default function RealtimeTimer({
  state, serverNowMs, command, pending,
}: {
  state: SessionState;
  serverNowMs: number;
  command?: (type: TimerCommand) => void;
  pending?: TimerCommand | null;
}) {
  const timer = state.timer;
  const remaining = visibleRemainingMs(timer, serverNowMs);
  const warning = timer.status === 'running' && timer.warningEmitted;
  return <section className={`osce-timer${warning ? ' osce-timer--warning' : ''}${timer.status === 'ended' ? ' osce-timer--ended' : ''}`} aria-label="Synchronisierter OSCE-Timer">
    <p className="osce-eyebrow">Live-Timer</p>
    <div className="osce-timer__display" role="timer" aria-label={`${formatTime(remaining / 1000)} verbleibend`}>{formatTime(remaining / 1000)}</div>
    <p className="osce-timer__state" role="status" aria-live="polite">{warning ? 'WARNUNG · LÄUFT' : statusText[timer.status]}</p>
    {command && <div className="osce-actions">
      {timer.status === 'ready' && <button className="osce-button" type="button" disabled={!!pending} onClick={() => command('timer.start')}>Timer starten</button>}
      {timer.status === 'running' && <button className="osce-button osce-button--secondary" type="button" disabled={!!pending} onClick={() => command('timer.pause')}>Pausieren</button>}
      {timer.status === 'paused' && <button className="osce-button" type="button" disabled={!!pending} onClick={() => command('timer.resume')}>Fortsetzen</button>}
      {timer.status !== 'ready' && <button className="osce-button osce-button--secondary" type="button" disabled={!!pending} onClick={() => command('timer.reset')}>Zurücksetzen</button>}
    </div>}
    {pending && <p className="osce-fineprint">Serverbestätigung wird abgewartet …</p>}
  </section>;
}
