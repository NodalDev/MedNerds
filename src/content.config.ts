import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';
import { pageLayouts } from './data/page-layouts';
import { articleMetadataSchema } from './lib/meddocs/article-metadata-schema';

export const collections = {
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
