import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { createArticleManifest, isCommentArticle, validateArticleManifest } from '../src/lib/meddocs/comments/articles.ts';
import { articleMetadataSchema } from '../src/lib/meddocs/article-metadata-schema.ts';

export async function readArticleEntries(root = process.cwd()) {
  const base = resolve(root, 'src/content/docs');
  const entries = [];
  for (const file of (await readdir(base, { recursive: true })).sort()) {
    if (!/\.mdx?$/.test(file)) continue;
    const path = join(base, file);
    const source = await readFile(path, 'utf8');
    const frontmatter = /^(\uFEFF?---)(\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
    if (!frontmatter) continue;
    const data = load(frontmatter[3]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const id = relative(base, path).replaceAll('\\', '/').replace(/\.mdx?$/, '');
    entries.push({ id, filePath: path, data, source, newline: frontmatter[2] });
  }
  return entries;
}

// UUID v5 (DNS namespace). Deterministic on first assignment, then persisted in frontmatter.
// Repeated CI checkouts agree even before the newly assigned ID is committed.
export function initialArticleId(id) {
  const bytes = createHash('sha1').update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'))
    .update(`mednerds.ch/${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function assignArticleIds(root = process.cwd()) {
  const entries = await readArticleEntries(root);
  const changes = [];
  for (const entry of entries) {
    if (isCommentArticle(entry) && entry.data.draft !== true && entry.data.comments !== false
      && entry.data.articleId === undefined) {
      entry.data.articleId = initialArticleId(entry.id);
      changes.push(entry);
    }
    articleMetadataSchema.parse(entry.data);
  }
  // Validate the entire set before changing any source file; never replace an existing ID.
  const manifest = createArticleManifest(entries);
  for (const entry of changes) {
    const source = entry.source.replace(/^(\uFEFF?---\r?\n)/, `$1articleId: ${entry.data.articleId}${entry.newline}`);
    await writeFile(entry.filePath, source);
  }
  return { assigned: changes.length, articles: manifest.filter(row => row.comments_enabled).length };
}

export async function repositoryManifest(root = process.cwd()) {
  const entries = await readArticleEntries(root);
  for (const entry of entries) articleMetadataSchema.parse(entry.data);
  return createArticleManifest(entries);
}

async function main(args) {
  if (args.length === 1 && args[0] === '--check') {
    const manifest = await repositoryManifest();
    console.log(`MedDocs: ${manifest.filter(row => row.comments_enabled).length} published comment articles validated. No source changes or remote action.`);
    return;
  }
  if (args.length === 1 && args[0] === '--assign-ids') {
    const result = await assignArticleIds();
    console.log(`MedDocs: ${result.articles} published comment articles; ${result.assigned} persistent IDs assigned. No remote action.`);
    return;
  }
  const options = new Map();
  for (const arg of args) {
    const match = /^--(manifest|out)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Expected --check, --assign-ids or unique --manifest/--out options.');
    options.set(match[1], match[2]);
  }
  const expected = await repositoryManifest();
  const manifest = validateArticleManifest(JSON.parse(await readFile(options.get('manifest') ?? '.astro/meddocs-comments-manifest.json', 'utf8')), expected);
  const json = JSON.stringify(manifest, null, 2);
  const sql = `-- COMPLETE deployment manifest. Requires the automatic-sync follow-up migration.\n-- Review the explicitly selected Production project before manual execution.\nbegin;\nselect public.meddocs_articles_sync('${json.replaceAll("'", "''")}'::jsonb);\n-- Expected count: ${manifest.length}. Published articles are activated; omitted/disabled articles are disabled.\n-- Inspect the catalog, then explicitly COMMIT or ROLLBACK.\n`;
  if (options.has('out')) {
    await writeFile(options.get('out'), sql, { flag: 'wx' });
    console.log(`Prepared ${manifest.length} repository-matched article IDs. No remote action.`);
  } else process.stdout.write(sql);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
