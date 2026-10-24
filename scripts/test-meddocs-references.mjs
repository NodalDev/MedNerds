import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { load } from 'js-yaml';
import { referenceSchema,referencesSchema,cslTypes,publicationIdsSchema } from '../src/lib/meddocs/references/schema.ts';
import { readPublicationCatalog,resolvePublications } from '../src/lib/meddocs/references/catalog.ts';
import { groupLiterature,literatureCategory,compareLiterature } from '../src/lib/meddocs/references/categories.ts';
import { collectCitations,referenceOrder,citationNumbers,partitionReferences } from '../src/lib/meddocs/references/numbering.ts';
import { referenceToCsl,articleToCsl,canonicalArticleUrl,doiUrl,selectCitationItems,allCitationSources } from '../src/lib/meddocs/references/model.ts';
import { citationStyles, defaultCitationStyle, formatBibliography } from '../src/lib/meddocs/references/format.ts';
import { exportBibtex,exportRis } from '../src/lib/meddocs/references/export.ts';
import { authors } from '../src/data/authors.ts';
import { testBook,testReferences } from './fixtures/meddocs-references.mjs';
import { referenceAwareLoader } from '../src/lib/meddocs/references/loader.ts';
const root=new URL('../src/lib/meddocs/references/csl/',import.meta.url);
const showcase=await readFile(new URL('../src/content/docs/meddocs/diverses/beispielartikel.mdx',import.meta.url),'utf8');
const showcaseMatch=/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(showcase);
assert.ok(showcaseMatch,'Showcase has a complete YAML frontmatter block');
const [,showcaseFrontmatter,showcaseBody]=showcaseMatch;
const showcaseData=load(showcaseFrontmatter);
const catalog=await readPublicationCatalog();
const fixtureCatalog=async()=>new Map([...catalog,...[testBook,...testReferences,{...testBook,id:'zweites'}].map(source=>[source.id,referenceSchema.parse(source)])]);
test('actual showcase has eight clearly illustrative sources, five types and reserved URLs',()=>{
  const sources=resolvePublications(showcaseData.references,catalog,'showcase');
  assert.equal(sources.length,8);
  assert.deepEqual([...new Set(sources.map(source=>source.type))].sort(),['book','chapter','journal-article','report','website']);
  for(const source of sources){assert.match(source.title,/illustrative Testdaten/);assert.equal(source.doi,undefined);assert.equal(new URL(source.url).hostname,'example.org');}
  assert.equal(typeof showcaseData.draft,'boolean');assert.equal(showcaseData.pagefind,false);assert.equal(showcaseData.sidebar.hidden,true);
});
test('showcase numbers single, multiple, repeated and initially hidden sources by first appearance',()=>{
  const sources=resolvePublications(showcaseData.references,catalog,'showcase');
  const citations=collectCitations(showcaseBody);
  const order=referenceOrder(sources,citations);
  assert.deepEqual(order,['demo-zeitschriftenartikel','demo-buch','demo-buchkapitel','demo-handbuch']);
  assert.deepEqual(citations.map(ids=>citationNumbers(ids,order)),[[1],[2,3],[1],[4]]);
  const groups=partitionReferences(sources,order);assert.equal(groups.cited.length,4);assert.equal(groups.literature.length,4);
  assert.deepEqual(groups.literature.map(source=>source.id),['demo-website','demo-bericht','demo-onlineartikel','demo-onlineportal']);
});
test('empty, literature-only, citations-only and hybrid articles partition without duplicate entries',()=>{
  const sources=referencesSchema.parse(testReferences.slice(0,4));
  assert.deepEqual(partitionReferences([],[]),{cited:[],literature:[]});
  assert.deepEqual(partitionReferences(sources,referenceOrder(sources,[])),{cited:[],literature:sources});
  const allOrder=referenceOrder(sources,[sources.map(source=>source.id)]);
  assert.deepEqual(partitionReferences(sources,allOrder),{cited:sources,literature:[]});
  const order=referenceOrder(sources,[['testquelle-4','testquelle-2'],['testquelle-4']]);
  const mixed=partitionReferences(sources,order);
  assert.deepEqual(mixed.cited.map(source=>source.id),['testquelle-4','testquelle-2']);
  assert.deepEqual(mixed.literature.map(source=>source.id),['testquelle-1','testquelle-3']);
  assert.equal(new Set([...mixed.cited,...mixed.literature].map(source=>source.id)).size,sources.length);
  assert.throws(()=>partitionReferences(sources,['missing']),/Unbekannte/);
  assert.throws(()=>partitionReferences(sources,['testquelle-1','testquelle-1']),/Doppelte/);
});
test('uncited additions and reordered frontmatter cannot change citation numbers; repeats stay stable',()=>{
  const sources=referencesSchema.parse(testReferences.slice(0,3));
  const citations=[['testquelle-2'],['testquelle-1','testquelle-2']];
  const order=referenceOrder(sources,citations);
  assert.deepEqual(order,['testquelle-2','testquelle-1']);
  const expanded=[...referencesSchema.parse(testReferences.slice(3,8)),...sources.toReversed()];
  assert.deepEqual(referenceOrder(expanded,citations),order);
  for(let build=0;build<3;build++)assert.deepEqual(referenceOrder(expanded,citations),order);
  assert.deepEqual(citationNumbers(citations[1],order),[1,2]);
  assert.throws(()=>citationNumbers(['testquelle-3'],order),/Unbekannte/);
});
const assets={styles:{},locales:{}};
for(const[id,file]of Object.entries({'mednerds-vancouver':'mednerds-vancouver.csl',vancouver:'vancouver.csl',apa:'apa.csl',harvard:'harvard-cite-them-right.csl',chicago:'chicago-author-date.csl',mla:'modern-language-association.csl'}))assets.styles[id]=await readFile(new URL(file,root),'utf8');
for(const lang of ['en-US','en-GB','de-DE'])assets.locales[lang]=await readFile(new URL(`locales-${lang}.xml`,root),'utf8');
test('five source types validate their specific required fields',()=>{
  for(const source of [testBook,{...testBook,type:'journal-article',publisher:undefined,journal:'Testjournal'},{...testBook,type:'chapter',bookTitle:'Sammelband',pages:'10–20'},{id:'web',type:'website',title:'Website',url:'https://example.test/',accessed:'2026-10-11'},{id:'report',type:'report',title:'Bericht',publisher:'Institution',year:2024}]){
    const cleaned=Object.fromEntries(Object.entries(source).filter(([,value])=>value!==undefined));assert.equal(referenceSchema.safeParse(cleaned).success,true);
  }
  for(const source of [{...testBook,year:undefined},{...testBook,authors:undefined},{...testBook,publisher:undefined},{id:'web',type:'website',title:'Website',url:'https://example.test/'}])assert.equal(referenceSchema.safeParse(source).success,false);
});
test('duplicate IDs, dates, DOI and unsafe URLs are validated without provider lookups',()=>{
  assert.equal(referencesSchema.safeParse([testBook,testBook]).success,false);
  for(const input of [{...testBook,doi:'javascript:alert(1)'},{...testBook,url:'javascript:alert(1)'},{...testBook,url:'https://user:password@example.test'},{...testBook,published:'2024-02-30'},{...testBook,published:'2023-01-01'}])assert.equal(referenceSchema.safeParse(input).success,false);
  assert.equal(referenceSchema.parse({...testBook,doi:'https://doi.org/10.1234/test'}).doi,'10.1234/test');
  assert.equal(doiUrl('10.1234/test#1'),'https://doi.org/10.1234/test%231');
});
test('AST numbering follows first citations, repeats IDs and ignores code examples',()=>{
  const citations=collectCitations('Text <MedCitation sources={["testquelle-3", "testquelle-1"]} />\n\n<MedCitation sources={["testquelle-3", "testquelle-2"]} />\n\n```mdx\n<MedCitation sources={["missing"]} />\n```');
  const order=referenceOrder(referencesSchema.parse(testReferences.slice(0,3)),citations);
  assert.deepEqual(order,['testquelle-3','testquelle-1','testquelle-2']);assert.deepEqual(citationNumbers(['testquelle-2','testquelle-3','testquelle-3'],order),[1,3]);
  assert.deepEqual(referenceOrder([],[]),[]);
});
test('unknown targets, duplicate definitions and dynamic expressions fail loudly',()=>{
  assert.throws(()=>referenceOrder([testBook],[['missing']]),/missing/);
  assert.throws(()=>referenceOrder([testBook,testBook],[]),/Doppelte/);
  for(const mdx of ['<MedCitation />','<MedCitation sources={someVariable} />','<MedCitation sources={[getId()]} />'])assert.throws(()=>collectCitations(mdx),/MedCitation|Quellen/);
});
test('loader enriches before digest caching and upgrades old cache; dev writes keep numbering',async()=>{
  const entry={id:'meddocs/test',digest:'original',data:{authors:['orlando-frey'],published:'2026-10-01',references:['buch']},body:'Text <MedCitation sources={["buch"]} />'};
  const rows=new Map([[entry.id,entry]]);let wrapped;
  const store={get:id=>rows.get(id),entries:()=>[...rows],delete:id=>rows.delete(id),set:value=>{if(rows.get(value.id)?.digest===value.digest)return false;rows.set(value.id,value);return true;}};
  const loader=referenceAwareLoader({name:'test',load:async context=>{wrapped=context.store;}},fixtureCatalog);
  await loader.load({store});assert.deepEqual(rows.get(entry.id).data.referenceOrder,['buch']);assert.equal(rows.get(entry.id).digest,'original');
  wrapped.set({...entry,digest:'edited',data:{...entry.data,references:['buch','zweites']},body:'Text <MedCitation sources={["zweites", "buch"]} />'});
  assert.deepEqual(rows.get(entry.id).data.referenceOrder,['zweites','buch']);
});
test('loader upgrades cached mixed/literature-only orders and preserves classification across reload/watch writes',async()=>{
  const sources=referencesSchema.parse(testReferences.slice(0,4));
  const data={authors:['orlando-frey'],published:'2026-10-01',references:sources.map(source=>source.id),referenceOrder:sources.map(source=>source.id)};
  const entry={id:'meddocs/hybrid',digest:'same-digest',data,body:'<MedCitation sources={["testquelle-2"]} />'};
  const uncited={...entry,id:'meddocs/literature',body:'Allgemeine Literatur ohne Zitiermarker.'};
  const rows=new Map([[entry.id,entry],[uncited.id,uncited]]);let wrapped,deletions=0;
  const store={get:id=>rows.get(id),entries:()=>[...rows],delete:id=>{deletions++;return rows.delete(id)},set:value=>{if(rows.get(value.id)?.digest===value.digest)return false;rows.set(value.id,value);return true;}};
  const loader=referenceAwareLoader({name:'hybrid-test',load:async context=>{wrapped=context.store}},fixtureCatalog);
  await loader.load({store});assert.deepEqual(rows.get(entry.id).data.referenceOrder,['testquelle-2']);assert.deepEqual(rows.get(uncited.id).data.referenceOrder,[]);
  assert.equal(rows.get(entry.id).digest,entry.digest);assert.equal(deletions,2);
  await loader.load({store});assert.equal(deletions,2,'unchanged second build does not rewrite the cache');
  wrapped.set({...entry,digest:'changed',body:'<MedCitation sources={["testquelle-4","testquelle-1"]} />'});
  assert.deepEqual(rows.get(entry.id).data.referenceOrder,['testquelle-4','testquelle-1']);
  wrapped.set({...entry,digest:'no-citations',body:'Nur Literatur.'});assert.deepEqual(rows.get(entry.id).data.referenceOrder,[]);
});
test('CSL maps journal/chapter/report and online dates without inventing optional data',()=>{
  const journal=referenceToCsl(referenceSchema.parse({id:'j',type:'journal-article',title:'Artikel',authors:[{family:'Müller'}],year:2024,journal:'Testjournal',articleNumber:'e123',doi:'10.1234/test'}));
  assert.equal(journal.type,'article-journal');assert.equal(journal.page,'e123');assert.equal(journal.DOI,'10.1234/test');assert.equal(journal.URL,undefined);
  const website=referenceToCsl(referenceSchema.parse({id:'web',type:'website',title:'Online',url:'https://example.test',accessed:'2026-10-11'}));assert.equal(website.issued,undefined);assert.deepEqual(website.accessed,{'date-parts':[[2026,10,11]]});
});
test('article uses actual registry name, original date, platform and public canonical URL',()=>{
  const item=articleToCsl('Titel',{authors:[authors['orlando-frey']],published:new Date('2026-10-01'),reviewers:[]},canonicalArticleUrl('/meddocs/test/',new URL('https://mednerds.ch')));
  assert.deepEqual(item.author,[{family:'Frey',given:'Orlando'}]);assert.equal(item.URL,'https://mednerds.ch/meddocs/test/');assert.equal(item['container-title'],'MedNerds MedDocs');
  assert.deepEqual(item.issued,{'date-parts':[[2026,10,1]]});assert.throws(()=>canonicalArticleUrl('/test',new URL('http://localhost:4321')));
  assert.equal(new URL(canonicalArticleUrl('//evil.test/',new URL('https://mednerds.ch'))).hostname,'mednerds.ch');
});
const expectations={vancouver:'1. Müller A. Testbuch. Testverlag; 2024.',apa:'Müller, A. (2024). Testbuch. Testverlag.',harvard:'Müller, A. (2024) Testbuch. Testverlag.',chicago:'Müller, Anna. 2024. Testbuch. Testverlag.',mla:'Müller, Anna. Testbuch. Testverlag, 2024.'};
for(const[style,expected]of Object.entries(expectations))test(`pinned ${style} CSL produces the expected known synthetic book citation`,()=>{
  assert.equal(formatBibliography([referenceToCsl(referenceSchema.parse(testBook))],style,assets)[0].text,expected);
  assert.deepEqual(formatBibliography([],style,assets),[]);
});

test('MedNerds Vancouver is the default; punctuated initials, DOI priority and URL fallback work for all five types',()=>{
  assert.equal(defaultCitationStyle,'mednerds-vancouver');
  assert.equal(citationStyles[0].id,defaultCitationStyle);
  const shared={title:'Synthetische Quelle',authors:[{family:'Müller',given:'Anna Maria'}],year:2024};
  const sources=[
    {...shared,id:'journal',type:'journal-article',journal:'Testjournal',volume:'12',issue:'2',pages:'10–18'},
    {...shared,id:'book',type:'book',publisher:'Testverlag'},
    {...shared,id:'chapter',type:'chapter',bookTitle:'Testbuch',publisher:'Testverlag',pages:'10–18',editors:[{family:'Meier',given:'Thomas Rudolf'}]},
    {...shared,id:'website',type:'website',website:'Testportal',url:'https://example.test/quelle',accessed:'2026-10-17'},
    {...shared,id:'report',type:'report',publisher:'Testinstitut'},
  ];
  for(const source of sources){
    for(const given of ['Anna Maria','A.M.','A. M.']){
      const reference=referenceSchema.parse({...source,authors:[{family:'Müller',given}],doi:'10.1234/mednerds-test',url:'https://example.test/quelle'});
      const [row]=formatBibliography([referenceToCsl(reference)],defaultCitationStyle,assets);
      assert.match(row.text,/^1\. Müller A\. M\./);
      assert.match(row.text,/https:\/\/doi\.org\/10\.1234\/mednerds-test$/);
      assert.doesNotMatch(row.text,/\[Internet\]|Available (?:from|at)|example\.test/i);
      if(source.type==='chapter')assert.match(row.text,/Meier T\. R\./);
    }
    const fallback=referenceSchema.parse({...source,url:'https://example.test/quelle'});
    const text=formatBibliography([referenceToCsl(fallback)],defaultCitationStyle,assets)[0].text;
    assert.match(text,/https:\/\/example\.test\/quelle$/);
    assert.doesNotMatch(text,/\[Internet\]|Available (?:from|at)|doi\.org/i);
  }
  const rows=formatBibliography(sources.map(source=>referenceToCsl(referenceSchema.parse(source))),defaultCitationStyle,assets);
  assert.deepEqual(rows.map(row=>row.id),sources.map(source=>source.id));
  rows.forEach((row,index)=>assert.match(row.text,new RegExp(`^${index+1}\\.`)));
  assert.deepEqual(formatBibliography([],defaultCitationStyle,assets),[]);
});
test('bibliography handles 1, 3, 4, 5, 6, 8, 30 entries; Vancouver retains citation order',()=>{
  for(const count of [1,3,4,5,6,8,30])assert.equal(formatBibliography(referencesSchema.parse(testReferences.slice(0,count)).map(referenceToCsl),'vancouver',assets).length,count);
  const rows=formatBibliography([referenceToCsl(referenceSchema.parse(testReferences[2])),referenceToCsl(referenceSchema.parse(testReferences[0]))],'vancouver',assets);assert.equal(rows[0].id,'testquelle-3');
});
test('article, cited/literature/all and single-source selections retain exactly their records in all styles and exports',()=>{
  const sources=resolvePublications(showcaseData.references,catalog,'showcase');
  const groups=partitionReferences(sources,referenceOrder(sources,collectCitations(showcaseBody)));
  const payload={article:articleToCsl(showcaseData.title,{authors:[authors['orlando-frey']],published:new Date('2026-09-27'),reviewers:[]},'https://mednerds.ch/meddocs/diverses/beispielartikel/'),cited:groups.cited.map(referenceToCsl),literature:groups.literature.map(referenceToCsl)};
  const all=allCitationSources(payload);assert.equal(all.length,8);assert.equal(new Set(all.map(item=>item.id)).size,8);
  const targets={article:[payload.article],cited:payload.cited,literature:payload.literature,references:all,'reference:demo-website':all.filter(item=>item.id==='demo-website')};
  for(const [target,expected]of Object.entries(targets)){
    const selected=selectCitationItems(payload,target);assert.deepEqual(selected,expected);
    for(const style of Object.keys(assets.styles)){
      const rows=formatBibliography(selected,style,assets);assert.deepEqual(rows.map(row=>row.id).sort(),expected.map(item=>item.id).sort());
    }
    const bib=exportBibtex(selected),ris=exportRis(selected);
    assert.equal((bib.match(/^@/gm)??[]).length,expected.length);assert.equal((ris.match(/^TY  - /gm)??[]).length,expected.length);
    for(const item of all){assert.equal(bib.includes(`{${item.id},`),selected.some(row=>row.id===item.id));assert.equal(ris.includes(`ID  - ${item.id}\r\n`),selected.some(row=>row.id===item.id));}
  }
  assert.deepEqual(selectCitationItems(payload,'reference:missing'),[]);
  assert.match(formatBibliography(payload.literature,'vancouver',assets)[0].text,/^1\./,'explicit Vancouver export can number literature');
});
test('BibTeX/RIS preserve structured metadata, Unicode and protect record delimiters',()=>{
  const item=referenceToCsl(referenceSchema.parse({...testBook,title:'Herz & Gefäße {Test}',doi:'10.1234/test',url:'https://example.test/'}));
  const bib=exportBibtex([item]);assert.match(bib,/@book\{buch,/);assert.match(bib,/author = \{Müller, Anna\}/);assert.match(bib,/Herz \\& Gefäße \\\{Test\\\}/);assert.match(bib,/doi = \{10.1234\/test\}/);
  const ris=exportRis([item]);assert.match(ris,/TY  - BOOK\r\n/);assert.match(ris,/AU  - Müller, Anna/);assert.match(ris,/DO  - 10.1234\/test/);assert.ok(ris.endsWith('ER  - \r\n'));
  assert.equal(exportBibtex([]),'');assert.equal(exportRis([]),'');
});
test('vendored CSL and locales match pinned manifest SHA-256',async()=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  for(const entry of manifest.files)assert.equal(createHash('sha256').update(await readFile(new URL(entry.file,root))).digest('hex'),entry.sha256);
  for(const entry of manifest.derivations){
    assert.equal(createHash('sha256').update(await readFile(new URL(entry.file,root))).digest('hex'),entry.sha256);
    assert.equal(manifest.files.find(file=>file.file===entry.derivedFrom).sha256,entry.upstreamSha256);
  }
});

test('central catalog resolves reused IDs, rejects missing/duplicate IDs and invalid metadata',async()=>{
  assert.equal(catalog.size,10);
  const ids=['total-intravenous-anesthesia-and-target-controlled-infusions'];
  assert.deepEqual(resolvePublications(ids,catalog,'article-a'),resolvePublications(ids,catalog,'draft-b'));
  assert.throws(()=>resolvePublications(['missing'],catalog,'meddocs/draft.mdx'),/meddocs\/draft\.mdx.*missing/);
  assert.equal(publicationIdsSchema.safeParse([ids[0],ids[0]]).success,false);
  assert.equal(publicationIdsSchema.safeParse([testBook]).success,false,'no parallel inline definition format');
  assert.equal(referenceSchema.safeParse({...testBook,meddocsCategory:'invalid'}).success,false);
  const directory=await mkdtemp(join(tmpdir(),'mednerds-publications-'));
  const folder=pathToFileURL(directory+'/');
  try{
    await writeFile(new URL('a.json',folder),JSON.stringify(testBook));
    await writeFile(new URL('b.json',folder),JSON.stringify(testBook));
    await assert.rejects(readPublicationCatalog(folder),/Doppelte Publikations-ID.*buch/);
    await writeFile(new URL('b.json',folder),JSON.stringify({...testBook,id:'invalid',type:'not-a-csl-type'}));
    await assert.rejects(readPublicationCatalog(folder),/b.json/);
  }finally{
    for(const name of ['a.json','b.json'])await rm(new URL(name,folder));
    await rmdir(directory);
  }
});

test('all valid CSL types preserve type, and categories affect no formatter or export data',()=>{
  for(const type of cslTypes){
    const source=referenceSchema.parse({...testBook,type,journal:'Testjournal',bookTitle:'Testband',pages:'1–2',url:'https://example.test/',accessed:'2026-10-23'});
    assert.equal(referenceToCsl(source).type,type);
    assert.equal(typeof literatureCategory(source),'string');
  }
  const cases={book:'books',chapter:'books',collection:'books',classic:'books','entry-dictionary':'books','entry-encyclopedia':'books','article-journal':'articles',article:'articles','paper-conference':'articles',standard:'guidelines',webpage:'online',post:'online','post-weblog':'online',report:'other',thesis:'other',dataset:'other',software:'other',manuscript:'other',interview:'other',legislation:'other',treaty:'other'};
  for(const [type,category]of Object.entries(cases))assert.equal(literatureCategory({...testBook,type}),category);
  const source=referenceSchema.parse({...testBook,type:'article-journal',journal:'Testjournal',doi:'10.1234/test',url:'https://example.test/'});
  assert.equal(literatureCategory(source),'articles','URL/DOI never make a journal article a website');
  const override=referenceSchema.parse({...source,meddocsCategory:'guidelines'});
  assert.equal(literatureCategory(override),'guidelines');
  assert.deepEqual(referenceToCsl(source),referenceToCsl(override));
  assert.equal(exportBibtex([referenceToCsl(source)]),exportBibtex([referenceToCsl(override)]));
  assert.equal(exportRis([referenceToCsl(source)]),exportRis([referenceToCsl(override)]));
  for(const style of Object.keys(assets.styles))assert.deepEqual(formatBibliography([referenceToCsl(source)],style,assets),formatBibliography([referenceToCsl(override)],style,assets));
});

test('literature grouping sorts authors, corporations, year, title and ID without mutation',()=>{
  const source=(id,extra={})=>referenceSchema.parse({...testBook,id,...extra});
  const items=[source('mueller-2025',{year:2025}),source('mueller-2023',{year:2023}),source('corporate',{authors:[{literal:'Ärztegesellschaft'}]}),source('no-author',{type:'standard',authors:undefined,year:undefined,title:'Atemweg'}),source('undated',{type:'manuscript',year:undefined}),source('a',{title:'Titel'}),source('b',{title:'Titel'}),source('url',{type:'webpage',url:'https://example.test/',accessed:'2026-10-23',authors:[{literal:'Zentrale'}]})];
  const snapshot=JSON.stringify(items);
  const groups=groupLiterature(items);
  assert.deepEqual(groups.map(group=>group.category),['books','guidelines','online','other']);
  assert.deepEqual(groups[0].sources.map(source=>source.id),['corporate','mueller-2023','a','b','mueller-2025']);
  assert.ok(compareLiterature(items[0],items[4])<0,'undated follows dated');
  assert.equal(JSON.stringify(items),snapshot);
  assert.deepEqual(groupLiterature([]),[]);
  const list=resolvePublications(showcaseData.references,catalog,'showcase');
  const order=referenceOrder(list,collectCitations(showcaseBody));
  const split=partitionReferences(list,order);
  assert.equal(groupLiterature(split.literature).flatMap(group=>group.sources).some(source=>order.includes(source.id)),false);
});

test('catalog-only changes refresh digest-cached articles and watcher writes',async()=>{
  let title='Original';let wrapped;const listeners=new Map();
  const entry={id:'meddocs/draft',digest:'same',filePath:'draft.mdx',data:{draft:true,authors:['orlando-frey'],published:'2026-10-01',references:['buch']},body:'<MedCitation sources={["buch"]} />'};
  const rows=new Map([[entry.id,entry]]);
  const store={get:id=>rows.get(id),entries:()=>[...rows],delete:id=>rows.delete(id),set:value=>{if(rows.get(value.id)?.digest===value.digest)return false;rows.set(value.id,value);return true;}};
  const watcher={add(){},on(event,callback){listeners.set(event,callback);return this}};
  const loader=referenceAwareLoader({name:'catalog-test',load:async context=>{wrapped=context.store}},async()=>new Map([['buch',referenceSchema.parse({...testBook,title})]]));
  await loader.load({store,watcher,logger:{error:assert.fail}});
  assert.equal(rows.get(entry.id).data.resolvedReferences[0].title,'Original');
  assert.equal(rows.get(entry.id).data.draft,true);
  title='Updated';await loader.load({store});
  assert.equal(rows.get(entry.id).data.resolvedReferences[0].title,'Updated');
  title='Watcher';
  const {publicationDirectory}=await import('../src/lib/meddocs/references/catalog.ts');
  listeners.get('change')(new URL('buch.json',publicationDirectory).pathname.replace(/^\/([A-Z]:)/,'$1'));
  for(let i=0;i<20&&rows.get(entry.id).data.resolvedReferences[0].title!=='Watcher';i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(rows.get(entry.id).data.resolvedReferences[0].title,'Watcher');
  assert.deepEqual(rows.get(entry.id).data.referenceOrder,['buch']);
  wrapped.set({...entry,digest:'cleared',data:{...entry.data,references:[]},body:'No sources'});
  assert.deepEqual(rows.get(entry.id).data.resolvedReferences,[]);
  assert.deepEqual(rows.get(entry.id).data.referenceOrder,[]);
});
