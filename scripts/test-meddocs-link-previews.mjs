import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
import { readArticleEntries } from './prepare-meddocs-comments-sync.mjs';
import { compactPreview, extractArticlePreview, isPreviewArticle } from '../src/lib/meddocs/link-previews/extract.ts';
import { isArticlePreview, previewAssetPath, previewTarget, selectedPreview } from '../src/lib/meddocs/link-previews/model.ts';

// Run the real client with its existing model; expose the private loader only in this test harness.
const { outputText: clientCode } = ts.transpileModule(
  await readFile(new URL('../src/lib/meddocs/link-previews/client.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
);
const clientLoader = fetch => new Function('exports', 'require', 'fetch', clientCode + '\nreturn loadPreview;')(
  {}, () => ({ isArticlePreview, previewAssetPath, previewTarget, selectedPreview }), fetch,
);
const preview = { path: '/meddocs/test/ziel/', title: 'Zielartikel', text: 'Vorschautext.', sections: {} };

test('preview fetch keeps same-origin credentials, mode and redirect protection for password-protected hosting', async t => {
  const fetch = t.mock.fn(async () => Response.json(preview));
  const load = clientLoader(fetch);
  assert.deepEqual(await load(preview.path), preview);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(fetch.mock.calls[0].arguments, [previewAssetPath(preview.path), {
    credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
  }]);
});

test('pending preview requests are deduplicated and a validated success stays cached', async t => {
  const response = Promise.withResolvers();
  const fetch = t.mock.fn(() => response.promise);
  const load = clientLoader(fetch);
  const first = load(preview.path), second = load(preview.path);
  assert.equal(fetch.mock.callCount(), 1);
  response.resolve(Response.json(preview));
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], preview);
  assert.equal(results[0], results[1]);
  assert.equal(await load(preview.path), results[0]);
  assert.equal(fetch.mock.callCount(), 1);
});

for (const status of [401, 403, 500]) test(`HTTP ${status} is handled without automatic retries and permits a later successful request`, async t => {
  const fetch = t.mock.fn(async () => Response.json(preview));
  fetch.mock.mockImplementationOnce(async () => new Response(null, { status }));
  const load = clientLoader(fetch);
  assert.equal(await load(preview.path), undefined);
  assert.equal(fetch.mock.callCount(), 1, 'no automatic retry');
  assert.deepEqual(await load(preview.path), preview);
  assert.equal(fetch.mock.callCount(), 2, 'a new interaction can retry');
  assert.deepEqual(await load(preview.path), preview);
  assert.equal(fetch.mock.callCount(), 2, 'the successful retry stays cached');
});

for (const [name, failure] of [
  ['network error', () => { throw new TypeError('Failed to fetch'); }],
  ['invalid JSON', () => new Response('{invalid json')],
  ['invalid preview data', () => Response.json({ ...preview, path: '/meddocs/test/wrong/' })],
]) test(`${name} is handled and does not poison the preview cache`, async t => {
  const fetch = t.mock.fn(async () => Response.json(preview));
  fetch.mock.mockImplementationOnce(async () => failure());
  const load = clientLoader(fetch);
  assert.equal(await load(preview.path), undefined);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(await load(preview.path), preview);
  assert.equal(fetch.mock.callCount(), 2);
});

// Exercise the real hover controller with only the DOM APIs it uses; no production exports.
function previewController(t, article) {
  class PreviewElement extends EventTarget {
    attributes = new Map();
    hidden = true;
    textContent = '';
    style = {};
    dataset = {};
    isConnected = true;
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    contains(target) { return target === this; }
    matches() { return false; }
    closest(selector) { return ['a[href]', 'p, li, dd'].includes(selector) ? this : null; }
    querySelector() { return null; }
    getBoundingClientRect() { return { left: 20, top: 20, bottom: 40, width: 320, height: 200 }; }
  }
  const panel = new PreviewElement(), content = new PreviewElement();
  const fields = Object.fromEntries(['breadcrumb', 'title', 'text'].map(name => [name, new PreviewElement()]));
  panel.id = 'meddocs-link-preview';
  panel.querySelector = selector => fields[selector.slice('[data-preview-'.length, -1)] ?? null;
  content.contains = target => target instanceof PreviewElement;
  const document = Object.assign(new EventTarget(), {
    documentElement: { clientWidth: 375, clientHeight: 850 },
    querySelector: selector => selector === '#meddocs-link-preview' ? panel : content,
  });
  const timers = new Map();
  let timerId = 0;
  const window = Object.assign(new EventTarget(), {
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
  });
  const fetch = t.mock.fn(async () => Response.json(article));
  const exports = {};
  new Function('exports', 'require', 'fetch', 'document', 'window', 'location', 'matchMedia', 'Element', 'Node', 'clearTimeout', clientCode)(
    exports, () => ({ isArticlePreview, previewAssetPath, previewTarget, selectedPreview }), fetch, document, window,
    { href: 'https://mednerds.ch/meddocs/test/quelle/', origin: 'https://mednerds.ch' },
    () => Object.assign(new EventTarget(), { matches: true }), PreviewElement, PreviewElement, id => timers.delete(id),
  );
  exports.initializeLinkPreviews();
  t.after(() => exports.disposeLinkPreviews());
  const close = () => document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  return { panel, fields, fetch, close, async hover(hash = '') {
    const link = Object.assign(new PreviewElement(), { href: article.path + (hash ? '#' + hash : '') });
    const event = Object.assign(new Event('pointerover'), { pointerType: 'mouse', relatedTarget: null });
    Object.defineProperty(event, 'target', { value: link });
    content.dispatchEvent(event);
    assert.equal(panel.hidden, true, 'preview waits for the existing hover delay');
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    assert.equal(timer.delay, 300);
    timers.delete(id);
    await timer.callback();
    assert.equal(panel.hidden, false);
    assert.equal(link.getAttribute('aria-details'), panel.id);
    return link;
  } };
}

test('whole-page hover renders the page title as breadcrumb and retains successful caching', async t => {
  const controller = previewController(t, preview);
  assert.equal(controller.fetch.mock.callCount(), 0, 'no eager request');
  await controller.hover();
  assert.equal(controller.fields.breadcrumb.textContent, preview.title);
  assert.equal(controller.fields.title.textContent, preview.title);
  assert.equal(controller.fields.text.textContent, preview.text);
  controller.close();
  await controller.hover();
  assert.equal(controller.fetch.mock.callCount(), 1);
});

test('section hover renders parent and full heading without guessing an abbreviation or adding category text', async t => {
  const article = { ...preview, title: 'Allgemeinanästhesie', sections: {
    tiva: { title: 'Total intravenöse Anästhesie (TIVA)', text: 'Unveränderter Abschnittstext.' },
  } };
  const { fields, hover, panel } = previewController(t, article);
  await hover('tiva');
  assert.equal(fields.breadcrumb.textContent, 'Allgemeinanästhesie › Total intravenöse Anästhesie (TIVA)');
  assert.equal(fields.title.textContent, article.sections.tiva.title);
  assert.equal(fields.text.textContent, article.sections.tiva.text);
  assert.doesNotMatch(Object.values(fields).map(field => field.textContent).join('\n'), /Unterkapitel|Aus:/);
  assert.equal(panel.querySelector('[data-preview-parent]'), null);
});

test('missing optional section/text data and an unknown hash safely fall back to the page breadcrumb', async t => {
  const article = { path: preview.path, title: 'Seite ohne Zusatzdaten', sections: {} };
  const { fields, hover } = previewController(t, article);
  await hover('unbekannt');
  assert.equal(fields.breadcrumb.textContent, article.title);
  assert.equal(fields.title.textContent, article.title);
  assert.equal(fields.text.textContent, '');
  assert.equal(fields.text.hidden, true);
});

test('long page and section titles remain complete plain text in the breadcrumb', async t => {
  const article = { ...preview, title: 'Langer Seitentitel '.repeat(30), sections: {
    abschnitt: { title: 'Langer Unterkapiteltitel '.repeat(30) + '<img src=x>' },
  } };
  const { fields, hover } = previewController(t, article);
  await hover('abschnitt');
  assert.equal(fields.breadcrumb.textContent, article.title + ' › ' + article.sections.abschnitt.title);
  assert.equal(fields.title.textContent, article.sections.abschnitt.title);
});

const entry = (body = '', data = {}) => ({ id: 'meddocs/test/ziel', filePath: 'src/content/docs/meddocs/test/ziel.mdx', body,
  data: { title: 'Zielartikel', authors: ['orlando-frey'], published: new Date(), draft: false, ...data } });
const headings = [{ depth: 2, text: 'Grundlagen', slug: 'grundlagen' }, { depth: 3, text: 'Äquivalenz', slug: 'äquivalenz' }, { depth: 2, text: 'Weiter', slug: 'weiter' }];

test('only published editorial MedDocs entries are indexed, independently of comments', () => {
  assert.equal(isPreviewArticle(entry('', { comments: false })), true);
  for (const data of [{ draft: true }, { draft: undefined }, { authors: [] }, { published: undefined }, { pageLayout: 'hub' }, { template: 'splash' }, { hero: {} }]) {
    assert.equal(isPreviewArticle(entry('', data)), false);
  }
  assert.equal(isPreviewArticle({ ...entry(), id: 'medblog/test' }), false);
  assert.equal(isPreviewArticle({ ...entry(), id: 'meddocs/test/index' }), false);
  assert.throws(() => extractArticlePreview(entry('GEHEIMER ENTWURF', { draft: true }), []), /No public preview/);
});
test('manual article and section descriptions take precedence without rewriting headings', () => {
  const result = extractArticlePreview(entry('## Grundlagen\n\nAutomatischer Text.\n\n### Äquivalenz\n\nAbschnittstext.\n\n## Weiter', {
    description: 'SEO-Beschreibung.', linkPreview: 'Manueller Artikeltext.', sectionPreviews: { 'äquivalenz': 'Manuelles Unterkapitel.' },
  }), headings);
  assert.equal(result.text, 'Manueller Artikeltext.');
  assert.equal(result.sections['äquivalenz'].text, 'Manuelles Unterkapitel.');
  assert.equal(result.sections['äquivalenz'].title, 'Äquivalenz');
});
test('article description precedes the first suitable body paragraph', () => {
  assert.equal(extractArticlePreview(entry('Inhaltlicher Absatz.', { description: 'Seitenbeschreibung.' }), []).text, 'Seitenbeschreibung.');
  assert.equal(extractArticlePreview(entry('In diesem Artikel findest du Details.\n\nFachlicher **Absatz** mit [Link](https://example.org) und `Cp`.', { description: 'Beschreibung folgt.' }), []).text,
    'Fachlicher Absatz mit Link und Cp.');
});
test('sections stop before the next child or sibling and do not borrow article descriptions', () => {
  const result = extractArticlePreview(entry('## Grundlagen\n\n### Äquivalenz\n\nText ausschließlich für das Unterkapitel.\n\n## Weiter', { description: 'Gesamtartikel.' }), headings);
  assert.equal(result.sections.grundlagen.text, undefined);
  assert.equal(result.sections['äquivalenz'].text, 'Text ausschließlich für das Unterkapitel.');
  assert.equal(result.sections.weiter.text, undefined);
});
test('compiled heading IDs are authoritative, including repeated headings and Unicode', () => {
  const ids = [{ depth: 2, text: 'Test', slug: 'vom-compiler' }, { depth: 2, text: 'Test', slug: 'vom-compiler-1' }];
  const result = extractArticlePreview(entry('## Test\n\nErster Abschnitt.\n\n## Test\n\nZweiter Abschnitt.'), ids);
  assert.equal(result.sections['vom-compiler'].text, 'Erster Abschnitt.');
  assert.equal(result.sections['vom-compiler-1'].text, 'Zweiter Abschnitt.');
  assert.throws(() => extractArticlePreview(entry('', { sectionPreviews: { veraltet: 'Manuell.' } }), ids), /unbekannte Abschnitts-ID/);
  const mismatch = extractArticlePreview(entry('## Anders\n\nNicht zuordnen.'), ids);
  assert.equal(mismatch.sections['vom-compiler'].text, undefined);
});
test('tables, lists, images, callouts, formulas, MDX and HTML do not leak into automatic excerpts', () => {
  const body = 'import Figure from "./Figure.astro";\n\n![Bildunterschrift](image.png)\n\n| Tabelle | Wert |\n| --- | --- |\n| A | B |\n\n- Listeneintrag\n\n:::note\nVersteckter Callouttext.\n:::\n\n<Figure caption="Bildunterschrift" />\n\n<div>HTML-Inhalt</div>\n\nFormel $x = y$.\n\nText mit <Component /> und Ausdruck {value}.\n\nLesbarer **Fließtext** mit [Link](javascript:alert).';
  assert.equal(extractArticlePreview(entry(body), []).text, 'Lesbarer Fließtext mit Link.');
  assert.equal(extractArticlePreview(entry('Lorem ipsum dolor sit amet.'), []).text, undefined);
  assert.equal(extractArticlePreview(entry('## Literatur\n\nAutor. Fachbuch.'), [{ depth: 2, text: 'Literatur', slug: 'literatur' }]).text, undefined);
  const bibliography = extractArticlePreview(entry('## Literatur\n\n### Handbuch\n\nKein Vorschautext.'), [
    { depth: 2, text: 'Literatur', slug: 'literatur' }, { depth: 3, text: 'Handbuch', slug: 'handbuch' },
  ]);
  assert.equal(bibliography.text, undefined);
  assert.equal(bibliography.sections.handbuch.text, undefined);
});
test('shortening retains complete sentences, negations and number/unit pairs', () => {
  const sentence = 'Die Dosis von 5 mg darf nicht ohne individuelle Prüfung verwendet werden.';
  assert.equal(compactPreview(sentence), sentence);
  assert.equal(compactPreview(sentence + ' ' + 'Eine sehr lange Einschränkung '.repeat(20)), sentence);
  assert.equal(compactPreview('Eine einzelne sehr lange Aussage '.repeat(20)), undefined);
  assert.equal(compactPreview('Komponenten des Modells:'), undefined);
  assert.equal(compactPreview('Beschreibung. Die Komponenten sind:'), 'Beschreibung.');
  assert.equal(compactPreview('Ein Beispiel ist z. B. ' + 'ein langer einschränkender Nebensatz '.repeat(20)), undefined);
});
test('relative, absolute and encoded internal links resolve; same article and external targets do not', () => {
  const page = 'http://localhost:4321/meddocs/test/quelle/';
  const canonical = 'https://mednerds.ch';
  const expected = { path: '/meddocs/test/ziel/', hash: 'äquivalenz' };
  for (const href of ['../ziel/#%C3%A4quivalenz', '/meddocs/test/ziel/#äquivalenz', 'https://mednerds.ch/meddocs/test/ziel/#%C3%A4quivalenz']) {
    assert.deepEqual(previewTarget(href, page, canonical), expected);
  }
  for (const href of ['#grundlagen', page, 'https://mednerds.ch/meddocs/test/quelle/#teil', 'https://doi.org/10.123/a', 'https://evil.test/meddocs/test/ziel/', 'javascript:alert(1)', '/account/', '/meddocs/test/ziel/#%GG']) {
    assert.equal(previewTarget(href, page, canonical), undefined);
  }
  assert.equal(previewAssetPath('/meddocs/test/ä/'), '/meddocs-previews/meddocs/test/%C3%A4.json');
  assert.equal(previewTarget('/meddocs/test/ziel/#a%CC%88', page, canonical).hash, 'a\u0308', 'actual Unicode heading IDs are not rewritten');
});
test('unknown sections safely return the article and prototype properties never become sections', () => {
  const result = extractArticlePreview(entry('## Grundlagen\n\nAbsatz.'), headings.slice(0, 1));
  assert.equal(selectedPreview(result, 'grundlagen').kind, 'Unterkapitel');
  assert.equal(selectedPreview(result, 'veraltet').kind, 'Artikel');
  assert.equal(selectedPreview(result, 'constructor').kind, 'Artikel');
  assert.equal(isArticlePreview(JSON.parse(JSON.stringify(result)), result.path), true);
  assert.equal(isArticlePreview({ ...result, path: '/wrong/' }, result.path), false);
  assert.equal(extractArticlePreview(entry('## Constructor\n\nEchter Absatz.', { sectionPreviews: {} }), [{ depth: 2, text: 'Constructor', slug: 'constructor' }]).sections.constructor.text, 'Echter Absatz.');
});

if (process.argv.includes('--built')) test('built assets contain every published eligible article and no draft, with real rendered IDs', async () => {
  const entries = await readArticleEntries();
  const eligible = entries.filter(value => isPreviewArticle({ ...value, data: { ...value.data, draft: value.data.draft ?? false } }));
  const root = new URL('../dist/meddocs-previews/', import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.json'));
  assert.equal(files.length, eligible.length);
  for (const file of files) {
    const preview = JSON.parse(await readFile(new URL(file.replaceAll('\\', '/'), root), 'utf8'));
    const entry = eligible.find(value => '/' + value.id + '/' === preview.path);
    assert.ok(entry, `No draft/non-editorial preview allowed: ${file}`);
    assert.equal(isArticlePreview(preview, preview.path), true);
    const html = await readFile(new URL('../dist' + preview.path + 'index.html', import.meta.url), 'utf8');
    const popover = html.match(/<aside\b[^>]*\bid="meddocs-link-preview"[^>]*>[\s\S]*?<\/aside>/)?.[0];
    assert.ok(popover, "Published article includes the link preview popover");
    assert.match(popover, /<p\b[^>]*\bdata-preview-breadcrumb/);
    assert.doesNotMatch(popover, /data-preview-kind|data-preview-parent|<nav\b|<a\b/);
    for (const id of Object.keys(preview.sections)) assert.ok(html.includes(`id="${id}"`), `Compiled heading ID exists: ${id}`);
  }
  const sitemap = await readFile(new URL('../dist/sitemap-0.xml', import.meta.url), 'utf8');
  assert.equal(sitemap.includes('/meddocs-previews/'), false);
  console.log(`Verified ${files.length} published preview assets; no draft assets or sitemap entries.`);
});
