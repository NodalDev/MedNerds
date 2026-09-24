export const featuredFaqQuestions = {
  audience: {
    id: 'fuer-wen-ist-mednerds',
    question: 'Für wen ist MedNerds gedacht?',
    answer:
      'Besonders für Medizinstudierende, Ärztinnen und Ärzte in Weiterbildung sowie andere Gesundheitsfachpersonen und medizinisch Interessierte.',
  },
  sources: {
    id: 'quellen-medizinischer-informationen',
    question: 'Woher stammen die medizinischen Informationen?',
    answer:
      'Die Inhalte werden anhand geeigneter Fachliteratur, Leitlinien und wissenschaftlicher Quellen erstellt und weiterentwickelt. Quellen und Aktualisierungen sollen möglichst bei den jeweiligen Inhalten nachvollziehbar sein.',
  },
  basel: {
    id: 'unterschied-mednerds-basel',
    question: 'Was ist der Unterschied zwischen MedNerds und MedNerds Basel?',
    answer:
      'MedNerds bezeichnet die digitale Wissens- und Lernplattform. MedNerds Basel ist die lokale und organisatorische Seite des Projekts, mit Raum für Austausch, Zusammenarbeit und gemeinsames Engagement.',
  },
  licensing: {
    id: 'inhalte-weiterverwenden',
    question: 'Darf ich Inhalte von MedNerds weiterverwenden?',
    answer:
      'Eigene medizinische und redaktionelle Inhalte stehen grundsätzlich unter CC BY-NC-SA 4.0, soweit beim einzelnen Inhalt nichts anderes angegeben ist. Für Branding und Materialien Dritter gelten eigene Rechte und Lizenzen.',
    relatedLink: {
      href: '/urheberrecht/',
      label: 'Details zu Urheberrecht und Lizenzen',
    },
  },
} as const;
