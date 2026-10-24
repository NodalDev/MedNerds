import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { load } from 'js-yaml';
import { readArticleEntries } from './prepare-meddocs-comments-sync.mjs';
import { medBlogPostHref } from '../src/data/medblog.ts';

// Read an existing production build; never build, rewrite sources or contact a service.
const root = resolve(process.argv[2] ?? '.');
const output = join(root, 'dist');
const docs = (await readArticleEntries(root)).map(entry => {
  const slug = (entry.data.slug ?? entry.id).replace(/(^index$|\/index$)/, '');
  return { ...entry, route: slug ? '/' + slug + '/' : '/' };
});
const blogRoot = join(root, 'src/content/medblog');
const blog = await Promise.all((await readdir(blogRoot)).filter(file => /\.mdx?$/.test(file)).map(async file => {
  const source = await readFile(join(blogRoot, file), 'utf8');
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  assert.ok(frontmatter, `Missing frontmatter: ${file}`);
  const data = load(frontmatter[1]);
  return { source, data, filePath: join(blogRoot, file), route: medBlogPostHref(data.type, file.replace(/\.mdx?$/, '')) };
}));
const entries = [...docs, ...blog];
// Starlight deliberately renders the custom 404 as its system fallback, even with draft: true.
const errorPage = docs.find(entry => entry.id === '404');
if (errorPage) {
  assert.equal(errorPage.data.template, 'splash');
  assert.equal(errorPage.data.pagefind, false);
  assert.equal(errorPage.data.authors, undefined, 'The system 404 must not become an editorial article');
}
const drafts = entries.filter(entry => entry.data.draft === true && entry !== errorPage);
const files = (await readdir(output, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
const publicPaths = new Set(files.map(file => relative(output, file).replaceAll('\\', '/')));
assert.ok(publicPaths.has('index.html'), 'Missing built home page');
assert.ok(publicPaths.has('sitemap-index.xml') && publicPaths.has('sitemap-0.xml'), 'Missing sitemap');
assert.ok(publicPaths.has('pagefind/pagefind.js'), 'Missing Pagefind runtime');
const fragmentFiles = files.filter(file => file.endsWith('.pf_fragment'));
assert.ok(fragmentFiles.length > 0, 'Missing Pagefind fragments; a successful exit code alone is insufficient');

const decode = text => text.replace(/\\u([a-f0-9]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  .replaceAll('\\/', '/').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
  })[entity]).replace(/&#(x[a-f0-9]+|[0-9]+);/gi, (_, value) => String.fromCodePoint(
    value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)));
const plain = text => decode(text).replace(/<[^>]*>/g, ' ').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
const publishedSources = entries.filter(entry => entry.data.draft !== true).map(entry => plain(entry.source));
// Check substantial, draft-only prose too, so a body copied to a different URL fails.
const draftPassages = [...new Set(drafts.flatMap(entry => entry.source
  .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').split(/\r?\n\s*\r?\n/)
  .filter(paragraph => !/^\s*(import |export |[#<>`{!|*-])/.test(paragraph)).map(plain)
  .filter(paragraph => paragraph.length >= 40 && !publishedSources.some(source => source.includes(paragraph)))))];

// Regression: this draft previously emitted its complete interactive tool and images.
if (drafts.some(entry => entry.route === '/medtools/kardiologie/herzzyklus/')) {
  for (const path of publicPaths) assert.doesNotMatch(path,
    /(?:^|\/)(?:HyperHeart|herzzyklus)\.[^/]+\.(?:js|css)$|(?:^|\/)(?:atrial-systole|isovolumetric-contraction|isovolumetric-relaxation|rapid-ejection|rapid-ventricular-filling|reduced-ejection|reduced-ventricular-filling)\.[^/]+\.png$/,
    `Draft-only HyperHeart asset was emitted: ${path}`);
}
const contentModules = await readFile(join(root, '.astro/content-modules.mjs'), 'utf8');
for (const draft of drafts) {
  const sourcePath = relative(root, draft.filePath).replaceAll('\\', '/');
  assert.equal(contentModules.includes(sourcePath), false, `Draft is still in Astro's bundler imports: ${sourcePath}`);
  const path = draft.route.replace(/^\/+|\/+$/g, '');
  for (const file of [path + '/index.html', path + '.html', 'meddocs-previews/' + path + '.json']) {
    assert.equal(publicPaths.has(file), false, `Draft route/preview was emitted: ${file}`);
  }
}
const indexedPaths = new Set();
const searchablePaths = new Set();
for (const file of files) {
  const path = relative(output, file).replaceAll('\\', '/');
  assert.doesNotMatch(path, /(?:^|\/)(?:\.env(?:\.|$)|\.astro\/|src\/)|meddocs-comments-manifest|\.(?:mdx?|map)$/i,
    `Source, source map or internal manifest in public output: ${path}`);
  if (!/\.(?:html|json|js|mjs|xml|txt|svg|css|pf_fragment)$/.test(path)) continue;
  const bytes = await readFile(file);
  const text = file.endsWith('.pf_fragment') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  if (file.endsWith('.html') && text.includes('data-pagefind-body')) {
    searchablePaths.add('/' + path.replace(/index\.html$/, ''));
  }
  if (file.endsWith('.pf_fragment')) {
    const fragment = JSON.parse(text.slice(text.indexOf('{')));
    const url = new URL(fragment.url, 'https://mednerds.ch');
    assert.ok(publicPaths.has(url.pathname.replace(/^\//, '') + 'index.html')
      || publicPaths.has(url.pathname.replace(/^\//, '')), `Search result has no built page: ${fragment.url}`);
    assert.equal(indexedPaths.has(url.pathname), false, `Duplicate search fragment: ${fragment.url}`);
    indexedPaths.add(url.pathname);
  }
  let decoded = decode(text);
  try { decoded = decodeURIComponent(decoded); } catch { /* Other text can contain a literal percent sign. */ }
  for (const draft of drafts) assert.equal(decoded.includes(draft.route), false, `Draft URL in ${path}: ${draft.route}`);
  const content = plain(text);
  for (const passage of draftPassages) assert.equal(content.includes(passage), false, `Draft-only prose in ${path}`);
  assert.doesNotMatch(text, /sb_secret_[a-z0-9_-]+|MEDDOCS_COMMENTS_SYNC_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/i,
    `Privileged credential or server-only configuration in ${path}`);
}
assert.deepEqual([...indexedPaths].sort(), [...searchablePaths].sort(), 'Search fragments must exactly match indexable HTML pages');
console.log(`Production audit passed: ${drafts.length} drafts, ${publicPaths.size} output files, ${indexedPaths.size} decoded Pagefind fragments, ${draftPassages.length} draft-only passages. No draft routes, links, previews, sitemap/search entries or source artifacts found.`);
