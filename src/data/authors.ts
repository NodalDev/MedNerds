export interface Person {
  name: string;
  description: string;
  citationName?: { family: string; given?: string } | { literal: string };
}

// Personendaten werden von Autoren und fachlichen Prüfern gemeinsam verwendet.
export const authors = {
  'orlando-frey': {
    name: 'Orlando Frey',
    citationName: { family: 'Frey', given: 'Orlando' },
    description: 'Medizinstudent an der Uni Basel mit besonderem Interesse an Ultraschall, Kardiologie und Notfallmedizin.',
  },
  'tim-luginbuehl': {
    name: 'Tim Luginbühl',
    citationName: { family: 'Luginbühl', given: 'Tim' },
    description: 'Medizinstudent an der Uni Basel mit besonderen Interesse an Anästhesie und präklinischer sowie klinischer Notfallmedizin.',
  },
  'hans-muster': {
    name: 'Hans Muster',
    citationName: { family: 'Muster', given: 'Hans' },
    description: 'Beispielperson für die Darstellung der fachlichen Prüfung.',
  },
} as const satisfies Record<string, Person>;

export type AuthorId = keyof typeof authors;
