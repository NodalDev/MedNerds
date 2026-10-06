import assert from 'node:assert/strict';
import { linkResourceSchema } from '../src/lib/links/schema.ts';
import { readLinkFilters, matchesLinkFilters, linkSearchText, normalizeLinkSearch, linkFilterUrl, sortLinkResources } from '../src/lib/links/filters.ts';
import { linkFixtures } from './fixtures/link-resources.mjs';
import { linkSpecialtyIds } from '../src/data/link-resources.ts';

const resources=linkFixtures.map((fixture,index)=>({id:String(index),data:linkResourceSchema.parse(fixture)}));
assert.equal(resources.length,6);
assert.equal(resources[0].data.checked.toISOString(),'2026-10-06T00:00:00.000Z');
assert.equal(linkResourceSchema.parse({...linkFixtures[0],checked:new Date('2026-10-06T14:00:00Z')}).checked.toISOString(),'2026-10-06T00:00:00.000Z');
for(const patch of [
  {specialties:['invalid']},{formats:['invalid']},{languages:['xx']},{access:'invalid'},
  {url:'javascript:alert(1)'},{url:'ftp://example.org'},{url:'data:text/html,test'},{url:'/relative/'},{url:'not a URL'},
  {specialties:[]},{formats:[]},{languages:[]},{title:' '},{checked:'2026-02-30'},{rating:5},
]) assert.equal(linkResourceSchema.safeParse({...linkFixtures[0],...patch}).success,false,JSON.stringify(patch));
assert.equal(linkResourceSchema.safeParse({...linkFixtures[0],url:'http://example.org/'}).success,true);

const match=(filters,baseline)=>resources.filter(({data})=>matchesLinkFilters({...data,search:linkSearchText(data)},filters,baseline)).map(({id})=>id);
assert.deepEqual(match({specialty:'ultraschall'}),['3']);
assert.deepEqual(match({format:'podcast'}),['1','3']);
assert.deepEqual(match({language:'de'}),['0','1','3']);
assert.deepEqual(match({access:'paid'}),['2','5']);
assert.deepEqual(match({specialty:'ultraschall',format:'podcast',language:'de',access:'mixed'}),['3']);
assert.deepEqual(match({specialty:'allgemein'}),['0']);
for(const q of ['übungsfälle','UEBUNGSFALLE','  übungsfälle   testressource  ','Beschreibungstest','Testanbieter Beta','sonderthema','Literatur']) {
  assert.deepEqual(match({q}),['4'],q);
}
assert.deepEqual(match({q:'Anästhesie'}),['1']);
assert.deepEqual(match({q:'Ultraschall'}),['3']);
assert.deepEqual(match({q:'none'}),[]);
assert.deepEqual(match({},'ultraschall'),['3']);
assert.deepEqual(match({specialty:'ekg'},'ultraschall'),[]);
for (const [specialty, ids] of Object.entries({
  anaesthesie: ['1'], ekg: ['5'], echokardiographie: ['2'],
  notfallmedizin: ['3', '4'], ultraschall: ['3'], allgemein: ['0'],
})) {
  assert.deepEqual(match({}, specialty), ids, specialty);
  assert.deepEqual(match(readLinkFilters(new URLSearchParams('format=podcast')), specialty),
    ids.filter((id) => resources[Number(id)].data.formats.includes('podcast')), specialty);
  assert.ok(match({q:'pocus'}, specialty).every((id) => ids.includes(id)), specialty);
  for (const other of linkSpecialtyIds) {
    assert.ok(match({specialty:other}, specialty).every((id) => ids.includes(id)), 'Baseline must never leak another specialty');
  }
}
assert.deepEqual(match({format:'podcast',q:'pocus'},'notfallmedizin'),['3']);
assert.deepEqual(match({format:'tool'},'ultraschall'),[]);
assert.equal(normalizeLinkSearch('  Ä ö Ü Straße '),'a o u strasse');
assert.equal(normalizeLinkSearch('AErzte'),normalizeLinkSearch('Ärzte'));
assert.deepEqual(match(readLinkFilters(new URLSearchParams('specialty=foobar&format=bad&language=bad&access=bad'))),resources.map(({id})=>id));
assert.equal(readLinkFilters(new URLSearchParams('q=++abc+++def++')).q,'abc def');
assert.deepEqual(sortLinkResources(resources).map(({id})=>id),['0','1','2','5','3','4']);
const current=new URL('https://mednerds.ch/medtools/links/?keep=value&q=old&format=podcast#results');
const filtered=linkFilterUrl(current,{q:'pocus',specialty:'ultraschall',language:'de'});
assert.equal(filtered.searchParams.get('q'),'pocus');
assert.equal(filtered.searchParams.get('specialty'),'ultraschall');
assert.equal(filtered.searchParams.get('language'),'de');
assert.equal(filtered.searchParams.has('format'),false);
assert.equal(filtered.searchParams.get('keep'),'value');
assert.equal(filtered.hash,'#results');
assert.equal(linkFilterUrl(filtered,{}).href,'https://mednerds.ch/medtools/links/?keep=value#results');
assert.equal(current.searchParams.get('q'),'old');
console.log('✓ Linksammlung: schema/URLs/dates, every filter/AND, search/umlauts, neutral/invalid values, immutable baseline, sorting, URL/reset');
