import type { StarlightRouteData } from '@astrojs/starlight/route-data';
import { authors, type Person } from '../../data/authors.ts';
import { licenses, defaultMedDocsLicense, type License } from '../../data/licenses.ts';
import { resolvePageLayout } from '../../data/page-layouts.ts';

export interface ArticleMetadata {
  authors: readonly Person[];
  published: Date;
  updated?: Date;
  reviewers: readonly Person[];
  reviewed?: Date;
  tags?: readonly string[];
  synonyms?: readonly string[];
  english?: readonly string[];
  abbreviations?: readonly string[];
  license: License;
}

type ArticleEntry = Pick<StarlightRouteData['entry'], 'id' | 'filePath' | 'data'>;

/** Resolve validated frontmatter only for ordinary MedDocs articles. */
export function getMedDocsArticleMetadata(entry: ArticleEntry): ArticleMetadata | undefined {
  const { data } = entry;
  const section = entry.id.split('/')[0];
  const filename = entry.filePath.replaceAll('\\', '/').split('/').at(-1);
  if (section !== 'meddocs' || resolvePageLayout(data.pageLayout) !== 'default'
    || data.template === 'splash' || data.hero || filename?.split('.')[0] === 'index') {
    return undefined;
  }
  if (!data.authors?.length || !data.published) return undefined;

  return {
    authors: data.authors.map((id) => authors[id]),
    published: data.published,
    updated: data.updated && data.updated.getTime() !== data.published.getTime() ? data.updated : undefined,
    reviewers: (data.reviewers ?? []).map((id) => authors[id]),
    reviewed: data.reviewed,
    tags: data.tags,
    synonyms: data.synonyms,
    english: data.english,
    abbreviations: data.abbreviations,
    license: licenses[data.license ?? defaultMedDocsLicense],
  };
}

const dateFormatter = new Intl.DateTimeFormat('de-CH', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

const nameFormatter = new Intl.ListFormat('de', { style: 'long', type: 'conjunction' });

export function formatAuthorNames(names: readonly string[]): string {
  return nameFormatter.format(names);
}

export function formatArticleDate(date: Date): string {
  return dateFormatter.format(date);
}

export function articleDateTime(date: Date): string {
  return date.toISOString().slice(0, 10);
}
