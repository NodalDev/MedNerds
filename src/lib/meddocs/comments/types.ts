/** Local Phase-3B RPC contract, NOT generated database types. Regenerate after staging. */
import type { Database, Json } from '../../auth/database.types.ts';

export type CommentSort = 'newest' | 'oldest' | 'helpful';
export interface Cursor { at: string; id: string; order?: CommentSort; votes?: number }
export interface UpvoteResult { id: string; upvote_count: number; has_upvoted: boolean }
export type CommentStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'withdrawn';
export type Visibility = 'active' | 'hidden' | 'withdrawn';
export type Reason = 'spam' | 'off_topic' | 'sensitive_data' | 'other';
export interface PublicComment {
  id: string; article_id: string; parent_id: string | null; reply_to_id: string | null;
  body: string | null; visibility: Visibility; display_name: string;
  role: 'admin' | 'author' | null; author_slug: string | null; professional_role: string | null;
  created_at: string; edited_at: string | null; version: number; reply_count: number;
  first_published_at: string; upvote_count: number; has_upvoted: boolean; can_upvote: boolean;
}
export interface OwnComment {
  id: string; article_id: string; parent_id: string | null; reply_to_id: string | null;
  version: number; visibility: Visibility; created_at: string; edited_at: string | null;
  canonical_path: string; article_state: 'published' | 'archived' | 'unpublished';
  published_body: string | null; revision_id: string | null; body: string | null;
  status: CommentStatus; reason_code: Reason | null; display_name: string;
}
export interface AuditItem {
  kind: 'revision' | 'event'; id: string; created_at: string; actor_id: string | null; reason_code: Reason | null;
  number?: number; body?: string | null; status?: CommentStatus; decided_at?: string | null;
  redacted_at?: string | null; action?: 'approve' | 'reject' | 'hide' | 'restore' | 'redact'; revision_id?: string | null;
}
export interface Page<T> { items: T[]; next_cursor: Cursor | null }
export interface PublicPage extends Page<PublicComment> { article: { state: 'published' | 'archived'; can_write: boolean } }
export interface MutationResult { id: string; version: number; status: CommentStatus | Visibility }

type Paged = { cursor?: Json; page_size?: number };
type Rpc<Args> = { Args: Args; Returns: Json };
export type CommentsRpcFunctions = {
  meddocs_comments_list: Rpc<Paged & { target_article: string; sort_order?: CommentSort }>;
  meddocs_comment_upvote: Rpc<{ target_comment: string; voted: boolean }>;
  meddocs_comment_replies: Rpc<Paged & { target_article: string; target_root: string }>;
  meddocs_comments_mine: Rpc<Paged & { target_article?: string }>;
  meddocs_comment_create: Rpc<{ target_article: string; body: string; request_id: string; reply_to?: string }>;
  meddocs_comment_edit: Rpc<{ target_comment: string; body: string; expected_version: number; request_id: string }>;
  meddocs_comment_withdraw: Rpc<{ target_comment: string; expected_version: number }>;
  meddocs_comment_queue: Rpc<Paged & { mode?: 'pending' | 'published' | 'hidden' }>;
  meddocs_comment_decide: Rpc<{ target_revision: string; decision: 'approve' | 'reject'; expected_version: number; reason?: Reason }>;
  meddocs_comment_visibility: Rpc<{ target_comment: string; action: 'hide' | 'restore'; expected_version: number; reason?: Reason }>;
  meddocs_comment_redact: Rpc<{ target_revision: string; expected_version: number; reason?: Reason }>;
  meddocs_comment_audit: Rpc<Paged & { target_comment: string }>;
};
/** Add ONLY the pending RPC contract to the central browser client's generated schema. */
export type BrowserDatabase = Database & { public: { Functions: CommentsRpcFunctions } };
