import type { CslType, Reference, ReferencePerson } from './schema.ts';
import type { ArticleMetadata } from '../article-metadata.ts';
export interface CslItem {
  id: string; type: CslType; title: string; author?: readonly ReferencePerson[]; editor?: readonly ReferencePerson[];
  issued?: { 'date-parts': number[][] }; accessed?: { 'date-parts': number[][] };
  'container-title'?: string; publisher?: string; 'publisher-place'?: string;
  volume?: string; issue?: string; page?: string; DOI?: string; URL?: string; ISBN?: string; edition?: string; number?: string;
}
export interface CitationPayload { article: CslItem; cited: readonly CslItem[]; literature: readonly CslItem[] }
export function allCitationSources(payload: CitationPayload): readonly CslItem[] {
  return [...payload.cited, ...payload.literature];
}
/** Selection changes datasets, never the bibliographic formatter or serializer. */
export function selectCitationItems(payload: CitationPayload, target: string): readonly CslItem[] {
  switch (target) {
    case 'article': return [payload.article];
    case 'cited': return payload.cited;
    case 'literature': return payload.literature;
    case 'references': return allCitationSources(payload);
    default: return allCitationSources(payload).filter((item) => `reference:${item.id}` === target);
  }
}
function cslDate(value: string): { 'date-parts': number[][] } { return { 'date-parts': [value.split('-').map(Number)] }; }
export function doiUrl(doi: string): string { return `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, '/')}`; }
export function referenceToCsl(source: Reference): CslItem {
  const item: CslItem = { id: source.id, type: source.type === 'journal-article' ? 'article-journal' : source.type === 'website' ? 'webpage' : source.type, title: source.title };
  if (source.authors) item.author = source.authors;
  if (source.published || source.year) item.issued = cslDate(source.published ?? String(source.year));
  if (source.accessed) item.accessed = cslDate(source.accessed);
  if (source.doi) item.DOI = source.doi;
  if (source.url) item.URL = source.url;
  if (source.journal) item['container-title'] = source.journal;
  if (source.volume) item.volume = source.volume;
  if (source.issue) item.issue = source.issue;
  if (source.pages || source.articleNumber) item.page = source.pages ?? source.articleNumber;
  if (source.website) item['container-title'] = source.website;
  if ('publisher' in source) item.publisher = source.publisher;
  if ('publisherPlace' in source) item['publisher-place'] = source.publisherPlace;
  if ('isbn' in source) item.ISBN = source.isbn;
  if (source.edition) item.edition = source.edition;
  if (source.bookTitle) item['container-title'] = source.bookTitle;
  if (source.editors) item.editor = source.editors;
  if (source.reportNumber) item.number = source.reportNumber;
  return item;
}
export function articleToCsl(title: string, metadata: ArticleMetadata, canonical: string): CslItem {
  return { id: 'mednerds-article', type: 'webpage', title, author: metadata.authors.map((person) => person.citationName ?? { literal: person.name }),
    issued: cslDate(metadata.published.toISOString().slice(0, 10)), 'container-title': 'MedNerds MedDocs', URL: canonical };
}
export function canonicalArticleUrl(pathname: string, site: URL | undefined): string {
  if (!site || !['https:', 'http:'].includes(site.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname)) throw new Error('Artikelzitation benötigt die öffentliche Astro.site-Konfiguration.');
  const canonical = new URL(site); canonical.pathname = pathname; canonical.search = ''; canonical.hash = ''; return canonical.href;
}
