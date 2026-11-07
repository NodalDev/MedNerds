interface ImportMetaEnv {
  /** Compile-time boolean derived from Netlify's NETLIFY=true build marker. */
  readonly MEDNERDS_MEDIA_PROXY: boolean;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}
