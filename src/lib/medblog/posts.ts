import { getCollection, type CollectionEntry } from 'astro:content';
import { authors } from '../../data/authors';
import { medBlogPostHref, type MedBlogType, type MedBlogArea } from '../../data/medblog';
import { selectMedBlogPosts } from './selection';

export type MedBlogPost = CollectionEntry<'medblog'>;

/** Shared source for hubs, routes, and future area-specific related-post lists. */
export async function getMedBlogPosts(filters: { type?: MedBlogType; area?: MedBlogArea } = {}): Promise<MedBlogPost[]> {
  const posts = selectMedBlogPosts(await getCollection('medblog'), {
    ...filters, includeDrafts: import.meta.env.MODE !== 'production',
  });
  for (const post of posts) medBlogPostHref(post.data.type, post.id);
  return posts;
}

export function getMedBlogMetadata(post: MedBlogPost) {
  const { data } = post;
  return {
    authors: data.authors.map((id) => authors[id]),
    published: data.published,
    updated: data.updated && data.updated.getTime() !== data.published.getTime() ? data.updated : undefined,
  };
}
