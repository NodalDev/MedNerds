import { z } from 'astro/zod';
import { authors, type AuthorId } from '../../data/authors.ts';
import { licenses, type LicenseId } from '../../data/licenses.ts';
import { publicationIdsSchema, referencesSchema } from './references/schema.ts';

const personId = z.enum(Object.keys(authors) as [AuthorId, ...AuthorId[]]);
const licenseId = z.enum(Object.keys(licenses) as [LicenseId, ...LicenseId[]]);

// YAML dates arrive as Date objects; quoted dates must be valid ISO calendar dates.
// Normalize to UTC midnight so formatting is independent of the build's time zone.
const articleDate = z.union([z.date(), z.iso.date().transform((date) => new Date(`${date}T00:00:00Z`))])
  .transform((date) => new Date(`${date.toISOString().slice(0, 10)}T00:00:00Z`));

const textList = z.array(z.string().trim().min(1));

export const articleMetadataSchema = z.object({
  articleId: z.uuid().optional(),
  comments: z.boolean().optional(),
  authors: z.array(personId).min(1).optional(),
  published: articleDate.optional(),
  updated: articleDate.optional(),
  reviewers: z.array(personId).optional(),
  reviewed: articleDate.optional(),
  tags: textList.optional(),
  synonyms: textList.optional(),
  english: textList.optional(),
  abbreviations: textList.optional(),
  license: licenseId.optional(),
  linkPreview: z.string().trim().min(1).max(240).optional(),
  sectionPreviews: z.record(z.string().min(1), z.string().trim().min(1).max(240)).optional(),
  references: publicationIdsSchema.optional(),
  // Build-derived records from the central catalog; never author these in frontmatter.
  resolvedReferences: referencesSchema.optional(),
  // Build-derived IDs of sources actually cited in MDX, in first-appearance order.
  referenceOrder: z.array(z.string()).optional(),
  learningUrl: z.string().regex(/^\/medlearn\/(?!\/)[a-z0-9/-]*$/, 'E-Learning muss auf einen internen MedLearn-Pfad zeigen.').optional(),
}).superRefine((data, context) => {
  if (data.comments && !data.articleId) {
    context.addIssue({ code: 'custom', path: ['articleId'], message: 'Kommentare benötigen eine dauerhaft gespeicherte articleId (UUID).' });
  }
  if (data.comments && (!data.authors?.length || !data.published)) {
    context.addIssue({ code: 'custom', path: ['comments'], message: 'Kommentare benötigen vollständige Artikel-Metadaten.' });
  }
  // Legacy entries may omit everything. Once editorial metadata is supplied,
  // author(s) and publication date must be supplied together.
  const hasMetadata = data.authors !== undefined || data.published !== undefined
    || data.updated !== undefined || data.reviewers !== undefined || data.reviewed !== undefined;
  if (!hasMetadata) return;
  if (!data.authors) {
    context.addIssue({ code: 'custom', path: ['authors'], message: 'Artikel-Metadaten benötigen mindestens einen Autor unter authors.' });
  }
  if (!data.published) {
    context.addIssue({ code: 'custom', path: ['published'], message: 'Artikel-Metadaten benötigen ein Veröffentlichungsdatum unter published.' });
  }
  if (data.published && data.updated && data.updated < data.published) {
    context.addIssue({ code: 'custom', path: ['updated'], message: 'updated darf nicht vor published liegen.' });
  }
  if (data.published && data.reviewed && data.reviewed < data.published) {
    context.addIssue({ code: 'custom', path: ['reviewed'], message: 'reviewed darf nicht vor published liegen.' });
  }
});
