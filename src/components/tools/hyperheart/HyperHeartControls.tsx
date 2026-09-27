import { useId } from 'react';
import { hyperHeartPlaybackRates, type HyperHeartPlaybackRate } from '../../../lib/tools/hyperheart/playback';
import { hyperHeartControlIcons } from './control-icons';

interface Props {
  isPlaying: boolean;
  rate: HyperHeartPlaybackRate;
  loop: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onRestart: () => void;
  onRateChange: (rate: number) => void;
  onLoopChange: (loop: boolean) => void;
}

function ControlIcon({ name }: { name: keyof typeof hyperHeartControlIcons }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: hyperHeartControlIcons[name] }} />
  );
}

export default function HyperHeartControls({
  isPlaying, rate, loop, onPrevious, onTogglePlay, onNext, onRestart, onRateChange, onLoopChange,
}: Props) {
  const speedId = useId();
  return (
    <div className="hh-controls">
      <div className="hh-playback-buttons" role="group" aria-label="Wiedergabe steuern">
        <button type="button" className="hh-icon-button" aria-label="Vorherige Phase" title="Vorherige Phase" onClick={onPrevious}>
          <ControlIcon name="player-skip-back" />
        </button>
        <button type="button" className="hh-play-button" aria-label={isPlaying ? 'Wiedergabe pausieren' : 'Wiedergabe starten'} onClick={onTogglePlay}>
          <ControlIcon name={isPlaying ? 'player-pause' : 'player-play'} />
          <span>{isPlaying ? 'Pause' : 'Start'}</span>
        </button>
        <button type="button" className="hh-icon-button" aria-label="Nächste Phase" title="Nächste Phase" onClick={onNext}>
          <ControlIcon name="player-skip-forward" />
        </button>
        <button type="button" className="hh-icon-button" aria-label="Zum Anfang zurücksetzen" title="Zum Anfang zurücksetzen" onClick={onRestart}>
          <ControlIcon name="refresh" />
        </button>
      </div>
      <div className="hh-playback-options">
        <label className="hh-speed" htmlFor={speedId}>
          <span>Tempo</span>
          <select id={speedId} value={rate} onChange={(event) => onRateChange(Number(event.target.value))}>
            {hyperHeartPlaybackRates.map((value) => <option key={value} value={value}>{String(value).replace('.', ',')}×</option>)}
          </select>
        </label>
        <label className="hh-loop">
          <input type="checkbox" checked={loop} onChange={(event) => onLoopChange(event.target.checked)} />
          <span>Wiederholen</span>
        </label>
      </div>
    </div>
  );
}
