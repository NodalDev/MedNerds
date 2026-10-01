import { medBlogAreaIds, medBlogTypeIds, type MedBlogArea, type MedBlogType } from '../../data/medblog.ts';

export interface MedBlogFilters {
  type?: MedBlogType;
  area?: MedBlogArea;
  tag?: string;
}

export function readMedBlogFilters(query: URLSearchParams, availableTags: readonly string[]): MedBlogFilters {
  const type = query.get('type');
  const area = query.get('area');
  const tag = query.get('tag');
  return {
    type: medBlogTypeIds.includes(type as MedBlogType) ? type as MedBlogType : undefined,
    area: medBlogAreaIds.includes(area as MedBlogArea) ? area as MedBlogArea : undefined,
    tag: tag && availableTags.includes(tag) ? tag : undefined,
  };
}

export function matchesMedBlogFilters(
  data: { type: MedBlogType; areas: readonly MedBlogArea[]; tags?: readonly string[] },
  filters: MedBlogFilters,
): boolean {
  return (!filters.type || data.type === filters.type)
    && (!filters.area || data.areas.includes(filters.area))
    && (!filters.tag || !!data.tags?.includes(filters.tag));
}

/** Preserve unrelated query parameters while removing inactive filters. */
export function medBlogFilterUrl(current: URL, filters: MedBlogFilters): URL {
  const url = new URL(current);
  for (const key of ['type', 'area', 'tag'] as const) {
    if (filters[key]) url.searchParams.set(key, filters[key]);
    else url.searchParams.delete(key);
  }
  return url;
}
