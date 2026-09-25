import { useEffect, useRef, useState } from 'react';
import { calculateLimbLeadAmplitudes } from '../../../lib/tools/ecg-axis-trainer/ecg';
import { drawEcg, type EcgColors } from './drawEcg';

interface Props {
  angle: number;
}

export default function EcgAxisDisplay({ angle }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const resize = () => setWidth(frame.getBoundingClientRect().width);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeRevision((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(width * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(canvas);
    const colors: EcgColors = {
      gridMinor: style.getPropertyValue('--axis-grid-minor').trim(),
      gridMajor: style.getPropertyValue('--axis-grid-major').trim(),
      trace: style.getPropertyValue('--axis-trace').trim(),
      label: style.getPropertyValue('--axis-label').trim(),
    };
    drawEcg(ctx, width, width, calculateLimbLeadAmplitudes(angle), colors, style.fontFamily);
  }, [angle, width, themeRevision]);

  return (
    <div className="axis-ecg-frame" ref={frameRef}>
      <canvas
        ref={canvasRef}
        className="axis-ecg-canvas"
        role="img"
        aria-label="Simuliertes EKG der sechs Extremitätenableitungen I, II, III, aVR, aVL und aVF"
      >
        Simuliertes EKG der sechs Extremitätenableitungen.
      </canvas>
    </div>
  );
}
