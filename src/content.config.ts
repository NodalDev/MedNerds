import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { pageLayouts } from './data/page-layouts';
import { articleMetadataSchema } from './lib/meddocs/article-metadata-schema';
import { glob } from 'astro/loaders';
import { medBlogSchema } from './lib/medblog/schema';
import { linkResourceSchema } from './lib/links/schema';

export const collections = {
  linkResources: defineCollection({
    loader: glob({ pattern: '*.md', base: './src/content/link-resources' }),
    schema: linkResourceSchema,
  }),
  medblog: defineCollection({
    loader: glob({ pattern: '*.{md,mdx}', base: './src/content/medblog' }),
    schema: medBlogSchema,
  }),
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: articleMetadataSchema.safeExtend({
				pageLayout: z.enum(pageLayouts).optional(),
			}),
		}),
	}),
	i18n: defineCollection({
		loader: i18nLoader(),
		schema: i18nSchema(),
	}),
};
