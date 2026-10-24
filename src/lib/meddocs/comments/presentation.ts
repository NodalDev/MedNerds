import type { OwnComment, PublicComment } from './types.ts';

export interface CommentView { id: string; publicComment?: PublicComment; ownComment?: OwnComment }
function order(a: CommentView, b: CommentView): number {
  const left = a.publicComment ?? a.ownComment;
  const right = b.publicComment ?? b.ownComment;
  return (left?.created_at ?? '').localeCompare(right?.created_at ?? '') || a.id.localeCompare(b.id);
}
/** Merge for THIS authenticated reader only; public state/counts never receive private rows. */
export function mergeCommentViews(published: readonly PublicComment[], own: readonly OwnComment[], preservePublicOrder = false): CommentView[] {
  const views = new Map<string, CommentView>(published.map((comment) => [comment.id, { id: comment.id, publicComment: comment }]));
  for (const comment of own) {
    const existing = views.get(comment.id);
    if (existing) existing.ownComment = comment;
    else if (comment.visibility !== 'withdrawn' && (comment.status !== 'approved' || comment.visibility === 'hidden')) {
      views.set(comment.id, { id: comment.id, ownComment: comment });
    }
  }
  // Public roots arrive globally sorted/paginated by the RPC; private rows follow.
  return preservePublicOrder ? [...views.values()] : [...views.values()].sort(order);
}
export function privateStatus(comment: OwnComment): string {
  if (comment.visibility === 'hidden') return 'Ausgeblendet';
  if (comment.visibility === 'withdrawn') return 'Zurückgezogen';
  if (comment.status === 'pending') return comment.published_body ? 'Änderung wird geprüft' : 'Wartet auf Freigabe';
  if (comment.status === 'rejected') return comment.published_body ? 'Änderung abgelehnt' : 'Abgelehnt';
  return '';
}
/** Own new submissions only; pending edits still have a public body and their own status. */
export function pendingCommentSummary(own: readonly OwnComment[], pagesComplete: boolean): string {
  const count = own.filter(comment => comment.status === 'pending' && comment.visibility === 'active'
    && comment.published_body === null && comment.body !== null).length;
  if (!count) return '';
  return `${pagesComplete ? '' : 'Mindestens '}${count} ${count === 1 ? 'Beitrag wartet' : 'Beiträge warten'} auf Freigabe.`;
}
/** Existing RPC has no total. Count only when every public page/thread is exhausted. */
export function exactPublicCount(roots: readonly PublicComment[], rootPagesComplete: boolean,
  replies: ReadonlyMap<string, { items: readonly PublicComment[]; complete: boolean }>): number | null {
  if (!rootPagesComplete) return null;
  let count = 0;
  for (const root of roots) {
    if (root.visibility === 'active' && root.body !== null) count++;
    if (!root.reply_count) continue;
    const thread = replies.get(root.id);
    if (!thread?.complete || thread.items.length !== root.reply_count) return null;
    count += thread.items.filter((reply) => reply.visibility === 'active' && reply.body !== null).length;
  }
  return count;
}
const date = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short', year: 'numeric' });
export function commentDate(value: string): string { return date.format(new Date(value)); }
