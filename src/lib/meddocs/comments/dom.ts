import { avatarInitials } from '../../auth/avatar.ts';
import { roleLabel } from './validation.ts';
import { commentDate, privateStatus, type CommentView } from './presentation.ts';
import type { PublicComment } from './types.ts';

/** All content is text nodes; never parse HTML/Markdown from a comment. */
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
}
export function action(text: string, name: string, id = ''): HTMLButtonElement {
  const button = node('button', text, 'comments-action'); button.type = 'button'; button.dataset.action = name;
  if (id) button.dataset.id = id; return button;
}
/** Full date remains useful in moderation; public entries use compact absolute dates. */
export function stamp(value: string, prefix = ''): HTMLElement {
  const span = node('span', prefix); const time = node('time', new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)));
  time.dateTime = value; span.append(time); return span;
}
export function avatar(name: string | null, template: HTMLTemplateElement): HTMLElement {
  const element = node('span', '', 'comment-avatar'); element.setAttribute('aria-hidden', 'true');
  const initials = name && !['Nutzerkonto', 'Beitrag entfernt', 'Gelöschter Account'].includes(name) ? avatarInitials(name) : '';
  if (initials) element.textContent = initials; else element.append(template.content.cloneNode(true));
  return element;
}
export interface EntryOptions {
  template: HTMLTemplateElement; articleAuthors: readonly string[]; writable: boolean; busy: boolean;
  ownRole: PublicComment['role']; ownAuthorSlug: string | null;
  voteIcon: HTMLTemplateElement; voteBusy: boolean; signedIn: boolean; voteReady: boolean; voteAvailable: boolean;
}
export function commentEntry(view: CommentView, options: EntryOptions): HTMLLIElement {
  const published = view.publicComment; const own = view.ownComment; const source = published ?? own;
  const item = node('li', '', 'comment-entry'); item.dataset.commentId = view.id;
  if (!source) return item;
  if (own) item.dataset.ownId = own.id;
  if (!published) item.dataset.private = 'true';
  const article = node('article', '', 'comment-row');
  article.append(avatar(source.visibility === 'withdrawn' ? null : source.display_name, options.template));
  const content = node('div', '', 'comment-content'); const header = node('div', '', 'comment-byline');
  header.append(node('strong', source.display_name, 'comment-name'));
  const role = published ? published.role : options.ownRole;
  if (role && source.visibility !== 'withdrawn') {
    const badge = node('span', role === 'admin' ? 'Admin' : 'Autor', 'comment-badge');
    badge.title = roleLabel({ role, author_slug: published?.author_slug ?? options.ownAuthorSlug }, options.articleAuthors); header.append(badge);
  }
  const time = node('time', commentDate(source.created_at), 'comments-meta'); time.dateTime = source.created_at;
  time.title = new Intl.DateTimeFormat('de-CH', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(source.created_at)); header.append(time);
  if (published?.edited_at) {
    const edited = node('time', 'bearbeitet', 'comments-meta'); edited.dateTime = published.edited_at;
    edited.title = `Bearbeitet: ${new Intl.DateTimeFormat('de-CH', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(published.edited_at))}`;
    edited.setAttribute('aria-label', edited.title); header.append(edited);
  }
  if (own && privateStatus(own)) {
    const pending = own.status === 'pending' && own.visibility === 'active';
    const status = node('span', privateStatus(own), pending ? 'comment-state comment-pending' : 'comment-state');
    status.title = 'Nur für dich und die Moderation sichtbar'; header.append(status);
  }
  content.append(header);
  if (published?.professional_role) content.append(node('p', `${published.professional_role} · Selbstangabe, nicht überprüft`, 'comments-meta comment-profession'));
  content.append(node('p', (published ? published.body : own?.published_body ?? own?.body) ?? 'Dieser Beitrag wurde entfernt.', 'comment-body'));
  if (own?.published_body && own.body && own.status !== 'approved') {
    const draft = node('details', '', 'comment-draft');
    draft.append(node('summary', own.status === 'rejected' ? 'Abgelehnte Änderung ansehen' : 'Meinen Entwurf ansehen'), node('p', own.body, 'comment-body'));
    if (own.reason_code) draft.append(node('p', reasonLabel(own.reason_code), 'comments-meta')); content.append(draft);
  } else if (own?.reason_code) content.append(node('p', reasonLabel(own.reason_code), 'comments-meta'));
  const actions = node('div', '', 'comment-actions');
  if (published?.body && published.visibility === 'active') {
    const vote = action('', 'upvote', view.id); vote.classList.add('comment-upvote');
    vote.setAttribute('aria-pressed', String(published.has_upvoted));
    const label = !options.voteAvailable ? 'Bewertungen hier derzeit nicht möglich'
      : options.signedIn && !published.can_upvote ? 'Dieser Beitrag kann nicht bewertet werden (z. B. eigener Kommentar)'
      : !options.signedIn ? 'Zum Bewerten anmelden' : published.has_upvoted ? 'Eigene Bewertung entfernen' : 'Als hilfreich bewerten';
    vote.setAttribute('aria-label', `${label} (${published.upvote_count} ${published.upvote_count === 1 ? 'Stimme' : 'Stimmen'})`);
    vote.title = options.signedIn && !published.can_upvote ? 'Dieser Beitrag kann nicht bewertet werden (z. B. eigener Kommentar).' : label;
    vote.disabled = !options.voteAvailable || options.voteBusy || (options.signedIn && (!options.voteReady || !published.can_upvote));
    vote.setAttribute('aria-busy', String(options.voteBusy));
    vote.append(options.voteIcon.content.cloneNode(true), node('span', String(published.upvote_count), 'comment-upvote-count'));
    actions.append(vote);
  }
  if (published?.body && published.visibility === 'active' && options.writable) {
    const reply = action('Antworten', 'reply', view.id); reply.disabled = options.busy; actions.append(reply);
  }
  if (own && own.visibility !== 'withdrawn') {
    if (own.visibility === 'active') { const edit = action('Bearbeiten', 'edit', view.id); edit.disabled = !options.writable || options.busy; actions.append(edit); }
    const withdraw = action('Zurückziehen', 'withdraw', view.id); withdraw.disabled = options.busy; actions.append(withdraw);
  }
  if (published && !published.parent_id && published.reply_count) {
    const replies = action(`${published.reply_count} ${published.reply_count === 1 ? 'Antwort' : 'Antworten'}`, 'replies', view.id);
    replies.setAttribute('aria-expanded', 'false'); actions.append(replies);
  }
  content.append(actions); const slot = node('div', '', 'comment-editor-slot'); slot.dataset.editorFor = view.id; content.append(slot);
  article.append(content); item.append(article); return item;
}
export function reasonLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = { spam: 'Spam', off_topic: 'Nicht zum Thema', sensitive_data: 'Vertrauliche / persönliche Daten', other: 'Sonstiges' };
  return Object.hasOwn(labels, value) ? labels[value] : value;
}
