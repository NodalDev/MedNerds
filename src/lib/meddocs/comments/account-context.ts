import { getBrowserAuthStore, getSupabaseBrowserClient } from '../../auth/supabase-client.ts';
import { ProfileStore, createProfileApi } from '../../auth/profile-store.ts';
import { LegalStore, createLegalApi } from '../../auth/legal-store.ts';
import { getAccountFeatureAccess, createAccountSetupHref } from '../../auth/account-access.ts';
import type { AccountFeatureAccess } from '../../auth/account-access.ts';

/** Subscribe to the existing auth lifecycle; never own/cache tokens or a second client. */
export class CommentsAccountContext {
  readonly auth = getBrowserAuthStore();
  readonly profiles?: ProfileStore;
  readonly legal?: LegalStore;
  private unsubscribers: (() => void)[] = [];
  private readonly versions: { terms: string; privacy: string };
  constructor(host: HTMLElement, changed: () => void) {
    this.versions = { terms: host.dataset.termsVersion ?? '', privacy: host.dataset.privacyVersion ?? '' };
    const client = getSupabaseBrowserClient();
    if (!client || !this.auth) return;
    this.profiles = new ProfileStore(createProfileApi(client));
    this.legal = new LegalStore(createLegalApi(client));
    this.unsubscribers.push(this.profiles.subscribe(changed), this.legal.subscribe(changed));
    this.unsubscribers.push(this.auth.subscribe((state) => {
      this.profiles?.setUser(state.status === 'signed-in' ? state.userId : null);
      this.legal?.setUser(state.status === 'signed-in' ? state.userId : null);
      changed();
    }));
    void this.auth.initialize();
  }
  get userId(): string | null { return this.auth?.state.status === 'signed-in' ? this.auth.state.userId : null; }
  get isAdmin(): boolean { return Boolean(this.userId && this.profiles?.state.userId === this.userId
    && this.profiles.state.staffStatus === 'ready' && this.profiles.state.staff?.role === 'admin'); }
  get access(): AccountFeatureAccess {
    if (!this.auth || !this.profiles || !this.legal) return 'authentication-required';
    return getAccountFeatureAccess({ auth: this.auth.state, profile: this.profiles.state, legal: this.legal.state, versions: this.versions });
  }
  get setupHref(): string { return createAccountSetupHref(location.pathname + location.search + '#kommentare', location.origin); }
  /** Reconcile rejected writes with the existing stores; never invent client authorization. */
  async refreshAfterRejection(code: string): Promise<void> {
    if (code === 'authentication_required') await this.auth?.signOut();
    else if (code === 'profile_required' || code === 'forbidden') await this.profiles?.load();
    else if (code === 'legal_required') await this.legal?.load();
  }
  dispose(): void { this.unsubscribers.forEach((stop) => stop()); this.unsubscribers = []; this.profiles?.dispose(); this.legal?.dispose(); }
}
