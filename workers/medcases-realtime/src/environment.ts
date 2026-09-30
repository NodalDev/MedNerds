export type RealtimeEnvironment = 'development' | 'production';

export interface EnvironmentSettings {
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
}

const DEVELOPMENT_ORIGINS = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);

export function environmentKind(settings: EnvironmentSettings): RealtimeEnvironment | null {
  return settings.ENVIRONMENT === 'development' || settings.ENVIRONMENT === 'production'
    ? settings.ENVIRONMENT : null;
}

function normalizedOrigin(value: string, requireHttps: boolean): string | null {
  try {
    const url = new URL(value);
    if ((requireHttps ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (requireHttps && (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
      || /^127\./.test(url.hostname) || url.hostname === '[::1]')) return null;
    return url.origin;
  } catch { return null; }
}

/** Only explicit HTTPS origins are accepted in production; malformed entries are ignored. */
export function productionOrigins(settings: EnvironmentSettings): Set<string> {
  return new Set((settings.ALLOWED_ORIGINS ?? '').split(',')
    .map((entry) => normalizedOrigin(entry.trim(), true))
    .filter((origin): origin is string => origin !== null));
}

export interface RequestOrigin {
  allowed: boolean;
  /** Original validated header value, suitable for an exact CORS echo. */
  origin: string | null;
}

export function validateRequestOrigin(request: Request, settings: EnvironmentSettings): RequestOrigin {
  const environment = environmentKind(settings);
  const header = request.headers.get('Origin');
  if (!environment) return { allowed: false, origin: null };
  // Existing origin-less local test clients remain supported only in development.
  if (header === null) return { allowed: environment === 'development', origin: null };
  const normalized = normalizedOrigin(header, environment === 'production');
  const allowed = normalized !== null && (environment === 'development'
    ? DEVELOPMENT_ORIGINS.has(normalized) : productionOrigins(settings).has(normalized));
  return { allowed, origin: allowed ? header : null };
}
