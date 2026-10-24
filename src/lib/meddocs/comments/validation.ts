import { articleUuid } from './articles.ts';
import { getStaffAuthor } from '../../auth/profile.ts';
import type { AuditItem, Cursor, MutationResult, OwnComment, Page, PublicComment, PublicPage, UpvoteResult } from './types.ts';

export function validateCommentBody(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (!value || [...value].length > 4000 || new TextEncoder().encode(value).length > 16384
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(raw)) {
    return { ok: false, message: 'Bitte schreibe 1–4.000 Zeichen ohne unsichtbare Steuerzeichen.' };
  }
  return { ok: true, value };
}
const statuses = ['pending', 'approved', 'rejected', 'superseded', 'withdrawn'];
const visibility = ['active', 'hidden', 'withdrawn'];
const reasons = ['spam', 'off_topic', 'sensitive_data', 'other'];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('invalid_response'); return value; }
function nullable(value: unknown): string | null { return value === null ? null : text(value); }
function uuid(value: unknown): string { const id = text(value); if (!articleUuid.test(id)) throw new Error('invalid_response'); return id; }
function nullableUuid(value: unknown): string | null { return value === null ? null : uuid(value); }
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new Error('invalid_response'); return value;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('invalid_response'); return value; }
function date(value: unknown): string { const stamp = text(value); if (!Number.isFinite(Date.parse(stamp))) throw new Error('invalid_response'); return stamp; }
function nullableDate(value: unknown): string | null { return value === null ? null : date(value); }
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  const raw = text(value); const match = allowed.find((candidate) => candidate === raw);
  if (!match) throw new Error('invalid_response'); return match;
}
export function parseCursor(value: unknown): Cursor | null {
  if (value === null) return null; const row = object(value);
  const base = { at: date(row.at), id: uuid(row.id) };
  return row.order === undefined && row.votes === undefined ? base
    : { ...base, order: enumValue(row.order, ['newest', 'oldest', 'helpful'] as const), votes: integer(row.votes) };
}
export function parseUpvote(value: unknown): UpvoteResult {
  const row = object(value); return { id: uuid(row.id), upvote_count: integer(row.upvote_count), has_upvoted: boolean(row.has_upvoted) };
}
/** Allowlist projection: even a bad provider response cannot forward extra private fields. */
export function parsePublicComment(value: unknown): PublicComment {
  const row = object(value);
  const state = enumValue(row.visibility, visibility as readonly PublicComment['visibility'][]);
  return {
    id: uuid(row.id), article_id: uuid(row.article_id), parent_id: nullableUuid(row.parent_id), reply_to_id: nullableUuid(row.reply_to_id),
    body: state === 'active' ? nullable(row.body) : null, visibility: state,
    display_name: state === 'withdrawn' ? (row.display_name === 'Gelöschter Account' ? 'Gelöschter Account' : 'Beitrag entfernt') : text(row.display_name),
    role: state !== 'active' || row.role === null ? null : enumValue(row.role, ['admin', 'author'] as const),
    author_slug: state === 'active' ? nullable(row.author_slug) : null,
    professional_role: state === 'active' ? nullable(row.professional_role) : null,
    created_at: date(row.created_at), edited_at: nullableDate(row.edited_at), version: integer(row.version, 1), reply_count: integer(row.reply_count),
    first_published_at: date(row.first_published_at), upvote_count: integer(row.upvote_count),
    has_upvoted: boolean(row.has_upvoted), can_upvote: boolean(row.can_upvote),
  };
}
export function parseOwnComment(value: unknown): OwnComment {
  const row = object(value); const path = text(row.canonical_path);
  if (!/^\/meddocs\/[a-z0-9/-]+\/$/.test(path) || path.includes('//')) throw new Error('invalid_response');
  return {
    id: uuid(row.id), article_id: uuid(row.article_id), parent_id: nullableUuid(row.parent_id), reply_to_id: nullableUuid(row.reply_to_id),
    version: integer(row.version, 1), visibility: enumValue(row.visibility, visibility as readonly OwnComment['visibility'][]),
    created_at: date(row.created_at), edited_at: nullableDate(row.edited_at), canonical_path: path,
    article_state: enumValue(row.article_state, ['published', 'archived', 'unpublished']), published_body: nullable(row.published_body),
    revision_id: nullableUuid(row.revision_id), body: nullable(row.body), status: enumValue(row.status, statuses as readonly OwnComment['status'][]),
    reason_code: row.reason_code === null ? null : enumValue(row.reason_code, reasons as readonly NonNullable<OwnComment['reason_code']>[]), display_name: text(row.display_name),
  };
}
export function parsePage<T>(value: unknown, parseItem: (value: unknown) => T): Page<T> {
  const row = object(value);
  if (!Array.isArray(row.items) || row.items.length > 20) throw new Error('invalid_response');
  return { items: row.items.map(parseItem), next_cursor: parseCursor(row.next_cursor) };
}
export function parsePublicPage(value: unknown): PublicPage {
  const article = object(object(value).article);
  if (typeof article.can_write !== 'boolean') throw new Error('invalid_response');
  return { ...parsePage(value, parsePublicComment), article: { state: enumValue(article.state, ['published', 'archived']), can_write: article.can_write } };
}
export function parseMutation(value: unknown): MutationResult {
  const row = object(value); return { id: uuid(row.id), version: integer(row.version, 1), status: enumValue(row.status, [...statuses, ...visibility] as readonly MutationResult['status'][]) };
}
export function parseAudit(value: unknown): AuditItem {
  const row = object(value); const common = { id: uuid(row.id), created_at: date(row.created_at), actor_id: nullableUuid(row.actor_id),
    reason_code: row.reason_code === null ? null : enumValue(row.reason_code, reasons as readonly NonNullable<AuditItem['reason_code']>[]) };
  if (row.kind === 'event') return { ...common, kind: 'event', action: enumValue(row.action, ['approve', 'reject', 'hide', 'restore', 'redact'] as const), revision_id: nullableUuid(row.revision_id) };
  if (row.kind !== 'revision') throw new Error('invalid_response');
  return { ...common, kind: 'revision', number: integer(row.number, 1), body: nullable(row.body), status: enumValue(row.status, statuses as readonly NonNullable<AuditItem['status']>[]),
    decided_at: nullableDate(row.decided_at), redacted_at: nullableDate(row.redacted_at) };
}
export function roleLabel(comment: Pick<PublicComment, 'role' | 'author_slug'>, articleAuthors: readonly string[]): string {
  if (comment.role === 'admin') return 'Administrator';
  if (comment.role !== 'author') return '';
  if (!getStaffAuthor(comment)) return 'MedNerds-Team';
  return comment.author_slug && articleAuthors.includes(comment.author_slug) ? 'Autor dieses Artikels' : 'Autor';
}
export function statusLabel(comment: Pick<OwnComment, 'status' | 'published_body' | 'visibility'>, audience: 'owner' | 'admin' = 'owner'): string {
  if (comment.visibility === 'withdrawn') return 'Beitrag zurückgezogen';
  if (comment.visibility === 'hidden') return 'Beitrag ausgeblendet';
  if (comment.status === 'pending') return comment.published_body ? 'Änderung wartet auf Freigabe – bisherige Fassung bleibt veröffentlicht.'
    : audience === 'admin' ? 'Wartet auf Freigabe – nur für Autor und Moderation sichtbar.' : 'Wartet auf Freigabe – nur für dich sichtbar.';
  if (comment.status === 'rejected') return comment.published_body ? 'Änderung abgelehnt – bisherige Fassung bleibt veröffentlicht.' : 'Beitrag abgelehnt';
  return 'Freigegeben';
}
