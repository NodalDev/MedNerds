import { hasPublicDisplayName, type Profile } from './profile.ts';

export function avatarInitials(name: string | null): string {
  if (!hasPublicDisplayName({ display_name: name })) return '';
  const words = name?.trim().split(/\s+/u).filter(Boolean) ?? [];
  if (!words.length) return '';
  const first = [...words[0]][0];
  const last = words.length > 1 ? [...words.at(-1)!][0] : '';
  return `${first}${last}`.toLocaleUpperCase('de-CH');
}
export async function gravatarUrl(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `https://gravatar.com/avatar/${hex}?s=128&r=g&d=404`;
}

/** Own-account image only. Called with a saved DB preference, never an unsaved checkbox. */
export class AccountAvatar {
  private generation = 0;
  private key = '';
  private image?: HTMLImageElement;
  private readonly host: HTMLElement;
  constructor(host: HTMLElement) { this.host = host; }
  update(profile: Profile | null, email: string | null, enabled: boolean): void {
    const initials = this.host.querySelector<HTMLElement>('[data-initials]');
    const text = avatarInitials(profile?.display_name ?? null);
    if (initials) { initials.textContent = text; initials.hidden = !text; }
    const neutral = this.host.querySelector<HTMLElement>('[data-avatar-neutral]');
    if (neutral) neutral.hidden = Boolean(text);
    const key = profile && text && email && enabled && profile.avatar_provider === 'gravatar' ? `${profile.user_id}:${email}` : '';
    if (key === this.key) {
      if (!key) this.host.dataset.avatarState = text ? 'initials' : 'neutral';
      return;
    }
    this.clear();
    this.key = key;
    this.host.dataset.avatarState = key ? 'loading' : text ? 'initials' : 'neutral';
    if (!key || !email) return;
    const generation = this.generation;
    void gravatarUrl(email).then((url) => {
      if (generation !== this.generation) return;
      const image = document.createElement('img');
      this.image = image;
      image.alt = ''; // Parent names the avatar; initials remain the accessible fallback.
      image.width = image.height = 64;
      image.referrerPolicy = 'no-referrer';
      image.hidden = true;
      image.onload = () => { if (generation === this.generation) { image.hidden = false; this.host.dataset.avatarState = 'loaded'; } };
      image.onerror = () => { image.remove(); this.host.dataset.avatarState = 'fallback'; }; // No retry loop.
      this.host.append(image);
      image.src = url;
    }).catch(() => { if (generation === this.generation) this.host.dataset.avatarState = 'fallback'; });
  }
  private clear(): void {
    this.generation++;
    if (this.image) {
      this.image.onload = this.image.onerror = null;
      this.image.removeAttribute('src');
      this.image.remove();
      this.image = undefined;
    }
  }
  dispose(): void { this.clear(); this.key = ''; }
}
