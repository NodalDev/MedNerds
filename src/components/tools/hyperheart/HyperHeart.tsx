import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { hyperHeartPhases } from '../../../lib/tools/hyperheart/phases';
import { normalizePlaybackRate } from '../../../lib/tools/hyperheart/playback';
import { frameToProgress, hyperHeartTimelineLength, phaseAtFrame, phaseStartFrame, seekPhaseBoundary } from '../../../lib/tools/hyperheart/timeline';
import { hyperHeartAssets } from '../../../lib/tools/hyperheart/asset-map';
import type { HyperHeartPhaseId, HyperHeartVariant } from '../../../lib/tools/hyperheart/types';
import HyperHeartControls from './HyperHeartControls';
import HyperHeartPhaseNav from './HyperHeartPhaseNav';
import { HyperHeartHeartPanel, HyperHeartWiggersPanel, HyperHeartEcgPanel, HyperHeartSoundsPanel } from './HyperHeartPanels';
import { useHyperHeartTimeline } from './useHyperHeartTimeline';
import './hyperheart.css';

const Controls = memo(HyperHeartControls);
const PhaseNav = memo(HyperHeartPhaseNav);

export interface HyperHeartProps {
  initialPhase?: HyperHeartPhaseId;
  /** Optional phase seek command; playback-derived phases emit onPhaseChange. */
  phase?: HyperHeartPhaseId;
  autoPlay?: boolean;
  loop?: boolean;
  playbackRate?: number;
  variant?: HyperHeartVariant;
  showControls?: boolean;
  showPhaseNavigation?: boolean;
  onPhaseChange?: (phase: HyperHeartPhaseId) => void;
}

export default function HyperHeart({
  initialPhase, phase: controlledPhase, autoPlay = false, loop = true, playbackRate = 1,
  variant = 'full', showControls = true, showPhaseNavigation = true, onPhaseChange,
}: HyperHeartProps) {
  const [rate, setRate] = useState(() => normalizePlaybackRate(playbackRate));
  const [repeat, setRepeat] = useState(loop);
  const initialFrame = phaseStartFrame(controlledPhase ?? initialPhase ?? hyperHeartPhases[0].id);
  const { sourceFrame, frameRef, isPlaying, seek, pause, play } = useHyperHeartTimeline(initialFrame, rate, repeat, autoPlay);
  const phase = phaseAtFrame(sourceFrame);
  const previousPhase = useRef(phase.id);
  const scrubberId = useId();

  useEffect(() => { setRate(normalizePlaybackRate(playbackRate)); }, [playbackRate]);
  useEffect(() => { setRepeat(loop); }, [loop]);

  useEffect(() => {
    if (previousPhase.current === phase.id) return;
    previousPhase.current = phase.id;
    onPhaseChange?.(phase.id);
  }, [phase.id, onPhaseChange]);

  useEffect(() => {
    // A parent acknowledging the emitted phase must not snap playback back to
    // that phase's start. A different phase is an explicit seek command.
    if (controlledPhase && controlledPhase !== phaseAtFrame(frameRef.current).id) seek(phaseStartFrame(controlledPhase));
  }, [controlledPhase, frameRef, seek]);

  useEffect(() => {
    // Small existing rasters are cached before boundaries to avoid image-load
    // gaps while the independently rendered SVG continues moving.
    for (const assets of Object.values(hyperHeartAssets)) for (const asset of Object.values(assets)) {
      const image = new Image();
      image.src = asset.src;
    }
  }, []);

  const selectPhase = useCallback((id: HyperHeartPhaseId) => seek(phaseStartFrame(id)), [seek]);
  const previous = useCallback(() => seek(seekPhaseBoundary(frameRef.current, -1)), [frameRef, seek]);
  const next = useCallback(() => seek(seekPhaseBoundary(frameRef.current, 1)), [frameRef, seek]);
  const restart = useCallback(() => seek(0), [seek]);
  const changeRate = useCallback((value: number) => setRate(normalizePlaybackRate(value)), []);
  const togglePlay = useCallback(() => {
    if (isPlaying) { pause(); return; }
    if (frameRef.current >= hyperHeartTimelineLength) seek(0);
    play();
  }, [isPlaying, frameRef, pause, play, seek]);

  return (
    <div className="mn-hyperheart not-content" data-variant={variant}>
      <div className="hh-toolbar">
        <div className="hh-tool-heading">
          <p className="hh-kicker">Herzzyklus erkunden</p>
          <h2>Phase {phase.order} <span>von {hyperHeartPhases.length}</span></h2>
        </div>
        {showControls && <Controls isPlaying={isPlaying} rate={rate} loop={repeat}
          onPrevious={previous} onTogglePlay={togglePlay} onNext={next} onRestart={restart}
          onRateChange={changeRate} onLoopChange={setRepeat} />}
      </div>

      {showControls && <div className="hh-scrubber">
        <label htmlFor={scrubberId}>Zyklusposition</label>
        <input id={scrubberId} type="range" min="0" max={hyperHeartTimelineLength} step="0.01" value={sourceFrame}
          aria-valuetext={`${Math.round(frameToProgress(sourceFrame) * 100)} Prozent – ${phase.label}`}
          onPointerDown={pause} onChange={(event) => seek(Number(event.target.value))} />
        <output htmlFor={scrubberId} aria-live="off">{Math.round(frameToProgress(sourceFrame) * 100)} %</output>
      </div>}

      {showPhaseNavigation && <PhaseNav phaseId={phase.id} onSelect={selectPhase} />}

      <div className="hh-visual-grid">
        <div className="hh-heart-column">
          <HyperHeartHeartPanel phase={phase} sourceFrame={sourceFrame} />
          <div className="hh-phase-info" role="status" aria-live={isPlaying ? 'off' : 'polite'} aria-atomic="true">
            <span className="hh-phase-index" aria-hidden="true">{String(phase.order).padStart(2, '0')}</span>
            <div><h3>{phase.label}</h3><p lang="en">{phase.sourceLabel}</p></div>
          </div>
        </div>
        <div className="hh-curves-column">
          <HyperHeartWiggersPanel phase={phase} sourceFrame={sourceFrame} />
          <div className="hh-signal-grid"><HyperHeartEcgPanel phase={phase} sourceFrame={sourceFrame} /><HyperHeartSoundsPanel phase={phase} sourceFrame={sourceFrame} /></div>
        </div>
      </div>

      <details className="hh-help">
        <summary>Zur Darstellung</summary>
        <p>Blutfluss und Zeitmarkierungen folgen einer gemeinsamen Zeitleiste; die Herzbilder wechseln an den Phasengrenzen. Mit der Zyklusposition lässt sich jeder Zeitpunkt anhalten und betrachten. Das Tempo folgt der ursprünglichen Lernanimation und entspricht nicht der realen Dauer eines Herzzyklus. Die Herztöne werden grafisch dargestellt; es wird kein Audio abgespielt.</p>
      </details>

      <p className="hh-attribution">
        Basierend auf <a href="https://library.med.utah.edu/kw/pharm/hyperheart/">HyperHeart · Spencer S. Eccles Health Sciences Library</a>.
        {' '}HTML5-Fassung: Quentin Roper (Massey University).{' '}
        <a href="https://creativecommons.org/licenses/by-nc/4.0/" rel="license">CC BY-NC 4.0</a>.
        <span>MedNerds-Neuimplementierung mit freigestellten Originalbildern.</span>
      </p>
    </div>
  );
}
