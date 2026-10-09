import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readAuthConfiguration, type AuthConfigurationResult } from './config.ts';
import { AuthStore } from './auth-store.ts';
import type { Database } from './database.types.ts';

let client: SupabaseClient<Database> | undefined;
let store: AuthStore | undefined;

export function getAuthConfiguration(): AuthConfigurationResult {
  return readAuthConfiguration(import.meta.env);
}

/** Called only by browser UI. No client or storage is initialized during prerendering. */
export function getSupabaseBrowserClient(): SupabaseClient<Database> | undefined {
  if (typeof window === 'undefined') return undefined;
  const result = getAuthConfiguration();
  if (!result.ok) return undefined;
  client ??= createClient<Database>(result.config.url, result.config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export function getBrowserAuthStore(): AuthStore | undefined {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return undefined;
  store ??= new AuthStore(supabase.auth);
  return store;
}
