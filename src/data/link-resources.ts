/** Stable filter IDs and their display labels, shared by schema, search and UI. */
export const linkSpecialties = {
  anaesthesie: 'Anästhesie',
  ekg: 'EKG',
  echokardiographie: 'Echokardiographie',
  notfallmedizin: 'Notfallmedizin',
  ultraschall: 'Ultraschall',
  allgemein: 'Allgemein',
} as const;
export const linkFormats = {
  leitlinie: 'Leitlinie', literatur: 'Literatur', podcast: 'Podcast', video: 'Video',
  kurs: 'Kurs', 'hands-on': 'Hands-on', website: 'Website', tool: 'Tool',
} as const;
export const linkLanguages = { de: 'DE', en: 'EN', fr: 'FR', it: 'IT' } as const;
export const linkAccess = { free: 'Kostenlos', paid: 'Kostenpflichtig', mixed: 'Teilweise kostenlos' } as const;

export type LinkSpecialty = keyof typeof linkSpecialties;
export type LinkFormat = keyof typeof linkFormats;
export type LinkLanguage = keyof typeof linkLanguages;
export type LinkAccess = keyof typeof linkAccess;

export const linkSpecialtyIds = Object.keys(linkSpecialties) as [LinkSpecialty, ...LinkSpecialty[]];
export const linkFormatIds = Object.keys(linkFormats) as [LinkFormat, ...LinkFormat[]];
export const linkLanguageIds = Object.keys(linkLanguages) as [LinkLanguage, ...LinkLanguage[]];
export const linkAccessIds = Object.keys(linkAccess) as [LinkAccess, ...LinkAccess[]];
