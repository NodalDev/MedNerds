import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import { TurnstileChallenge } from './turnstile.ts';

type DeletionReply = { status: string; challengeId?: string };
export interface DeletionApi {
  begin(captchaToken: string, signal: AbortSignal): Promise<DeletionReply>;
  confirm(challengeId: string, code: string, signal: AbortSignal): Promise<DeletionReply>;
}
export function createDeletionApi(client: SupabaseClient<Database>): DeletionApi {
  async function invoke(body: Record<string, string | boolean>, signal: AbortSignal): Promise<DeletionReply> {
    const { data: session, error: sessionError } = await client.auth.getSession();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (sessionError || !session.session) return { status: 'not_authenticated' };
    const result = await client.functions.invoke<unknown>('delete-account', {
      body, signal, headers: { Authorization: `Bearer ${session.session.access_token}` },
    });
    let data: unknown = result.data;
    if (result.error) {
      const error: unknown = result.error;
      if (error && typeof error === 'object' && 'context' in error && error.context instanceof Response) {
        try { data = await error.context.json(); } catch { data = null; }
      }
    }
    if (!data || typeof data !== 'object' || !('status' in data) || typeof data.status !== 'string') return { status: 'unavailable' };
    // HTTP errors can NEVER report successful deletion/delivery.
    if (result.error && ['deleted', 'code_sent'].includes(data.status)) return { status: 'unavailable' };
    return { status: data.status, challengeId: 'challengeId' in data && typeof data.challengeId === 'string' ? data.challengeId : undefined };
  }
  return {
    begin: (captchaToken, signal) => invoke({ action: 'begin', captchaToken }, signal),
    confirm: (challengeId, code, signal) => invoke({ action: 'delete', challengeId, code, confirmed: true }, signal),
  };
}
function deletionFailure(status: string): string {
  if (status === 'last_admin') return 'Dein Account ist der letzte Administrator. Bitte übergib die Administration zuerst über einen kontrollierten Verwaltungsprozess an einen anderen bestätigten Account.';
  if (status === 'rate_limited') return 'Bitte warte mindestens eine Minute, bevor du einen neuen Bestätigungscode anforderst.';
  if (status === 'not_authenticated') return 'Deine Sitzung konnte nicht bestätigt werden. Bitte melde dich erneut an.';
  if (status === 'confirmation_invalid') return 'Der Code oder die Löschbestätigung ist ungültig, abgelaufen oder bereits verwendet. Bitte fordere einen neuen Code an.';
  if (status === 'delete_failed') return 'Die Löschung wurde nicht bestätigt. Möglicherweise ist eine administrative Übergabe erforderlich. Bitte prüfe deinen Account oder fordere einen neuen Code an.';
  if (status === 'code_not_sent') return 'Der Bestätigungscode konnte nicht gesendet werden. Bitte warte eine Minute und bestätige die Sicherheitsprüfung erneut.';
  return 'Die Account-Löschung ist derzeit nicht verfügbar. Bitte versuche es später erneut.';
}

/** Only deletion-dialog UI state. AuthStore/SDK continue to own identity/session. */
export class AccountDeletion {
  private userId: string | null = null;
  private email = '';
  private generation = 0;
  private busy = false;
  private challengeId = '';
  private captcha?: TurnstileChallenge;
  private request?: AbortController;
  private returnFocus?: () => HTMLElement;
  private readonly events = new AbortController();
  private readonly host: HTMLElement;
  private readonly api: DeletionApi;
  private readonly siteKey: string;
  private readonly deleted: (userId: string) => Promise<void>;
  constructor(host: HTMLElement, api: DeletionApi, siteKey: string, deleted: (userId: string) => Promise<void>) {
    this.host = host; this.api = api; this.siteKey = siteKey; this.deleted = deleted;
    const { signal } = this.events;
    this.control('[data-delete-open]').addEventListener('click', () => this.open(() => this.control('[data-delete-open]')), { signal });
    this.control('[data-delete-cancel]').addEventListener('click', () => this.close(), { signal });
    this.control('[data-delete-send]').addEventListener('click', () => { void this.begin(); }, { signal });
    this.control('[data-delete-new-code]').addEventListener('click', () => this.prepare(), { signal });
    this.control('[data-delete-form]').addEventListener('submit', event => { event.preventDefault(); void this.confirm(); }, { signal });
    this.control('[data-delete-dialog]').addEventListener('cancel', event => {
      event.preventDefault(); if (!this.busy) this.close();
    }, { signal });
  }
  private control<T extends HTMLElement = HTMLElement>(selector: string): T {
    const node = this.host.querySelector<T>(selector);
    if (!node) throw new Error('Incomplete deletion markup');
    return node;
  }
  setUser(userId: string | null, email: string | null): void {
    if (this.userId !== userId || this.email !== (email ?? '')) this.close(false);
    this.userId = userId; this.email = email ?? '';
    this.control<HTMLButtonElement>('[data-delete-open]').disabled = !userId;
  }
  /** Explicit deletion entry is independent of profile completion / future feature gates. */
  open(returnFocus: () => HTMLElement): void {
    if (!this.userId || this.busy) return;
    const dialog = this.control<HTMLDialogElement>('[data-delete-dialog]');
    if (dialog.open) return;
    this.returnFocus = returnFocus;
    dialog.showModal(); this.prepare();
    this.control('[data-delete-cancel]').focus();
  }
  private prepare(): void {
    if (this.busy || !this.userId) return;
    this.generation++;
    this.challengeId = '';
    this.control<HTMLInputElement>('#account-delete-otp').value = '';
    this.control<HTMLInputElement>('#account-delete-otp').setAttribute('aria-invalid', 'false');
    this.control('[data-delete-form]').hidden = true;
    this.control('[data-delete-start]').hidden = false;
    this.control('[data-delete-status]').textContent = '';
    this.control('[data-delete-error]').hidden = true;
    this.control('[data-delete-new-code]').hidden = true;
    this.control<HTMLButtonElement>('[data-delete-send]').disabled = true;
    this.control('[data-delete-email]').textContent = this.email;
    this.captcha?.dispose();
    const generation = this.generation;
    this.captcha = new TurnstileChallenge(this.control('[data-delete-challenge]'), this.siteKey, (ready, message) => {
      if (generation !== this.generation) return;
      this.control<HTMLButtonElement>('[data-delete-send]').disabled = this.busy || !ready;
      if (message) this.error(message);
    });
    void this.captcha.mount();
  }
  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.control('[data-delete-dialog]').setAttribute('aria-busy', String(busy));
    for (const selector of ['[data-delete-cancel]', '[data-delete-send]', '[data-delete-confirm]', '[data-delete-new-code]', '#account-delete-otp']) {
      this.control<HTMLButtonElement | HTMLInputElement>(selector).disabled = busy;
    }
  }
  private error(message: string): void {
    this.control('[data-delete-error]').textContent = message;
    this.control('[data-delete-error]').hidden = false;
  }
  private async begin(): Promise<void> {
    if (!this.userId || this.busy) return;
    const token = this.captcha?.takeToken();
    if (!token) { this.error('Bitte bestätige zuerst die Sicherheitsprüfung.'); return; }
    const generation = this.generation;
    this.request = new AbortController(); this.setBusy(true);
    this.control('[data-delete-error]').hidden = true;
    this.control('[data-delete-status]').textContent = 'Bestätigungscode wird gesendet …';
    try {
      const result = await this.api.begin(token, this.request.signal);
      if (generation !== this.generation) return;
      this.setBusy(false); this.control('[data-delete-status]').textContent = '';
      if (result.status !== 'code_sent' || !result.challengeId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.challengeId)) {
        this.error(deletionFailure(result.status)); this.captcha?.reset(); return;
      }
      this.challengeId = result.challengeId;
      this.captcha?.dispose(); this.captcha = undefined;
      this.control('[data-delete-start]').hidden = true;
      this.control('[data-delete-form]').hidden = false;
      this.control<HTMLInputElement>('#account-delete-otp').focus();
    } catch {
      if (generation !== this.generation) return;
      this.setBusy(false); this.control('[data-delete-status]').textContent = '';
      this.error(deletionFailure('unavailable')); this.captcha?.reset();
    }
  }
  private async confirm(): Promise<void> {
    if (!this.userId || this.busy || !this.challengeId) return;
    const input = this.control<HTMLInputElement>('#account-delete-otp');
    const code = input.value.trim();
    input.setAttribute('aria-invalid', String(!/^\d{6}$/.test(code)));
    if (!/^\d{6}$/.test(code)) { this.error('Bitte gib den sechsstelligen Bestätigungscode ein.'); input.focus(); return; }
    const userId = this.userId, generation = this.generation, challengeId = this.challengeId;
    this.challengeId = ''; // Also single-flight on this device; server enforces the real one-use claim.
    this.request = new AbortController(); this.setBusy(true);
    this.control('[data-delete-error]').hidden = true;
    this.control('[data-delete-status]').textContent = 'Dein Account wird gelöscht …';
    try {
      const result = await this.api.confirm(challengeId, code, this.request.signal);
      if (generation !== this.generation || this.userId !== userId) return;
      this.setBusy(false); this.control('[data-delete-status]').textContent = '';
      if (result.status === 'deleted') { this.close(false); await this.deleted(userId); return; }
      this.error(deletionFailure(result.status));
    } catch {
      if (generation !== this.generation) return;
      this.setBusy(false); this.control('[data-delete-status]').textContent = '';
      this.error('Die Löschung konnte nicht bestätigt werden. Bitte prüfe deinen Account, bevor du es erneut versuchst.');
    }
    this.control<HTMLButtonElement>('[data-delete-confirm]').disabled = true;
    this.control('[data-delete-new-code]').hidden = false;
    input.value = '';
    this.control('[data-delete-new-code]').focus();
  }
  private close(restoreFocus = true): void {
    this.generation++; this.request?.abort(); this.request = undefined;
    this.captcha?.dispose(); this.captcha = undefined; this.challengeId = ''; this.setBusy(false);
    this.control<HTMLInputElement>('#account-delete-otp').value = '';
    this.control('[data-delete-email]').textContent = '';
    this.control('[data-delete-error]').textContent = '';
    this.control('[data-delete-status]').textContent = '';
    this.control<HTMLDialogElement>('[data-delete-dialog]').close();
    if (restoreFocus && this.userId) {
      const opener = this.returnFocus?.();
      if (opener?.isConnected) opener.focus();
    }
    this.returnFocus = undefined;
  }
  dispose(): void { this.close(false); this.events.abort(); this.userId = null; this.email = ''; }
}
