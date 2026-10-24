import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { testReferences } from './fixtures/meddocs-references.mjs';
import { createTestWorkspace, removeTestWorkspace } from './lib/test-workspace.mjs';
const args=process.argv.slice(2);
if(args.length===1&&args[0].startsWith('--clean=')){
  await removeTestWorkspace(args[0].slice('--clean='.length));
  process.exit(0);
}
if(args.some(arg=>arg!=='--keep'))throw new Error('Use --keep, or --clean=<owned workspace path>.');
const workspace=await createTestWorkspace('references');
let keep=false;
const counts=[0,1,3,4,5,6,8,30];
const cases=[...counts.map(count=>({name:String(count),count,mode:'cited'})),{name:'literature',count:8,mode:'literature'},{name:'hybrid',count:8,mode:'hybrid'}];
const paths=cases.map(({name})=>new URL(`src/content/docs/meddocs/diverses/reference-regression-${name}.mdx`,workspace.url));
const showcasePath=new URL('src/content/docs/meddocs/diverses/reference-regression-showcase.mdx',workspace.url);
const catalogDirectory=new URL('src/data/meddocs/publications/reference-regression/',workspace.url);
const catalogPaths=testReferences.map(source=>new URL(`${source.id}.json`,catalogDirectory));
  try{
    await mkdir(catalogDirectory,{recursive:true});
    for(const [index,source]of testReferences.entries()){
      await writeFile(catalogPaths[index],JSON.stringify(source,null,2)+'\n',{flag:'wx'});
    }
    for(const [index,path]of paths.entries()){
      const {count,name,mode}=cases[index];const sources=testReferences.slice(0,count);
      const citations=mode==='literature'||!count?'':mode==='hybrid'
        ? 'Erste Zitierung <MedCitation sources={["testquelle-8"]} />. Mehrfachverweis <MedCitation sources={["testquelle-2", "testquelle-6"]} />. Wiederholung <MedCitation sources={["testquelle-8"]} />. Verborgener Nachweis <MedCitation sources={["testquelle-1"]} />.'
        : `Erste Zitierung <MedCitation sources={["testquelle-${count}"]} />. Weitere Zitierung <MedCitation sources={["testquelle-1", "testquelle-${count}"]} />. Alle Quellen <MedCitation sources={${JSON.stringify(sources.map(source=>source.id))}} />.`;
      const content=`---\ncomments: false\ntitle: Quellenregression ${name} – NUR TESTDATEN\ndescription: Ausschließlich lokale technische Testdaten.\nauthors: [orlando-frey]\npublished: 2026-10-01\nreviewers: [hans-muster]\nreviewed: 2026-10-02\npagefind: false\nsidebar:\n  hidden: true\nhead:\n  - tag: meta\n    attrs:\n      name: robots\n      content: noindex,nofollow\nreferences: ${JSON.stringify(sources.map(source=>source.id))}\nlearningUrl: /medlearn/\n---\n\nimport MedCitation from '../../../../components/meddocs/MedCitation.astro';\n\nDiese synthetischen Quellen sind keine medizinischen Referenzen.\n\n${citations}\n`;
      await writeFile(path,content,{flag:'wx'});
    }
    // Test the actual showcase content without changing its editorial publication status.
    const showcase=await readFile(new URL('src/content/docs/meddocs/diverses/beispielartikel.mdx',workspace.url),'utf8');
    if(!/^draft: (true|false)$/m.test(showcase))throw new Error('Showcase draft field missing; review the fixture.');
    await writeFile(showcasePath,showcase.replace(/^draft: (true|false)$/m,'draft: false'),{flag:'wx'});
    let firstMarkers;
    for(let build=0;build<2;build++){
      const exit=await new Promise((resolve,reject)=>{const child=workspace.astro(['build']);child.once('error',reject);child.once('close',resolve);});
      if(exit!==0)throw new Error(`Fixture build failed: ${exit}`);
      const markers=await Promise.all([...cases.map(row=>row.name),'showcase'].map(async name=>{
        const html=await readFile(new URL(`dist/meddocs/diverses/reference-regression-${name}/index.html`,workspace.url),'utf8');
        return [...html.matchAll(/<a href="#quelle-([^"]+)"[^>]*aria-label="Quelle (\d+)"[^>]*>(\d+)<\/a>/g)].map(match=>[match[1],match[2],match[3]]);
      }));
      for(const [index,row]of cases.entries())if(row.count>0&&row.mode!=='literature'&&!markers[index].length)throw new Error(`Missing rendered citation markers in ${row.name}.`);
      if(!markers.at(-1).length)throw new Error('Missing showcase citation markers.');
      if(!build)firstMarkers=markers;
      else if(JSON.stringify(markers)!==JSON.stringify(firstMarkers))throw new Error('Citation markers changed across repeated builds.');
    }
    console.log('✓ Citation IDs and numbering remain identical across two fixture builds.');
    keep=args.includes('--keep');
    if(keep)console.log(`Retained isolated workspace for browser inspection: ${workspace.root}\nRemove afterward with --clean="${workspace.root}".`);
  }finally{if(!keep)await workspace.cleanup();}
