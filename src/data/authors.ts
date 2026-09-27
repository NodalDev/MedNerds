export interface Person {
  name: string;
  description: string;
}

// Personendaten werden von Autoren und fachlichen Prüfern gemeinsam verwendet.
export const authors = {
  'orlando-frey': {
    name: 'Orlando Frey',
    description: 'Medizinstudent; verantwortlich für die redaktionellen Inhalte von MedNerds.',
  },
} as const satisfies Record<string, Person>;

export type AuthorId = keyof typeof authors;
