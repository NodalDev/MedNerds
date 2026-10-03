import assert from 'node:assert/strict';
import { articleMetadataSchema as schema } from '../src/lib/meddocs/article-metadata-schema.ts';
import { articleDateTime, formatArticleDate, formatAuthorNames, getMedDocsArticleMetadata } from '../src/lib/meddocs/article-metadata.ts';
import { authors } from '../src/data/authors.ts';

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

check('Mehrere Autoren werden in Frontmatter-Reihenfolge aufgelöst', () => {
  const metadata = getMedDocsArticleMetadata(entry({ ...base, authors: ['orlando-frey', 'tim-luginbuehl'] }));
  assert.deepEqual(metadata.authors.map(({ name }) => name), ['Orlando Frey', 'Tim Luginbühl']);
  assert.strictEqual(metadata.authors[1], authors['tim-luginbuehl']);
  assert.equal(metadata.authors[1].description, 'Beschreibung folgt.');
});

check('Hans Muster und mehrere Reviewer verwenden dieselbe Personen-Registry', () => {
  const metadata = getMedDocsArticleMetadata(entry({ ...base, reviewers: ['hans-muster', 'tim-luginbuehl'] }));
  assert.deepEqual(metadata.reviewers, [authors['hans-muster'], authors['tim-luginbuehl']]);
  assert.strictEqual(metadata.reviewers[0], authors['hans-muster']);
  assert.match(metadata.reviewers[0].description, /Beispielperson/);
});

check('Datum der fachlichen Prüfung wird normalisiert und aufgelöst', () => {
  const quoted = schema.parse({ ...base, reviewed: '2026-10-03' });
  const yaml = schema.parse({ ...base, reviewed: new Date('2026-10-03T17:35:00Z') });
  assert.equal(quoted.reviewed.getTime(), yaml.reviewed.getTime());
  const metadata = getMedDocsArticleMetadata(entry(quoted));
  assert.equal(articleDateTime(metadata.reviewed), '2026-10-03');
  assert.equal(formatArticleDate(metadata.reviewed), '3. Oktober 2026');
});

check('Prüfung am Veröffentlichungstag bleibt sichtbar', () => {
  assert.equal(articleDateTime(getMedDocsArticleMetadata(entry({ ...base, reviewed: base.published })).reviewed), base.published);
});

check('Alte Artikel ohne neue Felder bleiben gültig', () => {
  const data = schema.parse(base);
  const metadata = getMedDocsArticleMetadata(entry(data));
  for (const field of ['reviewed', 'tags', 'synonyms', 'english', 'abbreviations']) {
    assert.equal(data[field], undefined);
    assert.equal(metadata[field], undefined);
  }
});

for (const field of ['tags', 'synonyms', 'english', 'abbreviations']) {
  check(`${field}: optional, getrimmt und ohne leere Werte`, () => {
    assert.equal(schema.parse(base)[field], undefined);
    assert.deepEqual(schema.parse({ ...base, [field]: [] })[field], []);
    const metadata = getMedDocsArticleMetadata(entry({ ...base, [field]: ['  Demo  ', ' Beispiel '] }));
    assert.deepEqual(metadata[field], ['Demo', 'Beispiel']);
    for (const value of ['', '   ', '\t\n']) invalid({ ...base, [field]: ['Demo', value] }, field);
    invalid({ ...base, [field]: ['Demo', 42] }, field);
    invalid({ ...base, [field]: 'Demo' }, field);
  });
}

check('Terminologie allein erzwingt keine Autorenmetadaten für Legacy-Seiten', () => {
  assert.deepEqual(schema.parse({ synonyms: [' Demo '], tags: ['Test'] }), { synonyms: ['Demo'], tags: ['Test'] });
});

check('Natürliche deutsche Namensformatierung für ein, zwei und drei Namen', () => {
  assert.equal(formatAuthorNames(['Orlando Frey']), 'Orlando Frey');
  assert.equal(formatAuthorNames(['Orlando Frey', 'Tim Luginbühl']), 'Orlando Frey und Tim Luginbühl');
  assert.equal(formatAuthorNames(['Person A', 'Person B', 'Person C']), 'Person A, Person B und Person C');
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
check('Fachliche Prüfung vor Veröffentlichung wird abgewiesen', () => invalid({ ...base, reviewed: '2026-09-26' }, 'reviewed'));
check('Ungültige Prüfdaten werden abgewiesen', () => {
  for (const reviewed of ['kein-datum', '2026-02-30', new Date('invalid')]) invalid({ ...base, reviewed }, 'reviewed');
});
check('Prüfdatum allein benötigt Autoren und Veröffentlichung', () => {
  invalid({ reviewed: '2026-10-03' }, 'authors');
  invalid({ reviewed: '2026-10-03' }, 'published');
});

console.log(`${checks} Prüfungen erfolgreich.`);
