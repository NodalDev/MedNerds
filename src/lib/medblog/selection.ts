import type { MedBlogArea, MedBlogType } from '../../data/medblog.ts';

interface SelectablePost {
  id: string;
  data: { type: MedBlogType; areas: readonly MedBlogArea[]; published: Date; draft: boolean };
}

export interface MedBlogSelection {
  type?: MedBlogType;
  area?: MedBlogArea;
  includeDrafts?: boolean;
}

export function selectMedBlogPosts<T extends SelectablePost>(posts: readonly T[], filters: MedBlogSelection = {}): T[] {
  return posts.filter(({ data }) =>
    (filters.includeDrafts || !data.draft)
    && (!filters.type || data.type === filters.type)
    && (!filters.area || data.areas.includes(filters.area))
  ).sort((a, b) => b.data.published.getTime() - a.data.published.getTime() || a.id.localeCompare(b.id, 'de-CH'));
}
