export interface PreviewText {
  title: string;
  text?: string;
}

export interface ArticlePreview extends PreviewText {
  path: string;
  sections: Record<string, PreviewText>;
}

export interface PreviewTarget {
  path: string;
  hash: string;
}

/** Normalize URLs, never link labels; keep native hrefs entirely untouched. */
export function previewTarget(href: string, current: string, canonicalOrigin: string): PreviewTarget | undefined {
  try {
    const page = new URL(current);
    const url = new URL(href, page);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || ![page.origin, canonicalOrigin].includes(url.origin)) return;
    const normalize = (path: string) => {
      const decoded = decodeURIComponent(path).normalize('NFC');
      if (!decoded.startsWith('/meddocs/') || /[\\\u0000-\u001f]/.test(decoded)) return;
      return decoded.replace(/\/+$/, '') + '/';
    };
    const path = normalize(url.pathname);
    if (!path || path === normalize(page.pathname)) return;
    return { path, hash: decodeURIComponent(url.hash.slice(1)) };
  } catch { return; }
}

export function previewAssetPath(path: string): string {
  return '/meddocs-previews' + path.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/') + '.json';
}

export function selectedPreview(article: ArticlePreview, hash: string): PreviewText & { kind: 'Artikel' | 'Unterkapitel'; parent?: string } {
  const section = hash && Object.hasOwn(article.sections, hash) ? article.sections[hash] : undefined;
  return section ? { ...section, kind: 'Unterkapitel', parent: article.title }
    : { title: article.title, text: article.text, kind: 'Artikel' };
}

/** Assets are plain data. DOM rendering still uses textContent exclusively. */
export function isArticlePreview(value: unknown, path: string): value is ArticlePreview {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const text = (entry: unknown): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Record<string, unknown>;
    return typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 1000
      && (item.text === undefined || typeof item.text === 'string' && item.text.length <= 240);
  };
  return data.path === path && text(data) && Boolean(data.sections) && typeof data.sections === 'object'
    && !Array.isArray(data.sections) && Object.values(data.sections as object).every(text);
}
