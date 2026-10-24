import { getSupabaseBrowserClient } from '../../auth/supabase-client.ts';
import { CommentsAccountContext } from './account-context.ts';
import { createCommentsApi, commentError, type CommentsApi } from './api.ts';
import { action, node, reasonLabel, stamp } from './dom.ts';
import { statusLabel } from './validation.ts';
import type { Cursor, OwnComment, Reason } from './types.ts';

type Decision = { comment: OwnComment; operation: 'approve' | 'reject' | 'hide' | 'restore' | 'redact'; revision?: string; reason: Reason };
class ModerationElement extends HTMLElement {
  private api?: CommentsApi;
  private account?: CommentsAccountContext;
  private events?: AbortController;
  private requests = new Set<AbortController>();
  private generation = 0;
  private sequence = 0;
  private adminKey = '';
  private comments = new Map<string, OwnComment>();
  private cursor: Cursor | null = null;
  private busy = false;
  private loading = false;
  private decision?: Decision;
  private returnFocus?: HTMLElement;
  private control<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.querySelector<T>(selector); if (!element) throw new Error(`Missing moderation control: ${selector}`); return element;
  }
  connectedCallback(): void {
    if (this.events) return;
    this.events = new AbortController(); const client = getSupabaseBrowserClient();
    if (!client) { this.control('[data-gate]').textContent = 'Die Moderation ist derzeit nicht verfügbar.'; return; }
    this.api = createCommentsApi(client);
    this.addEventListener('click', (event) => { const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action]') : null;
      if (button && this.contains(button) && !button.disabled) void this.handle(button); }, { signal: this.events.signal });
    this.control('select').addEventListener('change', () => void this.load(), { signal: this.events.signal });
    this.control<HTMLDialogElement>('dialog').addEventListener('cancel', (event) => { if (this.busy) event.preventDefault(); else this.closeDialog(); }, { signal: this.events.signal });
    this.account = new CommentsAccountContext(this, () => queueMicrotask(() => { if (this.isConnected) this.accountChanged(); }));
    this.accountChanged();
  }
  private accountChanged(): void {
    const key = this.account?.isAdmin ? this.account.userId ?? '' : '';
    if (key !== this.adminKey) {
      this.adminKey = key; this.generation++; this.sequence++; this.requests.forEach((r) => r.abort()); this.requests.clear();
      this.comments.clear(); this.cursor = null; this.busy = false; this.loading = false; this.decision = undefined;
      this.control('[data-queue]').replaceChildren(); this.closeDialog(); this.setError(''); this.control('[data-action-status]').textContent = '';
      if (key) void this.load();
    }
    const gate = this.control('[data-gate]'); gate.replaceChildren(); this.control('[data-admin-panel]').hidden = !key;
    if (!this.account?.userId) { gate.append(node('span', 'Melde dich mit einem Administrationsaccount an. ')); const link = node('a', 'Zum Account'); link.href = '/account/'; gate.append(link); }
    else if (!key) gate.textContent = this.account.profiles?.state.staffStatus === 'loading' ? 'Administrationsrechte werden geprüft …' : 'Du hast keine Administrationsrechte für die Kommentarmoderation.';
    else if (this.account.access !== 'ready') { gate.append(node('span', 'Vor Moderationsentscheidungen vervollständige dein Profil und die aktuellen rechtlichen Bestätigungen. ')); const link = node('a', 'Zum Account'); link.href = '/account/'; gate.append(link); }
    this.setBusy();
  }
  private setError(error: unknown): void {
    const element = this.control('[data-error]'); element.textContent = typeof error === 'string' ? error : commentError(error).message; element.hidden = !element.textContent;
    if (typeof error !== 'string') void this.account?.refreshAfterRejection(commentError(error).code);
  }
  private setBusy(): void {
    for (const button of this.querySelectorAll<HTMLButtonElement>('button')) {
      const operation = ['approve', 'reject', 'hide', 'restore', 'redact', 'confirm'].includes(button.dataset.action ?? '');
      button.disabled = this.busy || (operation && this.account?.access !== 'ready') || (this.loading && ['more', 'refresh'].includes(button.dataset.action ?? ''));
    }
    for (const select of this.querySelectorAll<HTMLSelectElement>('select')) select.disabled = this.busy || this.loading;
    this.control('[data-admin-panel]').setAttribute('aria-busy', String(this.busy || this.loading));
  }
  private mode(): 'pending' | 'published' | 'hidden' {
    const value = this.control<HTMLSelectElement>('#moderation-mode').value; return value === 'published' || value === 'hidden' ? value : 'pending';
  }
  private async load(more = false): Promise<void> {
    if (!this.api || !this.adminKey || this.busy || this.loading) return;
    this.loading = true; const generation = this.generation; const sequence = ++this.sequence;
    const request = new AbortController(); this.requests.add(request); this.setBusy(); this.control('[data-list-status]').textContent = 'Beiträge werden geladen …';
    try {
      const page = await this.api.queue(this.mode(), more ? this.cursor : null, request.signal);
      if (generation !== this.generation || sequence !== this.sequence || request.signal.aborted) return;
      if (!more) { this.comments.clear(); this.control('[data-queue]').replaceChildren(); }
      this.cursor = page.next_cursor; for (const comment of page.items) { this.comments.set(comment.id, comment); this.control('[data-queue]').append(this.card(comment)); }
      this.control('[data-list-status]').textContent = this.comments.size ? '' : 'Keine Beiträge in dieser Ansicht.';
      this.control('[data-action="more"]').hidden = !this.cursor; this.setError('');
    } catch (error) { if (generation === this.generation && !request.signal.aborted) { this.setError(error); this.control('[data-list-status]').textContent = ''; } }
    finally { this.requests.delete(request); if (generation === this.generation && sequence === this.sequence) { this.loading = false; this.setBusy(); } }
  }
  private card(comment: OwnComment): HTMLElement {
    const item = node('li', '', 'comment-card comment-private'); item.dataset.moderationId = comment.id;
    const link = node('a', comment.canonical_path); link.href = comment.canonical_path; item.append(link);
    item.append(node('p', `${comment.display_name} · ${statusLabel(comment, 'admin')}`, 'comments-meta'), stamp(comment.created_at));
    const comparison = node('div', '', 'comment-comparison');
    for (const [title, body] of [['Veröffentlichte Fassung', comment.published_body], ['Eingereichte Fassung', comment.body]]) {
      const block = node('div'); block.append(node('h4', title ?? ''), node('p', body ?? 'Keine Fassung vorhanden.')); comparison.append(block);
    }
    item.append(comparison); const buttons = node('div', '', 'comment-actions');
    if (comment.status === 'pending' && comment.visibility === 'active') buttons.append(action('Freigeben', 'approve', comment.id), action('Ablehnen', 'reject', comment.id));
    if (comment.visibility === 'active' && comment.published_body) buttons.append(action('Ausblenden', 'hide', comment.id));
    if (comment.visibility === 'hidden' && comment.published_body) buttons.append(action('Wieder anzeigen', 'restore', comment.id));
    const history = action('Revisionen und Moderationshistorie', 'audit', comment.id); history.setAttribute('aria-expanded', 'false'); buttons.append(history); item.append(buttons);
    return item;
  }
  private async audit(id: string, button: HTMLButtonElement, cursor: Cursor | null = null): Promise<void> {
    if (!this.api || !this.adminKey) return;
    const card = button.closest('[data-moderation-id]'); if (!card) return;
    const prior = card.querySelector<HTMLElement>('[data-history]');
    if (prior && !cursor) { prior.hidden = !prior.hidden; button.setAttribute('aria-expanded', String(!prior.hidden)); return; }
    const generation = this.generation; const request = new AbortController(); this.requests.add(request); button.disabled = true;
    try {
      const page = await this.api.audit(id, cursor, request.signal); if (generation !== this.generation || request.signal.aborted || !card.isConnected) return;
      const history = prior ?? node('div'); history.dataset.history = 'true';
      if (!prior) { history.append(node('h4', 'Private Historie')); card.append(history); }
      for (const item of page.items) {
        const record = node('div', '', 'comment-card'); record.append(stamp(item.created_at));
        if (item.kind === 'revision') {
          record.append(node('p', `Revision ${item.number} · ${item.status}`, 'comments-meta'), node('p', item.body ?? 'Text entfernt', 'comment-body'));
          if (item.body) { const redact = action('Diesen Revisionstext entfernen', 'redact', id); redact.dataset.revision = item.id; record.append(redact); }
        } else record.append(node('p', `Entscheidung: ${item.action}${item.reason_code ? ` · ${reasonLabel(item.reason_code)}` : ''}`, 'comments-meta'));
        if (item.actor_id) record.append(node('p', `Moderator-ID: ${item.actor_id}`, 'comments-meta')); history.append(record);
      }
      history.querySelector('[data-action="audit-more"]')?.remove();
      if (page.next_cursor) { const next = action('Weitere Historie laden', 'audit-more', id); next.dataset.cursor = JSON.stringify(page.next_cursor); history.append(next); }
      button.setAttribute('aria-expanded', 'true'); this.setBusy();
    } catch (error) { if (generation === this.generation && !request.signal.aborted) this.setError(error); }
    finally { this.requests.delete(request); button.disabled = false; }
  }
  private closeDialog(): void { this.control<HTMLDialogElement>('dialog').close(); this.decision = undefined; if (this.returnFocus?.isConnected) this.returnFocus.focus(); this.returnFocus = undefined; }
  private async confirm(): Promise<void> {
    const decision = this.decision; if (!decision || !this.api || this.busy || this.account?.access !== 'ready' || !this.account.isAdmin) return;
    this.busy = true; this.setBusy(); this.setError(''); const generation = this.generation; const request = new AbortController(); this.requests.add(request);
    this.control('[data-action-status]').textContent = '';
    const { comment, operation, reason } = decision;
    try {
      if (operation === 'approve' || operation === 'reject') {
        if (!comment.revision_id) return; await this.api.decide(comment.revision_id, operation, comment.version, reason, request.signal);
      } else if (operation === 'redact') {
        if (!decision.revision) return; await this.api.redact(decision.revision, comment.version, request.signal);
      } else await this.api.visibility(comment.id, operation, comment.version, reason, request.signal);
      if (generation !== this.generation || request.signal.aborted) return;
      this.closeDialog(); this.control('[data-action-status]').textContent = 'Die Moderationsentscheidung wurde gespeichert.';
      this.busy = false; await this.load(); this.control('[data-action-status]').tabIndex = -1; this.control('[data-action-status]').focus();
    } catch (error) { if (generation === this.generation && !request.signal.aborted) { this.closeDialog(); this.setError(error); } }
    finally { this.requests.delete(request); if (generation === this.generation) { this.busy = false; this.setBusy(); } }
  }
  private async handle(button: HTMLButtonElement): Promise<void> {
    const id = button.dataset.id ?? ''; const operation = button.dataset.action;
    if (operation === 'refresh') { await this.load(); return; }
    if (operation === 'more') { await this.load(true); return; }
    if (operation === 'audit') { await this.audit(id, button); return; }
    if (operation === 'audit-more') { await this.audit(id, button, JSON.parse(button.dataset.cursor ?? 'null')); return; }
    if (operation === 'cancel') { if (!this.busy) this.closeDialog(); return; }
    if (operation === 'confirm') { await this.confirm(); return; }
    const comment = this.comments.get(id);
    if (!comment || !operation || !['approve', 'reject', 'hide', 'restore', 'redact'].includes(operation) || this.account?.access !== 'ready') return;
    const reason = this.control<HTMLSelectElement>('#moderation-reason').value as Reason;
    this.decision = { comment, operation: operation as Decision['operation'], revision: button.dataset.revision, reason }; this.returnFocus = button;
    this.control('#moderation-confirm-description').textContent = `${button.textContent}? Diese Entscheidung betrifft den ausgewählten Beitrag in ${comment.canonical_path}.${operation === 'redact' ? ' Der Text wird dauerhaft aus dieser Revision entfernt.' : ''}`;
    this.control<HTMLDialogElement>('dialog').showModal();
    this.control('[data-action="cancel"]').focus({ preventScroll: true });
  }
  disconnectedCallback(): void {
    this.generation++; this.sequence++; this.events?.abort(); this.events = undefined; this.requests.forEach((r) => r.abort()); this.requests.clear();
    this.account?.dispose(); this.account = undefined; this.comments.clear(); this.control('[data-queue]').replaceChildren(); this.closeDialog();
    this.adminKey = ''; this.loading = false; this.busy = false; this.cursor = null;
  }
}
export function registerModerationElement(): void { if (!customElements.get('meddocs-moderation')) customElements.define('meddocs-moderation', ModerationElement); }
