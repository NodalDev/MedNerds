import { articleUuid } from './articles.ts';
import { validateCommentBody } from './validation.ts';

const prefix = 'mednerds:comment-draft:v1:';
export const COMMENT_DRAFT_TTL = 30 * 60 * 1000;
export interface CommentDraft {
  articleId: string; path: string; body: string; replyTo: string | null;
  owner: string | null; expiresAt: number; requestId?: string;
  edit?: { id: string; version: number };
}
type DraftStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
function storage(): DraftStorage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}
function parse(raw: string | null, now: number): CommentDraft | null {
  try {
    const row: unknown = JSON.parse(raw ?? 'null');
    if (!row || typeof row !== 'object') return null;
    const d = row as Partial<CommentDraft>;
    if (typeof d.articleId !== 'string' || !articleUuid.test(d.articleId)
      || typeof d.path !== 'string' || !/^\/meddocs\/[a-z0-9/-]+\/$/.test(d.path) || d.path.includes('//')
      || typeof d.body !== 'string' || !validateCommentBody(d.body).ok
      || (d.replyTo !== null && (typeof d.replyTo !== 'string' || !articleUuid.test(d.replyTo)))
      || (d.owner !== null && (typeof d.owner !== 'string' || !articleUuid.test(d.owner)))
      || typeof d.expiresAt !== 'number' || !Number.isFinite(d.expiresAt) || d.expiresAt <= now || d.expiresAt > now + COMMENT_DRAFT_TTL
      || (d.requestId !== undefined && (typeof d.requestId !== 'string' || !articleUuid.test(d.requestId)))) return null;
    if (d.edit !== undefined && (!d.edit || typeof d.edit !== 'object' || !d.owner || d.replyTo !== null
      || typeof d.edit.id !== 'string' || !articleUuid.test(d.edit.id)
      || !Number.isSafeInteger(d.edit.version) || d.edit.version < 1)) return null;
    return { articleId: d.articleId, path: d.path, body: d.body, replyTo: d.replyTo, owner: d.owner,
      expiresAt: d.expiresAt, ...(d.requestId ? { requestId: d.requestId } : {}),
      ...(d.edit ? { edit: { id: d.edit.id, version: d.edit.version } } : {}) };
  } catch { return null; }
}
function prune(store: DraftStorage, now: number): void {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) { const key = store.key(i); if (key?.startsWith(prefix)) keys.push(key); }
  for (const key of keys) if (!parse(store.getItem(key), now)) store.removeItem(key);
}
/** Persistence is explicit and tab-scoped, only immediately before account navigation. */
export function saveCommentDraft(draft: CommentDraft, store = storage(), now = Date.now()): boolean {
  try {
    const safe = parse(JSON.stringify(draft), now);
    if (!store || !safe) return false;
    prune(store, now); store.setItem(prefix + safe.articleId, JSON.stringify(safe)); return true;
  } catch { return false; }
}
export function readCommentDraft(articleId: string, path: string, store = storage(), now = Date.now()): CommentDraft | null {
  try {
    if (!store) return null; prune(store, now);
    const draft = parse(store.getItem(prefix + articleId), now);
    if (draft && draft.articleId === articleId && draft.path === path) return draft;
    return null;
  } catch { return null; }
}
export function removeCommentDraft(articleId: string, store = storage()): void {
  try { store?.removeItem(prefix + articleId); } catch { /* No durable fallback or content logging. */ }
}
/** Called by the existing account return flow, before profile/legal completion too.
 * The first verified login owns an anonymous handoff; another account cannot adopt it.
 * No credentials or tokens are stored here. */
export function bindCommentDraftToUser(returnTo: string, userId: string, store = storage(), now = Date.now()): void {
  try {
    if (!store || !articleUuid.test(userId)) return;
    const path = returnTo.split(/[?#]/, 1)[0];
    if (!/^\/meddocs\/[a-z0-9/-]+\/$/.test(path)) return;
    prune(store, now);
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i); if (!key?.startsWith(prefix)) continue;
      const draft = parse(store.getItem(key), now); if (!draft || draft.path !== path) continue;
      if (draft.owner && draft.owner !== userId) store.removeItem(key);
      else store.setItem(key, JSON.stringify({ ...draft, owner: userId }));
    }
  } catch { /* Storage denial must never interrupt authentication. */ }
}
