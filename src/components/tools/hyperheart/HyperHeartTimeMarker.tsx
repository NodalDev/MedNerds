import { chartProjections, timelineToChartProgress } from '../../../lib/tools/hyperheart/source-mapping';

interface Props { sourceFrame: number; visual: keyof typeof chartProjections }

export default function HyperHeartTimeMarker({ sourceFrame, visual }: Props) {
  const projection = chartProjections[visual];
  const progress = timelineToChartProgress(sourceFrame);
  const x = projection.left + progress * (projection.right - projection.left);
  return (
    <svg className="hh-animation-overlay hh-time-marker" viewBox={`0 0 ${projection.width} ${projection.height}`}
      data-chart-progress={progress} aria-hidden="true" focusable="false">
      <line x1={x} x2={x} y1={projection.top} y2={projection.bottom} />
    </svg>
  );
}
