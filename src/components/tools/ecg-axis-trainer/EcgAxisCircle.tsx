import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { angleFromPoint, axisLabels, classifyAxis, normalizeAngle, type AxisTypeId } from '../../../lib/tools/ecg-axis-trainer/axis';
import { limbLeads } from '../../../lib/tools/ecg-axis-trainer/ecg';

interface Props {
  angle: number;
  onChange: (angle: number) => void;
}

const sectors: { type: AxisTypeId; start: number; end: number }[] = [
  { type: 'left', start: 330, end: 360 },
  { type: 'left', start: 0, end: 30 },
  { type: 'indifferent', start: 30, end: 60 },
  { type: 'vertical', start: 60, end: 90 },
  { type: 'right', start: 90, end: 120 },
  { type: 'extreme-right', start: 120, end: 180 },
  { type: 'northwest', start: 180, end: 270 },
  { type: 'extreme-left', start: 270, end: 330 },
];

const solidDividerAngles = [30, 180, 270];

const center = 180;

function point(degree: number, radius: number) {
  const radians = (degree * Math.PI) / 180;
  return { x: center + Math.cos(radians) * radius, y: center + Math.sin(radians) * radius };
}

function sectorPath(start: number, end: number) {
  const outerStart = point(start, 142);
  const outerEnd = point(end, 142);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M ${center} ${center} L ${outerStart.x} ${outerStart.y} A 142 142 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} Z`;
}

export default function EcgAxisCircle({ angle, onChange }: Props) {
  const activePointer = useRef<number | null>(null);
  const currentType = classifyAxis(angle);
  const arrowTip = point(angle, 134);
  const arrowBase = point(angle, 115);
  const arrowWingA = point(angle - 4, 115);
  const arrowWingB = point(angle + 4, 115);

  function updateFromPointer(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    onChange(angleFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, event.clientX, event.clientY));
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    const onHandle = event.target instanceof Element && event.target.hasAttribute('data-axis-handle');
    if (event.pointerType === 'touch' && !onHandle) return;
    updateFromPointer(event);
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function stopDragging(event: PointerEvent<SVGSVGElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = Math.round(angle) - 1;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = Math.round(angle) + 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 359;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(normalizeAngle(next));
  }

  return (
    <svg
      className="axis-circle"
      viewBox="0 0 360 360"
      role="slider"
      tabIndex={0}
      aria-label="Elektrische Herzachse einstellen"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.floor(angle)}
      aria-valuetext={`${angle.toFixed(1)} Grad, ${axisLabels[currentType]}`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        if (activePointer.current === event.pointerId) updateFromPointer(event);
      }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    >
      {sectors.map(({ type, start, end }) => (
        <path
          key={`${type}-${start}`}
          className={`axis-sector axis-sector--${type}`}
          data-active={currentType === type}
          d={sectorPath(start, end)}
        >
          <title>{axisLabels[type]}</title>
        </path>
      ))}
      {solidDividerAngles.map((degree) => {
        const end = point(degree, 142);
        return <line key={degree} className="axis-sector-divider" x1={center} y1={center} x2={end.x} y2={end.y} />;
      })}
      {limbLeads.map(({ id, degree }) => {
        const end = point(degree, 142);
        const label = point(degree, 165);
        return (
          <g key={id} className="axis-lead">
            <line x1={center} y1={center} x2={end.x} y2={end.y} />
            <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle">{id}</text>
          </g>
        );
      })}
      <line className="axis-direction" x1={center} y1={center} x2={arrowBase.x} y2={arrowBase.y} />
      <path
        className="axis-arrowhead"
        d={`M ${arrowTip.x} ${arrowTip.y} L ${arrowWingA.x} ${arrowWingA.y} L ${arrowWingB.x} ${arrowWingB.y} Z`}
      />
      <circle className="axis-center" cx={center} cy={center} r="5" />
      <circle className="axis-handle-target" data-axis-handle="true" cx={arrowTip.x} cy={arrowTip.y} r="26" />
    </svg>
  );
}
