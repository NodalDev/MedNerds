import CSL from 'citeproc';
import type { CslItem } from './model.ts';
export const citationStyles = [
  { id: 'mednerds-vancouver', label: 'Vancouver – MedNerds Style' },
  { id: 'vancouver', label: 'Vancouver' }, { id: 'apa', label: 'APA 7' },
  { id: 'harvard', label: 'Harvard · Cite Them Right' }, { id: 'chicago', label: 'Chicago Author-Date' }, { id: 'mla', label: 'MLA 9' },
] as const;
export type CitationStyle = typeof citationStyles[number]['id'];
export const defaultCitationStyle: CitationStyle = 'mednerds-vancouver';
export interface CslAssets { styles: Partial<Record<CitationStyle, string>>; locales: Record<string, string> }
export function formatBibliography(items: readonly CslItem[], style: CitationStyle, assets: CslAssets): { id: string; text: string }[] {
  if (!items.length) return [];
  const template = assets.styles[style]; if (!template) throw new Error('Zitierstil konnte nicht geladen werden.');
  const byId = new Map(items.map((item) => [item.id, item]));
  const processor = new CSL.Engine({ retrieveLocale: (language) => assets.locales[language] ?? assets.locales['en-US'] ?? false,
    retrieveItem: (id) => { const item = byId.get(id); if (!item) throw new Error('Unbekannte CSL-Quelle.'); return item; } }, template, 'en-US');
  processor.setOutputFormat('text'); processor.updateItems(items.map((item) => item.id));
  const bibliography = processor.makeBibliography();
  if (!bibliography || bibliography[0].bibliography_errors.length) throw new Error('Die Literaturangaben konnten nicht vollständig formatiert werden.');
  return bibliography[1].map((text, index) => ({ id: bibliography[0].entry_ids[index][0], text: text.trim() }));
}
