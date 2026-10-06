import assert from 'node:assert/strict';
import { writeFile, unlink, readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linkFixtures } from './fixtures/link-resources.mjs';
import { matchesLinkFilters } from '../src/lib/links/filters.ts';

const medDocsPages = [
  ['anaesthesie', 'anaesthesie', 'Anästhesie', ['Anästhesie Testressource']],
  ['ekg', 'ekg', 'EKG', ['EKG Testressource']],
  ['echokardiographie', 'echokardiographie', 'Echokardiographie', ['Echo Testressource']],
  ['notfallmedizin', 'notfallmedizin', 'Notfallmedizin', ['POCUS Testressource', 'Übungsfälle Testressource']],
  ['ultraschall', 'ultraschall', 'Ultraschall', ['POCUS Testressource']],
];

// Starts a dedicated Astro dev server after seeding; use local headless Chrome/CDP.
// Temporary, explicitly marked fixtures are removed in finally; never commit/publish them.
const site=process.env.LINKS_SITE ?? 'http://127.0.0.1:4325';
const endpoint=process.env.LINKS_CDP ?? 'http://127.0.0.1:9334';
const route='/medtools/links/';
const fixtureName=`browser-link-fixture-${process.pid}`;
const created=[];
let server;
let serverOutput='';
let allResources=[];
let originalResourceCount=0;
const target=await(await fetch(`${endpoint}/json/new?about:blank`,{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
let sequence=0;
const pending=new Map();
const errors=[];
socket.onmessage=({data})=>{
  const message=JSON.parse(data);
  if(pending.has(message.id)){
    const {resolve,reject}=pending.get(message.id);pending.delete(message.id);
    message.error?reject(new Error(message.error.message)):resolve(message.result);
  }
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
};
function command(method,params={}){return new Promise((resolve,reject)=>{
  const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
})}
async function evaluate(expression){
  const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(expression){for(let i=0;i<120;i++){if(await evaluate(expression))return;await pause(75)}throw new Error(`Timed out: ${expression}`)}
async function navigate(path){
  await command('Page.navigate',{url:`${site}${path}`});
  try { await waitFor("document.readyState==='complete' && !!document.querySelector('link-explorer')"); }
  catch(error){throw new Error(`${error.message}\n${await evaluate('location.href+" "+document.body.innerText.slice(0,1500)')}\n${serverOutput.slice(-3000)}`)}
}
async function set(key,value){
  await evaluate(`(()=>{const input=document.querySelector('link-explorer [name="${key}"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await pause(180);
}
async function state(){return evaluate(`(()=>{
  const root=document.querySelector('link-explorer');return {
    visible:[...root.querySelectorAll('[data-link-resource]:not([hidden])')].map(card=>card.querySelector('h3 a').textContent.replace(' (externe Ressource)','').trim()),
    count:root.querySelector('[data-result-count]').textContent.trim(),
    empty:!root.querySelector('[data-empty]').hidden,reset:!root.querySelector('[data-reset]').hidden,
    query:location.search,controls:Object.fromEntries([...root.querySelectorAll('input,select')].map(input=>[input.name,input.value])),
  }
})()`)}
async function reset(){await evaluate("document.querySelector('link-explorer [data-reset]').click()");await pause(30)}
async function assertCards(){
  const cards=await evaluate(`(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d');
    const luminance=color=>{
      context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);
      const rgb=[...context.getImageData(0,0,1,1).data].slice(0,3).map(v=>{
        const value=v/255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;
      });
      return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
    };
    const contrast=(text,background)=>{
      const a=luminance(text),b=luminance(background);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    };
    return [...document.querySelectorAll('link-explorer .resource-card')].map(card=>{
      const meta=card.querySelector('.resource-kicker'),title=card.querySelector('h3'),link=title.querySelector('a');
      const background=getComputedStyle(card).backgroundColor;
      return {
        provider:!!card.querySelector('.resource-provider'),
        metaSize:parseFloat(getComputedStyle(meta).fontSize),titleSize:parseFloat(getComputedStyle(title).fontSize),
        link:link.hasAttribute('href'),externalText:link.querySelector('.sr-only').textContent.trim(),
        iconHidden:link.querySelector('svg').getAttribute('aria-hidden'),
        contrast:[meta,title,card.querySelector('.resource-description')].map(node=>contrast(getComputedStyle(node).color,background)),
        chips:[...card.querySelectorAll('.resource-tags li')].map(chip=>({
          text:chip.textContent.trim(),contrast:contrast(getComputedStyle(chip).color,getComputedStyle(chip).backgroundColor),
        })),
      };
    });
  })()`);
  for(const card of cards){
    assert.equal(card.provider,false);assert.ok(card.metaSize<card.titleSize);
    assert.equal(card.link,true);assert.equal(card.externalText,'(externe Ressource)');assert.equal(card.iconHidden,'true');
    for(const ratio of card.contrast)assert.ok(ratio>=4.5,`Card text contrast ${ratio}`);
    for(const chip of card.chips){assert.ok(chip.text);assert.ok(chip.contrast>=4.5,`Chip contrast ${chip.contrast}`);}
  }
}
function expectedResources(filters={},baseline){
  return allResources.filter(({data})=>matchesLinkFilters(data,filters,baseline)).map(({title})=>title);
}
async function assertResources(filters={},baseline){
  const current=await state();
  const expected=expectedResources(filters,baseline);
  assert.deepEqual(current.visible,expected);
  assert.equal(current.count,`${expected.length} ${expected.length===1?'Ressource':'Ressourcen'}`);
  assert.equal(current.empty,expected.length===0);
}
async function assertSidebar(html){
  const entries=await evaluate(`(()=>{
    const root=${html ? `new DOMParser().parseFromString(${JSON.stringify(html)},'text/html')` : 'document'};
    const groups=[...root.querySelectorAll('.sidebar-content .top-level > li > details')];
    return groups.map(group=>({
      label:group.querySelector('summary .mn-sidebar-label-text, summary .large')?.textContent.trim(),
      links:[...group.querySelectorAll('a[href$="/links-ressourcen/"]')].map(a=>a.getAttribute('href')),
      last:group.querySelector(':scope > ul > li:last-child > a')?.getAttribute('href'),
    }));
  })()`);
  for(const [section,,label] of medDocsPages){
    const group=entries.find(entry=>entry.label===label);
    const href=`/meddocs/${section}/links-ressourcen/`;
    assert.ok(group,label);assert.deepEqual(group.links,[href],label);assert.equal(group.last,href,label);
  }
  const diverses=entries.find(entry=>entry.label==='Diverses');
  assert.ok(diverses);assert.deepEqual(diverses.links,[],'Diverses must not contain Links & Ressourcen');
}

try{
  await command('Page.enable');await command('Runtime.enable');
  await assert.rejects(readFile(new URL('../dist/meddocs/diverses/links-ressourcen/index.html',import.meta.url)),{code:'ENOENT'});
  // Add fixtures alongside real content; never remove or rewrite existing resources.
  originalResourceCount=(await readdir(new URL('../src/content/link-resources/',import.meta.url))).filter(file=>file.endsWith('.md')).length;
  for(const [index,fixture] of linkFixtures.entries()){
    const path=new URL(`../src/content/link-resources/${fixtureName}-${index}.md`,import.meta.url);
    const frontmatter=Object.entries(fixture).map(([key,value])=>`${key}: ${JSON.stringify(value)}`).join('\n');
    await writeFile(path,`---\n${frontmatter}\n---\n`,{flag:'wx'});created.push(path);
  }
  const embedPath=new URL(`../src/content/docs/medtools/links/${fixtureName}.mdx`,import.meta.url);
  await writeFile(embedPath,`---\ntitle: Interne Testansicht\ntemplate: splash\ndraft: true\npagefind: false\n---\n\nimport LinkExplorer from '../../../../components/links/LinkExplorer.astro';\n\n<LinkExplorer specialty="ultraschall" showSpecialtyFilter={false} compact />\n\n<LinkExplorer specialty="echokardiographie" showSearch={false} showSpecialtyFilter={false} showFormatFilter={false} showLanguageFilter={false} showAccessFilter={false} />\n\n<LinkExplorer specialty="ekg" showSpecialtyFilter={false} />\n`,{flag:'wx'});
  created.push(embedPath);
  // An initially empty glob has no watcher in this Astro version: seed before startup.
  const serverUrl=new URL(site);
  assert.ok(['127.0.0.1','localhost'].includes(serverUrl.hostname),'Use a local test server.');
  let portInUse=false;
  try { await fetch(site);portInUse=true; } catch { /* Expected: the dedicated port is free. */ }
  assert.equal(portInUse,false,'The test server port must be free; do not stop a personal dev server.');
  server=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs',import.meta.url)),
    'dev','--host',serverUrl.hostname,'--port',serverUrl.port || '4325','--ignore-lock'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,
    env:{...process.env,ASTRO_DEV_BACKGROUND:'1'},stdio:['ignore','pipe','pipe'],
  });
  server.stdout.on('data',data=>{serverOutput+=data});
  server.stderr.on('data',data=>{serverOutput+=data});
  for(let i=0;i<120;i++){
    assert.equal(server.exitCode,null,serverOutput);
    try { if((await(await fetch(`${site}${route}`)).text()).includes('Zulu Testressource'))break; } catch { /* Starting. */ }
    await pause(250);
  }
  await navigate(route);
  await waitFor(`document.querySelectorAll('link-explorer [data-link-resource]').length===${originalResourceCount+linkFixtures.length}`);
  allResources=await evaluate(`(()=>[...document.querySelectorAll('link-explorer [data-link-resource]')].map(card=>({
    title:card.querySelector('h3 a').textContent.replace(' (externe Ressource)','').trim(),
    data:JSON.parse(card.dataset.filterData),
  })))()`);
  await assertResources();
  assert.equal((await fetch(`${site}/meddocs/diverses/links-ressourcen/`)).status,404);
  const diversesHtml=await(await fetch(`${site}/meddocs/diverses/`)).text();
  await assertSidebar(diversesHtml);
  await set('specialty','allgemein');await assertResources({specialty:'allgemein'});
  assert.ok((await state()).visible.includes('Zulu Testressource'),'General resources remain in the central collection');
  await reset();
  assert.deepEqual(allResources.filter(({title})=>linkFixtures.some(f=>f.title===title)).map(({title})=>title),
    ['Zulu Testressource','Anästhesie Testressource','Echo Testressource','EKG Testressource','POCUS Testressource','Übungsfälle Testressource']);
  const metadata=await evaluate(`(()=>{const root=document.querySelector('link-explorer');return {
    canonical:document.querySelector('link[rel=canonical]').href,description:document.querySelector('meta[name=description]').content,
    h1s:document.querySelectorAll('h1').length,live:root.querySelector('[data-result-count]').getAttribute('aria-live'),
    resultHeading:root.querySelector('.result-heading h2')?.textContent.trim(),
    date:root.querySelector('[data-link-resource^="${fixtureName}-0"] time').textContent,
    link:root.querySelector('[data-link-resource^="${fixtureName}-0"] h3 a').href,newTab:root.querySelector('h3 a').target,
    labels:[...root.querySelectorAll('input,select')].every(input=>!!input.closest('label')?.querySelector('span'))};})()`);
  assert.equal(metadata.canonical,'https://mednerds.ch/medtools/links/');
  assert.ok(metadata.description.includes('Kuratierte medizinische Ressourcen'));
  assert.equal(metadata.h1s,1);assert.equal(metadata.live,'polite');assert.equal(metadata.labels,true);
  assert.equal(metadata.resultHeading,'Ressourcen');
  assert.equal(metadata.date,'6. Oktober 2026');assert.equal(metadata.link,'https://example.org/zulu');assert.equal(metadata.newTab,'');

  for(const [key,value] of [['specialty','ultraschall'],['format','podcast'],['language','de'],['access','paid']]){
    await set(key,value);await assertResources({[key]:value});assert.equal(new URLSearchParams((await state()).query).get(key),value);await reset();
  }
  for(const q of ['UEBUNGSFALLE','  übungsfälle   testressource  ','Beschreibungstest','Testanbieter Beta','sonderthema','Literatur']){
    await set('q',q);await assertResources({q});assert.ok((await state()).visible.includes('Übungsfälle Testressource'));await reset();
  }
  await set('specialty','ultraschall');await set('format','podcast');await set('language','de');await set('access','mixed');
  await assertResources({specialty:'ultraschall',format:'podcast',language:'de',access:'mixed'});
  await set('q','POCUS Testressource');assert.deepEqual((await state()).visible,['POCUS Testressource']);
  await set('access','paid');assert.equal((await state()).count,'0 Ressourcen');assert.equal((await state()).empty,true);
  await reset();await assertResources();assert.equal((await state()).reset,false);
  assert.equal(await evaluate("document.activeElement.matches('[name=q]')"),true);
  assert.equal((await state()).query,'');
  await navigate(`${route}?q=pocus&specialty=ultraschall&format=podcast&language=de&access=mixed`);
  await assertResources({q:'pocus',specialty:'ultraschall',format:'podcast',language:'de',access:'mixed'});
  assert.equal(await evaluate("document.querySelector('link[rel=canonical]').href"),'https://mednerds.ch/medtools/links/');
  await navigate(`${route}?specialty=invalid&format=invalid&language=invalid&access=invalid`);
  await assertResources();
  assert.ok(Object.values((await state()).controls).every(value=>value===''));
  await navigate(route);
  await evaluate("history.pushState(null,'','?specialty=ekg');window.dispatchEvent(new PopStateEvent('popstate'))");
  await assertResources({specialty:'ekg'});
  await evaluate('history.back()');await waitFor("location.search===''");await assertResources();
  await evaluate('history.forward()');await waitFor("location.search==='?specialty=ekg'");await assertResources({specialty:'ekg'});
  await reset();
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate("document.documentElement.dataset.theme='dark';document.querySelector('link-explorer').scrollIntoView({block:'start'})");
  await pause(100);
  const screenshot=await command('Page.captureScreenshot',{format:'png'});
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  await writeFile(join(tmpdir(),'mednerds-link-explorer-desktop.png'),Buffer.from(screenshot.data,'base64'));

  for(const width of [320,390,768,1440,1920])for(const theme of ['dark','light']){
    await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    await evaluate(`document.documentElement.dataset.theme='${theme}'`);
    const layout=await evaluate(`({overflow:document.documentElement.scrollWidth-innerWidth,
      targets:[...document.querySelectorAll('link-explorer input,link-explorer select')].every(input=>input.getBoundingClientRect().height>=44),
      columns:getComputedStyle(document.querySelector('.resource-grid')).gridTemplateColumns.split(' ').length})`);
    assert.ok(layout.overflow<=1,`${width} ${theme}`);assert.equal(layout.targets,true);
    if(width<600)assert.equal(layout.columns,1);
    if(width===1920){assert.equal(layout.columns,2);await assertCards();}
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:true});
  await evaluate("document.documentElement.dataset.theme='light';window.scrollTo(0,0)");
  await pause(100);
  const mobileScreenshot=await command('Page.captureScreenshot',{format:'png'});
  await writeFile(join(tmpdir(),'mednerds-link-explorer-mobile.png'),Buffer.from(mobileScreenshot.data,'base64'));
  await set('q','no match');
  await evaluate("document.querySelector('link-explorer [name=q]').focus()");
  for(let i=0;i<5;i++){
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  }
  assert.equal(await evaluate("document.activeElement.matches('[data-reset]')"),true);
  assert.equal(await evaluate("document.activeElement.matches(':focus-visible')"),true);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await assertResources();

  const embedRoute=`${route}${fixtureName}/?specialty=ekg`;
  await navigate(embedRoute);
  await waitFor("document.querySelectorAll('link-explorer').length===3");
  await assertResources({},'ultraschall');
  assert.equal(await evaluate("document.querySelector('link-explorer [name=specialty]')"),null);
  await set('format','tool');await assertResources({format:'tool'},'ultraschall');
  assert.equal((await state()).query,'?specialty=ekg');
  await reset();await assertResources({},'ultraschall');
  assert.equal(await evaluate("document.querySelectorAll('link-explorer')[1].querySelector('form')"),null);
  const echoCount=expectedResources({},'echokardiographie').length;
  assert.equal(await evaluate("document.querySelectorAll('link-explorer')[1].querySelector('[data-result-count]').textContent"),`${echoCount} ${echoCount===1?'Ressource':'Ressourcen'}`);

  await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  for(const [section,specialty,,fixtures] of medDocsPages){
    const path=`/meddocs/${section}/links-ressourcen/`;
    const productionHtml=await readFile(new URL(`../dist${path}index.html`,import.meta.url),'utf8');
    await assertSidebar(productionHtml);
    const productionCards=await evaluate(`(()=>{
      const root=new DOMParser().parseFromString(${JSON.stringify(productionHtml)},'text/html');
      return [...root.querySelectorAll('link-explorer [data-link-resource]')].map(card=>JSON.parse(card.dataset.filterData));
    })()`);
    assert.ok(productionCards.every(card=>card.specialties.includes(specialty)),section);
    assert.equal(productionCards.length,allResources.filter(({title,data})=>
      !linkFixtures.some(f=>f.title===title) && data.specialties.includes(specialty)).length,section);
    await navigate(`${path}?specialty=${specialty==='ekg'?'ultraschall':'ekg'}`);
    await assertResources({},specialty);
    assert.deepEqual((await state()).visible.filter(title=>linkFixtures.some(f=>f.title===title)),fixtures);
    assert.equal(await evaluate("document.querySelector('link-explorer [name=specialty]')"),null);
    assert.equal(await evaluate("document.querySelectorAll('h1').length"),1);
    assert.equal(await evaluate("document.querySelector('link[rel=canonical]').href"),`https://mednerds.ch${path}`);
    assert.equal(await evaluate("!!document.querySelector('meta[name=robots][content*=noindex]')"),false);
    const content=await evaluate(`(()=>{
      const intro=document.querySelector('.resources-intro');
      const root=document.querySelector('link-explorer');
      const controls=root.querySelector('[data-controls]');
      const header=root.querySelector('.result-toolbar');
      const card=root.querySelector('.resource-card');
      const link=document.querySelector('.resources-overview-link');
      return {
        intro:intro.textContent,
        heading:root.querySelector('.result-heading h2').textContent.trim(),
        headingHeight:root.querySelector('.result-heading h2').getBoundingClientRect().height,
        href:link.getAttribute('href'),
        introGap:controls.getBoundingClientRect().top-intro.getBoundingClientRect().bottom,
        resultsGap:header.getBoundingClientRect().top-controls.getBoundingClientRect().bottom,
        cardGap:card.getBoundingClientRect().top-header.getBoundingClientRect().bottom,
        overviewGap:link.getBoundingClientRect().top-root.getBoundingClientRect().bottom,
      };
    })()`);
    assert.ok(content.intro.endsWith('Die Sammlung wird laufend erweitert.'));
    assert.ok(!content.intro.includes('zentral gepflegt'));
    assert.equal(content.heading,'Ressourcen');assert.ok(content.headingHeight>0);
    assert.equal(content.href,'/medtools/links/');
    for(const key of ['introGap','resultsGap','cardGap','overviewGap'])assert.ok(content[key]>=16,`${section} ${key}`);
    await assertSidebar();
    await set('format','podcast');await assertResources({format:'podcast'},specialty);
    assert.equal(new URLSearchParams((await state()).query).has('specialty'),false);
    await reset();await set('q',fixtures[0]);assert.deepEqual((await state()).visible,[fixtures[0]]);
    assert.equal((await state()).count,'1 Ressource');
    assert.equal(new URLSearchParams((await state()).query).get('q'),fixtures[0]);
    await reset();await set('language','en');await assertResources({language:'en'},specialty);
    await reset();await set('access','free');await assertResources({access:'free'},specialty);
    await reset();await set('q',fixtureName);assert.equal((await state()).empty,true);
    assert.ok(await evaluate("document.querySelector('[data-empty]').textContent.includes('Passe deine Suche oder Filter an.')"));
    await reset();
    for(const width of [320,768,1920])for(const theme of ['dark','light']){
      await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
      await evaluate(`document.documentElement.dataset.theme='${theme}'`);
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`${section} ${width} ${theme}`);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.resource-grid')).gridTemplateColumns.split(' ').length"),1);
      if(width===1920)await assertCards();
      if(section==='ultraschall' && ((width===1920 && theme==='dark') || (width===320 && theme==='light'))){
        await evaluate("document.querySelector('h1').scrollIntoView({block:'start'});window.scrollBy(0,-170)");
        await pause(100);
        const capture=await command('Page.captureScreenshot',{format:'png'});
        await writeFile(join(tmpdir(),`mednerds-meddocs-resources-${theme}-${width}.png`),Buffer.from(capture.data,'base64'));
      }
    }
  }

  await command('Emulation.setScriptExecutionDisabled',{value:true});
  await navigate(`${route}?q=no-match&specialty=ekg`);
  await assertResources();
  assert.equal(await evaluate("document.querySelector('[data-controls]').hidden"),true);
  await navigate(embedRoute);await assertResources({},'ultraschall');
  for(const [section,specialty] of medDocsPages){
    await navigate(`/meddocs/${section}/links-ressourcen/?q=no-match&specialty=ekg`);
    await assertResources({},specialty);
    assert.equal(await evaluate("document.querySelector('[data-controls]').hidden"),true);
    assert.ok(await evaluate("[...document.querySelectorAll('link-explorer h3 a')].every(a=>a.hasAttribute('href'))"));
    await assertSidebar();
  }
  assert.deepEqual(errors,[]);
  // Verify an initially empty specialty without changing real content.
  const ekgFixture=created.find(path=>path.pathname.endsWith(`${fixtureName}-5.md`));
  if(expectedResources({},'ekg').length===1){
    await unlink(ekgFixture);created.splice(created.indexOf(ekgFixture),1);
    await command('Emulation.setScriptExecutionDisabled',{value:false});
    for(let i=0;i<80;i++){
      const html=await(await fetch(`${site}${route}${fixtureName}/`)).text();
      if(!html.includes('EKG Testressource'))break;
      await pause(100);
    }
    await navigate(`${route}${fixtureName}/`);
    assert.equal(await evaluate("document.querySelectorAll('link-explorer')[2].querySelectorAll('[data-link-resource]').length"),0);
    assert.ok(await evaluate("document.querySelectorAll('link-explorer')[2].querySelector('[data-empty]').textContent.includes('Für dieses Fachgebiet sind aktuell noch keine Ressourcen eingetragen.')"));
  }
  console.log('✓ Linksammlung browser: V1 including allgemein, five MedDocs baselines, removed Diverses route/sidebar, multi-specialty, URL/query isolation, sidebar last/unique, empty states, SEO/headings, responsive light/dark, no-JS');
}finally{
  try {
    await command('Emulation.setScriptExecutionDisabled',{value:false});
    socket.close();await fetch(`${endpoint}/json/close/${target.id}`);
    for(const path of created.reverse())await unlink(path);
    // Let the active loader remove fixtures from its generated content store as well.
    if(server && server.exitCode===null){
      let cleared=false;
      for(let i=0;i<40;i++){
        try { const html=await(await fetch(`${site}${route}`)).text();
          if(!html.includes(fixtureName) && (html.match(/data-link-resource=/g)||[]).length===originalResourceCount){cleared=true;break;} }
        catch { /* Content watcher may briefly reload the server module. */ }
        await pause(100);
      }
      assert.equal(cleared,true,'Temporary resources must also leave the generated content store.');
    }
  } finally {
    if(server && server.exitCode===null){
      const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;
    }
  }
}
