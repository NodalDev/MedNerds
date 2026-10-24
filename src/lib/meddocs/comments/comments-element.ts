import { getSupabaseBrowserClient } from '../../auth/supabase-client.ts';
import { CommentsAccountContext } from './account-context.ts';
import { createCommentsApi, commentError, type CommentError, type CommentsApi } from './api.ts';
import { action, avatar, commentEntry, node } from './dom.ts';
import { validateCommentBody } from './validation.ts';
import { exactPublicCount, mergeCommentViews, pendingCommentSummary, type CommentView } from './presentation.ts';
import type { CommentSort, Cursor, OwnComment, PublicComment } from './types.ts';
import { createAccountSetupHref } from '../../auth/account-access.ts';
import { COMMENT_DRAFT_TTL, readCommentDraft, saveCommentDraft, removeCommentDraft, type CommentDraft } from './draft.ts';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
interface Thread { items: PublicComment[]; cursor: Cursor | null; complete: boolean; status: LoadState; error: CommentError | null }
type Editor = { kind: 'new' } | { kind: 'reply'; id: string } | { kind: 'edit'; comment: Pick<OwnComment, 'id' | 'version' | 'body' | 'published_body'> };

class CommentsElement extends HTMLElement {
  static get observedAttributes(): string[] { return ['data-article-id']; }
  private api?: CommentsApi;
  private account?: CommentsAccountContext;
  private events?: AbortController;
  private publicRequest?: AbortController;
  private privateRequest?: AbortController;
  private mutationRequest?: AbortController;
  private voteRequests = new Map<string, AbortController>();
  private sort: CommentSort = 'newest';
  private replyRequests = new Map<string, AbortController>();
  private generation = 0;
  private publicSequence = 0;
  private replySequence = 0;
  private userId: string | null | undefined;
  private published: PublicComment[] = [];
  private own = new Map<string, OwnComment>();
  private threads = new Map<string, Thread>();
  private expanded = new Set<string>();
  private cursor: Cursor | null = null;
  private ownCursor: Cursor | null = null;
  private publicState: LoadState = 'idle';
  private privateState: LoadState = 'idle';
  private publicError: CommentError | null = null;
  private privateError: CommentError | null = null;
  private hasPublicData = false;
  private writable = false;
  private busy = false;
  private sessionExpired = false;
  private editor: Editor | null = null;
  private form?: HTMLFormElement;
  private requestKey = '';
  private requestId = '';
  private withdrawal?: OwnComment;
  private returnFocus?: HTMLElement;
  private actionStatusTimer?: ReturnType<typeof setTimeout>;
  private draftOwner: string | null = null;
  private pendingDraft: CommentDraft | null = null;
  private draftChecked = false;
  private draftExpiresAt?: number;
  private authReturnFocus?: HTMLElement;
  private control<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.querySelector<T>(selector); if (!element) throw new Error(`Missing comments control: ${selector}`); return element;
  }
  private get article(): string { return this.dataset.articleId ?? ''; }
  private get body(): HTMLTextAreaElement { return this.control('#comment-body'); }
  connectedCallback(): void {
    if (this.events) return;
    this.events = new AbortController(); this.form = this.control('[data-composer]');
    this.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action]') : null;
      if (button && this.contains(button) && !button.disabled) void this.handleAction(button);
    }, { signal: this.events.signal });
    this.form.addEventListener('submit', (event) => { event.preventDefault(); void this.submit(); }, { signal: this.events.signal });
    this.body.addEventListener('input', () => { this.body.removeAttribute('aria-invalid'); this.resizeEditor(); this.updateHandoffDraft(); }, { signal: this.events.signal });
    this.control<HTMLSelectElement>('[data-sort]').addEventListener('change', () => {
      const value = this.control<HTMLSelectElement>('[data-sort]').value;
      if (value !== 'newest' && value !== 'oldest' && value !== 'helpful') return;
      this.sort = value; this.restartPublic(); void this.loadOwn();
    }, { signal: this.events.signal });
    this.control<HTMLDialogElement>('[data-withdraw-dialog]').addEventListener('cancel', (event) => { if (this.busy) event.preventDefault(); else this.closeWithdrawal(); }, { signal: this.events.signal });
    this.control<HTMLDialogElement>('[data-auth-dialog]').addEventListener('cancel', () => this.closeAuth(), { signal: this.events.signal });
    for (const link of this.querySelectorAll<HTMLAnchorElement>('[data-comment-login],[data-comment-register]')) {
      link.addEventListener('click', (event) => {
        if (!this.persistDraft()) { event.preventDefault(); this.control('[data-auth-error]').textContent = 'Dein Browser konnte den Entwurf nicht sichern. Bleibe bei deinem Kommentar und erlaube Sitzungsspeicher, bevor du zur Anmeldung wechselst.'; this.control('[data-auth-error]').hidden = false; }
      }, { signal: this.events.signal });
    }
    const client = getSupabaseBrowserClient();
    if (!client) { this.publicState = 'error'; this.publicError = commentError({ code: 'PGRST202' }); this.renderStatus(); return; }
    this.api = createCommentsApi(client);
    this.account = new CommentsAccountContext(this, () => queueMicrotask(() => { if (this.isConnected && this.events) this.accountChanged(); }));
    this.accountChanged(); void this.loadPublic();
  }
  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.events || oldValue === newValue) return;
    this.resetArticle(); void this.loadPublic(); if (this.userId) void this.loadOwn();
  }
  private accountChanged(): void {
    const user = this.account?.userId ?? null;
    if (user !== this.userId) {
      const draft = this.currentDraft(); const previous = this.userId;
      const keepEditor = Boolean(draft && (draft.owner === user || (draft.owner === null && previous === null)
        || (!user && this.sessionExpired)));
      if (draft && !keepEditor) this.pendingDraft = draft;
      this.generation++; this.privateRequest?.abort(); this.mutationRequest?.abort();
      this.voteRequests.forEach((request) => request.abort()); this.voteRequests.clear();
      this.userId = user; this.own.clear(); this.ownCursor = null; this.privateState = 'idle'; this.privateError = null;
      if (user) this.sessionExpired = false;
      this.busy = false;
      if (keepEditor) this.draftOwner = draft?.owner ?? user;
      else this.resetEditor();
      if (keepEditor) this.updateHandoffDraft();
      this.closeAuth(); this.closeWithdrawal(); this.control('[data-action-status]').textContent = '';
      this.control('[data-vote-error]').hidden = true;
      // Personal vote state must be fetched anew after login/logout/session changes.
      this.published = []; this.threads.clear(); this.hasPublicData = false;
      this.restartPublic(); if (user) void this.loadOwn();
    }
    this.restoreDraft(); this.renderList();
  }
  /** Public loading, account gates, private reads and writes never share an error box. */
  private renderStatus(): void {
    const ready = this.hasPublicData && this.publicState !== 'error';
    this.dataset.publicState = this.publicState; this.dataset.publicCause = this.publicError?.code ?? '';
    this.dataset.privateState = this.privateState; this.dataset.privateCause = this.privateError?.code ?? '';
    this.control('[data-public-list]').hidden = !this.hasPublicData;
    this.control('[data-personal]').hidden = !ready || !this.userId || !this.control('[data-personal-list]').children.length;
    const status = this.control('[data-list-status]');
    status.textContent = this.publicState === 'error' ? 'Kommentare sind momentan nicht verfügbar.'
      : !this.hasPublicData && this.publicState === 'loading' ? 'Kommentare werden geladen …'
      : ready && !this.published.length && !this.own.size ? 'Noch keine Kommentare. Starte die Diskussion.' : '';
    this.control('[data-public-retry]').hidden = this.publicState !== 'error' && this.publicState !== 'idle';
    const retry = this.control<HTMLButtonElement>('[data-action="load"]'); retry.textContent = this.publicState === 'error' ? 'Erneut versuchen' : 'Kommentare laden'; retry.disabled = this.publicState === 'loading';
    this.control('[data-order]').hidden = !ready; this.control('[data-composer-home]').hidden = !ready;
    const more = this.control<HTMLButtonElement>('[data-action="more"]'); more.hidden = !ready || !this.cursor; more.disabled = this.publicState === 'loading';
    this.control('.comments-shell').setAttribute('aria-busy', String(this.publicState === 'loading'));
    const count = ready ? exactPublicCount(this.published, this.cursor === null, this.threads) : null;
    this.control('[data-count]').hidden = count === null; this.control('[data-count]').textContent = count === null ? '' : `(${count})`;
    const pending = ready && this.userId && this.privateState === 'ready'
      ? pendingCommentSummary([...this.own.values()], this.ownCursor === null) : '';
    this.control('[data-pending-summary]').textContent = pending;
    this.control('[data-pending-summary]').hidden = !pending;
    this.renderGate(ready);
    const privateFailure = ready && Boolean(this.userId) && this.privateState === 'error';
    this.control('[data-private-status]').hidden = !privateFailure;
    this.control('[data-own-status]').textContent = privateFailure ? 'Deine privaten Kommentarstände konnten nicht geladen werden.' : '';
    const ownRetry = this.control<HTMLButtonElement>('[data-action="retry-mine"]'); ownRetry.hidden = !privateFailure; ownRetry.disabled = this.privateState === 'loading';
    const ownMore = this.control<HTMLButtonElement>('[data-action="more-mine"]'); ownMore.hidden = !ready || !this.userId || !this.ownCursor; ownMore.disabled = this.busy || this.privateState === 'loading';
    this.control<HTMLButtonElement>('[data-action="confirm-withdraw"]').disabled = this.busy; this.control<HTMLButtonElement>('[data-action="cancel-withdraw"]').disabled = this.busy;
  }
  private renderGate(ready: boolean): void {
    const access = this.account?.access ?? 'authentication-required'; const gate = this.control('[data-gate]'); const trigger = this.control<HTMLButtonElement>('[data-action="compose"]');
    const available = ready && this.writable; gate.replaceChildren(); gate.hidden = true; trigger.disabled = this.busy || !available;
    if (available && access !== 'ready') {
      if (['authentication-required', 'profile-required', 'legal-required'].includes(access)) {
        const text = access === 'authentication-required' ? this.sessionExpired ? 'Deine Sitzung ist abgelaufen. Dein Kommentar bleibt erhalten.' : '' : access === 'profile-required' ? 'Vervollständige vor dem Einreichen dein Profil.' : 'Bestätige vor dem Einreichen die aktuellen rechtlichen Hinweise.';
        if (text) { gate.append(node('span', text)); gate.hidden = false; }
      } else {
        const failed = this.account?.profiles?.state.status === 'error' || this.account?.legal?.state.error;
        gate.append(node('span', failed ? 'Dein Accountstatus konnte nicht geprüft werden. ' : 'Accountstatus wird geprüft …'));
        if (failed) gate.append(action('Erneut versuchen', 'retry-account')); gate.hidden = false;
      }
    } else if (ready && !this.writable) { gate.textContent = 'Neue Beiträge sind hier derzeit nicht möglich.'; gate.hidden = false; }
    const name = this.account?.profiles?.state.profile?.display_name ?? null;
    this.control('[data-composer-avatar]').replaceChildren(avatar(name, this.control('template')));
    this.control('[data-prompt]').hidden = Boolean(this.editor && this.editor.kind === 'new' && available);
    trigger.setAttribute('aria-expanded', String(Boolean(this.editor && this.editor.kind === 'new')));
    if (this.form) {
      this.form.hidden = !this.editor || !ready; this.form.setAttribute('aria-busy', String(this.busy)); this.body.disabled = this.busy;
      this.control<HTMLButtonElement>('button[type="submit"]').disabled = this.busy || !available; this.control('button[type="submit"]').textContent = this.busy ? 'Wird gespeichert …' : this.editor?.kind === 'edit' ? 'Änderung senden' : 'Kommentar senden';
      this.control<HTMLButtonElement>('[data-action="cancel-edit"]').disabled = this.busy; this.control('[data-moderation-hint]').hidden = Boolean(this.account?.isAdmin && this.editor?.kind !== 'edit');
    }
  }
  private restartPublic(): Promise<void> {
    this.publicRequest?.abort(); this.publicSequence++; this.publicState = 'idle'; this.cursor = null;
    return this.loadPublic();
  }
  private async loadPublic(more = false): Promise<void> {
    if (!this.api || this.publicState === 'loading') return;
    const article = this.article; const sequence = ++this.publicSequence;
    if (!more) {
      this.replySequence++; this.replyRequests.forEach((r) => r.abort()); this.replyRequests.clear();
      for (const thread of this.threads.values()) if (thread.status === 'loading') thread.status = 'idle';
    }
    this.publicRequest?.abort(); const request = this.publicRequest = new AbortController(); this.publicState = 'loading'; this.publicError = null; this.renderStatus();
    try {
      const page = await this.api.list(article, more ? this.cursor : null, request.signal, this.sort);
      if (sequence !== this.publicSequence || article !== this.article || request.signal.aborted) return;
      if (!more) { this.published = []; this.replyRequests.forEach((r) => r.abort()); this.replyRequests.clear(); this.threads.clear(); }
      const rows = new Map(this.published.map((row) => [row.id, row])); page.items.forEach((row) => rows.set(row.id, row)); this.published = [...rows.values()];
      this.cursor = page.next_cursor; this.writable = page.article.can_write; this.hasPublicData = true; this.publicState = 'ready'; this.restoreDraft(); this.renderList();
      this.loadExpandedReplies(!more);
    } catch (error) { if (sequence === this.publicSequence && article === this.article && !request.signal.aborted) { this.publicState = 'error'; this.publicError = commentError(error); } }
    finally { if (sequence === this.publicSequence && article === this.article) this.renderStatus(); }
  }
  private async loadOwn(more = false): Promise<void> {
    if (!this.api || !this.userId) return;
    const generation = this.generation; const user = this.userId; const article = this.article;
    this.privateRequest?.abort(); const request = this.privateRequest = new AbortController(); this.privateState = 'loading'; this.privateError = null; this.renderStatus();
    try {
      const page = await this.api.mine(article, more ? this.ownCursor : null, request.signal);
      if (generation !== this.generation || article !== this.article || user !== this.userId || request.signal.aborted) return;
      const known = new Set(this.own.keys());
      if (!more) this.own.clear(); page.items.forEach((row) => { this.own.set(row.id, row); if (row.parent_id && row.status !== 'approved' && !known.has(row.id)) this.expanded.add(row.parent_id); });
      this.ownCursor = page.next_cursor; this.privateState = 'ready'; this.renderList(); this.loadExpandedReplies();
    } catch (error) {
      if (generation === this.generation && article === this.article && !request.signal.aborted) {
        this.privateState = 'error'; this.privateError = commentError(error);
        if (this.privateError.code === 'authentication_required') { this.sessionExpired = Boolean(this.userId); void this.account?.refreshAfterRejection(this.privateError.code); }
      }
    } finally { if (generation === this.generation && article === this.article && !request.signal.aborted) this.renderStatus(); }
  }
  private authorIds(): string[] {
    try { const values: unknown = JSON.parse(this.dataset.articleAuthors ?? '[]'); return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : []; } catch { return []; }
  }
  private entry(view: CommentView, rootActive = true): HTMLLIElement {
    const staff = this.account?.profiles?.state.staffStatus === 'ready' ? this.account.profiles.state.staff : null;
    return commentEntry(view, { template: this.control('template'), articleAuthors: this.authorIds(), writable: this.writable && rootActive, busy: this.busy, ownRole: staff?.role ?? null, ownAuthorSlug: staff?.author_slug ?? null,
      voteIcon: this.control('[data-comment-vote-icon]'), voteBusy: this.voteRequests.has(view.id), signedIn: Boolean(this.userId), voteReady: this.account?.access === 'ready' && this.publicState === 'ready', voteAvailable: this.writable && rootActive });
  }
  private renderList(): void {
    const focused = document.activeElement; const editorFocused = Boolean(this.form?.contains(focused));
    const focusedAction = focused instanceof HTMLButtonElement && focused.dataset.id ? { id: focused.dataset.id, action: focused.dataset.action } : null;
    this.placeFormInHome();
    const list = this.control('[data-public-list]'); const personal = this.control('[data-personal-list]'); list.replaceChildren(); personal.replaceChildren();
    const ownRows = [...this.own.values()]; const roots = mergeCommentViews(this.published, ownRows.filter((row) => row.parent_id === null), true); const visibleRoots = new Set<string>();
    for (const view of roots) {
      if (!view.publicComment && view.ownComment?.visibility === 'hidden') { personal.append(this.entry(view)); continue; }
      const item = this.entry(view); list.append(item); visibleRoots.add(view.id);
      const thread = this.threads.get(view.id); const privateReplies = ownRows.filter((row) => row.parent_id === view.id); const replies = mergeCommentViews(thread?.items ?? [], privateReplies, true);
      if (replies.length || this.expanded.has(view.id)) {
        const replyList = node('ul', '', 'comment-list comment-thread'); replyList.setAttribute('aria-label', 'Antworten'); replyList.hidden = !this.expanded.has(view.id);
        for (const reply of replies) replyList.append(this.entry(reply, view.publicComment?.visibility === 'active')); item.append(replyList);
        item.querySelector<HTMLButtonElement>('[data-action="replies"]')?.setAttribute('aria-expanded', String(!replyList.hidden));
        if (thread?.status === 'error') { const failure = node('li', '', 'comments-thread-status'); failure.append(node('p', 'Antworten sind momentan nicht verfügbar.', 'comments-hint'), action('Erneut versuchen', 'retry-replies', view.id)); replyList.append(failure); }
        else if (thread?.status === 'loading' && !thread.items.length) replyList.append(node('li', 'Antworten werden geladen …', 'comments-hint'));
        if (thread?.cursor) { const row = node('li'); const next = action('Weitere Antworten laden', 'more-replies', view.id); next.disabled = thread.status === 'loading'; row.append(next); replyList.append(row); }
      }
    }
    for (const own of ownRows) if (own.parent_id && !visibleRoots.has(own.parent_id) && own.visibility !== 'withdrawn' && (own.status !== 'approved' || own.visibility === 'hidden')) personal.append(this.entry({ id: own.id, ownComment: own }));
    this.control('[data-personal]').hidden = !personal.children.length || !this.userId; this.control('[data-personal-count]').textContent = personal.children.length ? `(${personal.children.length})` : '';
    this.placeEditor(); this.renderStatus();
    if (editorFocused && focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
    else if (focusedAction) this.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusedAction.id)}"][data-action="${CSS.escape(focusedAction.action ?? '')}"]`)?.focus({ preventScroll: true });
  }
  private loadExpandedReplies(refresh = false): void {
    for (const root of this.published) if (this.expanded.has(root.id) && root.reply_count && (refresh || !this.threads.has(root.id))) void this.loadReplies(root.id);
  }
  private async loadReplies(id: string, more = false): Promise<void> {
    if (!this.api || this.threads.get(id)?.status === 'loading') return;
    const generation = this.replySequence; const article = this.article; const old = this.threads.get(id); const request = new AbortController(); this.replyRequests.set(id, request);
    this.threads.set(id, { items: old?.items ?? [], cursor: old?.cursor ?? null, complete: old?.complete ?? false, status: 'loading', error: null }); this.expanded.add(id); this.renderList();
    try {
      const page = await this.api.replies(article, id, more ? old?.cursor ?? null : null, request.signal);
      if (generation !== this.replySequence || article !== this.article || request.signal.aborted) return;
      const rows = new Map((more ? old?.items ?? [] : []).map((row) => [row.id, row])); page.items.forEach((row) => rows.set(row.id, row)); this.threads.set(id, { items: [...rows.values()], cursor: page.next_cursor, complete: page.next_cursor === null, status: 'ready', error: null });
    } catch (error) { if (generation === this.replySequence && article === this.article && !request.signal.aborted) this.threads.set(id, { items: old?.items ?? [], cursor: old?.cursor ?? null, complete: false, status: 'error', error: commentError(error) }); }
    finally { if (this.replyRequests.get(id) === request) this.replyRequests.delete(id); if (generation === this.replySequence && article === this.article && !request.signal.aborted) this.renderList(); }
  }
  private locate(id: string): PublicComment | undefined { return this.published.find((row) => row.id === id) ?? [...this.threads.values()].flatMap((thread) => thread.items).find((row) => row.id === id); }
  private setWriteError(error: unknown): void {
    const failure = typeof error === 'string' ? null : commentError(error); const element = this.control('[data-error]'); element.textContent = typeof error === 'string' ? error : failure?.message ?? ''; element.hidden = !element.textContent;
    if (failure?.code === 'authentication_required') this.sessionExpired = Boolean(this.userId);
    if (failure && ['authentication_required', 'profile_required', 'legal_required', 'forbidden'].includes(failure.code)) void this.account?.refreshAfterRejection(failure.code);
  }
  private resizeEditor(): void {
    this.control('[data-character-hint]').textContent = `${[...this.body.value].length.toLocaleString('de-CH')} / 4.000 Zeichen`;
    this.body.style.height = 'auto'; this.body.style.height = `${Math.min(this.body.scrollHeight, 320)}px`;
  }
  private placeEditor(): void {
    if (!this.form) return;
    const id = this.editor?.kind === 'reply' ? this.editor.id : this.editor?.kind === 'edit' ? this.editor.comment.id : null;
    const slot = id ? this.querySelector<HTMLElement>(`[data-editor-for="${CSS.escape(id)}"]`) : null;
    if (slot) slot.append(this.form); else this.placeFormInHome();
  }
  private placeFormInHome(): void {
    if (this.form) this.control('[data-composer-home]').append(this.form);
  }
  private resetEditor(): void {
    this.editor = null; this.draftOwner = null; this.draftExpiresAt = undefined; this.requestKey = ''; this.requestId = ''; this.placeFormInHome();
    this.body.value = ''; this.body.style.removeProperty('height'); this.body.removeAttribute('aria-invalid'); this.setWriteError(''); this.control('[data-composer-label]').textContent = 'Kommentar (Pflichtfeld)';
    this.control('[data-composer-title]').hidden = true; this.control('[data-character-hint]').textContent = 'Maximal 4.000 Zeichen.';
  }
  private openEditor(editor: Editor, focus = true): void {
    if (this.busy || !this.writable || this.publicState === 'error') return;
    if (!this.editor) this.draftOwner = this.userId ?? null;
    this.editor = editor; this.setWriteError(''); if (editor.kind === 'edit') this.body.value = editor.comment.body ?? editor.comment.published_body ?? '';
    const title = editor.kind === 'reply' ? `Antwort an ${this.locate(editor.id)?.display_name ?? 'diesen Beitrag'}` : editor.kind === 'edit' ? 'Kommentar bearbeiten' : '';
    this.control('[data-composer-title]').textContent = title; this.control('[data-composer-title]').hidden = !title; this.control('[data-composer-label]').textContent = title ? `${title} (Pflichtfeld)` : 'Kommentar (Pflichtfeld)';
    this.placeEditor(); this.renderStatus(); this.resizeEditor(); if (focus) this.body.focus();
  }
  private async submit(): Promise<void> {
    if (!this.api || !this.editor || this.busy || !this.writable || this.publicState === 'error') return;
    const validated = validateCommentBody(this.body.value); if (!validated.ok) { this.setWriteError(validated.message); this.body.setAttribute('aria-invalid', 'true'); this.body.focus(); return; }
    if (this.account?.access !== 'ready') {
      if (['authentication-required', 'profile-required', 'legal-required'].includes(this.account?.access ?? 'authentication-required')) this.showAuth('comment');
      else this.setWriteError('Dein Accountstatus wird noch geprüft. Bitte versuche es gleich erneut.');
      return;
    }
    if (this.draftOwner && this.draftOwner !== this.userId) { this.setWriteError('Dieser Entwurf gehört zu einem anderen Account. Bitte melde dich mit dem ursprünglichen Konto an.'); return; }
    const editor = this.editor; const key = `${editor.kind === 'edit' ? editor.comment.id : editor.kind === 'reply' ? editor.id : 'new'}:${validated.value}`;
    if (key !== this.requestKey) { this.requestKey = key; this.requestId = crypto.randomUUID(); }
    this.updateHandoffDraft();
    const generation = this.generation; const article = this.article; const request = this.mutationRequest = new AbortController(); this.busy = true; this.setWriteError(''); this.control('[data-action-status]').textContent = ''; this.renderStatus();
    try {
      const result = editor.kind === 'edit' ? await this.api.edit(editor.comment.id, validated.value, editor.comment.version, this.requestId, request.signal) : await this.api.create(article, validated.value, this.requestId, editor.kind === 'reply' ? editor.id : undefined, request.signal);
      if (generation !== this.generation || article !== this.article || request.signal.aborted) return;
      this.busy = false; this.clearDraft(); this.resetEditor();
      const status = this.control('[data-action-status]');
      const message = result.status === 'approved' ? 'Kommentar veröffentlicht.' : 'Zur Prüfung eingereicht.';
      status.textContent = message; clearTimeout(this.actionStatusTimer);
      this.actionStatusTimer = setTimeout(() => {
        if (generation === this.generation && status.textContent === message) status.textContent = '';
      }, 3000);
      this.control('[data-action="compose"]').focus({ preventScroll: true }); await Promise.all([this.loadPublic(), this.loadOwn()]);
    } catch (error) { if (generation === this.generation && article === this.article && !request.signal.aborted) this.setWriteError(error); }
    finally { if (generation === this.generation && article === this.article) { this.busy = false; this.renderStatus(); } }
  }
  private currentDraft(): CommentDraft | null {
    if (!this.editor || !this.body.value.trim()) return null;
    const replyTo = this.editor.kind === 'reply' ? this.editor.id : null;
    const edit = this.editor.kind === 'edit' ? { id: this.editor.comment.id, version: this.editor.comment.version } : undefined;
    const sameRequest = this.requestKey === `${edit?.id ?? replyTo ?? 'new'}:${this.body.value.trim()}`;
    return { articleId: this.article, path: location.pathname, body: this.body.value, replyTo,
      owner: this.draftOwner, expiresAt: this.draftExpiresAt ?? Date.now() + COMMENT_DRAFT_TTL,
      ...(edit ? { edit } : {}),
      ...(sameRequest && this.requestId ? { requestId: this.requestId } : {}) };
  }
  private persistDraft(): boolean {
    const draft = this.currentDraft() ?? this.pendingDraft;
    if (!draft) return true;
    const saved = { ...draft, expiresAt: Date.now() + COMMENT_DRAFT_TTL };
    if (!saveCommentDraft(saved)) return false;
    this.draftExpiresAt = saved.expiresAt; return true;
  }
  /** Only a previously requested auth handoff is persisted; ordinary typing stays in RAM.
   * Editing a restored draft never extends the original 30-minute lifetime. */
  private updateHandoffDraft(): void {
    if (this.draftExpiresAt === undefined) return;
    const draft = this.currentDraft();
    if (!draft || !saveCommentDraft(draft)) removeCommentDraft(this.article);
    if (this.draftExpiresAt <= Date.now()) this.draftExpiresAt = undefined;
  }
  private clearDraft(): void {
    removeCommentDraft(this.article); this.pendingDraft = null; this.draftExpiresAt = undefined;
    this.control('[data-draft-status]').textContent = ''; this.control('[data-draft-status]').hidden = true;
  }
  private restoreDraft(): void {
    const status = this.account?.auth?.state.status;
    if (status !== 'signed-in' && status !== 'signed-out') return;
    if (!this.draftChecked) { this.pendingDraft = readCommentDraft(this.article, location.pathname); this.draftChecked = true; }
    const draft = this.pendingDraft;
    if (!draft) return;
    if (draft.expiresAt <= Date.now() || (this.userId && draft.owner && draft.owner !== this.userId)) { this.clearDraft(); return; }
    if (draft.owner && !this.userId && !this.sessionExpired) {
      const message = this.control('[data-draft-status]'); message.replaceChildren(node('span', 'Ein vorbereiteter Kommentar wartet auf deine erneute Anmeldung. '));
      const button = action('Anmelden', 'resume-draft'); message.append(button); message.hidden = false; return;
    }
    if (this.editor || !this.hasPublicData || this.publicState === 'error') return;
    this.pendingDraft = null; this.draftExpiresAt = draft.expiresAt;
    this.body.value = draft.body;
    this.editor = draft.edit ? { kind: 'edit', comment: { ...draft.edit, body: draft.body, published_body: null } }
      : draft.replyTo ? { kind: 'reply', id: draft.replyTo } : { kind: 'new' };
    this.draftOwner = draft.owner ?? this.userId ?? null;
    if (draft.owner !== this.draftOwner && !saveCommentDraft({ ...draft, owner: this.draftOwner })) removeCommentDraft(this.article);
    if (draft.replyTo) this.expanded.add(draft.replyTo);
    this.requestId = draft.requestId ?? ''; this.requestKey = draft.requestId ? `${draft.edit?.id ?? draft.replyTo ?? 'new'}:${draft.body.trim()}` : '';
    const title = draft.edit ? 'Vorbereitete Änderung' : draft.replyTo ? 'Vorbereitete Antwort' : '';
    this.control('[data-composer-title]').textContent = title; this.control('[data-composer-title]').hidden = !title;
    this.control('[data-composer-label]').textContent = title ? `${title} (Pflichtfeld)` : 'Kommentar (Pflichtfeld)';
    const message = this.control('[data-draft-status]'); message.textContent = this.writable
      ? 'Dein Kommentar wurde wiederhergestellt. Prüfe ihn und reiche ihn ausdrücklich mit „Kommentar senden“ ein.'
      : 'Dein Entwurf wurde wiederhergestellt. Für diesen Artikel sind neue Beiträge derzeit nicht möglich.';
    message.hidden = false; this.resizeEditor();
  }
  private showAuth(intent: 'comment' | 'vote'): void {
    this.authReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const signedIn = Boolean(this.userId);
    this.control('#comment-auth-title').textContent = signedIn ? 'Account vervollständigen' : intent === 'vote' ? 'Anmelden, um zu bewerten' : 'Anmelden, um zu kommentieren';
    this.control('#comment-auth-description').textContent = signedIn
      ? 'Vervollständige dein Profil und bestätige die erforderlichen rechtlichen Hinweise. Dein Kommentar bleibt vorbereitet.'
      : intent === 'vote' ? 'Melde dich an oder erstelle ein Konto, um diesen Beitrag zu bewerten. Danach kannst du deine Bewertung ausdrücklich abgeben.'
      : 'Dein Kommentar ist vorbereitet. Melde dich an oder erstelle ein Konto, um ihn zur Prüfung einzureichen.';
    const returnTo = location.pathname + location.search + '#kommentare';
    const login = this.control<HTMLAnchorElement>('[data-comment-login]'); login.textContent = signedIn ? 'Fortfahren' : 'Anmelden';
    login.href = createAccountSetupHref(returnTo, location.origin, 'login');
    const register = this.control<HTMLAnchorElement>('[data-comment-register]'); register.href = createAccountSetupHref(returnTo, location.origin, 'register'); register.hidden = signedIn;
    this.control('[data-action="close-auth"]').textContent = intent === 'vote' ? 'Zurück zum Artikel' : 'Zurück zum Kommentar';
    this.control('[data-auth-error]').hidden = true;
    this.control<HTMLDialogElement>('[data-auth-dialog]').showModal();
  }
  private closeAuth(): void {
    const dialog = this.control<HTMLDialogElement>('[data-auth-dialog]');
    if (!dialog.open) return;
    dialog.close(); if (this.authReturnFocus?.isConnected) this.authReturnFocus.focus({ preventScroll: true }); this.authReturnFocus = undefined;
  }
  private closeWithdrawal(): void { this.control<HTMLDialogElement>('[data-withdraw-dialog]').close(); this.withdrawal = undefined; if (this.returnFocus?.isConnected) this.returnFocus.focus(); this.returnFocus = undefined; }
  private async upvote(id: string): Promise<void> {
    if (!this.userId) { this.showAuth('vote'); return; }
    const comment = this.locate(id);
    if (!this.api || !comment?.can_upvote || this.account?.access !== 'ready' || this.publicState !== 'ready' || this.voteRequests.has(id)) return;
    const generation = this.generation; const article = this.article;
    const focused = document.activeElement;
    const restoreFocus = focused instanceof HTMLButtonElement && focused.dataset.action === 'upvote' && focused.dataset.id === id;
    const request = new AbortController(); this.voteRequests.set(id, request);
    const errorBox = this.control('[data-vote-error]'); errorBox.hidden = true; errorBox.textContent = ''; this.renderList();
    try {
      const result = await this.api.upvote(id, !comment.has_upvoted, request.signal);
      if (generation !== this.generation || article !== this.article || request.signal.aborted) return;
      if (result.id !== id) throw new Error('invalid_response');
      const current = this.locate(id);
      if (current) { current.upvote_count = result.upvote_count; current.has_upvoted = result.has_upvoted; }
      this.control('[data-action-status]').textContent = result.has_upvoted ? 'Bewertung gespeichert.' : 'Bewertung entfernt.';
      // Re-fetch the global ranking rather than locally reordering a partial page.
      if (this.sort === 'helpful') await this.restartPublic();
    } catch (failure) {
      if (generation === this.generation && article === this.article && !request.signal.aborted) {
        errorBox.textContent = `Bewertung konnte nicht gespeichert werden. ${commentError(failure).message}`; errorBox.hidden = false;
        if (commentError(failure).code === 'authentication_required') void this.account?.refreshAfterRejection('authentication_required');
      }
    } finally {
      if (this.voteRequests.get(id) === request) this.voteRequests.delete(id);
      if (generation === this.generation && article === this.article && !request.signal.aborted) {
        this.renderList();
        if (restoreFocus && document.activeElement === document.body) this.querySelector<HTMLButtonElement>(`[data-action="upvote"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      }
    }
  }
  private async withdraw(): Promise<void> {
    if (!this.api || !this.withdrawal || this.busy) return;
    const generation = this.generation; const article = this.article; const request = this.mutationRequest = new AbortController(); this.busy = true;
    const error = this.control('[data-withdraw-error]'); error.hidden = true; error.textContent = ''; this.renderStatus();
    try {
      await this.api.withdraw(this.withdrawal.id, this.withdrawal.version, request.signal); if (generation !== this.generation || article !== this.article || request.signal.aborted) return;
      this.closeWithdrawal(); this.control('[data-action-status]').textContent = 'Dein Beitrag wurde zurückgezogen.'; this.control('[data-action-status]').tabIndex = -1; this.control('[data-action-status]').focus(); await Promise.all([this.loadPublic(), this.loadOwn()]);
    } catch (failure) { if (generation === this.generation && article === this.article && !request.signal.aborted) { this.closeWithdrawal(); error.textContent = commentError(failure).message; error.hidden = false; } }
    finally { if (generation === this.generation && article === this.article) { this.busy = false; this.renderStatus(); } }
  }
  private async handleAction(button: HTMLButtonElement): Promise<void> {
    const id = button.dataset.id ?? '';
    switch (button.dataset.action) {
      case 'load': await this.loadPublic(); break;
      case 'upvote': await this.upvote(id); break;
      case 'more': await this.loadPublic(true); break;
      case 'retry-mine': await this.loadOwn(); break;
      case 'more-mine': await this.loadOwn(true); break;
      case 'retry-account': await Promise.all([this.account?.profiles?.load(), this.account?.legal?.load()]); break;
      case 'compose': this.openEditor({ kind: 'new' }); break;
      case 'close-auth': this.closeAuth(); break;
      case 'resume-draft': this.showAuth('comment'); break;
      case 'reply': this.openEditor({ kind: 'reply', id }); break;
      case 'edit': { const comment = this.own.get(id); if (comment) this.openEditor({ kind: 'edit', comment }); break; }
      case 'cancel-edit': if (!this.busy) { const target = this.editor?.kind === 'new' ? this.control('[data-action="compose"]') : button.closest('[data-comment-id]')?.querySelector<HTMLElement>('[data-action="reply"], [data-action="edit"]'); this.clearDraft(); this.resetEditor(); this.renderStatus(); target?.focus({ preventScroll: true }); } break;
      case 'replies': if (this.expanded.has(id)) { this.expanded.delete(id); this.renderList(); } else if (this.threads.has(id)) { this.expanded.add(id); this.renderList(); } else await this.loadReplies(id); break;
      case 'more-replies': await this.loadReplies(id, true); break;
      case 'retry-replies': await this.loadReplies(id); break;
      case 'withdraw': if (!this.busy) { this.withdrawal = this.own.get(id); if (!this.withdrawal) return; this.returnFocus = button; this.control<HTMLDialogElement>('[data-withdraw-dialog]').showModal(); } break;
      case 'cancel-withdraw': if (!this.busy) this.closeWithdrawal(); break;
      case 'confirm-withdraw': await this.withdraw(); break;
    }
  }
  private resetArticle(): void {
    this.pendingDraft = null; this.draftChecked = false; this.closeAuth();
    clearTimeout(this.actionStatusTimer);
    this.voteRequests.forEach((request) => request.abort()); this.voteRequests.clear();
    this.generation++; this.publicSequence++; this.replySequence++; this.publicRequest?.abort(); this.privateRequest?.abort(); this.mutationRequest?.abort(); this.replyRequests.forEach((r) => r.abort()); this.replyRequests.clear();
    this.published = []; this.own.clear(); this.threads.clear(); this.expanded.clear(); this.cursor = null; this.ownCursor = null; this.publicState = 'idle'; this.privateState = 'idle';
    this.publicError = null; this.privateError = null; this.hasPublicData = false; this.writable = false; this.busy = false; this.resetEditor(); this.closeWithdrawal();
    this.control('[data-withdraw-error]').hidden = true; this.control('[data-vote-error]').hidden = true; this.control('[data-action-status]').textContent = ''; this.renderList();
  }
  disconnectedCallback(): void { this.events?.abort(); this.events = undefined; this.account?.dispose(); this.account = undefined; this.userId = undefined; this.resetArticle(); }
}
export function registerCommentsElement(): void { if (!customElements.get('meddocs-comments')) customElements.define('meddocs-comments', CommentsElement); }
