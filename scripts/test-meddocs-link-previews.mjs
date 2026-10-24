import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { readArticleEntries } from './prepare-meddocs-comments-sync.mjs';
import { compactPreview, extractArticlePreview, isPreviewArticle } from '../src/lib/meddocs/link-previews/extract.ts';
import { isArticlePreview, previewAssetPath, previewTarget, selectedPreview } from '../src/lib/meddocs/link-previews/model.ts';

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
    for (const id of Object.keys(preview.sections)) assert.ok(html.includes(`id="${id}"`), `Compiled heading ID exists: ${id}`);
  }
  const sitemap = await readFile(new URL('../dist/sitemap-0.xml', import.meta.url), 'utf8');
  assert.equal(sitemap.includes('/meddocs-previews/'), false);
  console.log(`Verified ${files.length} published preview assets; no draft assets or sitemap entries.`);
});
