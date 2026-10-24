import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrowserDatabase, CommentSort, CommentsRpcFunctions, Cursor, Reason } from './types.ts';
import { parseAudit, parseMutation, parseOwnComment, parsePage, parsePublicPage, parseUpvote } from './validation.ts';

const messages: Record<string, string> = {
  backend_not_configured: 'Kommentare sind momentan nicht verfügbar.',
  network_error: 'Die Verbindung konnte nicht hergestellt werden. Bitte versuche es erneut.',
  authentication_required: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
  profile_required: 'Bitte vervollständige zuerst dein Profil mit einem Anzeigenamen.',
  legal_required: 'Bitte bestätige zuerst die aktuellen Nutzungsbedingungen und Datenschutzhinweise.',
  article_unavailable: 'Die Kommentare sind für diesen Artikel derzeit nicht verfügbar.',
  forbidden: 'Du bist für diese Aktion nicht berechtigt.', conflict: 'Der Beitrag wurde inzwischen geändert. Bitte lade ihn neu und prüfe deine Eingabe.',
  rate_limited: 'Du hast das Beitragslimit erreicht (3 pro Minute, 20 pro Tag). Bitte versuche es später erneut.',
  invalid_body: 'Bitte schreibe 1–4.000 Zeichen ohne Steuerzeichen.', invalid_reply: 'Auf diesen Beitrag kann derzeit nicht geantwortet werden.',
  unavailable: 'Die Kommentare konnten nicht geladen oder gespeichert werden. Bitte versuche es erneut.',
};
export class CommentError extends Error {
  readonly code: string;
  constructor(code: string) { super(messages[code] ?? messages.unavailable); this.code = code; }
}
export function commentError(error: unknown): CommentError {
  if (error instanceof CommentError) return error;
  const providerCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  // Missing migrations are backend configuration, even if an accompanying message is misleading.
  if (['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42883'].includes(providerCode)) return new CommentError('backend_not_configured');
  if (providerCode === '42501') return new CommentError('forbidden');
  if (error instanceof TypeError || (error && typeof error === 'object' && 'message' in error
    && typeof error.message === 'string' && /(?:Failed to fetch|NetworkError|fetch failed)/i.test(error.message))) return new CommentError('network_error');
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    && Object.hasOwn(messages, error.message)) return new CommentError(error.message);
  if (error && typeof error === 'object' && 'code' in error && ['PGRST301', 'PGRST302', 'PGRST303'].includes(String(error.code))) return new CommentError('authentication_required');
  if (error && typeof error === 'object' && 'code' in error && ['40P01', '40001', '55P03'].includes(String(error.code))) return new CommentError('conflict');
  return new CommentError('unavailable');
}
/** One existing Supabase client; exact local RPC arguments + runtime DTO validation. */
export function createCommentsApi(client: SupabaseClient<BrowserDatabase>) {
  async function rpc<Name extends keyof CommentsRpcFunctions, T>(name: Name, args: CommentsRpcFunctions[Name]['Args'], parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    try {
      const query = client.rpc(name, args);
      const result = await (signal ? query.abortSignal(signal) : query);
      if (result.error) throw commentError(result.error);
      return parse(result.data);
    } catch (error) {
      const failure = commentError(error);
      if (import.meta.env?.DEV && !signal?.aborted) {
        // Fixed endpoint and classified cause only: no tokens, URLs, bodies or provider messages.
        console.debug('[MedDocs comments]', { rpc: name, cause: failure.code });
      }
      throw failure;
    }
  }
  const page = (cursor: Cursor | null) => ({ cursor: cursor ? { at: cursor.at, id: cursor.id,
    ...(cursor.order ? { order: cursor.order, votes: cursor.votes } : {}) } : null, page_size: 10 });
  return {
    list: (article: string, cursor: Cursor | null, signal?: AbortSignal, sort: CommentSort = 'newest') => rpc('meddocs_comments_list', { target_article: article, ...page(cursor), sort_order: sort }, parsePublicPage, signal),
    upvote: (id: string, voted: boolean, signal?: AbortSignal) => rpc('meddocs_comment_upvote', { target_comment: id, voted }, parseUpvote, signal),
    replies: (article: string, root: string, cursor: Cursor | null, signal?: AbortSignal) => rpc('meddocs_comment_replies', { target_article: article, target_root: root, ...page(cursor) }, parsePublicPage, signal),
    mine: (article: string | undefined, cursor: Cursor | null, signal?: AbortSignal) => rpc('meddocs_comments_mine', { target_article: article, ...page(cursor) }, (value) => parsePage(value, parseOwnComment), signal),
    create: (article: string, body: string, requestId: string, reply: string | undefined, signal?: AbortSignal) => rpc('meddocs_comment_create', { target_article: article, body, request_id: requestId, reply_to: reply }, parseMutation, signal),
    edit: (id: string, body: string, version: number, requestId: string, signal?: AbortSignal) => rpc('meddocs_comment_edit', { target_comment: id, body, expected_version: version, request_id: requestId }, parseMutation, signal),
    withdraw: (id: string, version: number, signal?: AbortSignal) => rpc('meddocs_comment_withdraw', { target_comment: id, expected_version: version }, parseMutation, signal),
    queue: (mode: 'pending' | 'published' | 'hidden', cursor: Cursor | null, signal?: AbortSignal) => rpc('meddocs_comment_queue', { mode, ...page(cursor) }, (value) => parsePage(value, parseOwnComment), signal),
    decide: (id: string, decision: 'approve' | 'reject', version: number, reason: Reason, signal?: AbortSignal) => rpc('meddocs_comment_decide', { target_revision: id, decision, expected_version: version, reason }, parseMutation, signal),
    visibility: (id: string, action: 'hide' | 'restore', version: number, reason: Reason, signal?: AbortSignal) => rpc('meddocs_comment_visibility', { target_comment: id, action, expected_version: version, reason }, parseMutation, signal),
    redact: (id: string, version: number, signal?: AbortSignal) => rpc('meddocs_comment_redact', { target_revision: id, expected_version: version, reason: 'sensitive_data' }, parseMutation, signal),
    audit: (id: string, cursor: Cursor | null, signal?: AbortSignal) => rpc('meddocs_comment_audit', { target_comment: id, ...page(cursor) }, (value) => parsePage(value, parseAudit), signal),
  };
}
export type CommentsApi = ReturnType<typeof createCommentsApi>;
