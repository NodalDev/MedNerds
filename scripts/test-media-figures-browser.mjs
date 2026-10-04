import assert from 'node:assert/strict';
import { validateFigureUrl } from '../src/lib/media/urls.ts';
import { getFigureDownloadLabel, resolveFigureDownload } from '../src/lib/media/download.ts';
import { createFigureMetadata } from '../src/lib/media/figure-metadata.ts';

// Use an Astro dev server (the showcase is a draft) and local headless Chrome/CDP.
// No additional browser dependency is needed. Run with --experimental-strip-types.
const site = process.env.MEDIA_SITE ?? 'http://127.0.0.1:4325';
const endpoint = process.env.MEDIA_CDP ?? 'http://127.0.0.1:9223';
const route = '/meddocs/diverses/beispielartikel/';
const marker = '[data-mednerds-fancybox]';
for (const url of ['/image.webp', './image.webp', 'https://example.org/a.webp?signature=a%2Bb']) {
  assert.equal(validateFigureUrl(url), url);
}
for (const url of ['', 'javascript:alert(1)', 'data:text/html,test', 'file:///secret']) {
  assert.throws(() => validateFigureUrl(url));
}
for (const [filename, format] of [['image.png', 'PNG'], ['image.JPG', 'JPEG'], ['image.jpeg', 'JPEG'], ['image.svg', 'SVG']]) {
  assert.equal(getFigureDownloadLabel(filename), `${format} herunterladen`);
}
for (const filename of [undefined, '', 'png', 'image.tiff', 'image.png?token=1', 'image.constructor']) {
  assert.equal(getFigureDownloadLabel(filename), 'Herunterladen');
}
const imageSources = { src: '/preview.webp', fullSrc: '/large.webp', downloadSrc: '/original.png' };
assert.equal(resolveFigureDownload({ ...imageSources, downloadable: false }), undefined);
assert.equal(resolveFigureDownload({ ...imageSources, downloadable: true }), '/original.png');
assert.equal(resolveFigureDownload({ ...imageSources, downloadSrc: undefined, downloadable: true }), '/large.webp');
assert.equal(resolveFigureDownload({ src: '/preview.webp', downloadable: true }), '/preview.webp');
assert.equal(resolveFigureDownload({ src: { src: '/local.webp', width: 1, height: 1, format: 'webp' }, downloadable: true }), '/local.webp');

const canonicalUrl = new URL(`https://mednerds.ch${route}`);
const citationOptions = {
  citationTitle: 'Prinzip des B-Mode', caption: 'Längere Bildunterschrift',
  creator: 'Orlando Frey', organization: 'MedNerds', license: 'CC BY-NC-SA 4.0',
};
assert.equal(createFigureMetadata(citationOptions, canonicalUrl).citation,
  `„Prinzip des B-Mode“ – Orlando Frey, MedNerds, CC BY-NC-SA 4.0, Quelle: ${canonicalUrl.href}`);
assert.equal(createFigureMetadata({ ...citationOptions, sourceUrl: 'https://example.org/source#figure' }, canonicalUrl).citation,
  '„Prinzip des B-Mode“ – Orlando Frey, MedNerds, CC BY-NC-SA 4.0, Quelle: https://example.org/source#figure');
assert.equal(createFigureMetadata({ ...citationOptions, citationTitle: ' ', organization: 'Orlando Frey' }, canonicalUrl).citation,
  `„Längere Bildunterschrift“ – Orlando Frey, CC BY-NC-SA 4.0, Quelle: ${canonicalUrl.href}`);
assert.equal(createFigureMetadata({ ...citationOptions, citationTitle: undefined, captionTitle: 'Kurzer Titel' }, canonicalUrl).citation,
  `„Kurzer Titel“ – Orlando Frey, MedNerds, CC BY-NC-SA 4.0, Quelle: ${canonicalUrl.href}`);
assert.equal(createFigureMetadata({ ...citationOptions, captionTitle: 'Anderer sichtbarer Titel' }, canonicalUrl).citation,
  `„Prinzip des B-Mode“ – Orlando Frey, MedNerds, CC BY-NC-SA 4.0, Quelle: ${canonicalUrl.href}`);
assert.equal(createFigureMetadata({ ...citationOptions, citationTitle: ' ', captionTitle: ' ' }, canonicalUrl).citation,
  `„Längere Bildunterschrift“ – Orlando Frey, MedNerds, CC BY-NC-SA 4.0, Quelle: ${canonicalUrl.href}`);
assert.equal(createFigureMetadata({ ...citationOptions, citationTitle: undefined, caption: undefined, alt: 'Alt is not a citation title' }, canonicalUrl).citation, undefined);
assert.equal(createFigureMetadata({ ...citationOptions, license: undefined }, canonicalUrl).citation, undefined);
assert.equal(createFigureMetadata(citationOptions).citation, undefined);
assert.equal(createFigureMetadata(citationOptions, new URL(`http://localhost:4321${route}`)).citation, undefined);
assert.equal(createFigureMetadata({ ...citationOptions, sourceUrl: `http://localhost:4321${route}` }, canonicalUrl).citation,
  `„Prinzip des B-Mode“ – Orlando Frey, MedNerds, CC BY-NC-SA 4.0, Quelle: ${canonicalUrl.href}`);
assert.equal(createFigureMetadata({ caption: 'Titel', license: 'Lizenz', sourceUrl: './original/' }, canonicalUrl).citation,
  `„Titel“ – Lizenz, Quelle: ${canonicalUrl.href}original/`);
assert.equal(createFigureMetadata({ caption: 'Titel', creator: ' ', organization: ' ', license: 'Lizenz' }, canonicalUrl).citation,
  `„Titel“ – Lizenz, Quelle: ${canonicalUrl.href}`);
assert.throws(() => createFigureMetadata({ ...citationOptions, sourceUrl: 'javascript:alert(1)' }, canonicalUrl));
assert.throws(() => createFigureMetadata({ ...citationOptions, licenseUrl: 'javascript:alert(1)' }, canonicalUrl));

const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  }
};
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await pause(75);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function navigate(path) {
  await command('Page.navigate', { url: `${site}${path}` });
  await waitFor(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && !!document.querySelector('main h1')`);
}
async function key(key) {
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key });
}
async function open(index) {
  await evaluate(`document.querySelectorAll('${marker}')[${index}].focus(); document.querySelectorAll('${marker}')[${index}].click()`);
  await waitFor("!!document.querySelector('.mn-fancybox.is-ready .f-panzoom__content.is-lazyloaded')");
}
async function close() {
  await key('Escape');
  await waitFor("!document.querySelector('.mn-fancybox')");
}
async function panzoomState() {
  return evaluate(`(async () => {
    // Import the already loaded module, so the test uses the same official instance.
    const moduleUrl=performance.getEntriesByType('resource').map(entry=>entry.name)
      .find(url=>url.includes('@fancyapps') && url.includes('fancybox') && !url.includes('l10n'));
    window.mediaTestFancybox ??= (await import(moduleUrl)).Fancybox;
    const panzoom=window.mediaTestFancybox.getSlide().panzoomRef;
    return {scale:panzoom.getTransform().scale,base:panzoom.getScale('base'),
      start:panzoom.getStartPosition().scale,full:panzoom.getScale('full'),max:panzoom.getScale('max')};
  })()`);
}
async function assertCaptionLayout() {
  const layout = await evaluate(`(() => {
    const root=document.querySelector('.mn-fancybox');
    const caption=root.querySelector('.is-selected .f-caption');
    const block=caption.querySelector('.mn-figure-caption');
    const image=root.querySelector('.is-selected .f-panzoom__content');
    const r=caption.getBoundingClientRect(), b=block.getBoundingClientRect(), i=image.getBoundingClientRect();
    const title=block.querySelector('.mn-figure-caption-title');
    const description=block.querySelector('.mn-figure-caption-description');
    const meta=block.querySelector('.mn-figure-caption-meta');
    return {
      width:r.width, maxWidth:48*parseFloat(getComputedStyle(document.documentElement).fontSize),
      centered:Math.abs((r.left+r.right)/2-(i.left+i.right)/2)<1,
      left:r.left,right:r.right,bottom:r.bottom,height:innerHeight,
      padding:parseFloat(getComputedStyle(caption).paddingLeft),
      paddingBottom:parseFloat(getComputedStyle(caption).paddingBottom),
      scrollable:caption.scrollHeight>caption.clientHeight,
      imageGap:b.top-i.bottom,bottomGap:r.bottom-b.bottom,
      align:getComputedStyle(block).textAlign,
      order:title.getBoundingClientRect().bottom<=description.getBoundingClientRect().top
        && description.getBoundingClientRect().bottom<=meta.getBoundingClientRect().top,
      captionOverflow:caption.scrollWidth-caption.clientWidth,
      pageOverflow:document.documentElement.scrollWidth-innerWidth,
    };
  })()`);
  assert.ok(layout.width<=layout.maxWidth+1, JSON.stringify(layout));
  assert.equal(layout.centered, true, JSON.stringify(layout));
  assert.ok(layout.left>=0 && layout.right<=await evaluate('innerWidth')+1);
  assert.ok(layout.bottom<=layout.height+1);
  assert.ok(layout.padding>=12);
  assert.ok(layout.imageGap>=12, JSON.stringify(layout));
  assert.ok(layout.paddingBottom>=12);
  if (!layout.scrollable) assert.ok(layout.bottomGap>=12, JSON.stringify(layout));
  assert.ok(['start','left'].includes(layout.align));
  assert.equal(layout.order, true);
  assert.ok(layout.captionOverflow<=1 && layout.pageOverflow<=1, JSON.stringify(layout));
}
async function state() {
  return evaluate(`(() => {
    const root = document.querySelector('.mn-fancybox');
    const button = root.querySelector('[data-carousel-download]');
    const sample = document.createElement('span');
    sample.style.color = 'var(--sl-color-white)';
    document.documentElement.append(sample);
    const expectedColor = getComputedStyle(sample).color;
    sample.remove();
    return {
      theme: root.getAttribute('theme'),
      counter: root.querySelector('.f-counter')?.textContent ?? '',
      caption: root.querySelector('.is-selected .f-caption')?.textContent ?? '',
      download: !!button && !button.hidden && !button.disabled,
      titles: [...root.querySelectorAll('button')].map(b => b.title),
      overflow: document.documentElement.scrollWidth - innerWidth,
      color: getComputedStyle(root).color,
      expectedColor,
      controlsInViewport: [...root.querySelectorAll('.f-carousel__toolbar button')].filter(b => !b.hidden).every(b => {
        const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;
      }),
    };
  })()`);
}

try {
  await command('Page.enable'); await command('Runtime.enable');
  await navigate(route);
  await waitFor("!!document.querySelector('style[data-mednerds-fancybox-styles]')");
  await waitFor("document.querySelector('[data-figure-citation-action]')?.hidden === false");
  assert.equal(await evaluate(`(async () => {
    const { initializeMediaLightbox } = await import('/src/lib/media/fancybox.ts');
    return initializeMediaLightbox() === initializeMediaLightbox()
      && document.querySelectorAll('style[data-mednerds-fancybox-styles]').length === 1;
  })()`), true);
  const credits = await evaluate("document.querySelector('.figure-credit').textContent");
  assert.ok(credits.includes('MedNerds Basel') && credits.includes('Rechtehinweise zum Logo'));
  assert.equal(await evaluate("document.querySelector('.figure-credit a').getAttribute('href')"), '/urheberrecht/');
  assert.equal(await evaluate("document.querySelectorAll('.article-meta').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('.article-info').length"), 1);
  const articleHeader = await evaluate(`(() => {
    const title = document.querySelector('main h1');
    const terminology = document.querySelector('.article-terminology');
    const metadata = document.querySelector('.article-info');
    return {
      title: title.textContent.trim(),
      h1Count: document.querySelectorAll('h1').length,
      descriptionVisible: !!document.querySelector('.article-description'),
      description: document.head.querySelector('meta[name="description"]')?.content,
      order: !!(title.compareDocumentPosition(terminology) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(terminology.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  })()`);
  assert.equal(articleHeader.title, 'Beispielartikel – Starlight Showcase');
  assert.equal(articleHeader.h1Count, 1);
  assert.equal(articleHeader.descriptionVisible, false);
  assert.equal(articleHeader.description, 'Visuelle Übersicht der wichtigsten Inhalts- und UI-Elemente in MedDocs.');
  assert.equal(articleHeader.order, true);
  const expectedCitations = [
    '„MedNerds-Markenicon“ – MedNerds Basel, Rechtehinweise zum Logo, Quelle: https://github.com/NodalDev/MedNerds',
    `„MedNerds-Galerieicon“ – MedNerds Basel, Rechtehinweise zum Logo, Quelle: ${canonicalUrl.href}`,
  ];
  const citationButtons = await evaluate("[...document.querySelectorAll('button[data-figure-citation]')].map(button=>button.dataset.figureCitation)");
  assert.deepEqual(citationButtons, expectedCitations);
  assert.ok(citationButtons.every(text=>!text.includes('localhost') && !text.includes('127.0.0.1')));
  // Capture the real Clipboard API call without changing the user's OS clipboard.
  await evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: {writeText: async (text) => {window.testClipboard = text;}}
  })`);
  for (let i = 0; i < expectedCitations.length; i++) {
    await evaluate(`document.querySelectorAll('button[data-figure-citation]')[${i}].focus()`);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(`window.testClipboard === ${JSON.stringify(expectedCitations[i])}`);
    const copyStatus = await evaluate(`(() => {
      const button=document.querySelectorAll('button[data-figure-citation]')[${i}];
      const status=button.parentElement.querySelector('[data-citation-status]');
      return {text:button.textContent.trim(),status:status.textContent,live:status.getAttribute('aria-live'),focused:document.activeElement===button};
    })()`);
    assert.deepEqual(copyStatus, { text:'Zitation kopiert', status:'Zitation kopiert', live:'polite', focused:true });
    await waitFor(`document.querySelectorAll('button[data-figure-citation]')[${i}].textContent.trim() === 'Zitation kopieren'`);
  }
  assert.equal(await evaluate("document.querySelectorAll('figure.mn-media-figure')[2].querySelector('button[data-figure-citation]')"), null);
  await evaluate(`navigator.clipboard.writeText = async () => {throw new Error('Permission denied')};
    document.querySelector('button[data-figure-citation]').focus();
    document.querySelector('button[data-figure-citation]').click();`);
  await waitFor("document.querySelector('[data-citation-label]').textContent === 'Kopieren fehlgeschlagen'");
  assert.equal(await evaluate("document.querySelector('[data-citation-status]').textContent"), 'Die Zitation konnte nicht kopiert werden. Bitte erneut versuchen.');
  assert.equal(await evaluate("document.activeElement.matches('button[data-figure-citation]')"), true);
  await waitFor("document.querySelector('[data-citation-label]').textContent === 'Zitation kopieren'");
  const figures = await evaluate(`([...document.querySelectorAll('figure.mn-media-figure')].map(figure => {
    const image = figure.querySelector('${marker}');
    const link = figure.querySelector('.figure-credit a[download]');
    return {
      href: link?.href, filename: link?.getAttribute('download'), text: link?.textContent.trim(),
      source: image.dataset.downloadSrc ? new URL(image.dataset.downloadSrc, location.href).href : undefined,
      full: image.href, linkCount: figure.querySelectorAll('.figure-credit a[download]').length,
    };
  }))`);
  for (const figure of figures.slice(0, 2)) {
    assert.equal(figure.linkCount, 1);
    assert.equal(figure.text, '↓ SVG herunterladen');
    assert.equal(figure.filename, 'mednerds-icon.svg');
    assert.equal(figure.href, figure.source);
    assert.notEqual(figure.href, figure.full);
    assert.equal((await fetch(figure.href)).status, 200);
  }
  assert.equal(figures[2].linkCount, 0);
  assert.equal(figures[2].source, undefined);
  await evaluate("document.querySelector('.figure-credit a[download]').focus()");
  assert.equal(await evaluate("document.activeElement.matches('.figure-credit a[download]')"), true);

  for (const width of [320, 390, 768, 1440]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    for (const theme of ['light', 'dark']) {
      await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
      for (const align of ['start', 'center', 'end']) {
        const layout = await evaluate(`(() => {
          const figure=document.querySelector('figure.mn-media-figure');
          figure.dataset.align='${align}';
          const r=figure.getBoundingClientRect();
          const parent=figure.parentElement;
          const p=parent.getBoundingClientRect();
          const style=getComputedStyle(parent);
          const start=p.left+parseFloat(style.paddingLeft)+parseFloat(style.borderLeftWidth);
          const end=p.right-parseFloat(style.paddingRight)-parseFloat(style.borderRightWidth);
          const image=figure.querySelector('.figure-image').getBoundingClientRect();
          const caption=figure.querySelector('figcaption');
          const title=figure.querySelector('.figure-caption-title');
          const description=figure.querySelector('.figure-caption');
          const credit=figure.querySelector('.figure-credit');
          if (!title || !description || !credit) throw new Error('Incomplete caption: '+figure.outerHTML);
          return {left:r.left,right:r.right,expected:${align === 'start' ? 'start' : align === 'end' ? 'end-r.width' : '(start+end-r.width)/2'},
            imageWidth:image.width,figureWidth:r.width,captionWidth:caption.getBoundingClientRect().width,
            title:title.textContent,heading:!!figure.querySelector('h1,h2,h3,h4,h5,h6'),
            weight:getComputedStyle(title).fontWeight,align:getComputedStyle(caption).textAlign,
            descriptionSize:getComputedStyle(description).fontSize,creditSize:getComputedStyle(credit).fontSize,
            order:title.getBoundingClientRect().bottom<=description.getBoundingClientRect().top
              && description.getBoundingClientRect().bottom<=credit.getBoundingClientRect().top,
            overflow:document.documentElement.scrollWidth-innerWidth};
        })()`);
        assert.ok(Math.abs(layout.left-layout.expected)<1, JSON.stringify({align,width,theme,layout}));
        assert.ok(Math.abs(layout.imageWidth-layout.figureWidth)<1);
        assert.ok(Math.abs(layout.captionWidth-layout.figureWidth)<1);
        assert.equal(layout.title, 'MedNerds-Markenicon');
        assert.equal(layout.heading, false);
        assert.equal(layout.weight, '600');
        assert.ok(['start','left'].includes(layout.align));
        assert.equal(layout.descriptionSize, layout.creditSize);
        assert.equal(layout.order, true);
        assert.ok(layout.overflow<=1);
      }
      await evaluate("document.querySelector('figure.mn-media-figure').dataset.align='center'");
      await open(0);
      const current = await state();
      assert.equal(current.theme, theme);
      assert.equal(current.counter, '');
      assert.equal(current.download, true);
      assert.equal(current.color, current.expectedColor);
      assert.equal(current.controlsInViewport, true);
      assert.ok(current.caption.includes('einzelnen Abbildung'));
      assert.equal(await evaluate("document.querySelector('.mn-fancybox .mn-figure-caption-title').textContent"), 'MedNerds-Markenicon');
      assert.equal(await evaluate("document.querySelector('.mn-fancybox .mn-figure-caption-description').textContent"), 'Lokales MedNerds-Markenicon als Demonstration einer einzelnen Abbildung.');
      assert.equal(await evaluate("!!document.querySelector('.mn-fancybox .mn-figure-caption h1, .mn-fancybox .mn-figure-caption h2')"), false);
      assert.ok(current.caption.includes('MedNerds Basel') && current.caption.includes('Rechtehinweise zum Logo'));
      assert.equal(await evaluate("document.querySelector('.mn-fancybox .mn-figure-caption-meta a').getAttribute('href')"), '/urheberrecht/');
      assert.equal(await evaluate("document.querySelectorAll('.mn-fancybox .mn-figure-caption-meta a')[1].href"), 'https://github.com/NodalDev/MedNerds');
      await assertCaptionLayout();
      assert.ok(current.titles.includes('Schließen') && current.titles.includes('Vergrößern'));
      assert.ok(current.overflow <= 1, JSON.stringify(current));
      await close();
      assert.equal(await evaluate(`document.activeElement === document.querySelector('${marker}')`), true);
    }
  }

  // Long captions reproduce the original viewport-wide layout; no content files change.
  const originalCaption = await evaluate(`document.querySelector('${marker}').dataset.mnCaption`);
  const longCaption = 'Neutrale Beispielbeschreibung einer Abbildung mit mehreren Sätzen und Details. '.repeat(10);
  await evaluate(`document.querySelector('${marker}').dataset.mnCaption=${JSON.stringify(longCaption)}`);
  for (const [width,height] of [[1440,900],[768,700],[390,844],[320,480]]) {
    await command('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width<600});
    for (const theme of ['light','dark']) {
      await evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await open(0);
      await assertCaptionLayout();
      assert.equal(await evaluate("document.querySelector('.mn-fancybox .mn-figure-caption-description').textContent"), longCaption);
      assert.equal(await evaluate(`(() => {
        const caption=document.querySelector('.mn-fancybox .is-selected .f-caption');
        caption.scrollTop=caption.scrollHeight;
        const meta=caption.querySelector('.mn-figure-caption-meta').getBoundingClientRect();
        const r=caption.getBoundingClientRect();
        return meta.bottom<=r.bottom && meta.top>=r.top;
      })()`), true);
      await close();
    }
  }
  await evaluate(`document.querySelector('${marker}').dataset.mnCaption=${JSON.stringify(originalCaption)}`);
  await command('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});

  // Browser-only neutral SVG fixtures exercise oversized images without remote assets.
  for (const [imageWidth,imageHeight] of [[3200,800],[800,3200]]) {
    await evaluate(`(() => {
      const fixture=document.querySelector('${marker}').cloneNode(true);
      fixture.removeAttribute('data-fancybox');
      fixture.dataset.sizeTest='';
      fixture.href='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}"><rect width="100%" height="100%" fill="gray"/></svg>');
      document.querySelector('main').append(fixture);
    })()`);
    for (const [width,height] of [[1920,1080],[1440,900],[768,1024],[390,844]]) {
      await command('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width<600});
      await open(3);
      await assertCaptionLayout();
      const zoom=await panzoomState();
      assert.ok(Math.abs(zoom.scale-zoom.base)<0.001 && Math.abs(zoom.start-zoom.base)<0.001, JSON.stringify(zoom));
      assert.ok(zoom.full>zoom.base && zoom.max>=zoom.full);
      const fit=await evaluate(`(() => {
        const root=document.querySelector('.mn-fancybox');
        const image=root.querySelector('.is-selected .f-panzoom__content').getBoundingClientRect();
        const caption=root.querySelector('.is-selected .f-caption').getBoundingClientRect();
        const toolbar=root.querySelector('.f-carousel__toolbar').getBoundingClientRect();
        return {left:image.left,right:image.right,top:image.top,bottom:image.bottom,width:image.width,height:image.height,
          captionTop:caption.top,captionBottom:caption.bottom,toolbarBottom:toolbar.bottom};
      })()`);
      assert.ok(fit.width<=width*(width>800?0.9:1)+1);
      assert.ok(fit.left>=10 && fit.right<=width-10);
      assert.ok(fit.top>fit.toolbarBottom && fit.bottom<=fit.captionTop+1, JSON.stringify({width,height,imageWidth,imageHeight,fit}));
      assert.ok(fit.captionBottom<height);
      assert.ok(Math.abs(fit.width/fit.height-imageWidth/imageHeight)<0.01, JSON.stringify(fit));

      await evaluate("document.querySelector('.mn-fancybox [data-panzoom-action=zoomIn]').click()");
      await waitFor("window.mediaTestFancybox.getSlide().panzoomRef.getTransform().scale>1.01");
      await close();
      await open(3);
      await evaluate("document.querySelector('.mn-fancybox [data-panzoom-action=toggleFull]').click()");
      await waitFor("Math.abs(window.mediaTestFancybox.getSlide().panzoomRef.getTransform().scale-window.mediaTestFancybox.getSlide().panzoomRef.getScale('full'))<0.01");
      await close();
      await open(3);
      const center=await evaluate(`(() => {
        const r=document.querySelector('.mn-fancybox .is-selected .f-panzoom__content').getBoundingClientRect();
        return {x:r.left+r.width/2,y:r.top+r.height/2};
      })()`);
      if (width<600) {
        await command('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:2});
        const points=(distance)=>[{x:center.x-distance,y:center.y,id:0},{x:center.x+distance,y:center.y,id:1}];
        await command('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:points(20)});
        for (const distance of [25,30,35,40,45,50]) {
          await command('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:points(distance)});
          await pause(20);
        }
        await command('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
        await command('Emulation.setTouchEmulationEnabled', {enabled:false});
      } else {
        await command('Input.dispatchMouseEvent', {type:'mouseWheel',...center,deltaX:0,deltaY:-120});
      }
      await waitFor("window.mediaTestFancybox.getSlide().panzoomRef.getTransform().scale>1.01");
      await close();
    }
    await evaluate("document.querySelector('[data-size-test]').remove()");
  }
  await command('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});

  await open(1);
  assert.equal((await state()).counter, '1/2');
  await key('ArrowRight');
  await waitFor("document.querySelector('.mn-fancybox .f-counter')?.textContent === '2/2'");
  assert.equal((await state()).download, false);
  await key('ArrowLeft');
  await waitFor("document.querySelector('.mn-fancybox .f-counter')?.textContent === '1/2'");
  assert.equal((await state()).download, true);
  await close();
  await open(2); assert.equal((await state()).download, false); await close();
  await open(2);
  assert.equal(await evaluate("document.querySelector('.mn-fancybox .mn-figure-caption-title')"), null);
  assert.equal(await evaluate("document.querySelector('.mn-fancybox .mn-figure-caption-description').textContent"), 'Galerie: die horizontale Wortmarke.');
  await close();

  // Real touch gestures; start away from the next/previous arrow hit areas.
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await open(1); await pause(500);
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y: 180 }] });
  for (let x = 290; x >= 50; x -= 30) {
    await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 180 }] });
    await pause(15);
  }
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor("document.querySelector('.mn-fancybox .f-counter')?.textContent === '2/2'");
  await close();
  await command('Emulation.setTouchEmulationEnabled', { enabled: false });

  // Activate the image link with Enter; fullscreen needs a real user gesture.
  await evaluate(`document.querySelector('${marker}').focus()`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor("!!document.querySelector('.mn-fancybox.is-ready')");
  const fullscreenButton = await evaluate(`(() => {
    const r = document.querySelector('.mn-fancybox [data-fullscreen-action]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...fullscreenButton });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...fullscreenButton });
  await waitFor('!!document.fullscreenElement');
  await evaluate('document.exitFullscreen()');
  await close();

  // Add a second ungrouped trigger in the browser only; delegated binding must isolate it.
  await evaluate(`const copy = document.querySelector('${marker}').cloneNode(true); document.querySelector('main').append(copy)`);
  await open(3); assert.equal((await state()).counter, ''); await close();
  // HTML-shaped caption data must remain literal text, never executable markup.
  const unsafeText = '<img src=x onerror="window.captionExecuted=true">';
  await evaluate(`document.querySelector('${marker}').dataset.mnCaption = ${JSON.stringify(unsafeText)}`);
  await evaluate(`document.querySelector('${marker}').dataset.mnCaptionTitle = ${JSON.stringify(unsafeText)}`);
  const originalCredits = await evaluate(`document.querySelector('${marker}').dataset.mnCredits`);
  await evaluate(`document.querySelector('${marker}').dataset.mnCredits = JSON.stringify([
    {text:${JSON.stringify(unsafeText)}}, {text:'Orlando Frey'}, {text:'MedNerds'}, {text:'Lizenz',href:'javascript:window.captionExecuted=true'}
  ])`);
  await open(0);
  assert.equal(await evaluate("document.querySelector('.mn-fancybox .mn-figure-caption-title').textContent"), unsafeText);
  assert.equal(await evaluate("document.querySelector('.mn-fancybox .mn-figure-caption-description').textContent"), unsafeText);
  const safeMetadata = await evaluate(`(() => {
    const meta=document.querySelector('.mn-fancybox .mn-figure-caption-meta');
    return {text:meta.textContent,links:meta.querySelectorAll('a').length};
  })()`);
  assert.deepEqual(safeMetadata, {text:`${unsafeText} · Orlando Frey · MedNerds · Lizenz`,links:0});
  assert.equal(await evaluate("!!document.querySelector('.mn-fancybox .f-caption img') || !!window.captionExecuted"), false);
  await close();
  await evaluate(`document.querySelector('${marker}').dataset.mnCredits = ${JSON.stringify(originalCredits)}`);

  // Intercept the official toolbar's generated anchor without downloading a file.
  await open(0);
  await evaluate(`(() => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.testDownload = {href:this.href,filename:this.download}; };
    try { document.querySelector('.mn-fancybox [data-carousel-download]').click(); }
    finally { HTMLAnchorElement.prototype.click = original; }
  })()`);
  const download = await evaluate('window.testDownload');
  assert.equal(download.href, figures[0].href);
  assert.equal(download.filename, 'mednerds-icon.svg');
  await close();

  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await open(0);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.mn-fancybox')).getPropertyValue('--f-interface-enter-duration').trim()"), '0s');
  await close();
  await command('Emulation.setEmulatedMedia', { features: [] });

  for (const path of ['/meddocs/', '/medblog/', '/medtools/']) {
    await navigate(path);
    assert.equal(await evaluate(`document.querySelectorAll('${marker}').length`), 0);
    assert.equal(await evaluate("performance.getEntriesByType('resource').some(r => r.name.includes('@fancyapps') || r.name.includes('/src/styles/fancybox.css'))"), false);
  }

  await command('Emulation.setScriptExecutionDisabled', { value: true });
  await navigate(route);
  const fallback = await evaluate(`document.querySelector('${marker}').href`);
  assert.equal((await fetch(fallback)).status, 200);
  assert.equal(await evaluate("document.querySelectorAll('figure img[alt][width][height]').length"), 3);
  assert.equal(await evaluate("!!document.querySelector('.mn-fancybox')"), false);
  assert.equal(await evaluate("document.querySelector('.figure-credit a[download]').href"), figures[0].href);
  assert.equal(await evaluate("[...document.querySelectorAll('[data-figure-citation-action]')].every(action=>action.hidden)"), true);
  await evaluate(`document.querySelector('${marker}').focus()`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(`location.href === ${JSON.stringify(fallback)} && !!document.querySelector('body > img')`);
  assert.deepEqual(errors, []);
  console.log('✓ Figure alignment/title/description, metadata/citations, Clipboard API/accessible feedback, safe captions/credits, downloads, galleries, keyboard/fullscreen/touch, responsive light/dark, reduced motion, opt-in loading and no-JS fallback');
} finally {
  await command('Emulation.setScriptExecutionDisabled', { value: false });
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
