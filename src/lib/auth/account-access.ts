import type { AuthSnapshot } from './auth-store.ts';
import type { ProfileSnapshot } from './profile-store.ts';
import type { LegalSnapshot } from './legal-store.ts';
import { hasPublicDisplayName } from './profile.ts';

export type AccountSetupStatus = 'pending' | 'required' | 'complete';
type SavedProfileState = Pick<ProfileSnapshot, 'status' | 'userId' | 'profile'>;

/** Only use a loaded DB row / confirmed write response, never form values. */
export function getAccountSetupStatus(state: SavedProfileState, userId: string | null): AccountSetupStatus {
  if (!userId || state.userId !== userId || state.status !== 'ready' || state.profile?.user_id !== userId) return 'pending';
  return hasPublicDisplayName(state.profile) ? 'complete' : 'required';
}

export type AccountFeatureAccess =
  | 'authentication-required' | 'authentication-pending' | 'profile-pending'
  | 'profile-required' | 'legal-pending' | 'legal-required' | 'ready';

/** UI guidance only. Comment and personalized-learning writes MUST enforce this server-side. */
export function getAccountFeatureAccess(context: {
  auth: Pick<AuthSnapshot, 'status' | 'userId'>;
  profile: SavedProfileState;
  legal: LegalSnapshot;
  versions: { terms: string; privacy: string };
}, options: { requireLegalAcceptance?: boolean } = {}): AccountFeatureAccess {
  const { auth, profile, legal, versions } = context;
  if (auth.status === 'loading' || auth.status === 'error') return 'authentication-pending';
  if (auth.status !== 'signed-in' || !auth.userId) return 'authentication-required';
  const setup = getAccountSetupStatus(profile, auth.userId);
  if (setup === 'pending') return 'profile-pending';
  if (setup === 'required') return 'profile-required';
  if (options.requireLegalAcceptance !== false) {
    if (legal.userId !== auth.userId || legal.loading || legal.saving || legal.error) return 'legal-pending';
    if (!versions.terms || !versions.privacy || legal.policy.terms !== versions.terms
      || legal.policy.privacy !== versions.privacy || !legal.policy.accepted) return 'legal-required';
  }
  return 'ready';
}

/** Return navigation is restricted to this origin; account URLs would create loops. */
export function getAccountReturnPath(raw: string | null, origin: string): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || url.username || url.password || /^\/account(?:\/|$)/.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

export function createAccountSetupHref(returnTo: string, origin: string, mode?: 'login' | 'register'): string {
  const path = getAccountReturnPath(returnTo, origin);
  const params = new URLSearchParams();
  if (path) params.set('returnTo', path);
  if (mode) params.set('mode', mode);
  return `/account/${params.size ? `?${params}` : ''}#profil-vervollstaendigen`;
}
