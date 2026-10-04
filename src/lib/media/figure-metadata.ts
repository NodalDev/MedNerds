import { validateFigureUrl } from './urls.ts';

export interface FigureCredit {
  text: string;
  href?: string;
}

export interface FigureMetadata {
  captionTitle?: string;
  caption?: string;
  credits: FigureCredit[];
  citation?: string;
}

interface MetadataOptions {
  captionTitle?: string;
  caption?: string;
  citationTitle?: string;
  creator?: string;
  organization?: string;
  license?: string;
  licenseUrl?: string;
  sourceUrl?: string;
}

function isLocalUrl(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
    || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

function resolveCitationSource(source: string | undefined, canonicalUrl?: URL): string | undefined {
  if (!source) return canonicalUrl && !isLocalUrl(canonicalUrl) ? canonicalUrl.href : undefined;
  let url: URL;
  try { url = new URL(source, canonicalUrl); }
  catch { return undefined; }
  if (!isLocalUrl(url)) return url.href;
  // Explicit development links also cite the configured public site.
  if (!canonicalUrl || isLocalUrl(canonicalUrl)) return undefined;
  return new URL(url.pathname + url.search + url.hash, canonicalUrl).href;
}

/** One editorial source for inline credits, lightbox credits and copied citations. */
export function createFigureMetadata(options: MetadataOptions, canonicalUrl?: URL): FigureMetadata {
  const attribution = [...new Set([options.creator, options.organization]
    .map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  const license = options.license?.trim();
  const source = options.sourceUrl?.trim() ? validateFigureUrl(options.sourceUrl) : undefined;
  const credits: FigureCredit[] = attribution.map((text) => ({ text }));
  if (license) credits.push({
    text: license,
    href: options.licenseUrl?.trim() ? validateFigureUrl(options.licenseUrl) : undefined,
  });
  if (source) credits.push({ text: 'Quelle', href: source });

  const title = options.citationTitle?.trim() || options.captionTitle?.trim() || options.caption?.trim();
  const citationSource = resolveCitationSource(source, canonicalUrl);
  const citation = title && license && citationSource
    ? `„${title}“ – ${[...attribution, license].join(', ')}, Quelle: ${citationSource}`
    : undefined;
  return { captionTitle: options.captionTitle?.trim() || undefined, caption: options.caption, credits, citation };
}
