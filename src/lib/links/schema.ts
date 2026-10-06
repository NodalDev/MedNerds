import { z } from 'astro/zod';
import { linkSpecialtyIds, linkFormatIds, linkLanguageIds, linkAccessIds } from '../../data/link-resources.ts';
import { articleMetadataSchema } from '../meddocs/article-metadata-schema.ts';

const text = z.string().trim().min(1);
const externalUrl = text.pipe(z.url()).refine((value) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}, {
  message: 'Ressourcen benötigen eine vollständige HTTP- oder HTTPS-URL.',
});

export const linkResourceSchema = z.strictObject({
  title: text,
  description: text,
  url: externalUrl,
  provider: text.optional(),
  specialties: z.array(z.enum(linkSpecialtyIds)).min(1),
  formats: z.array(z.enum(linkFormatIds)).min(1),
  topics: z.array(text).optional(),
  languages: z.array(z.enum(linkLanguageIds)).min(1),
  access: z.enum(linkAccessIds).optional(),
  featured: z.boolean().optional(),
  // Reuse MedDocs' validated ISO/YAML dates and UTC normalization.
  checked: articleMetadataSchema.shape.published,
});

export type LinkResource = z.infer<typeof linkResourceSchema>;
