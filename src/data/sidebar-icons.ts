import type { ComponentProps } from 'astro/types';
import type MedNerdsIcon from '../components/MedNerdsIcon.astro';

// Shared semantic mapping; labels remain visible and accessible in the sidebar.
export const sidebarIcons = {
  Übersicht: 'tabler:layout-dashboard',
  EKG: 'healthicons:heart-cardiogram-outline',
  Echokardiographie: 'healthicons:heart-organ-outline',
  Sonographie: 'healthicons:ultrasound-scanner-outline',
  Notfallmedizin: 'healthicons:accident-and-emergency-outline',
  Diverses: 'healthicons:cardiogram-e-outline',
} as const satisfies Record<string, ComponentProps<typeof MedNerdsIcon>['name']>;
