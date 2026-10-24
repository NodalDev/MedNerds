import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readAuthConfiguration, type AuthConfigurationResult } from './config.ts';
import { AuthStore } from './auth-store.ts';
import type { BrowserDatabase } from '../meddocs/comments/types.ts';

let client: SupabaseClient<BrowserDatabase> | undefined;
let store: AuthStore | undefined;
let storageKey = '';

export function getAuthConfiguration(): AuthConfigurationResult {
  return readAuthConfiguration(import.meta.env);
}

/** Called only by browser UI. No client or storage is initialized during prerendering. */
export function getSupabaseBrowserClient(): SupabaseClient<BrowserDatabase> | undefined {
  if (typeof window === 'undefined') return undefined;
  const result = getAuthConfiguration();
  if (!result.ok) return undefined;
  if (!client) {
    storageKey = `sb-${new URL(result.config.url).hostname.split('.')[0]}-auth-token`;
    client = createClient<BrowserDatabase>(result.config.url, result.config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey },
    });
  }
  return client;
}

export function getBrowserAuthStore(): AuthStore | undefined {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return undefined;
  store ??= new AuthStore(supabase.auth, Date.now, (userId) => {
    // Same explicit storage key as the SDK. Never clear another account/all storage.
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const session: unknown = JSON.parse(saved);
        if (session && typeof session === 'object' && 'user' in session && session.user
          && typeof session.user === 'object' && 'id' in session.user && session.user.id !== userId) return;
      } catch { /* Corrupt owned session data also needs removal. */ }
    }
    for (const key of [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`]) localStorage.removeItem(key);
  });
  return store;
}
