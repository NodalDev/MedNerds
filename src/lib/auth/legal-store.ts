import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types.ts';

export interface LegalPolicy {
  registrationEnabled: boolean;
  gravatarEnabled: boolean;
  terms: string | null;
  privacy: string | null;
  accepted: boolean;
}
interface LegalResult { data: Json | null; error: { code?: string } | null }
export interface LegalApi {
  read(signal: AbortSignal): Promise<LegalResult>;
  accept(terms: string, privacy: string, signal: AbortSignal): Promise<LegalResult>;
}
export function createLegalApi(client: SupabaseClient<Database>): LegalApi {
  return {
    async read(signal) { return client.rpc('get_account_legal_state').abortSignal(signal); },
    async accept(terms, privacy, signal) {
      return client.rpc('record_account_legal_acceptance', {
        requested_terms_version: terms, requested_privacy_notice_version: privacy,
      }).abortSignal(signal);
    },
  };
}
const disabled: LegalPolicy = { registrationEnabled: false, gravatarEnabled: false, terms: null, privacy: null, accepted: false };
export interface LegalSnapshot { userId: string | null; loading: boolean; saving: boolean; policy: LegalPolicy; error: string }
function parsePolicy(data: Json | null): LegalPolicy | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { registration_enabled, gravatar_enabled, terms_version, privacy_notice_version, accepted } = data;
  if (typeof registration_enabled !== 'boolean' || typeof gravatar_enabled !== 'boolean' || typeof accepted !== 'boolean') return null;
  if (registration_enabled && (typeof terms_version !== 'string' || typeof privacy_notice_version !== 'string')) return null;
  return { registrationEnabled: registration_enabled, gravatarEnabled: gravatar_enabled,
    terms: typeof terms_version === 'string' ? terms_version : null,
    privacy: typeof privacy_notice_version === 'string' ? privacy_notice_version : null, accepted };
}

/** Only DB-controlled releases can enable registration. No metadata/localStorage proof. */
export class LegalStore {
  private snapshot: LegalSnapshot = { userId: null, loading: true, saving: false, policy: disabled, error: '' };
  private listeners = new Set<(state: LegalSnapshot) => void>();
  private generation = 0;
  private initialized = false;
  private request?: AbortController;
  private readonly api: LegalApi;
  constructor(api: LegalApi) { this.api = api; }
  get state(): LegalSnapshot { return this.snapshot; }
  subscribe(listener: (state: LegalSnapshot) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot); return () => { this.listeners.delete(listener); };
  }
  private update(patch: Partial<LegalSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }
  setUser(userId: string | null): void {
    if (this.initialized && this.snapshot.userId === userId) return;
    this.initialized = true;
    const generation = ++this.generation;
    this.request?.abort();
    this.update({ userId, loading: true, saving: false, policy: disabled, error: '' });
    queueMicrotask(() => { if (generation === this.generation) void this.load(); });
  }
  matches(versions: { terms: string; privacy: string }): boolean {
    const policy = this.snapshot.policy;
    return !this.snapshot.loading && policy.registrationEnabled
      && policy.terms === versions.terms && policy.privacy === versions.privacy;
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.request?.abort();
    const request = this.request = new AbortController();
    this.update({ loading: true, error: '', policy: disabled });
    try {
      const result = await this.api.read(request.signal);
      if (generation !== this.generation || request.signal.aborted) return;
      const policy = result.error ? null : parsePolicy(result.data);
      this.update({ loading: false, policy: policy ?? disabled,
        error: policy ? '' : 'Die Registrierung ist derzeit nicht verfügbar. Du kannst dich weiterhin anmelden.' });
    } catch {
      if (generation === this.generation) this.update({ loading: false, policy: disabled,
        error: 'Die Registrierung ist derzeit nicht verfügbar. Du kannst dich weiterhin anmelden.' });
    }
  }
  async accept(versions: { terms: string; privacy: string }): Promise<boolean> {
    if (!this.snapshot.userId || this.snapshot.saving) return false;
    if (!this.matches(versions)) {
      this.update({ error: 'Die Dokumentversion konnte nicht bestätigt werden. Bitte lade die Seite neu und versuche es erneut.' });
      return false;
    }
    const generation = this.generation;
    const request = this.request = new AbortController();
    this.update({ saving: true, error: '' });
    try {
      const result = await this.api.accept(versions.terms, versions.privacy, request.signal);
      if (generation !== this.generation || request.signal.aborted) return false;
      const row = result.data;
      const valid = !result.error && row && typeof row === 'object' && !Array.isArray(row)
        && row.user_id === this.snapshot.userId && row.terms_version === versions.terms
        && row.privacy_notice_version === versions.privacy && typeof row.accepted_at === 'string';
      this.update({ saving: false, policy: { ...this.snapshot.policy, accepted: Boolean(valid) },
        error: valid ? '' : 'Deine Bestätigungen konnten nicht gespeichert werden. Bitte versuche es erneut.' });
      return Boolean(valid);
    } catch {
      if (generation === this.generation) this.update({ saving: false, error: 'Deine Bestätigungen konnten nicht gespeichert werden. Bitte versuche es erneut.' });
      return false;
    }
  }
  dispose(): void { this.generation++; this.request?.abort(); this.listeners.clear(); }
}
