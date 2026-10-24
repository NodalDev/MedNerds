import { authors, type AuthorId } from '../../data/authors.ts';
import type { Database } from './database.types.ts';

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileExtensions = Pick<Profile, 'professional_role' | 'professional_role_public' | 'avatar_provider'>;
export type StaffAccount = Database['public']['Tables']['staff_accounts']['Row'];
export type AccountRole = 'user' | Database['public']['Enums']['staff_role'];
export type DisplayNameResult = { ok: true; value: string | null } | { ok: false; message: string };
export const defaultProfileExtensions: ProfileExtensions = {
  professional_role: null, professional_role_public: false, avatar_provider: 'initials',
};

export function validateProfessionalRole(raw: string): DisplayNameResult {
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(raw)) {
    return { ok: false, message: 'Bitte verwende eine Berufsangabe ohne Steuerzeichen oder Zeilenumbrüche.' };
  }
  const value = raw.trim().replace(/\s+/gu, ' ');
  return [...value].length > 80
    ? { ok: false, message: 'Beruf / Funktion darf höchstens 80 Zeichen lang sein.' }
    : { ok: true, value: value || null };
}

/** Readiness for future public UI only. Future comment writes also need DB enforcement. */
export function hasPublicDisplayName(profile: Pick<Profile, 'display_name'> | null): boolean {
  const name = profile?.display_name;
  if (!name) return false;
  const result = validateDisplayName(name);
  return result.ok && Boolean(result.value);
}

export function publicProfessionalRole(profile: Profile): string | null {
  return profile.professional_role_public ? profile.professional_role : null;
}

/** UI readiness only; future public write endpoints must enforce both in PostgreSQL. */
export function isProfileReadyForPublicActions(profile: Pick<Profile, 'display_name'> | null, currentLegalAcceptance: boolean): boolean {
  return currentLegalAcceptance && hasPublicDisplayName(profile);
}

/** Same code points and Unicode code-point length as PostgreSQL's constraint. */
export function validateDisplayName(raw: string): DisplayNameResult {
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(raw)) {
    return { ok: false, message: 'Bitte verwende einen Namen ohne Steuerzeichen oder Zeilenumbrüche.' };
  }
  const name = raw.trim();
  if (!name) return { ok: true, value: null };
  const length = [...name].length;
  if (length < 2 || length > 60) return { ok: false, message: 'Der Anzeigename muss zwischen 2 und 60 Zeichen lang sein.' };
  return { ok: true, value: name };
}

export function getStaffAuthor(staff: Pick<StaffAccount, 'author_slug'> | null) {
  const slug = staff?.author_slug;
  return slug && Object.hasOwn(authors, slug) ? authors[slug as AuthorId] : undefined;
}

/** Presentation helper only. A trusted DB staff row and actual frontmatter IDs are required.
 * Future write permissions must still be enforced in PostgreSQL, never by this helper.
 */
export function isStaffAuthorOfArticle(staff: StaffAccount | null, articleAuthors: readonly AuthorId[]): boolean {
  return Boolean(getStaffAuthor(staff) && articleAuthors.some((id) => id === staff?.author_slug));
}
