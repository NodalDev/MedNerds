import { z } from 'astro/zod';
import type { SchemaContext } from 'astro:content';
import { articleMetadataSchema } from '../meddocs/article-metadata-schema.ts';
import { medBlogTypeIds, medBlogAreaIds } from '../../data/medblog.ts';

const text = z.string().trim().min(1);
const safeLink = text.refine((href) => {
  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) return true;
  try { return new URL(href).protocol === 'https:'; }
  catch { return false; }
}, {
  message: 'CTA-Links müssen interne absolute Pfade oder HTTPS-Links sein.',
});

export const medBlogEditorialSchema = z.object({
  title: text,
  description: text,
  type: z.enum(medBlogTypeIds),
  areas: z.array(z.enum(medBlogAreaIds)).min(1),
  authors: articleMetadataSchema.shape.authors.unwrap(),
  published: articleMetadataSchema.shape.published.unwrap(),
  updated: articleMetadataSchema.shape.updated,
  tags: z.array(text).default([]),
  featured: z.boolean().default(false),
  cta: z.object({ label: text, href: safeLink }).optional(),
  draft: z.boolean().default(false),
}).superRefine((data, context) => {
  if (data.updated && data.updated < data.published) {
    context.addIssue({ code: 'custom', path: ['updated'], message: 'updated darf nicht vor published liegen.' });
  }
});

export function medBlogSchema({ image }: SchemaContext) {
  return medBlogEditorialSchema.safeExtend({
    image: z.object({
      // Astro resolves local files, validates their existence, and supplies dimensions.
      src: image(),
      alt: text,
      fit: z.enum(['cover', 'contain']).default('cover'),
    }).optional(),
  });
}
