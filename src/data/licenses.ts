export interface License {
  label: string;
  fullName: string;
  url: string;
}

export const licenses = {
  'cc-by-nc-sa-4.0': {
    label: 'CC BY-NC-SA 4.0',
    fullName: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International',
    url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  },
  'cc-by-nc-4.0': {
    label: 'CC BY-NC 4.0',
    fullName: 'Creative Commons Attribution-NonCommercial 4.0 International',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
} as const satisfies Record<string, License>;

export type LicenseId = keyof typeof licenses;

// Nur für eigene MedDocs-Inhalte. Abweichende Lizenzen müssen explizit angegeben werden.
export const defaultMedDocsLicense = 'cc-by-nc-sa-4.0' satisfies LicenseId;
