import assert from 'node:assert/strict';
import { medBlogEditorialSchema as schema } from '../src/lib/medblog/schema.ts';
import { selectMedBlogPosts } from '../src/lib/medblog/selection.ts';
import { medBlogTypes, medBlogTypeIds, medBlogTypeFromSegment, medBlogPostHref } from '../src/data/medblog.ts';

const base = { title: 'Demo', description: 'Beispielbeitrag', type: 'news', areas: ['medtools'], authors: ['orlando-frey'], published: '2026-09-27' };
let checks = 0;
function check(name, test) { test(); checks++; console.log(`✓ ${name}`); }
function invalid(data, field) {
  const result = schema.safeParse(data);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(({ path }) => path[0] === field));
}

check('Alle drei Typen und ihre deutschen URL-Segmente', () => {
  for (const type of medBlogTypeIds) {
    assert.equal(schema.parse({ ...base, type }).type, type);
    assert.equal(medBlogTypeFromSegment(medBlogTypes[type].segment), type);
    assert.equal(medBlogPostHref(type, 'beispiel'), `/medblog/${medBlogTypes[type].segment}/beispiel/`);
  }
});
check('Keine optionalen Pflicht-Bilder oder CTAs', () => {
  const result = schema.parse(base);
  assert.equal(result.image, undefined);
  assert.equal(result.cta, undefined);
  assert.deepEqual(result.tags, []);
  assert.equal(result.featured, false);
  assert.equal(result.draft, false);
});
check('Mehrere Areas und freie Tags', () => {
  const result = schema.parse({ ...base, areas: ['platform', 'meddocs', 'medtools', 'mednerds-basel'], tags: ['EKG', ' Lernen '] });
  assert.equal(result.areas.length, 4);
  assert.deepEqual(result.tags, ['EKG', 'Lernen']);
});
check('Unbekannter Typ', () => invalid({ ...base, type: 'basel' }, 'type'));
check('Unbekannte Area', () => invalid({ ...base, areas: ['unbekannt'] }, 'areas'));
check('Leere Areas', () => invalid({ ...base, areas: [] }, 'areas'));
check('Unbekannter Autor', () => invalid({ ...base, authors: ['unbekannt'] }, 'authors'));
check('Leere Autorenliste', () => invalid({ ...base, authors: [] }, 'authors'));
check('Fehlender Autor', () => { const { authors, ...rest } = base; invalid(rest, 'authors'); });
check('Fehlende Beschreibung', () => { const { description, ...rest } = base; invalid(rest, 'description'); });
check('Ungültiges Datum', () => invalid({ ...base, published: 'hallo' }, 'published'));
check('Unmöglicher Kalendertag', () => invalid({ ...base, published: '2026-02-30' }, 'published'));
check('Aktualisierung vor Veröffentlichung', () => invalid({ ...base, updated: '2026-09-26' }, 'updated'));
check('CTA mit internem Pfad oder HTTPS', () => {
  for (const href of ['/medtools/ekg/lagetyptrainer/', 'https://mednerds.ch/']) assert.equal(schema.parse({ ...base, cta: { label: 'Öffnen', href } }).cta.href, href);
});
check('Ungültige CTA-Links', () => {
  for (const href of ['javascript:alert(1)', '//example.com', '/\\example.com', 'https://']) invalid({ ...base, cta: { label: 'Öffnen', href } }, 'cta');
});
check('Stabiler einzelner Slug', () => {
  for (const slug of ['../demo', 'news/demo', '']) assert.throws(() => medBlogPostHref('news', slug), /Ungültiger/);
});

const posts = [
  { id: 'older', data: schema.parse({ ...base, type: 'article', areas: ['platform', 'meddocs'], published: '2026-09-25', featured: true }) },
  { id: 'draft', data: schema.parse({ ...base, draft: true, areas: ['mednerds-basel'] }) },
  { id: 'newest', data: schema.parse(base) },
  { id: 'middle', data: schema.parse({ ...base, type: 'update', areas: ['platform'], published: '2026-09-26' }) },
];
check('Neueste zuerst, ohne Drafts, ohne Mutation der Eingabe', () => {
  assert.deepEqual(selectMedBlogPosts(posts).map(({ id }) => id), ['newest', 'middle', 'older']);
  assert.equal(posts[0].id, 'older');
});
check('Drafts nur im lokalen Modus', () => {
  assert.equal(selectMedBlogPosts(posts, { includeDrafts: true }).length, 4);
  assert.deepEqual(selectMedBlogPosts(posts, { area: 'mednerds-basel' }), []);
});
check('Typ und Area kombinieren', () => {
  assert.deepEqual(selectMedBlogPosts(posts, { type: 'news', area: 'medtools' }).map(({ id }) => id), ['newest']);
  assert.deepEqual(selectMedBlogPosts(posts, { type: 'article', area: 'meddocs' }).map(({ id }) => id), ['older']);
});
check('Filter ohne Treffer', () => assert.deepEqual(selectMedBlogPosts(posts, { type: 'article', area: 'medtools' }), []));

console.log(`${checks} Prüfungen erfolgreich.`);
