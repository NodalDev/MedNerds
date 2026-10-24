import { z } from 'astro/zod';
import { literatureCategories } from './categories.ts';

// CSL input schema: https://github.com/citation-style-language/schema/blob/master/schemas/input/csl-data.json
export const cslTypes = [
  'article', 'article-journal', 'article-magazine', 'article-newspaper', 'bill', 'book', 'broadcast',
  'chapter', 'classic', 'collection', 'dataset', 'document', 'entry', 'entry-dictionary', 'entry-encyclopedia',
  'event', 'figure', 'graphic', 'hearing', 'interview', 'legal_case', 'legislation', 'manuscript', 'map',
  'motion_picture', 'musical_score', 'pamphlet', 'paper-conference', 'patent', 'performance', 'periodical',
  'personal_communication', 'post', 'post-weblog', 'regulation', 'report', 'review', 'review-book',
  'software', 'song', 'speech', 'standard', 'thesis', 'treaty', 'webpage',
] as const;
export type CslType = typeof cslTypes[number];
export const publicationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/, 'Quellenkennung: Kleinbuchstaben, Ziffern und Bindestriche.');
export const publicationIdsSchema = z.array(publicationIdSchema).superRefine((ids, context) => {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) context.addIssue({ code: 'custom', path: [index], message: `Doppelte Quellenkennung: ${id}` });
    seen.add(id);
  });
});

const text = z.string().trim().min(1).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Keine Steuerzeichen in Literaturangaben.');
export const referencePerson = z.union([
  z.strictObject({ family: text, given: text.optional() }),
  z.strictObject({ literal: text }),
]);
const date = z.union([z.iso.date(), z.date().transform((value) => value.toISOString().slice(0, 10))]);
const url = z.url().refine((value) => { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }, 'Nur HTTP-/HTTPS-URLs ohne Zugangsdaten.');
const common = {
  id: publicationIdSchema,
  title: text, authors: z.array(referencePerson).min(1).optional(),
  year: z.number().int().min(1).max(9999).optional(), published: date.optional(),
  doi: text.transform((value) => value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''))
    .refine((value) => /^10\.\d{4,9}\/[^\s<>]+$/.test(value), 'DOI muss mit 10.…/ beginnen.').optional(),
  url: url.optional(), accessed: date.optional(),
  meddocsCategory: z.enum(literatureCategories).optional(),
};
// Preserve established field names and the two existing aliases. Canonical CSL types use the same converter.
export const referenceSchema = z.strictObject({
  ...common, type: z.enum([...cslTypes, 'journal-article', 'website']),
  journal: text.optional(), volume: text.optional(), issue: text.optional(), pages: text.optional(), articleNumber: text.optional(),
  publisher: text.optional(), publisherPlace: text.optional(), edition: text.optional(), isbn: text.optional(),
  bookTitle: text.optional(), editors: z.array(referencePerson).min(1).optional(), website: text.optional(), reportNumber: text.optional(),
}).superRefine((source, context) => {
  const required = (field: keyof typeof source) => {
    if (!source[field]) context.addIssue({ code: 'custom', path: [field], message: `Diese Quelle benötigt ${field}.` });
  };
  if (['journal-article', 'article-journal', 'book', 'chapter', 'report'].includes(source.type) && !source.year && !source.published) {
    context.addIssue({ code: 'custom', path: ['year'], message: 'Diese Quelle benötigt year oder published.' });
  }
  if (['journal-article', 'article-journal', 'book', 'chapter'].includes(source.type)) required('authors');
  if (['journal-article', 'article-journal'].includes(source.type)) required('journal');
  if (['book', 'chapter', 'report'].includes(source.type)) required('publisher');
  if (source.type === 'chapter') { required('bookTitle'); required('pages'); }
  if (['website', 'webpage', 'post', 'post-weblog'].includes(source.type)) { required('url'); required('accessed'); }
  if (source.year && source.published && Number(source.published.slice(0, 4)) !== source.year) context.addIssue({ code: 'custom', path: ['published'], message: 'published und year widersprechen sich.' });
});
export const referencesSchema = z.array(referenceSchema).superRefine((sources, context) => {
  const seen = new Set<string>();
  sources.forEach((source, index) => {
    if (seen.has(source.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: `Doppelte Quellenkennung: ${source.id}` });
    seen.add(source.id);
  });
});
export type Reference = z.infer<typeof referenceSchema>;
export type ReferencePerson = z.infer<typeof referencePerson>;
