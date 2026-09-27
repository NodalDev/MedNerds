export type HyperHeartPhaseId =
  | 'atrial-systole'
  | 'isovolumetric-contraction'
  | 'rapid-ejection'
  | 'reduced-ejection'
  | 'isovolumetric-relaxation'
  | 'rapid-ventricular-filling'
  | 'reduced-ventricular-filling';

export interface HyperHeartPhase {
  readonly id: HyperHeartPhaseId;
  readonly label: string;
  readonly sourceLabel: string;
  readonly order: number;
  readonly sourceFrames: { readonly start: number; readonly endExclusive: number };
  readonly tutorialFrame: number;
}

export type HyperHeartVisual = 'heart' | 'wiggers' | 'ecg' | 'sounds';

export interface HyperHeartImage {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

export type HyperHeartAssetSet = Readonly<Record<HyperHeartVisual, HyperHeartImage>>;
export type HyperHeartVariant = 'full' | 'embedded' | 'dialog';
