import type { ComponentProps } from 'astro/types';
import type MedNerdsIcon from '../components/MedNerdsIcon.astro';
import { sidebarIcons } from './sidebar-icons';

export type ProductStatus = 'active' | 'building' | 'planned';

export interface ProductNavigationItem {
  label: string;
  href: string;
  icon: ComponentProps<typeof MedNerdsIcon>['name'];
}

export const productStatusLabels: Record<ProductStatus, string> = {
  active: 'Aktiv',
  building: 'Im Aufbau',
  planned: 'Geplant',
};

export const productLinks = [
  {
    label: 'MedDocs',
    href: '/meddocs/',
    product: 'meddocs',
    icon: 'tabler:book',
    description:
      'Strukturiertes medizinisches Wissen mit klaren Kapiteln, Quellen und Querverweisen.',
    status: 'building',
    children: [
      { label: 'Übersicht', href: '/meddocs/', icon: sidebarIcons.Übersicht },
      { label: 'Anästhesie', href: '/meddocs/anaesthesie/', icon: sidebarIcons.Anästhesie },
      { label: 'EKG', href: '/meddocs/ekg/', icon: sidebarIcons.EKG },
      { label: 'Echokardiographie', href: '/meddocs/echokardiographie/', icon: sidebarIcons.Echokardiographie },
      { label: 'Notfallmedizin', href: '/meddocs/notfallmedizin/', icon: sidebarIcons.Notfallmedizin },
      { label: 'Ultraschall', href: '/meddocs/sonographie/', icon: sidebarIcons.Ultraschall },
      { label: 'Diverses', href: '/meddocs/diverses/', icon: sidebarIcons.Diverses },
    ],
  },
  {
    label: 'MedBlog',
    href: '/medblog/',
    product: 'medblog',
    icon: 'tabler:news',
    description:
      'Neuigkeiten, Einordnungen und Beiträge aus der MedNerds-Community.',
    status: 'planned',
    children: [],
  },
  {
    label: 'MedLearn',
    href: '/medlearn/',
    product: 'medlearn',
    icon: 'tabler:school',
    description:
      'Lernpfade, Quizfragen und Wiederholungen für nachhaltiges Lernen.',
    status: 'planned',
    children: [],
  },
  {
    label: 'MedCases',
    href: '/medcases/',
    product: 'medcases',
    icon: 'healthicons:clinical-f-outline',
    description:
      'Realistische Fallbeispiele, die Wissen mit klinischen Entscheidungen verbinden.',
    status: 'planned',
    children: [],
  },
  {
    label: 'MedTools',
    href: '/medtools/',
    product: 'medtools',
    icon: 'tabler:tools',
    description:
      'Praktische medizinische Werkzeuge und interaktive Hilfsmittel.',
    status: 'building',
    children: [
      { label: 'EKG-Lagetyptrainer', href: '/medtools/ekg/lagetyptrainer/', icon: 'tabler:activity-heartbeat' },
      { label: 'Interaktiver Herzzyklus', href: '/medtools/kardiologie/herzzyklus/', icon: 'tabler:heart' },
    ],
  },
  {
    label: 'MedNerds Basel',
    href: '/mednerds-basel/',
    product: 'mednerds-basel',
    icon: 'tabler:users-group',
    description:
      'Die Community und das organisatorische Zuhause der offenen Plattform.',
    status: 'active',
    children: [],
  },
] as const satisfies readonly {
  label: string;
  href: string;
  product: string;
  icon: string;
  description: string;
  status: ProductStatus;
  children: readonly ProductNavigationItem[];
}[];

export function getActiveProduct(pathname: string) {
  return productLinks.find(({ href }) => pathname === href.slice(0, -1) || pathname.startsWith(href));
}
