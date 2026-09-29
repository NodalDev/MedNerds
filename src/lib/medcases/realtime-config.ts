const configuredWorkerUrl = import.meta.env.PUBLIC_MEDCASES_REALTIME_URL?.trim();
const configuredJoinBaseUrl = import.meta.env.PUBLIC_MEDCASES_JOIN_BASE_URL?.trim();

function publicHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

/** One place for the development fallback and future explicit production opt-in. */
export const realtimeConfig = {
  workerUrl: publicHttpUrl(configuredWorkerUrl) ?? (import.meta.env.DEV ? 'http://127.0.0.1:8787' : null),
  joinBaseUrl: publicHttpUrl(configuredJoinBaseUrl),
};
