/**
 * Waveform and grid adapted from resources/js/ecgDrawing.js in ECG Axis Trainer
 * by David Schaack (MIT License): https://github.com/david-shrk/ecgaxistrainer
 * Drawing now uses local canvas coordinates; the caller handles pixel density.
 */
import type { LimbLeadId } from '../../../lib/tools/ecg-axis-trainer/ecg';

export interface EcgColors {
  gridMinor: string;
  gridMajor: string;
  trace: string;
  label: string;
}

type LeadAmplitude = { id: LimbLeadId; amplitude: number };

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, factor: number, colors: EcgColors) {
  for (const [spacing, color, lineWidth] of [
    [factor / 10, colors.gridMinor, 0.65],
    [factor / 2, colors.gridMajor, 0.9],
  ] as const) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let x = spacing; x < width; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = spacing; y < height; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }
}

function drawQrs(ctx: CanvasRenderingContext2D, amplitude: number, y: number, x: number, factor: number) {
  const threshold = 0.25;
  ctx.arc(x + factor * 0.25, y, factor * 0.25, Math.PI, 0);
  ctx.lineTo(x + factor, y);

  if (amplitude >= threshold) {
    ctx.lineTo(x + factor * 1.17, y - amplitude * factor * 2);
    ctx.lineTo(x + factor * 1.34, y + amplitude * factor * 0.6);
  } else if (amplitude >= 0) {
    ctx.lineTo(x + factor * 1.17, y - threshold * factor * 2);
    ctx.lineTo(x + factor * 1.34, y + Math.max(threshold * 0.6, (threshold - amplitude) * 2) * factor);
  } else if (amplitude > -threshold) {
    ctx.lineTo(x + factor * 1.17, y - Math.max(threshold * 0.6, (threshold + amplitude) * 2) * factor);
    ctx.lineTo(x + factor * 1.34, y + threshold * 2 * factor);
  } else {
    ctx.lineTo(x + factor * 1.17, y + amplitude * factor * 0.6);
    ctx.lineTo(x + factor * 1.34, y - amplitude * factor * 2);
  }

  ctx.lineTo(x + factor * 1.5, y);
  ctx.arc(x + factor * 2.6, y, factor * 0.4, Math.PI, 0);
}

function drawLead(ctx: CanvasRenderingContext2D, amplitude: number, y: number, x: number, end: number, factor: number) {
  let start = x + 54 + factor * 0.75;
  ctx.moveTo(x + 54, y);
  while (start < end) {
    drawQrs(ctx, amplitude, y, start, factor);
    ctx.lineTo(start + factor * 5, y);
    start += factor * 5;
  }
}

export function drawEcg(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  leads: readonly LeadAmplitude[],
  colors: EcgColors,
  fontFamily: string,
) {
  ctx.clearRect(0, 0, width, height);
  if (!width || !height) return;

  // Upstream uses two columns only when the ECG becomes narrower than 300 px.
  const sideBySide = width < 300;
  const rows = sideBySide ? leads.length / 2 : leads.length;
  const rowHeight = height / (rows + 1);
  const factor = rowHeight * 0.4;
  drawGrid(ctx, width, height, factor, colors);

  ctx.strokeStyle = colors.trace;
  ctx.fillStyle = colors.label;
  ctx.lineWidth = 1.3;
  ctx.font = `600 13px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.beginPath();

  leads.forEach(({ id, amplitude }, index) => {
    const column = sideBySide && index >= rows ? 1 : 0;
    const row = sideBySide ? index % rows : index;
    const x = column * (width / 2);
    const y = rowHeight * (row + 1);
    ctx.fillText(id, x + 10, y);
    drawLead(ctx, amplitude, y, x, x + (sideBySide ? width / 2 : width), factor);
  });

  ctx.stroke();
}
