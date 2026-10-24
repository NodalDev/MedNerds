import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import { validateDisplayName, validateProfessionalRole, hasPublicDisplayName, defaultProfileExtensions, type Profile, type ProfileExtensions, type StaffAccount } from './profile.ts';
import { getAccountSetupStatus } from './account-access.ts';

interface QueryResult<T> { data: T | null; error: { code?: string } | null; extensionsAvailable?: boolean }
export interface ProfileApi {
  readProfile(userId: string, signal: AbortSignal): Promise<QueryResult<Profile>>;
  readStaff(userId: string, signal: AbortSignal): Promise<QueryResult<StaffAccount>>;
  updateName(userId: string, displayName: string | null, signal: AbortSignal, extensions?: ProfileExtensions): Promise<QueryResult<Profile>>;
}

export function createProfileApi(client: SupabaseClient<Database>): ProfileApi {
  let extensionsAvailable = true;
  const baseFields = 'user_id,display_name,created_at,updated_at';
  const fields = 'user_id,display_name,created_at,updated_at,professional_role,professional_role_public,avatar_provider' as const;
  return {
    async readProfile(userId, signal) {
      const result = await client.from('profiles').select(fields)
        .eq('user_id', userId).abortSignal(signal).maybeSingle();
      if (['42703', 'PGRST204'].includes(result.error?.code ?? '')) {
        extensionsAvailable = false;
        const legacy = await client.from('profiles').select(baseFields).eq('user_id', userId).abortSignal(signal).maybeSingle();
        return { ...legacy, extensionsAvailable: false, data: legacy.data ? { ...legacy.data, ...defaultProfileExtensions } : null };
      }
      extensionsAvailable = true;
      return { ...result, extensionsAvailable: true };
    },
    async readStaff(userId, signal) {
      return client.from('staff_accounts').select('user_id,role,author_slug,created_at')
        .eq('user_id', userId).abortSignal(signal).maybeSingle();
    },
    async updateName(userId, displayName, signal, extensions) {
      // Explicit editable fields only. Schema types never grant permissions.
      const query = client.from('profiles').update({ display_name: displayName,
        ...(extensionsAvailable && extensions ? extensions : {}) }).eq('user_id', userId);
      if (extensionsAvailable) return query.select(fields).abortSignal(signal).single();
      const result = await query.select(baseFields).abortSignal(signal).single();
      return { ...result, data: result.data ? { ...result.data, ...defaultProfileExtensions } : null };
    },
  };
}

export interface ProfileSnapshot {
  readonly userId: string | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly profile: Profile | null;
  readonly staff: StaffAccount | null;
  readonly staffStatus: 'loading' | 'ready' | 'error';
  readonly saving: boolean;
  readonly error: string;
  readonly invalidName: boolean;
  readonly message: string;
  readonly extensionsAvailable: boolean;
}

const empty: ProfileSnapshot = {
  userId: null, status: 'idle', profile: null, staff: null, staffStatus: 'loading',
  saving: false, error: '', invalidName: false, message: '', extensionsAvailable: false,
};
const unavailable = 'Die Profilfunktion ist noch nicht verfügbar. Deine Anmeldung funktioniert weiterhin; bitte versuche es später erneut.';
function loadFailure(error: { code?: string } | null): string {
  return ['42P01', 'PGRST205'].includes(error?.code ?? '') ? unavailable
    : 'Dein Profil konnte nicht geladen werden. Bitte versuche es erneut.';
}

/** Profile UI state only. AuthStore/SDK own identity and session lifecycle. */
export class ProfileStore {
  private snapshot: ProfileSnapshot = empty;
  private listeners = new Set<(state: ProfileSnapshot) => void>();
  private generation = 0;
  private request?: AbortController;
  private readonly api: ProfileApi;
  constructor(api: ProfileApi) { this.api = api; }
  get state(): ProfileSnapshot { return this.snapshot; }
  /** Derived only from the current user's loaded, persisted profile. */
  get requiresCompletion(): boolean {
    return getAccountSetupStatus(this.snapshot, this.snapshot.userId) === 'required';
  }

  subscribe(listener: (state: ProfileSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  private update(patch: Partial<ProfileSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener(this.snapshot);
  }

  setUser(userId: string | null): void {
    if (this.snapshot.userId === userId) return;
    this.generation++;
    this.request?.abort();
    this.snapshot = empty;
    this.update({ userId, status: userId ? 'loading' : 'idle' });
    // Do not perform SDK-dependent requests inside onAuthStateChange callbacks.
    const generation = this.generation;
    if (userId) queueMicrotask(() => {
      if (generation === this.generation && this.snapshot.userId === userId) void this.load();
    });
  }

  async load(): Promise<void> {
    const userId = this.snapshot.userId;
    if (!userId || this.snapshot.saving) return;
    const generation = ++this.generation;
    this.request?.abort();
    const request = this.request = new AbortController();
    this.update({ status: 'loading', profile: null, staff: null, staffStatus: 'loading', error: '', message: '', invalidName: false });
    const [profile, staff] = await Promise.allSettled([
      this.api.readProfile(userId, request.signal), this.api.readStaff(userId, request.signal),
    ]);
    if (generation !== this.generation || request.signal.aborted) return;
    const profileResult = profile.status === 'fulfilled' ? profile.value : null;
    const staffResult = staff.status === 'fulfilled' ? staff.value : null;
    const ownProfile = profileResult?.data?.user_id === userId ? profileResult.data : null;
    const profileReady = Boolean(ownProfile && !profileResult?.error);
    const profileError = profileReady ? ''
      : profile.status === 'rejected' || profileResult?.data ? loadFailure(null)
      : profileResult?.error ? loadFailure(profileResult.error) : unavailable;
    const staffValid = Boolean(staffResult && !staffResult.error && (!staffResult.data || (
      staffResult.data.user_id === userId && ['author', 'admin'].includes(staffResult.data.role)
    )));
    this.update({
      status: profileReady ? 'ready' : 'error',
      profile: profileResult?.error ? null : ownProfile,
      error: profileError,
      staff: staffValid ? staffResult?.data ?? null : null,
      staffStatus: staffValid ? 'ready' : 'error',
      extensionsAvailable: profileResult?.extensionsAvailable ?? Boolean(ownProfile && 'avatar_provider' in ownProfile),
    });
  }

  async completeProfile(rawName: string, professionalRole: string = ''): Promise<boolean> {
    if (!this.requiresCompletion) return false;
    return this.save(rawName, {
      professionalRole,
      professionalRolePublic: this.snapshot.profile?.professional_role_public ?? false,
      gravatar: this.snapshot.profile?.avatar_provider === 'gravatar',
    }, { requireDisplayName: true });
  }

  async save(rawName: string, rawExtensions?: { professionalRole: string; professionalRolePublic: boolean; gravatar: boolean },
    options: { requireDisplayName?: boolean } = {}): Promise<boolean> {
    if (!this.snapshot.userId || this.snapshot.status !== 'ready' || this.snapshot.saving) return false;
    const name = validateDisplayName(rawName);
    if (!name.ok) { this.update({ error: name.message, invalidName: true, message: '' }); return false; }
    if (options.requireDisplayName && !name.value) {
      this.update({ error: 'Bitte wähle einen Anzeigenamen mit 2–60 Zeichen.', invalidName: true, message: '' }); return false;
    }
    const completing = options.requireDisplayName && this.requiresCompletion;
    const role = validateProfessionalRole(rawExtensions?.professionalRole ?? this.snapshot.profile?.professional_role ?? '');
    if (!role.ok) { this.update({ error: role.message, invalidName: false, message: '' }); return false; }
    const extensions: ProfileExtensions = rawExtensions ? {
      professional_role: role.value,
      professional_role_public: Boolean(role.value && rawExtensions.professionalRolePublic),
      avatar_provider: rawExtensions.gravatar ? 'gravatar' : 'initials',
    } : { professional_role: this.snapshot.profile?.professional_role ?? null,
      professional_role_public: this.snapshot.profile?.professional_role_public ?? false,
      avatar_provider: this.snapshot.profile?.avatar_provider ?? 'initials' };
    if (!this.snapshot.extensionsAvailable && rawExtensions && (
      extensions.professional_role || extensions.professional_role_public || extensions.avatar_provider !== 'initials')) {
      this.update({ error: 'Die neuen Profileinstellungen sind noch nicht verfügbar. Es wurde nichts gespeichert.', message: '' }); return false;
    }
    const userId = this.snapshot.userId;
    const generation = this.generation;
    const request = this.request = new AbortController();
    this.update({ saving: true, error: '', invalidName: false, message: '' });
    try {
      const result = await this.api.updateName(userId, name.value, request.signal,
        this.snapshot.extensionsAvailable ? extensions : undefined);
      if (generation !== this.generation || request.signal.aborted) return false;
      if (result.error || result.data?.user_id !== userId) {
        this.update({ saving: false, error: 'Dein Anzeigename konnte nicht gespeichert werden. Bitte versuche es erneut.' });
        return false;
      }
      if (options.requireDisplayName && (!hasPublicDisplayName(result.data) || result.data.display_name !== name.value)) {
        this.update({ saving: false, error: 'Dein Profil konnte nicht bestätigt werden. Bitte versuche es erneut.' }); return false;
      }
      this.update({ profile: result.data, saving: false, message: completing ? 'Dein Profil wurde erstellt.' : 'Dein Anzeigename wurde gespeichert.' });
      return true;
    } catch {
      if (generation === this.generation && !request.signal.aborted) this.update({ saving: false, error: 'Dein Anzeigename konnte nicht gespeichert werden. Bitte prüfe deine Verbindung.' });
      return false;
    }
  }

  dispose(): void {
    this.generation++;
    this.request?.abort();
    this.listeners.clear();
    this.snapshot = empty;
  }
}
