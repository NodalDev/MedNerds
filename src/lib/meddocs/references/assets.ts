import type { CslAssets } from './format.ts';
import type { CitationStyle } from './format.ts';
const styleLoaders = {
  'mednerds-vancouver': () => import('./csl/mednerds-vancouver.csl?raw'),
  vancouver: () => import('./csl/vancouver.csl?raw'),
  apa: () => import('./csl/apa.csl?raw'),
  harvard: () => import('./csl/harvard-cite-them-right.csl?raw'),
  chicago: () => import('./csl/chicago-author-date.csl?raw'),
  mla: () => import('./csl/modern-language-association.csl?raw'),
};
let locales: Promise<Record<string, string>> | undefined;
const loadedStyles = new Map<CitationStyle, Promise<{ default: string }>>();
export async function loadCslAssets(style: CitationStyle): Promise<CslAssets> {
  let selected = loadedStyles.get(style);
  if (!selected) { selected = styleLoaders[style](); loadedStyles.set(style, selected); }
  try {
    const [template, languages] = await Promise.all([selected, locales ??= Promise.all([
      import('./csl/locales-en-US.xml?raw'), import('./csl/locales-en-GB.xml?raw'), import('./csl/locales-de-DE.xml?raw'),
    ]).then(([enUS, enGB, deDE]) => ({ 'en-US': enUS.default, 'en-GB': enGB.default, 'de-DE': deDE.default }))]);
    return { styles: { [style]: template.default }, locales: languages };
  } catch (error) { loadedStyles.delete(style); locales = undefined; throw error; }
}
