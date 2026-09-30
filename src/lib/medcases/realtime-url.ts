const LOCAL_WORKER_ORIGIN = 'http://127.0.0.1:8787';

/** Public configuration contains origins only; production never accepts HTTP or loopback. */
export function publicRealtimeOrigin(value: string | undefined, development: boolean): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if ((development ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:')
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (!development && (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
      || /^127\./.test(url.hostname) || url.hostname === '[::1]')) return null;
    return url.origin;
  } catch { return null; }
}

export function configuredRealtimeOrigin(value: string | undefined, development: boolean): string | null {
  return publicRealtimeOrigin(value, development) ?? (development ? LOCAL_WORKER_ORIGIN : null);
}

export function realtimeWebSocketUrl(baseUrl: string, sessionId: string, development: boolean): string {
  const origin = publicRealtimeOrigin(baseUrl, development);
  if (!origin) throw new RangeError('Invalid Realtime origin.');
  const url = new URL(`/sessions/${sessionId}/connect`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
