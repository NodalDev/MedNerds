export interface MotionState {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  skewY: number;
  regX: number;
  regY: number;
  alpha: number;
  _off: boolean;
}

export interface MotionGuide {
  readonly path: readonly number[];
  readonly orient?: 'fixed';
}

export interface MotionSegment {
  readonly start: number;
  readonly end: number;
  readonly target: Readonly<Partial<MotionState> & { guide?: MotionGuide }>;
}

export interface MotionElement {
  readonly id: string;
  readonly symbol: string;
  readonly initial: Readonly<MotionState>;
  readonly segments: readonly MotionSegment[];
}

export interface FlowSymbol {
  readonly fill: string;
  readonly path: string;
  readonly offset: readonly [number, number];
}

export type FlowElement = MotionElement;
