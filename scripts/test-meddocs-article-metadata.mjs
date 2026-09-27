import assert from 'node:assert/strict';
import { articleMetadataSchema as schema } from '../src/lib/meddocs/article-metadata-schema.ts';
import { articleDateTime, formatArticleDate, getMedDocsArticleMetadata } from '../src/lib/meddocs/article-metadata.ts';

const base = { authors: ['orlando-frey'], published: '2026-09-27' };
let checks = 0;

function check(name, test) {
  test();
  checks++;
  console.log(`✓ ${name}`);
}

function invalid(data, field) {
  const result = schema.safeParse(data);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(({ path }) => path[0] === field));
}

function entry(data = base, overrides = {}) {
  return {
    id: 'meddocs/diverses/beispielartikel',
    filePath: 'src/content/docs/meddocs/diverses/beispielartikel.mdx',
    data: { title: 'Demo', template: 'doc', ...schema.parse(data) },
    ...overrides,
  };
}

check('Autoren und Veröffentlichung ohne Aktualisierung', () => {
  const metadata = getMedDocsArticleMetadata(entry());
  assert.equal(metadata.authors[0].name, 'Orlando Frey');
  assert.equal(metadata.updated, undefined);
  assert.deepEqual(metadata.reviewers, []);
  assert.equal(metadata.license.label, 'CC BY-NC-SA 4.0');
  assert.equal(formatArticleDate(metadata.published), '27. September 2026');
  assert.equal(articleDateTime(metadata.published), '2026-09-27');
});

check('Aktualisierung und deutsche Datumsformatierung', () => {
  const metadata = getMedDocsArticleMetadata(entry({ ...base, updated: '2026-10-04' }));
  assert.equal(formatArticleDate(metadata.updated), '4. Oktober 2026');
});

check('YAML-Date und zitierte ISO-Daten werden gleich normalisiert', () => {
  assert.equal(schema.parse({ ...base, published: new Date('2026-09-27T12:00:00Z') }).published.getTime(), schema.parse(base).published.getTime());
});

check('Identische Aktualisierung wird ausgeblendet', () => {
  assert.equal(getMedDocsArticleMetadata(entry({ ...base, updated: '2026-09-27' })).updated, undefined);
});

check('Reviewer verwenden dieselbe Personen-Registry (nur Testdaten)', () => {
  const metadata = getMedDocsArticleMetadata(entry({ ...base, reviewers: ['orlando-frey'] }));
  assert.strictEqual(metadata.authors[0], metadata.reviewers[0]);
});

check('Explizite abweichende Lizenz', () => {
  assert.equal(getMedDocsArticleMetadata(entry({ ...base, license: 'cc-by-nc-4.0' })).license.label, 'CC BY-NC 4.0');
});

check('Legacy ohne Metadaten bleibt gültig und ohne Darstellung', () => {
  assert.deepEqual(schema.parse({}), {});
  assert.equal(getMedDocsArticleMetadata(entry({})), undefined);
});

check('Hub wird auch mit vollständigen Metadaten ausgeschlossen', () => {
  const hub = entry();
  hub.data.pageLayout = 'hub';
  assert.equal(getMedDocsArticleMetadata(hub), undefined);
});

check('Kategorie-/Index-Seiten werden ausgeschlossen', () => {
  assert.equal(getMedDocsArticleMetadata(entry(base, { id: 'meddocs/ekg', filePath: 'src/content/docs/meddocs/ekg/index.md' })), undefined);
});

check('Andere Produktbereiche werden ausgeschlossen', () => {
  for (const id of ['medtools/kardiologie/herzzyklus', 'medlearn/demo', 'medcases/demo', 'ueber-mednerds', 'faq', 'datenschutz', 'mednerds-basel', '']) {
    assert.equal(getMedDocsArticleMetadata(entry(base, { id })), undefined);
  }
});

check('Legal- und Landingpage-Layouts werden ausgeschlossen', () => {
  for (const override of [{ pageLayout: 'legal' }, { template: 'splash' }, { hero: { tagline: 'Demo' } }]) {
    const page = entry();
    Object.assign(page.data, override);
    assert.equal(getMedDocsArticleMetadata(page), undefined);
  }
});

check('Draft verhält sich lokal wie ein Artikel', () => {
  const draft = entry();
  draft.data.draft = true;
  assert.ok(getMedDocsArticleMetadata(draft));
});

check('Unbekannter Autor wird abgewiesen', () => invalid({ ...base, authors: ['unbekannte-person'] }, 'authors'));
check('Unbekannter Reviewer wird abgewiesen', () => invalid({ ...base, reviewers: ['unbekannte-person'] }, 'reviewers'));
check('Unbekannte Lizenz wird abgewiesen', () => invalid({ ...base, license: 'unbekannte-lizenz' }, 'license'));
check('Ungültiges Datum wird abgewiesen', () => invalid({ ...base, published: 'hallo' }, 'published'));
check('Nicht existierender Kalendertag wird abgewiesen', () => invalid({ ...base, published: '2026-02-30' }, 'published'));
check('Leere Autorenliste wird abgewiesen', () => invalid({ ...base, authors: [] }, 'authors'));
check('Veröffentlichung ohne Autor wird abgewiesen', () => invalid({ published: base.published }, 'authors'));
check('Autor ohne Veröffentlichung wird abgewiesen', () => invalid({ authors: base.authors }, 'published'));
check('Aktualisierung vor Veröffentlichung wird abgewiesen', () => invalid({ ...base, updated: '2026-09-26' }, 'updated'));

console.log(`${checks} Prüfungen erfolgreich.`);
