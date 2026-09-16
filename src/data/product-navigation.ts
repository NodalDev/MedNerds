export type ProductStatus = 'active' | 'building' | 'planned';

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
  },
  {
    label: 'MedBlog',
    href: '/medblog/',
    product: 'medblog',
    icon: 'tabler:news',
    description:
      'Neuigkeiten, Einordnungen und Beiträge aus der MedNerds-Community.',
    status: 'planned',
  },
  {
    label: 'MedLearn',
    href: '/medlearn/',
    product: 'medlearn',
    icon: 'tabler:school',
    description:
      'Lernpfade, Quizfragen und Wiederholungen für nachhaltiges Lernen.',
    status: 'planned',
  },
  {
    label: 'MedCases',
    href: '/medcases/',
    product: 'medcases',
    icon: 'healthicons:clinical-f-outline',
    description:
      'Realistische Fallbeispiele, die Wissen mit klinischen Entscheidungen verbinden.',
    status: 'planned',
  },
  {
    label: 'MedTools',
    href: '/medtools/',
    product: 'medtools',
    icon: 'tabler:tools',
    description:
      'Praktische medizinische Werkzeuge und interaktive Hilfsmittel.',
    status: 'planned',
  },
  {
    label: 'MedNerds Basel',
    href: '/mednerds-basel/',
    product: 'mednerds-basel',
    icon: 'tabler:users-group',
    description:
      'Die Community und das organisatorische Zuhause der offenen Plattform.',
    status: 'active',
  },
] as const satisfies readonly {
  label: string;
  href: string;
  product: string;
  icon: string;
  description: string;
  status: ProductStatus;
}[];

export function getActiveProduct(pathname: string) {
  return productLinks.find(({ href }) => pathname.startsWith(href));
}
