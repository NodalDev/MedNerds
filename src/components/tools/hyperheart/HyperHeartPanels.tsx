import { memo } from 'react';
import { hyperHeartAssets } from '../../../lib/tools/hyperheart/asset-map';
import type { HyperHeartPhase, HyperHeartVisual } from '../../../lib/tools/hyperheart/types';
import HeartFlowOverlay from './HeartFlowOverlay';
import HyperHeartTimeMarker from './HyperHeartTimeMarker';

interface Props { phase: HyperHeartPhase; sourceFrame: number }

// The original raster only updates at phase boundaries. Its animation overlay
// samples the shared master clock; it never owns another clock or timer.
const PhaseImage = memo(function PhaseImage({ phase, visual, description }: { phase: HyperHeartPhase; visual: HyperHeartVisual; description: string }) {
  const image = hyperHeartAssets[phase.id][visual];
  return <img src={image.src} width={image.width} height={image.height}
    alt={`${description} – ${phase.label}. Originaldarstellung aus HyperHeart.`} decoding="async" />;
});

export function HyperHeartHeartPanel({ phase, sourceFrame }: Props) {
  return (
    <section className="hh-panel hh-heart-panel" aria-label={`Herz: ${phase.label}`}>
      <div className="hh-panel-heading"><h3>Herz</h3><span>Blutfluss</span></div>
      <div className="hh-heart-image"><div className="hh-image-stack hh-heart-stack">
        <PhaseImage phase={phase} visual="heart" description="Herz mit Klappenstellung und Blutflussmarkierungen" />
        <HeartFlowOverlay sourceFrame={sourceFrame} />
      </div></div>
    </section>
  );
}

export function HyperHeartWiggersPanel({ phase, sourceFrame }: Props) {
  return (
    <section className="hh-panel hh-wiggers-panel" aria-label={`Druck und Volumen: ${phase.label}`}>
      <div className="hh-panel-heading"><h3>Druck &amp; Volumen</h3><span>Wiggers-Diagramm</span></div>
      <div className="hh-diagram-surface"><div className="hh-image-stack hh-wiggers-stack">
        <PhaseImage phase={phase} visual="wiggers" description="Druck- und Volumenverläufe mit Markierung der aktuellen Phase" />
        <HyperHeartTimeMarker sourceFrame={sourceFrame} visual="wiggers" />
      </div></div>
    </section>
  );
}

export function HyperHeartEcgPanel({ phase, sourceFrame }: Props) {
  return (
    <section className="hh-panel hh-signal-panel" aria-label={`EKG: ${phase.label}`}>
      <div className="hh-panel-heading"><h3>EKG</h3></div>
      <div className="hh-diagram-surface"><div className="hh-image-stack hh-signal-stack">
        <PhaseImage phase={phase} visual="ecg" description="EKG-Verlauf mit Markierung der aktuellen Phase" />
        <HyperHeartTimeMarker sourceFrame={sourceFrame} visual="ecg" />
      </div></div>
    </section>
  );
}

export function HyperHeartSoundsPanel({ phase, sourceFrame }: Props) {
  return (
    <section className="hh-panel hh-signal-panel" aria-label={`Herztöne: ${phase.label}`}>
      <div className="hh-panel-heading"><h3>Herztöne</h3><span>Grafische Darstellung</span></div>
      <div className="hh-diagram-surface"><div className="hh-image-stack hh-signal-stack">
        <PhaseImage phase={phase} visual="sounds" description="Zeitlicher Verlauf der Herztöne mit Markierung der aktuellen Phase" />
        <HyperHeartTimeMarker sourceFrame={sourceFrame} visual="sounds" />
      </div></div>
    </section>
  );
}
