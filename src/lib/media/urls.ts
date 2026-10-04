/** Validate media/credit URLs without rewriting paths or signed query strings. */
export function validateFigureUrl(value: string): string {
  const url = value.trim();
  if (!url || !['http:', 'https:'].includes(new URL(url, 'https://mednerds.ch').protocol)) {
    throw new Error('Figure URLs must be non-empty HTTP(S) URLs or relative paths.');
  }
  return url;
}
