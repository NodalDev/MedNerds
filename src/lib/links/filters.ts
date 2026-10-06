import {
  linkSpecialties, linkFormats, linkSpecialtyIds, linkFormatIds, linkLanguageIds, linkAccessIds,
  type LinkSpecialty, type LinkFormat, type LinkLanguage, type LinkAccess,
} from '../../data/link-resources.ts';
import type { LinkResource } from './schema.ts';

export interface LinkFilters {
  q?: string;
  specialty?: LinkSpecialty;
  format?: LinkFormat;
  language?: LinkLanguage;
  access?: LinkAccess;
}
export const linkFilterKeys = ['q', 'specialty', 'format', 'language', 'access'] as const;

function validId<T extends string>(value: string | null, ids: readonly T[]): T | undefined {
  return ids.find((id) => id === value);
}
export function readLinkFilters(query: URLSearchParams): LinkFilters {
  return {
    q: query.get('q')?.trim().replace(/\s+/g, ' ') || undefined,
    specialty: validId(query.get('specialty'), linkSpecialtyIds),
    format: validId(query.get('format'), linkFormatIds),
    language: validId(query.get('language'), linkLanguageIds),
    access: validId(query.get('access'), linkAccessIds),
  };
}

/** Match ä/ae/a (and ß/ss) consistently without an external search index. */
export function normalizeLinkSearch(value: string): string {
  return value.toLocaleLowerCase('de').replace(/ß/g, 'ss').normalize('NFD')
    .replace(/\p{M}/gu, '').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/\s+/g, ' ').trim();
}
export function linkSearchText(resource: LinkResource): string {
  return normalizeLinkSearch([
    resource.title, resource.description, resource.provider ?? '', ...(resource.topics ?? []),
    ...resource.specialties.map((id) => linkSpecialties[id]),
    ...resource.formats.map((id) => linkFormats[id]),
  ].join(' '));
}

export type LinkFilterData = Pick<LinkResource, 'specialties' | 'formats' | 'languages' | 'access'> & { search: string };
export function matchesLinkFilters(data: LinkFilterData, filters: LinkFilters, baseline?: LinkSpecialty): boolean {
  return (!baseline || data.specialties.includes(baseline))
    && (!filters.specialty || data.specialties.includes(filters.specialty))
    && (!filters.format || data.formats.includes(filters.format))
    && (!filters.language || data.languages.includes(filters.language))
    && (!filters.access || data.access === filters.access)
    && (!filters.q || normalizeLinkSearch(filters.q).split(' ').every((term) => data.search.includes(term)));
}

/** Keep unrelated query parameters and the fragment intact. */
export function linkFilterUrl(current: URL, filters: LinkFilters): URL {
  const url = new URL(current);
  for (const key of linkFilterKeys) {
    const value = filters[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return url;
}

const titleOrder = new Intl.Collator('de-CH', { sensitivity: 'base', numeric: true });
export function sortLinkResources<T extends { id: string; data: LinkResource }>(resources: readonly T[]): T[] {
  return [...resources].sort((a, b) => Number(Boolean(b.data.featured)) - Number(Boolean(a.data.featured))
    || titleOrder.compare(a.data.title, b.data.title) || a.id.localeCompare(b.id));
}
