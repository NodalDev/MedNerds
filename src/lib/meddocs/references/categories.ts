import type { Reference } from './schema.ts';

export const literatureCategories = ['books', 'articles', 'guidelines', 'online', 'other'] as const;
export type LiteratureCategory = typeof literatureCategories[number];
export const literatureCategoryLabels: Readonly<Record<LiteratureCategory, string>> = {
  books: 'Bücher & Lehrbücher',
  articles: 'Fachartikel & Studien',
  guidelines: 'Leitlinien & Empfehlungen',
  online: 'Online-Ressourcen',
  other: 'Sonstige Quellen',
};

/** A display convention only; never modifies the bibliographic type. */
export function literatureCategory(source: Reference): LiteratureCategory {
  if (source.meddocsCategory) return source.meddocsCategory;
  switch (source.type) {
    case 'book': case 'chapter': case 'collection': case 'classic':
    case 'entry-dictionary': case 'entry-encyclopedia': return 'books';
    case 'journal-article': case 'article-journal': case 'article': case 'paper-conference': return 'articles';
    case 'standard': return 'guidelines';
    case 'website': case 'webpage': case 'post': case 'post-weblog': return 'online';
    default: return 'other';
  }
}

const collator = new Intl.Collator('de', { usage: 'sort', sensitivity: 'base', numeric: true });
function authorKey(source: Reference): string {
  const person = source.authors?.find((author) => 'family' in author);
  return person && 'family' in person ? person.family
    : source.authors?.find((author) => 'literal' in author)?.literal ?? source.publisher ?? source.title;
}
function year(source: Reference): number {
  // Undated publications follow dated works by the same author.
  return source.year ?? (source.published ? Number(source.published.slice(0, 4)) : Number.POSITIVE_INFINITY);
}
export function compareLiterature(a: Reference, b: Reference): number {
  return collator.compare(authorKey(a), authorKey(b))
    || (year(a) === year(b) ? 0 : year(a) < year(b) ? -1 : 1)
    || collator.compare(a.title, b.title)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function groupLiterature(sources: readonly Reference[]): { category: LiteratureCategory; label: string; sources: Reference[] }[] {
  return literatureCategories.flatMap((category) => {
    const items = sources.filter((source) => literatureCategory(source) === category).sort(compareLiterature);
    return items.length ? [{ category, label: literatureCategoryLabels[category], sources: items }] : [];
  });
}
