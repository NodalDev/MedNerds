import type { MedBlogArea, MedBlogType } from '../../data/medblog.ts';
import { matchesMedBlogFilters, type MedBlogFilters } from './filters.ts';

interface SelectablePost {
  id: string;
  data: { type: MedBlogType; areas: readonly MedBlogArea[]; tags?: readonly string[]; published: Date; draft: boolean };
}

export interface MedBlogSelection extends MedBlogFilters {
  includeDrafts?: boolean;
}

export function selectMedBlogPosts<T extends SelectablePost>(posts: readonly T[], filters: MedBlogSelection = {}): T[] {
  return posts.filter(({ data }) =>
    (filters.includeDrafts || !data.draft)
    && matchesMedBlogFilters(data, filters)
  ).sort((a, b) => b.data.published.getTime() - a.data.published.getTime() || a.id.localeCompare(b.id, 'de-CH'));
}
