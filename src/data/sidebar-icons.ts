import type { ComponentProps } from 'astro/types';
import type MedNerdsIcon from '../components/MedNerdsIcon.astro';

// Shared semantic mapping; labels remain visible and accessible in the sidebar.
export const sidebarIcons = {
  Übersicht: 'tabler:layout-dashboard',
  Anästhesie: 'healthicons:syringe-24px',
  EKG: 'healthicons:heart-cardiogram',
  Echokardiographie: 'healthicons:heart-organ',
  Notfallmedizin: 'healthicons:accident-and-emergency',
  Ultraschall: 'healthicons:ultrasound-scanner',
  Diverses: 'healthicons:cardiogram-e',
} as const satisfies Record<string, ComponentProps<typeof MedNerdsIcon>['name']>;
