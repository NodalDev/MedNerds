export interface Person {
  name: string;
  description: string;
}

// Personendaten werden von Autoren und fachlichen Prüfern gemeinsam verwendet.
export const authors = {
  'orlando-frey': {
    name: 'Orlando Frey',
    description: 'Medizinstudent an der Uni Basel mit besonderem Interesse an Ultraschall, Kardiologie und Notfallmedizin.',
  },
  'tim-luginbuehl': {
    name: 'Tim Luginbühl',
    description: 'Medizinstudent an der Uni Basel mit besonderen Interesse an Anästhesie und präklinischer sowie klinischer Notfallmedizin.',
  },
  'hans-muster': {
    name: 'Hans Muster',
    description: 'Beispielperson für die Darstellung der fachlichen Prüfung.',
  },
} as const satisfies Record<string, Person>;

export type AuthorId = keyof typeof authors;
