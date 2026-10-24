import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const site=process.env.AUTH_SITE??'http://127.0.0.1:4326',endpoint=process.env.AUTH_CDP??'http://127.0.0.1:9334';
const screenshots=process.env.AUTH_SCREENSHOTS??tmpdir();await mkdir(screenshots,{recursive:true});
const target=await(await fetch(`${endpoint}/json/new?about:blank`,{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0;const pending=new Map(),errors=[],requests=[];
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
socket.onmessage=({data})=>{const message=JSON.parse(data);if(pending.has(message.id)){const{resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(message.error.message)):resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
  if(message.method==='Fetch.requestPaused'){requests.push(message.params.request.url);const local=new URL(message.params.request.url).origin===new URL(site).origin;void command(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId:message.params.requestId}:{requestId:message.params.requestId,errorReason:'BlockedByClient'});}};
async function evaluate(expression){const response=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value;}
async function wait(expression){for(let i=0;i<180;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Timed out: '+expression);}
async function navigate(count){await command('Page.navigate',{url:`${site}/meddocs/diverses/reference-regression-${count}/`});await wait("document.readyState==='complete'");await evaluate("document.querySelector('.meddocs-editorial').scrollIntoView()");await wait("!document.querySelector('.article-tools').closest('astro-island').hasAttribute('ssr')");}
async function openCitation(){await click('.article-tools-trigger');await wait("!!document.querySelector('.article-tools-panel')");assert.doesNotMatch(await evaluate("document.querySelector('.article-tools-panel').textContent"),/ChatGPT|Claude/);await click('.article-tools-panel button:nth-child(3)');await wait("document.querySelector('.citation-dialog').open");}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function press(key,code,keyCode){const text=key==='Enter'?'\r':key===' '?' ':undefined;await command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,...(text?{text}:{})});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode});}
async function closeCitation(){await evaluate("new Promise(resolve=>{const dialog=document.querySelector('.citation-dialog');dialog.addEventListener('close',()=>resolve(true),{once:true});dialog.querySelector('[data-citation-close]').click();})");}
async function escapeCitation(){await evaluate("window.__citationClosed=false;document.querySelector('.citation-dialog').addEventListener('close',()=>window.__citationClosed=true,{once:true})");await press('Escape','Escape',27);await wait('window.__citationClosed');}
async function change(selector,value){await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function preview(){await wait("document.querySelector('[data-citation-preview]').textContent.length>0&&!document.querySelector('[data-citation-copy]').disabled");return evaluate("document.querySelector('[data-citation-preview]').textContent");}
try{
  await command('Page.enable');await command('Runtime.enable');await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});await command('Page.bringToFront');
  for(const count of [0,1,3,4,5,6,8,30]){
    await navigate(count);assert.equal(await evaluate("document.querySelectorAll('.reference-list li').length"),count);
    assert.equal(await evaluate("document.querySelectorAll('.reference-list').length"),count?1:0);
    assert.equal(await evaluate("document.querySelectorAll('ol.reference-list').length"),count?1:0);
    assert.equal(await evaluate("document.querySelectorAll('ul.reference-list').length"),0);
    assert.equal(await evaluate("!!document.querySelector('[data-reference-kind=cited]')"),!!count);
    assert.equal(await evaluate("!!document.querySelector('[data-reference-kind=literature]')"),false);
    assert.equal(await evaluate("!!document.querySelector('[data-citation-target] option[value=cited]')"),!!count);
    assert.equal(await evaluate("!!document.querySelector('[data-citation-target] option[value=literature]')"),false);
    assert.equal(await evaluate("!!document.querySelector('[data-citation-target] option[value=references]')"),!!count);
    assert.equal(await evaluate("!!document.querySelector('[data-reference-toggle]')"),count>3);
    if(count>3){
      await wait("document.querySelector('[data-reference-viewport]').style.getPropertyValue('--references-collapsed-height')!==''");
      assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')"),'false');
      assert.notEqual(await evaluate("getComputedStyle(document.querySelector('[data-reference-viewport]')).maskImage"),'none');
      assert.equal(await evaluate("[...document.querySelectorAll('.reference-list > li:nth-child(n+4)')].every(item=>item.inert&&item.getAttribute('aria-hidden')==='true'&&[...item.querySelectorAll('a')].every(link=>link.tabIndex===-1))"),true);
      assert.equal(await evaluate("(()=>{const viewport=document.querySelector('[data-reference-viewport]'),third=document.querySelector('.reference-list > li:nth-child(3)'),fourth=document.querySelector('.reference-list > li:nth-child(4)');return third.getBoundingClientRect().bottom<=fourth.getBoundingClientRect().top&&fourth.getBoundingClientRect().top<viewport.getBoundingClientRect().bottom;})()"),true);
      const ids=await evaluate("[...document.querySelectorAll('.reference-list > li')].map(item=>item.id)");
      await evaluate("document.querySelector('[data-reference-toggle]').focus()");await press('Enter','Enter',13);
      assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')"),'true');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-reference-viewport]')).maskImage"),'none');
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.reference-list > li')].map(item=>item.id)"),ids);
      assert.equal(await evaluate("document.querySelectorAll('.reference-list [inert], .reference-list [aria-hidden]').length"),0);
      await press(' ','Space',32);assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')"),'false');
    }else if(count)assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-reference-viewport]')).maskImage"),'none');
    assert.equal(await evaluate("!!document.querySelector('.reference-list img')"),false);assert.equal(await evaluate('window.__referenceXss'),undefined);
    assert.equal(await evaluate("document.querySelectorAll('.article-cite-link,[data-citation-trigger]').length"),0);
    assert.equal(await evaluate("document.querySelector('[data-citation-style]').value"),'vancouver');
    if(count){
      const entry=await evaluate("(()=>{const item=document.querySelector('#quelle-testquelle-1'),link=item.querySelector('span > a');return {text:item.querySelector('span').textContent,href:link?.href,label:link?.textContent,links:item.querySelectorAll('span > a').length};})()");
      assert.match(entry.text,/Müller A\. M\./);
      assert.doesNotMatch(entry.text,/\[Internet\]|Available (?:from|at)/i);
      assert.equal(entry.href,'https://doi.org/10.1234/mednerds-test');
      assert.equal(entry.label,entry.href);assert.equal(entry.links,1);
    }
    assert.equal(await evaluate("document.querySelector('.article-info').textContent.includes('Medizinstudent an der Uni Basel')"),true);
    assert.equal(await evaluate("document.querySelector('.article-info').textContent.includes('Beispielperson für die Darstellung')"),true);
  }
  await navigate(6);
  assert.equal(await evaluate("document.querySelector('.med-citation').textContent"),'[1]');
  assert.equal(await evaluate("document.querySelectorAll('.med-citation')[1].textContent"),'[1, 2]');
  assert.equal(requests.some(url=>/\/(?:format|assets)\.[^/]+\.js/.test(url)),false,'CSL engine/styles are not initially fetched');
  await navigate('literature');
  assert.equal(await evaluate("document.querySelectorAll('.med-citation,ol.reference-list,[data-reference-kind=cited]').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('ul.reference-list > li').length"),8);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('ul.reference-list')).listStyleType"),'none');
  assert.equal(await evaluate("document.querySelector('ul.reference-list').getAttribute('role')"),'list');
  assert.equal(await evaluate("document.querySelector('[data-reference-kind=literature] h2').textContent"),'Literatur & weiterführende Informationen');
  assert.equal(await evaluate("!!document.querySelector('[data-citation-target] option[value=cited]')"),false);
  assert.equal(await evaluate("!!document.querySelector('[data-citation-target] option[value=literature]')"),true);
  await click('[data-reference-toggle]');assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')"),'true');
  await click('[data-reference-toggle]');
  await navigate('hybrid');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.med-citation')].map(cite=>cite.textContent)"),['[1]','[2, 3]','[1]','[4]']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-reference-kind=cited] li')].map(item=>item.id)"),['quelle-testquelle-8','quelle-testquelle-2','quelle-testquelle-6','quelle-testquelle-1']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-reference-kind=literature] li')].map(item=>item.id)"),['quelle-testquelle-3','quelle-testquelle-4','quelle-testquelle-5','quelle-testquelle-7']);
  assert.equal(await evaluate("new Set([...document.querySelectorAll('.reference-list li')].map(item=>item.id)).size"),8);
  assert.equal(await evaluate("[...document.querySelectorAll('[data-reference-toggle]')].every(button=>document.getElementById(button.getAttribute('aria-controls'))===button.closest('.meddocs-references').querySelector('[data-reference-viewport]'))"),true);
  await evaluate("document.querySelector('[data-reference-kind=literature] [data-reference-toggle]').focus()");await press('Enter','Enter',13);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-reference-toggle]')].map(button=>button.getAttribute('aria-expanded'))"),['false','true']);
  await press(' ','Space',32);
  await click('.med-citation:last-of-type a');await wait("document.activeElement.id==='quelle-testquelle-1'");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-reference-toggle]')].map(button=>button.getAttribute('aria-expanded'))"),['true','false']);
  await command('Emulation.setEmulatedMedia',{media:'print'});assert.equal(await evaluate("[...document.querySelectorAll('.reference-list li')].every(item=>item.getBoundingClientRect().height>0)"),true);await command('Emulation.setEmulatedMedia',{media:''});
  await navigate(6);
  await click('[data-reference-toggle]');assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')"),'true');
  await click('[data-reference-toggle]');assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')"),'false');
  await click('.med-citation:last-of-type a:last-of-type');await wait("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')==='true'");
  assert.match(await evaluate('document.activeElement.id'),/^quelle-/);
  const articleReferences=await evaluate("({entries:[...document.querySelectorAll('.reference-list li')].map(item=>item.textContent),citations:[...document.querySelectorAll('.med-citation')].map(item=>item.textContent)})");
  await openCitation();assert.equal(await evaluate("document.querySelector('[data-citation-style]').value"),'vancouver');
  await change('[data-citation-style]','mednerds-vancouver');await change('[data-citation-target]','reference:testquelle-1');
  const ownStyle=await preview();assert.match(ownStyle,/Müller A\. M\./);assert.match(ownStyle,/https:\/\/doi\.org\/10\.1234\/mednerds-test/);assert.doesNotMatch(ownStyle,/\[Internet\]|Available (?:from|at)/i);
  await change('[data-citation-target]','reference:testquelle-6');const single=await preview();assert.match(single,/Testbuch/);assert.equal(await evaluate("document.activeElement.id"),'citation-target');
  const outputs=new Set();for(const style of ['mednerds-vancouver','vancouver','apa','harvard','chicago','mla']){await change('[data-citation-style]',style);outputs.add(await preview());}assert.equal(outputs.size,6);
  await change('[data-citation-target]','article');assert.match(await preview(),/Frey|Orlando/);assert.match(await preview(),/https:\/\/mednerds.ch\/meddocs\/diverses\/reference-regression-6\//);
  assert.doesNotMatch(await preview(),/localhost|127\.0\.0\.1/);
  await change('[data-citation-target]','references');assert.match(await preview(),/Testbuch 6/);
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__clipboard=text}}})");await click('[data-citation-copy]');await wait("document.querySelector('[data-citation-status]').textContent.includes('kopiert')");assert.equal(await evaluate('window.__clipboard'),await preview());
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Denied')}}})");await click('[data-citation-copy]');await wait("document.querySelector('[data-citation-status]').textContent.includes('nicht möglich')");
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=(command)=>{window.__clipboard=document.querySelector('.citation-copy-fallback').value;return command==='copy'}");await click('[data-citation-copy]');await wait("document.querySelector('[data-citation-status]').textContent.includes('kopiert')");assert.equal(await evaluate('window.__clipboard'),await preview());
  await evaluate("window.__exports=[];const create=URL.createObjectURL;URL.createObjectURL=(blob)=>{blob.text().then(text=>window.__exports.push({text}));return create(blob)};const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.href.startsWith('blob:')){window.__filename=this.download;return;}return original.call(this)}");
  for(const format of ['txt','bib','ris']){const before=await evaluate('window.__exports.length');await click(`[data-citation-export="${format}"]`);await wait(`window.__exports.length>${before}`);const text=await evaluate('window.__exports.at(-1).text');assert.ok(text.length>0);assert.ok((await evaluate('window.__filename')).endsWith('.'+format));if(format==='bib')assert.match(text,/@book\{/);if(format==='ris')assert.match(text,/TY  - BOOK/);if(format==='txt')assert.equal(text,await preview());}
  await escapeCitation();await wait("document.activeElement.classList.contains('article-tools-trigger')");
  assert.deepEqual(await evaluate("({entries:[...document.querySelectorAll('.reference-list li')].map(item=>item.textContent),citations:[...document.querySelectorAll('.med-citation')].map(item=>item.textContent)})"),articleReferences,'dialog style changes leave article references and citation numbering unchanged');
  await click('.article-tools-trigger');await wait("!!document.querySelector('.article-tools-panel')");await wait("document.activeElement.textContent==='Drucken / als PDF speichern'");
  assert.equal(await evaluate("document.querySelector('.article-tools-panel a[href=\"/medlearn/\"]')!==null"),true);
  await click('.article-tools-panel button:nth-child(3)');await preview();assert.equal(await evaluate("document.querySelector('[data-citation-style]').value"),'vancouver','reopening resets only the dialog style to Vancouver');await closeCitation();assert.equal(await evaluate("document.activeElement.classList.contains('article-tools-trigger')"),true);
  await evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>window.__shared=text}})");await click('.article-tools-trigger');await click('.article-tools-panel button:nth-child(2)');await wait("document.querySelector('.article-tools-status').textContent.includes('kopiert')");assert.ok((await evaluate('window.__shared')).startsWith('https://mednerds.ch/'));
  await evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:async(data)=>{window.__shareData=data}})");await click('.article-tools-trigger');await click('.article-tools-panel button:nth-child(2)');await wait("document.querySelector('.article-tools-status').textContent.includes('geteilt')");assert.ok((await evaluate('window.__shareData.url')).startsWith('https://mednerds.ch/'));
  await click('.article-tools-trigger');await evaluate('document.body.click();document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');assert.equal(await evaluate("!!document.querySelector('.article-tools-panel')"),false);
  await click('.article-tools-trigger');await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait("!document.querySelector('.article-tools-panel')");
  for(const[width,theme]of [[320,'dark'],[375,'light'],[768,'dark'],[1440,'light']]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await evaluate(`document.documentElement.dataset.theme='${theme}'`);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    await openCitation();await preview();assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
    assert.equal(await evaluate("(()=>{const r=document.querySelector('.citation-dialog').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&Math.abs(r.left+r.width/2-document.documentElement.clientWidth/2)<1&&Math.abs(r.top+r.height/2-innerHeight/2)<1;})()"),true,`dialog centered/contained at ${width}px`);
    assert.equal(await evaluate("document.querySelector('.citation-dialog').matches(':modal')"),true);
    assert.equal(await evaluate("document.querySelector('.citation-dialog').hasAttribute('aria-describedby')"),false);
    assert.equal(await evaluate("document.querySelector('[data-citation-preview]').getAttribute('aria-labelledby')"),'citation-preview-label');
    assert.equal(await evaluate("document.querySelector('#citation-preview-label').textContent"),'Zitatvorschau');
    assert.equal(await evaluate("document.querySelector('[data-citation-style]').value"),'vancouver');
    assert.equal(await evaluate("document.querySelector('.citation-dialog-header').children.length"),1);
    assert.equal(await evaluate("document.querySelector('[data-citation-close]').closest('footer')?.className"),'citation-dialog-footer');
    assert.equal(await evaluate("document.querySelector('[data-citation-close]').textContent"),'Schliessen');
    assert.equal(await evaluate("!!document.querySelector('#citation-hint')"),false);
    assert.equal(await evaluate("document.querySelector('[data-citation-copy]').textContent.trim()"),'In die Zwischenablage kopieren');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-citation-style] optgroup')].map(g=>({label:g.label,ids:[...g.children].map(o=>o.value)}))"),[
      {label:'Wissenschaftliche Zitierstile',ids:['vancouver','apa','harvard','chicago','mla']},{label:'MedNerds Zitierstil',ids:['mednerds-vancouver']}]);
    assert.equal(await evaluate("document.querySelector('[data-citation-style] option[value=\"mednerds-vancouver\"]').textContent"),'Vancouver – MedNerds Style');
    assert.equal(await evaluate("document.querySelector('[data-citation-copy] svg').getBBox().width>0"),true);
    assert.equal(await evaluate("document.querySelector('.citation-attribution').textContent"),'citeproc-js · © 2009–2019 Frank Bennett · CPAL 1.0');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.citation-attribution a')].map(a=>a.getAttribute('href'))"),['https://github.com/Juris-M/citeproc-js','/licenses/citeproc-CPAL-1.0.txt']);
    assert.equal(await evaluate("!!document.querySelector('.citation-style-licenses, .citation-dialog details, .citation-dialog summary')"),false);
    assert.doesNotMatch(await evaluate("document.querySelector('.citation-dialog').textContent"),/Lizenzhinweise der Zitierstile/);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-citation-preview]')).fontFamily.includes('monospace')"),false);
    assert.equal(await evaluate("(()=>{const d=document.querySelector('.citation-dialog'),copy=d.querySelector('[data-citation-copy]').getBoundingClientRect(),grid=d.querySelector('.citation-exports').getBoundingClientRect(),buttons=[...d.querySelectorAll('[data-citation-export]')].map(b=>b.getBoundingClientRect());return Math.abs(copy.width-grid.width)<1&&copy.bottom<grid.top&&buttons.every(r=>r.height>=44)&&(innerWidth<=352?buttons[0].top<buttons[1].top&&buttons[1].top<buttons[2].top:buttons.every(r=>Math.abs(r.top-buttons[0].top)<1&&Math.abs(r.width-buttons[0].width)<1));})()"),true,'copy row and equal export actions');
    assert.equal(await evaluate("(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');function rgb(color){ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);}function luminance(rgb){return rgb.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);}const d=document.querySelector('.citation-dialog'),copy=getComputedStyle(d.querySelector('[data-citation-copy]')),buttons=[...d.querySelectorAll('[data-citation-export]')].map(b=>getComputedStyle(b)),bg=rgb(getComputedStyle(d).backgroundColor),primary=rgb(copy.backgroundColor);return buttons.every(b=>{const fill=rgb(b.backgroundColor),fg=luminance(rgb(b.color)),background=luminance(fill),distance=c=>c.reduce((sum,v,i)=>sum+Math.abs(v-bg[i]),0);return fill[2]>fill[0]&&distance(fill)>0&&distance(fill)<distance(primary)&&(Math.max(fg,background)+.05)/(Math.min(fg,background)+.05)>=4.5;});})()"),true,'blue export tint remains quieter than primary copy with readable text in each theme');
    const focused=await evaluate('document.activeElement.id');await evaluate("document.querySelector('.article-tools-trigger').focus()");assert.equal(await evaluate('document.activeElement.id'),focused,'background is inert');
    for(let step=0;step<12;step++){await press('Tab','Tab',9);assert.equal(await evaluate("document.activeElement===document.body||document.querySelector('.citation-dialog').contains(document.activeElement)"),true,'Tab cannot reach background controls');}
    await evaluate("document.querySelector('.citation-dialog').scrollTop=0");
    const dialogScreen=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,`meddocs-citation-${theme}-${width}.png`),Buffer.from(dialogScreen.data,'base64'));
    await escapeCitation();assert.equal(await evaluate("document.activeElement.classList.contains('article-tools-trigger')"),true);
    const screen=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,`meddocs-references-${theme}-${width}.png`),Buffer.from(screen.data,'base64'));
  }
  await command('Emulation.setDeviceMetricsOverride',{width:320,height:420,deviceScaleFactor:1,mobile:true});
  await evaluate("document.documentElement.style.fontSize='200%'");await openCitation();await preview();
  await evaluate("document.querySelector('[data-citation-preview]').textContent='https://example.org/'+ 'LangerText'.repeat(100)");
  assert.equal(await evaluate("(()=>{const dialog=document.querySelector('.citation-dialog'),r=dialog.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=visualViewport.width&&r.bottom<=visualViewport.height&&dialog.scrollWidth<=dialog.clientWidth+1&&dialog.scrollHeight>dialog.clientHeight;})()"),true,'large font/short mobile visual viewport remains contained and internally scrollable');
  await evaluate("document.querySelector('.citation-dialog').scrollTop=10000");
  assert.equal(await evaluate("(()=>{const close=document.querySelector('[data-citation-close]').getBoundingClientRect(),dialog=document.querySelector('.citation-dialog').getBoundingClientRect();return close.top>=dialog.top&&close.bottom<=dialog.bottom;})()"),true,'footer close stays reachable by scrolling');
  await escapeCitation();
  await evaluate("document.documentElement.style.fontSize=''");await command('Emulation.setDeviceMetricsOverride',{width:1440,height:950,deviceScaleFactor:1,mobile:false});
  await navigate(30);await openCitation();await change('[data-citation-target]','references');await preview();
  assert.equal(await evaluate("document.querySelector('[data-citation-preview]').scrollHeight>document.querySelector('[data-citation-preview]').clientHeight"),true);
  await closeCitation();await command('Emulation.setEmulatedMedia',{media:'print'});
  assert.equal(await evaluate("[...document.querySelectorAll('.reference-list li')].every(item=>item.getBoundingClientRect().height>0)"),true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.article-tools')).display"),'none');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.header')).display"),'none');
  const pdf=await command('Page.printToPDF',{printBackground:false,preferCSSPageSize:true});await writeFile(join(tmpdir(),'meddocs-references-regression.pdf'),Buffer.from(pdf.data,'base64'));
  await command('Emulation.setEmulatedMedia',{media:''});
  // Actual draft article, copied only into this temporary test build.
  await navigate('showcase');
  assert.equal(await evaluate("document.querySelector('#quelle-demo-website span > a')?.href"),'https://example.org/demo/website');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.med-citation')].map(cite=>cite.textContent)"),['[1]','[2, 3]','[1]','[4]']);
  assert.equal(await evaluate("document.querySelectorAll('.reference-list li').length"),8);
  assert.equal(await evaluate("document.querySelectorAll('.reference-list').length"),4);
  assert.equal(await evaluate("document.querySelectorAll('.reference-list > li:not([aria-hidden])').length"),6);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.meddocs-references h2')].map(heading=>heading.textContent)"),['Einzelnachweise','Literatur & weiterführende Informationen']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.reference-group-heading')].map(heading=>heading.textContent)"),['Fachartikel & Studien','Online-Ressourcen','Sonstige Quellen']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-reference-kind=literature] li')].map(item=>item.id)"),['quelle-demo-onlineartikel','quelle-demo-onlineportal','quelle-demo-website','quelle-demo-bericht']);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-citation-target] option')].slice(0,4).map(option=>option.value)"),['article','cited','literature','references']);
  assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')"),'false');
  assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').textContent"),'Mehr anzeigen');
  const documentNode=await command('DOM.getDocument');const hiddenNode=await command('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector:'#quelle-demo-handbuch'});
  const hiddenAx=await command('Accessibility.getPartialAXTree',{nodeId:hiddenNode.nodeId});assert.equal(hiddenAx.nodes[0].ignored,true,'collapsed source excluded from accessibility tree');
  await click('a[href="#quelle-demo-handbuch"]');await wait("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')==='true'&&document.activeElement.id==='quelle-demo-handbuch'");
  const visibleAx=await command('Accessibility.getPartialAXTree',{nodeId:hiddenNode.nodeId});assert.equal(visibleAx.nodes[0].ignored,false);
  assert.equal(await evaluate("document.querySelector('[data-reference-kind=literature] [data-reference-toggle]').getAttribute('aria-expanded')"),'false','direct citation only opens its own group');
  await click('[data-reference-toggle]');assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').getAttribute('aria-expanded')"),'false');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#quelle-demo-handbuch')).outlineStyle"),'none','collapsed target does not leave an outline in the fade');
  await evaluate("document.querySelector('.meddocs-references').style.fontSize='200%'");
  await wait("(()=>{const viewport=document.querySelector('[data-reference-viewport]'),third=document.querySelector('.reference-list > li:nth-child(3)');return third.getBoundingClientRect().bottom<=viewport.getBoundingClientRect().bottom-parseFloat(viewport.style.getPropertyValue('--references-fade-height'))+1;})()");
  await evaluate("document.querySelector('.meddocs-references').style.fontSize=''");
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-reference-viewport]')).animationName"),'none');
  await click('[data-reference-toggle]');assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-reference-viewport]')).maskImage"),'none');await click('[data-reference-toggle]');
  await command('Emulation.setEmulatedMedia',{features:[]});
  for(const [width,theme]of [[320,'dark'],[375,'light'],[768,'dark'],[1440,'light']]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await evaluate(`document.documentElement.dataset.theme='${theme}'`);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'hybrid source headings/entries do not overflow');
    await wait("[...document.querySelectorAll('.meddocs-references')].every(section=>{const viewport=section.querySelector('[data-reference-viewport]'),third=section.querySelectorAll('.reference-list > li')[2];return third.getBoundingClientRect().bottom<=viewport.getBoundingClientRect().bottom-parseFloat(viewport.style.getPropertyValue('--references-fade-height'))+1;})");
    await evaluate("document.querySelector('[data-reference-kind=literature]').scrollIntoView({block:'start'});window.scrollBy(0,-160)");const screen=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(screenshots,`meddocs-hybrid-${theme}-${width}.png`),Buffer.from(screen.data,'base64'));
  }
  await openCitation();assert.match(await preview(),/Beispielartikel/);
  assert.equal(await evaluate("document.querySelectorAll('[data-citation-target] option[value^=\"reference:\"]').length"),8);
  await change('[data-citation-target]','reference:demo-handbuch');assert.match(await preview(),/Darstellung eines Handbuchs/);
  await change('[data-citation-target]','references');
  for(const style of ['mednerds-vancouver','vancouver','apa','harvard','chicago','mla']){await change('[data-citation-style]',style);const text=await preview();assert.equal((text.match(/illustrative testdaten/gi)??[]).length,8,`${style} retains all eight illustrative sources`);assert.doesNotMatch(text,/doi\.org|localhost|127\.0\.0\.1/);}
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__clipboard=text}}});window.__exports=[];const create=URL.createObjectURL;URL.createObjectURL=(blob)=>{blob.text().then(text=>window.__exports.push(text));return create(blob)};const original=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.href.startsWith('blob:'))return;return original.call(this)}");
  await click('[data-citation-copy]');await wait("document.querySelector('.citation-dialog [data-citation-status]').textContent.includes('kopiert')");assert.equal(await evaluate('window.__clipboard'),await preview());
  for(const format of ['txt','bib','ris']){const before=await evaluate('window.__exports.length');await click(`[data-citation-export="${format}"]`);await wait(`window.__exports.length>${before}`);const text=await evaluate('window.__exports.at(-1)');if(format==='txt')assert.equal(text,await preview());if(format==='bib'){assert.equal((text.match(/^@/gm)??[]).length,8);for(const type of ['article','book','incollection','misc','techreport'])assert.ok(text.includes('@'+type+'{'));}if(format==='ris'){assert.equal((text.match(/^TY  - /gm)??[]).length,8);for(const type of ['JOUR','BOOK','CHAP','ELEC','RPRT'])assert.ok(text.includes('TY  - '+type));}}
  const groupIds={cited:['demo-zeitschriftenartikel','demo-buch','demo-buchkapitel','demo-handbuch'],literature:['demo-website','demo-bericht','demo-onlineartikel','demo-onlineportal'],'reference:demo-handbuch':['demo-handbuch']};
  const allIds=[...groupIds.cited,...groupIds.literature];
  for(const [target,ids]of Object.entries(groupIds)){
    await change('[data-citation-target]',target);
    for(const style of ['mednerds-vancouver','vancouver','apa','harvard','chicago','mla']){await change('[data-citation-style]',style);const text=await preview();assert.equal((text.match(/illustrative testdaten/gi)??[]).length,ids.length,`${target}/${style} exports only selected category`);}
    await click('[data-citation-copy]');await wait("document.querySelector('.citation-dialog [data-citation-status]').textContent.includes('kopiert')");assert.equal(await evaluate('window.__clipboard'),await preview());
    for(const format of ['txt','bib','ris']){
      const before=await evaluate('window.__exports.length');await click(`[data-citation-export="${format}"]`);await wait(`window.__exports.length>${before}`);
      const text=await evaluate('window.__exports.at(-1)');
      if(format==='txt')assert.equal(text,await preview());
      else{assert.equal((text.match(format==='bib'?/^@/gm:/^TY  - /gm)??[]).length,ids.length);for(const id of allIds)assert.equal(format==='bib'?text.includes(`{${id},`):text.includes(`ID  - ${id}\r\n`),ids.includes(id));}
    }
  }
  await closeCitation();
  await command('Emulation.setEmulatedMedia',{media:'print'});assert.equal(await evaluate("[...document.querySelectorAll('.reference-list li')].every(item=>item.getBoundingClientRect().height>0)"),true);await command('Emulation.setEmulatedMedia',{media:''});
  // Progressive enhancement: without JS all sources stay reachable and the article remains static.
  await command('Emulation.setScriptExecutionDisabled',{value:true});await command('Page.navigate',{url:`${site}/meddocs/diverses/reference-regression-6/`});await wait("document.readyState==='complete'");
  assert.equal(await evaluate("document.querySelector('[data-reference-toggle]').hidden"),true);assert.equal(await evaluate("document.querySelectorAll('.reference-list [aria-hidden], .reference-list [inert]').length"),0);assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-reference-viewport]')).maskImage"),'none');assert.equal(await evaluate("document.querySelector('.med-citation').textContent"),'[1]');await command('Emulation.setScriptExecutionDisabled',{value:false});
  await command('Emulation.setScriptExecutionDisabled',{value:true});await command('Page.navigate',{url:`${site}/meddocs/diverses/reference-regression-hybrid/`});await wait("document.readyState==='complete'");
  assert.equal(await evaluate("document.querySelectorAll('.reference-list li').length"),8);assert.equal(await evaluate("[...document.querySelectorAll('[data-reference-toggle]')].every(button=>button.hidden)"),true);assert.equal(await evaluate("[...document.querySelectorAll('[data-reference-viewport]')].every(viewport=>getComputedStyle(viewport).maskImage==='none')"),true);await command('Emulation.setScriptExecutionDisabled',{value:false});
  await command('Page.navigate',{url:`${site}/meddocs/ekg/theorie-grundlagen-ekg/test/`});await wait("document.readyState==='complete'");await evaluate("document.querySelector('.article-tools').scrollIntoView()");await click('.article-tools-trigger');await wait("!!document.querySelector('.article-tools-panel')");
  assert.equal(await evaluate("document.querySelector('.article-tools-panel').textContent.includes('Artikel teilen')"),true);assert.equal(await evaluate("document.querySelector('.article-tools-panel').textContent.includes('Zitieren & Exportieren')"),false);
  assert.deepEqual(errors,[]);
  assert.deepEqual([...new Set(requests.filter(url=>new URL(url).origin!==new URL(site).origin).map(url=>new URL(url).origin+new URL(url).pathname))],[],'reference rendering and exports do not request external services');
  console.log('✓ MedDocs references browser: no sources/cited-only/literature-only/hybrid, independent fade/keyboard/AX focus, stable numbers/no duplicates, category/all/single exports in six styles, clipboard/TXT/BibTeX/RIS, print/no-JS, responsive centered modal, dark/light, no external API');
}catch(error){const capture=await command('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(capture)await writeFile(join(screenshots,'meddocs-references-failure.png'),Buffer.from(capture.data,'base64'));throw error;
}finally{socket.close();await fetch(`${endpoint}/json/close/${target.id}`).catch(()=>{});}
