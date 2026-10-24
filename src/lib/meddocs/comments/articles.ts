/** Stable repository identifiers; paths continue to be owned by Starlight. */
export const articleUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface CommentArticleEntry {
  id: string;
  filePath?: string;
  data: Record<string, unknown>;
}
export interface ArticleManifestEntry {
  id: string;
  locale: 'de';
  canonical_path: string;
  author_slugs: string[];
  state: 'published' | 'unpublished';
  comments_enabled: boolean;
}
export function isCommentArticle(entry: CommentArticleEntry): boolean {
  const { data } = entry;
  return entry.id.startsWith('meddocs/') && !/(?:^|\/)index$/.test(entry.id)
    && !/(?:^|[/\\])index\.[^.]+$/.test(entry.filePath ?? '')
    && (data.pageLayout === undefined || data.pageLayout === 'default')
    && data.template !== 'splash' && !data.hero
    && Array.isArray(data.authors) && data.authors.length > 0 && Boolean(data.published);
}
export function commentsVisible(entry: CommentArticleEntry): boolean {
  return isCommentArticle(entry) && entry.data.comments !== false && entry.data.draft !== true
    && typeof entry.data.articleId === 'string' && articleUuid.test(entry.data.articleId);
}
/** Validate ALL IDs, including drafts and disabled pages, before emitting an operator-only manifest. */
export function createArticleManifest(entries: readonly CommentArticleEntry[]): ArticleManifestEntry[] {
  const ids = new Set<string>();
  const manifest: ArticleManifestEntry[] = [];
  for (const entry of entries) {
    const id = entry.data.articleId;
    if (id !== undefined) {
      if (typeof id !== 'string' || !articleUuid.test(id)) throw new Error(`Invalid articleId: ${entry.id}`);
      if (ids.has(id.toLowerCase())) throw new Error(`Duplicate articleId: ${entry.id} (${id})`);
      ids.add(id.toLowerCase());
    }
    const editorial = isCommentArticle(entry);
    if (entry.data.comments === true && !editorial) throw new Error(`Invalid comment article: ${entry.id}`);
    if (editorial && entry.data.draft !== true && entry.data.comments !== false && !id) {
      throw new Error(`Missing persistent articleId: ${entry.id}. Run npm run comments:prepare.`);
    }
    // Keep former article IDs too: losing metadata or becoming a hub disables them.
    if (typeof id === 'string' && entry.id.startsWith('meddocs/')) manifest.push({
      id: id.toLowerCase(), locale: 'de', canonical_path: `/${entry.id.replace(/\/index$/, '')}/`,
      author_slugs: Array.isArray(entry.data.authors) ? (entry.data.authors as string[]).slice() : [],
      state: editorial && entry.data.draft !== true && entry.data.comments !== false ? 'published' : 'unpublished',
      comments_enabled: editorial && entry.data.draft !== true && entry.data.comments !== false,
    });
  }
  return manifest.sort((a, b) => a.canonical_path.localeCompare(b.canonical_path));
}

/** Operator preparation only. Compare a built manifest with a freshly built repository manifest. */
export function validateArticleManifest(value: unknown, expected: readonly ArticleManifestEntry[]): ArticleManifestEntry[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error('Manifest must be an array of at most 5000 articles.');
  const ids = new Set<string>(); const paths = new Set<string>();
  const rows: ArticleManifestEntry[] = value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid manifest entry.');
    const row = item as Record<string, unknown>;
    const keys = ['id', 'locale', 'canonical_path', 'author_slugs', 'state', 'comments_enabled'];
    if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))
      || typeof row.id !== 'string' || !articleUuid.test(row.id) || row.locale !== 'de'
      || typeof row.canonical_path !== 'string' || !/^\/meddocs\/[a-z0-9/-]+\/$/.test(row.canonical_path) || row.canonical_path.includes('//')
      || !Array.isArray(row.author_slugs) || (row.state === 'published' && !row.author_slugs.length)
      || !row.author_slugs.every((slug) => typeof slug === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
      || typeof row.state !== 'string' || !['published', 'unpublished'].includes(row.state)
      || typeof row.comments_enabled !== 'boolean'
      || (row.state === 'unpublished' && row.comments_enabled !== false)) throw new Error('Invalid manifest fields or activation request.');
    const id = row.id.toLowerCase();
    if (ids.has(id) || paths.has(row.canonical_path)) throw new Error('Duplicate manifest UUID or path.');
    ids.add(id); paths.add(row.canonical_path);
    return { id, locale: 'de', canonical_path: row.canonical_path, author_slugs: row.author_slugs.slice(), state: row.state as ArticleManifestEntry['state'], comments_enabled: row.comments_enabled };
  });
  const byId = new Map(expected.map((row) => [row.id, row]));
  if (rows.length !== expected.length || rows.some((row) => JSON.stringify(row) !== JSON.stringify(byId.get(row.id)))) {
    throw new Error('Manifest is incomplete or stale relative to the repository. Rebuild and review the article changes.');
  }
  return rows.sort((a, b) => a.canonical_path.localeCompare(b.canonical_path));
}
