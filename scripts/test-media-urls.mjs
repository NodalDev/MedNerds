import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import { resolveMediaUrl } from '../src/lib/media/urls.ts';
import { resolveFigureDownload } from '../src/lib/media/download.ts';
import { mediaUrlPlugin } from '../src/lib/media/markdown.ts';

// Use the same Sätteri version as Astro's installed MDX integration.
const requireMdx = createRequire(import.meta.resolve('@astrojs/mdx'));
const { mdxToJs } = await import(pathToFileURL(requireMdx.resolve('satteri')).href);
const origin = 'https://media.mednerds.ch';

test('media resolver: exact HTTPS origin, encoding, variants, query/fragment and idempotence', () => {
  for (const path of [
    '/meddocs/TCI/Example_preview.webp', '/meddocs/TCI/Example_full.png',
    '/meddocs/TCI/Example_source.png', '/meddocs/TCI/Example_large.webp',
    '/Konzentration%20am%20Wirkort.png?v=2&token=a%2Bb#detail',
    '/Umlaut-%C3%A4%2Fplus+comma,.png?size=full#x', '/',
  ]) {
    const output = `/media-assets${path}`;
    assert.equal(resolveMediaUrl(origin + path, true), output);
    assert.equal(resolveMediaUrl(output, true), output);
    assert.equal(resolveMediaUrl(resolveMediaUrl(origin + path, true), true), output);
  }
  assert.equal(resolveMediaUrl('https://MEDIA.MEDNERDS.CH:443/Case.png', true), '/media-assets/Case.png');
  for (const value of [
    '', 'not a URL', 'https://[invalid', '/local.png', '/media-assets/file.png',
    'https://example.org/file.png', 'https://media.mednerds.ch.example.org/file.png',
    'https://other-media.mednerds.ch/file.png', 'https://media.mednerds.ch@evil.example/file.png',
    'https://user:password@media.mednerds.ch/file.png', 'https://media.mednerds.ch:444/file.png',
    'http://media.mednerds.ch/file.png', '//media.mednerds.ch/file.png', 'data:image/png;base64,AAAA',
  ]) assert.equal(resolveMediaUrl(value, true), value);
});

test('ordinary local dev and production preview retain original URLs', () => {
  const url = `${origin}/Example_full.png?v=2#detail`;
  assert.equal(resolveMediaUrl(url, false), url);
  // Without Vite's build marker, importing the module in Node also defaults to local.
  assert.equal(resolveMediaUrl(url), url);
});

test('shared download selection still respects explicit source, fallbacks and opt-in', () => {
  const options = { src: `${origin}/preview.webp`, fullSrc: `${origin}/full.webp`, downloadSrc: `${origin}/source.png` };
  assert.equal(resolveFigureDownload(options), undefined);
  assert.equal(resolveFigureDownload({ ...options, downloadable: true }), options.downloadSrc);
  assert.equal(resolveFigureDownload({ ...options, downloadSrc: undefined, downloadable: true }), options.fullSrc);
  assert.equal(resolveFigureDownload({ src: options.src, downloadable: true }), options.src);
});

test('actual Astro Markdown pipeline rewrites image and media link attributes, not text/code/foreign links', async () => {
  const source = `![Bild](${origin}/preview.webp)\n\n[Original herunterladen](${origin}/source.png?v=2#detail)\n\n[Extern](https://example.org/)\n\n\`${origin}/code.png\``;
  for (const enabled of [false, true]) {
    const processor = await createSatteriMarkdownProcessor({ syntaxHighlight: false, hastPlugins: [mediaUrlPlugin(enabled)] });
    const { code } = await processor.render(source);
    const base = enabled ? '/media-assets' : origin;
    assert.ok(code.includes(`src="${base}/preview.webp"`), code);
    assert.ok(code.includes(`href="${base}/source.png?v=2#detail"`), code);
    assert.ok(code.includes('href="https://example.org/"'), code);
    assert.ok(code.includes(`${origin}/code.png`), code);
  }
});

test('actual MDX compilation handles native images and literal HTML attributes, preserving component expressions', async () => {
  const source = `![Bild](${origin}/markdown.webp)\n\n<img src="${origin}/inline.webp?v=2#x" alt="Bild" />\n\nText <a href="${origin}/source.png" download>Download</a>\n\n<MediaFigure src={frontmatter.image} />`;
  for (const enabled of [false, true]) {
    const { code } = await mdxToJs(source, { hastPlugins: [mediaUrlPlugin(enabled)] });
    const base = enabled ? '/media-assets' : origin;
    for (const path of ['/markdown.webp', '/inline.webp?v=2#x', '/source.png']) assert.ok(code.includes(`${base}${path}`), code);
    assert.ok(code.includes('frontmatter.image'), code);
    if (enabled) assert.ok(!code.includes(origin), code);
  }
});

const buildMode = process.argv.find(arg => arg.startsWith('--built='))?.slice('--built='.length);
if (buildMode) {
  if (!['local', 'netlify'].includes(buildMode)) throw Error('Use --built=local or --built=netlify');
  test(`built MediaFigure/MedDocsFigure: preview, lightbox, downloads and no direct R2 loads (${buildMode})`, async () => {
    const html = await readFile('dist/meddocs/anaesthesie/target-controlled-infusion/index.html', 'utf8');
    const base = buildMode === 'netlify' ? '/media-assets' : origin;
    const file = '/meddocs/anaesthesie/TCI/Kompartimentmodell';
    for (const [attribute, suffix] of [
      ['src', '_preview.webp'], ['href', '_large.webp'],
      ['data-download-src', '_full.png'], ['href', '_full.png'],
    ]) assert.ok(html.includes(`${attribute}="${base}${file}${suffix}"`), `${attribute} ${suffix}`);
    const encoded = '/meddocs/anaesthesie/TCI/Konzentration%20am%20Wirkort_preview.webp';
    assert.ok(html.includes(`src="${base}${encoded}"`));
    if (buildMode === 'netlify') {
      const files = await readdir('dist', { recursive: true });
      for (const file of files.filter(file => /\.(html|js|json)$/.test(file))) {
        const content = await readFile(`dist/${file}`, 'utf8');
        assert.doesNotMatch(content, /https:\/\/media\.mednerds\.ch\//, `Direct R2 reference in ${file}`);
      }
    }
  });
}
