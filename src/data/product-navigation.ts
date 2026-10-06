import type { ComponentProps } from 'astro/types';
import type MedNerdsIcon from '../components/MedNerdsIcon.astro';
import { sidebarIcons } from './sidebar-icons';
import { medBlogTypes } from './medblog';

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
      'Strukturiertes medizinisches Wissen zu EKGs, Echokardiographie, Ultraschall, Notfallmedizin und vielem mehr.',
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
      'Neuigkeiten zu MedNerds und Beiträge zu spannenden Themen.',
    status: 'building',
    children: [
      { label: medBlogTypes.article.plural, href: `/medblog/${medBlogTypes.article.segment}/`, icon: 'tabler:file-text' },
      { label: medBlogTypes.news.plural, href: `/medblog/${medBlogTypes.news.segment}/`, icon: 'tabler:news' },
      { label: medBlogTypes.update.plural, href: `/medblog/${medBlogTypes.update.segment}/`, icon: 'tabler:refresh' },
    ],
  },
  {
    label: 'MedLearn',
    href: '/medlearn/',
    product: 'medlearn',
    icon: 'tabler:school',
    description:
      'E-Learning mit Quizfragen und Wiederholungen für nachhaltiges Lernen.',
    status: 'planned',
    children: [],
  },
  {
    label: 'MedCases',
    href: '/medcases/',
    product: 'medcases',
    icon: 'healthicons:clinical-f-outline',
    description:
      'OSCE-Prüfungssituationen gemeinsam trainieren.',
    status: 'building',
    children: [
      { label: 'OSCE trainieren', href: '/medcases/osce/', icon: 'healthicons:clinical-f-outline' },
      { label: 'Session beitreten', href: '/medcases/session/candidate/', icon: 'tabler:qrcode' },
    ],
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
      // Vorläufig zurückgestellt; die Herzzyklus-Seite bleibt als Draft erhalten.
      // { label: 'Interaktiver Herzzyklus', href: '/medtools/kardiologie/herzzyklus/', icon: 'tabler:heart' },
      { label: 'OSCE-Timer', href: '/medtools/osce-timer/', icon: 'tabler:clock' },
      { label: 'Linksammlung', href: '/medtools/links/', icon: 'tabler:link' },
    ],
  },
  {
    label: 'MedNerds Basel',
    href: '/mednerds-basel/',
    product: 'mednerds-basel',
    icon: 'tabler:users-group',
    description:
      'Der Verein hinter dem Projekt MedNerds.',
    status: 'active',
    children: [
      { label: 'Mitmachen', href: '/mednerds-basel/#mitglied-werden', icon: 'tabler:user-plus' },
      { label: 'Spenden', href: '/mednerds-basel/#spenden', icon: 'tabler:heart-handshake' },
      { label: 'FAQ', href: '/faq/#mednerds-basel', icon: 'tabler:help-circle' },
    ],
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
