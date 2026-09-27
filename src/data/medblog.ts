export const medBlogTypes = {
  article: { label: 'Artikel', plural: 'Artikel', segment: 'artikel' },
  news: { label: 'News', plural: 'News', segment: 'news' },
  update: { label: 'Update', plural: 'Updates', segment: 'updates' },
} as const;

export type MedBlogType = keyof typeof medBlogTypes;
export const medBlogTypeIds = Object.keys(medBlogTypes) as [MedBlogType, ...MedBlogType[]];

export const medBlogAreas = {
  platform: { label: 'Plattform' },
  meddocs: { label: 'MedDocs' },
  medblog: { label: 'MedBlog' },
  medlearn: { label: 'MedLearn' },
  medcases: { label: 'MedCases' },
  medtools: { label: 'MedTools' },
  'mednerds-basel': { label: 'MedNerds Basel' },
} as const;

export type MedBlogArea = keyof typeof medBlogAreas;
export const medBlogAreaIds = Object.keys(medBlogAreas) as [MedBlogArea, ...MedBlogArea[]];

export function medBlogTypeFromSegment(segment: string): MedBlogType | undefined {
  return medBlogTypeIds.find((type) => medBlogTypes[type].segment === segment);
}

export function medBlogPostHref(type: MedBlogType, slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Ungültiger MedBlog-Dateiname/Slug: "${slug}". Bitte Kleinbuchstaben, Zahlen und Bindestriche verwenden.`);
  }
  return `/medblog/${medBlogTypes[type].segment}/${slug}/`;
}
