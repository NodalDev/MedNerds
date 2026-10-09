export interface AuthEnvironment {
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  PUBLIC_TURNSTILE_SITE_KEY?: string;
}

export interface AuthConfiguration {
  url: string;
  publishableKey: string;
  turnstileSiteKey: string;
}

export type AuthConfigurationResult =
  | { ok: true; config: AuthConfiguration }
  | { ok: false; message: string };

/** Only public configuration is accepted. Missing configuration never blocks a static build. */
export function readAuthConfiguration(env: AuthEnvironment): AuthConfigurationResult {
  const url = env.PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const turnstileSiteKey = env.PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!url || !publishableKey || !turnstileSiteKey) {
    return { ok: false, message: 'Die Anmeldung ist derzeit nicht eingerichtet. Bitte versuche es später erneut.' };
  }
  try {
    const parsed = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))
      || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    if (!publishableKey.startsWith('sb_publishable_') || publishableKey.length <= 'sb_publishable_'.length) throw new Error();
  } catch {
    return { ok: false, message: 'Die Anmeldung ist derzeit nicht verfügbar. Bitte versuche es später erneut.' };
  }
  return { ok: true, config: { url, publishableKey, turnstileSiteKey } };
}
