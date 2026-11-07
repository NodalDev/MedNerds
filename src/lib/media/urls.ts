/** Netlify supplies the proxy; ordinary Astro dev/build/preview keeps R2 URLs. */
export function resolveMediaUrl(value: string, useProxy = import.meta.env?.MEDNERDS_MEDIA_PROXY === true): string {
  if (!useProxy) return value;
  let url: URL;
  try { url = new URL(value); }
  catch { return value; }
  if (url.origin !== 'https://media.mednerds.ch' || url.username || url.password) return value;
  return `/media-assets${url.pathname}${url.search}${url.hash}`;
}

/** Validate media/credit URLs without rewriting paths or signed query strings. */
export function validateFigureUrl(value: string): string {
  const url = value.trim();
  if (!url || !['http:', 'https:'].includes(new URL(url, 'https://mednerds.ch').protocol)) {
    throw new Error('Figure URLs must be non-empty HTTP(S) URLs or relative paths.');
  }
  return url;
}
