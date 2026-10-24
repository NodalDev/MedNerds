import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Reuse the repository's local Chrome/CDP regression-test setup; no browser dependency.
const site = process.env.SIDEBAR_SITE ?? 'http://127.0.0.1:4326';
const endpoint = process.env.SIDEBAR_CDP ?? 'http://127.0.0.1:9334';
const screenshots = process.env.TOC_SCREENSHOTS ?? tmpdir();
await mkdir(screenshots, { recursive: true });
const article = '/meddocs/anaesthesie/target-controlled-infusion/';
const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (pending.has(message.id)) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Fetch.requestPaused') {
    const local = new URL(message.params.request.url).origin === new URL(site).origin;
    void command(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local
      ? { requestId: message.params.requestId }
      : { requestId: message.params.requestId, errorReason: 'BlockedByClient' });
  }
};
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(expression) {
  for (let i = 0; i < 120; i++) {
    if (await evaluate(expression)) return;
    await pause(50);
  }
  throw Error(`Timed out: ${expression}`);
}
async function navigate(path = article) {
  const previousDocument = await evaluate('performance.timeOrigin');
  const response = await command('Page.navigate', { url: site + path });
  if (!response.loaderId) await command('Page.reload', { ignoreCache: true });
  await wait(`performance.timeOrigin !== ${previousDocument} && location.pathname === ${JSON.stringify(path.split('#')[0])} && document.readyState === 'complete' && !!document.querySelector('main h1')`);
}
const desktop = 'meddocs-toc-accordion starlight-toc';
const mobile = 'meddocs-toc-accordion mobile-starlight-toc';
async function scrollHeading(id, scope = desktop) {
  await evaluate(`(() => {
    const heading = document.getElementById(${JSON.stringify(id)});
    const toc = document.querySelector(${JSON.stringify(scope)});
    const offset = document.querySelector('header').getBoundingClientRect().height + (toc.querySelector('summary')?.getBoundingClientRect().height ?? 0) + 36;
    window.scrollTo({ top: heading.getBoundingClientRect().top + scrollY - offset, behavior: 'instant' });
  })()`);
  await wait(`(() => {
    const toc = document.querySelector(${JSON.stringify(scope)});
    const current = toc?.querySelector('a[aria-current="true"]');
    const expected = [...toc.querySelectorAll('a')].find(a => a.hash === ${JSON.stringify('#' + encodeURIComponent(id))});
    return current === expected || (expected?.nextElementSibling?.matches('.mn-toc-toggle') && expected.closest('li').contains(current));
  })()`);
}
const openGroups = (scope = desktop) => `[...document.querySelectorAll('${scope} .mn-toc-toggle[aria-expanded="true"]')].map(button => button.previousElementSibling.hash)`;
async function capture(name) {
  const image = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(screenshots, name), Buffer.from(image.data, 'base64'));
}
async function verifyRowBand(scope) {
  assert.equal(await evaluate(`(() => {
    const toc = document.querySelector(${JSON.stringify(scope)});
    const leaf = toc.querySelector('nav > ul > li:not(.mn-toc-group) > a, .dropdown > ul > li:not(.mn-toc-group) > a');
    return [...toc.querySelectorAll('.mn-toc-row')].every(row => {
      const link = row.querySelector(':scope > a'), button = row.querySelector(':scope > button');
      const r = row.getBoundingClientRect(), a = link.getBoundingClientRect(), b = button.getBoundingClientRect();
      return !button.closest('a') && !link.closest('button') && Math.abs(r.width - row.parentElement.getBoundingClientRect().width) < 1
        && Math.abs(r.width - leaf.getBoundingClientRect().width) < 1
        && Math.abs(a.right - b.left) < 1 && Math.abs(b.right - r.right) < 1 && Math.abs(a.height - b.height) < 1;
    });
  })()`), true, 'text and chevron fill one common row, including wrapped titles');
  await command('DOM.enable');
  await command('CSS.enable');
  const documentNode = await command('DOM.getDocument');
  const { nodeId } = await command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: `${scope} .mn-toc-row` });
  await command('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
  assert.equal(await evaluate(`(() => {
    const row = document.querySelector('${scope} .mn-toc-row');
    const clear = element => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)';
    return !clear(row) && clear(row.querySelector('a')) && clear(row.querySelector('button'));
  })()`), true, 'hover background belongs to the entire band, never its individual controls');
  await command('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${scope} .mn-toc-row')).backgroundColor !== 'rgba(0, 0, 0, 0)'`), true);
  await command('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  await evaluate(`document.querySelector('${scope} .mn-toc-row > a').focus({ preventScroll: true })`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate(`(() => {
    const button = document.activeElement, row = button.closest('.mn-toc-row');
    return button.matches('.mn-toc-toggle') && getComputedStyle(row).outlineStyle === 'solid' && getComputedStyle(button).outlineStyle === 'solid';
  })()`), true, 'button focus identifies both its control and the whole row');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  assert.equal(await evaluate(`document.activeElement.matches('.mn-toc-row > a') && getComputedStyle(document.activeElement.closest('.mn-toc-row')).outlineStyle === 'solid'`), true, 'link has a full-row keyboard focus indicator');
  await evaluate('document.activeElement.blur()');
}
async function verifyMotion(scope) {
  await wait(`document.querySelector('${scope}').closest('meddocs-toc-accordion').hasAttribute('data-toc-animated')`);
  const settle = () => evaluate(`Promise.all([...document.querySelectorAll('${scope} .mn-toc-panel')].flatMap(panel => panel.getAnimations().map(animation => animation.finished.catch(() => {})))).then(() => true)`);
  await settle();
  await evaluate(`(() => { const button = document.querySelector('${scope} .mn-toc-toggle'); if (button.getAttribute('aria-expanded') === 'true') button.click(); })()`);
  await settle();
  const opening = await evaluate(`(() => {
    const button = document.querySelector('${scope} .mn-toc-toggle'), panel = button.closest('li').querySelector('.mn-toc-panel');
    const before = panel.getBoundingClientRect().height, y = scrollY;
    button.click();
    const animation = panel.getAnimations().find(animation => animation.transitionProperty === 'grid-template-rows');
    const duration = animation?.effect.getTiming().duration;
    if (animation) animation.currentTime = 85;
    const middle = panel.getBoundingClientRect().height, full = panel.firstElementChild.scrollHeight;
    return { before, duration, middle, full, inert: panel.querySelector('ul').inert, yUnchanged: scrollY === y };
  })()`);
  assert.equal(opening.before, 0);
  assert.equal(opening.duration, 170);
  assert.ok(opening.middle > 0 && opening.middle < opening.full, 'opening interpolates its natural height');
  assert.equal(opening.inert, false);
  assert.equal(opening.yUnchanged, true);
  await settle();
  assert.equal(await evaluate(`(() => { const panel = document.querySelector('${scope} .mn-toc-panel'), list = panel.querySelector('ul'); return list.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1; })()`), true, 'expanded content is not clipped');

  const closing = await evaluate(`(() => {
    const button = document.querySelector('${scope} .mn-toc-toggle'), panel = button.closest('li').querySelector('.mn-toc-panel'), list = panel.querySelector('ul');
    const full = panel.getBoundingClientRect().height;
    button.focus({ preventScroll: true }); button.click();
    const animation = panel.getAnimations().find(animation => animation.transitionProperty === 'grid-template-rows');
    const duration = animation?.effect.getTiming().duration;
    if (animation) animation.currentTime = 65;
    list.querySelector('a').focus({ preventScroll: true });
    return { duration, full, middle: panel.getBoundingClientRect().height, inert: list.inert, hiddenFromAT: list.getAttribute('aria-hidden'), focusBlocked: document.activeElement === button };
  })()`);
  assert.equal(closing.duration, 130);
  assert.ok(closing.middle > 0 && closing.middle < closing.full, 'closing interpolates instead of disappearing');
  assert.equal(closing.inert, true);
  assert.equal(closing.hiddenFromAT, 'true');
  assert.equal(closing.focusBlocked, true, 'closing children cannot take keyboard focus');
  await settle();
  assert.equal(await evaluate(`document.querySelector('${scope} .mn-toc-panel').getBoundingClientRect().height`), 0);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${scope} .mn-toc-panel')).visibility`), 'hidden');

  await evaluate(`(() => {
    const button = document.querySelector('${scope} .mn-toc-toggle'), panel = button.closest('li').querySelector('.mn-toc-panel');
    button.click(); panel.getBoundingClientRect();
    const animation = panel.getAnimations().find(animation => animation.transitionProperty === 'grid-template-rows');
    if (animation) animation.currentTime = 60;
    button.click(); panel.getBoundingClientRect(); button.click();
  })()`);
  await settle();
  assert.equal(await evaluate(`document.querySelector('${scope} .mn-toc-toggle').getAttribute('aria-expanded')`), 'true', 'rapid reversal leaves the intended group open');

  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate(`(() => {
    const button = document.querySelector('${scope} .mn-toc-toggle'), panel = button.closest('li').querySelector('.mn-toc-panel');
    button.click(); const closed = panel.getBoundingClientRect().height === 0 && panel.getAnimations().length === 0;
    button.click(); return closed && panel.getBoundingClientRect().height > 0 && panel.getAnimations().length === 0 && getComputedStyle(panel).transitionDuration === '0s';
  })()`), true, 'reduced motion disables opening and closing completely');
  await command('Emulation.setEmulatedMedia', { features: [] });
  await evaluate('document.activeElement.blur()');
}
try {
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate();
  await wait(`document.querySelector('${desktop} .mn-toc-toggle') !== null`);
  await wait(`document.querySelector('${desktop} a[aria-current="true"]') !== null`);
  await wait(`document.querySelector('${desktop}').closest('meddocs-toc-accordion').hasAttribute('data-toc-animated')`);
  await evaluate(`window.__tocMotionEvents = []; document.querySelector('${desktop}').addEventListener('transitionrun', event => {
    if (event.propertyName === 'grid-template-rows' && event.target.matches('.mn-toc-panel')) {
      window.__tocMotionEvents.push({ hash: event.target.closest('li').querySelector('.mn-toc-row > a').hash, expanded: event.target.dataset.expanded });
    }
  })`);
  assert.deepEqual(await evaluate(openGroups()), [], 'overview starts with all groups closed');

  const headings = await evaluate(`[...document.querySelectorAll('${desktop} nav > ul > li')].map(item => ({ hash: item.querySelector(':scope > a, :scope > .mn-toc-row > a').hash, children: [...item.querySelectorAll(':scope > .mn-toc-panel ul a')].map(a => a.hash) }))`);
  const groups = headings.filter((heading) => heading.children.length);
  assert.ok(groups.length >= 2, 'TCI provides two main chapters with children');
  const [model, models] = groups;
  const id = (hash) => decodeURIComponent(hash.slice(1));
  const button = (hash, scope = desktop) => `${scope} a[href="${hash}"] + button`;
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const afterModel = headings[headings.findIndex((heading) => heading.hash === model.hash) + 1];

  await scrollHeading(id(model.children[0]));
  assert.deepEqual(await evaluate(openGroups()), [model.hash]);
  await wait(`window.__tocMotionEvents.some(event => event.hash === ${JSON.stringify(model.hash)} && event.expanded === 'true')`);
  const before = await evaluate('({ y: scrollY, hash: location.hash })');
  await click(button(models.hash));
  assert.deepEqual(await evaluate(openGroups()), [models.hash]);
  assert.deepEqual(await evaluate('({ y: scrollY, hash: location.hash })'), before, 'chevron does not navigate/scroll the article');
  await pause(200);
  await scrollHeading(id(model.children[1]));
  assert.deepEqual(await evaluate(openGroups()), [models.hash], 'same main chapter preserves manual choice');
  await click(button(model.hash));
  await evaluate(`document.querySelector('${desktop} a[href="${model.children[0]}"]').focus({ preventScroll: true })`);
  await evaluate(`Promise.all(document.querySelector('${desktop} .mn-toc-panel').getAnimations().map(animation => animation.finished.catch(() => {}))).then(() => { window.__tocMotionEvents = []; })`);
  await scrollHeading(id(afterModel.hash));
  assert.deepEqual(await evaluate(openGroups()), [], 'main chapter without children closes the previous group');
  await wait(`window.__tocMotionEvents.some(event => event.hash === ${JSON.stringify(model.hash)} && event.expanded === 'false')`);
  assert.equal(await evaluate('document.activeElement.hash'), model.hash, 'focus stays on a visible parent if its child becomes hidden');
  await scrollHeading(id(models.hash));
  assert.deepEqual(await evaluate(openGroups()), [models.hash]);
  await click(button(models.hash));
  assert.deepEqual(await evaluate(openGroups()), [], 'active group can be closed manually');
  await scrollHeading(id(models.children[0]));
  assert.deepEqual(await evaluate(openGroups()), [], 'active child changes do not reopen manually closed main chapter');

  await click(button(model.hash));
  await click(`${desktop} a[href="${model.children[0]}"]`);
  await wait(`location.hash === ${JSON.stringify(model.children[0])}`);
  await wait(`${openGroups()}.includes(${JSON.stringify(model.hash)})`);
  await click(`${desktop} a[href="${models.hash}"]`);
  await wait(`location.hash === ${JSON.stringify(models.hash)}`);
  await evaluate('history.back()');
  await wait(`location.hash === ${JSON.stringify(model.children[0])}`);
  await wait(`${openGroups()}.includes(${JSON.stringify(model.hash)})`);
  await evaluate('history.forward()');
  await wait(`location.hash === ${JSON.stringify(models.hash)}`);
  await wait(`${openGroups()}.includes(${JSON.stringify(models.hash)})`);

  await navigate(article + model.children[1]);
  await wait(`${openGroups()}.includes(${JSON.stringify(model.hash)})`);
  await wait(`document.querySelector('${desktop} a[aria-current="true"]')?.hash === ${JSON.stringify(model.children[1])}`);
  assert.equal(await evaluate(`document.querySelector('${desktop} .mn-toc-panel').getAnimations().length`), 0, 'initial deep-link selection does not animate');
  assert.equal(await evaluate(`(() => {
    const toc = document.querySelector('${desktop}');
    return [...toc.querySelectorAll('.mn-toc-toggle')].every(button => {
      const list = document.getElementById(button.getAttribute('aria-controls'));
      return button.tagName === 'BUTTON' && !button.closest('a') && list.inert === (button.getAttribute('aria-expanded') === 'false') && list.getAttribute('aria-hidden') === String(list.inert) && button.getAttribute('aria-label').includes('Unterkapitel von');
    });
  })()`), true);
  assert.equal(await evaluate(`document.querySelectorAll('${desktop} nav > ul > li:not(.mn-toc-group) button').length`), 0);
  assert.equal(await evaluate(`[...document.querySelectorAll('${desktop} .mn-toc-toggle svg')].every(svg => svg.getBBox().width > 0)`), true, 'chevrons have visible inline paths');
  await evaluate(`document.querySelector(${JSON.stringify(button(model.hash))}).focus({ preventScroll: true })`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  assert.deepEqual(await evaluate(openGroups()), []);
  assert.equal(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'solid');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate(`document.activeElement.closest('[inert], [aria-hidden="true"]') === null`), true);
  await click(button(model.hash));
  await evaluate('document.activeElement.blur()');
  for (const theme of ['light', 'dark']) {
    await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
    await verifyRowBand(desktop);
    await scrollHeading(id(model.hash));
    await wait(`document.querySelector('${desktop} a[aria-current="true"]')?.hash === ${JSON.stringify(model.hash)}`);
    assert.equal(await evaluate(`(() => {
      const link = document.querySelector('${desktop} a[aria-current="true"]'), row = link.closest('.mn-toc-row');
      return !!row && getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(link).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(row, '::before').width === '2px';
    })()`), true, 'active parent has a full-width band and retains its left marker');
    await capture(`meddocs-toc-${theme}.png`);
    await verifyMotion(desktop);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 500, deviceScaleFactor: 1, mobile: false });
  await pause(300);
  if (!(await evaluate(openGroups())).includes(model.hash)) await click(button(model.hash));
  await wait(`(() => { const panel = document.querySelector('${desktop}').closest('.right-sidebar'); return getComputedStyle(panel).overflowY === 'auto' && panel.scrollHeight > panel.clientHeight; })()`);

  await command('Emulation.setDeviceMetricsOverride', { width: 375, height: 850, deviceScaleFactor: 1, mobile: true });
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await navigate();
  await wait(`document.querySelector('${mobile} .mn-toc-toggle') !== null`);
  await click(`${mobile} summary`);
  const mobileBefore = await evaluate('({ y: scrollY, hash: location.hash })');
  await click(button(model.hash, mobile));
  assert.deepEqual(await evaluate(openGroups(mobile)), [model.hash]);
  assert.deepEqual(await evaluate('({ y: scrollY, hash: location.hash })'), mobileBefore);
  assert.equal(await evaluate(`document.querySelector('${mobile} details').open`), true, 'chevron does not close mobile TOC');
  assert.equal(await evaluate(`(() => { const rect = document.querySelector('${mobile} .mn-toc-toggle').getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44; })()`), true, 'touch targets are at least 44px');
  const controls = await evaluate(`[...document.querySelectorAll('meddocs-toc-accordion button[aria-controls]')].map(button => button.getAttribute('aria-controls'))`);
  assert.equal(new Set(controls).size, controls.length, 'desktop and mobile use unique controlled-list IDs');
  await capture('meddocs-toc-mobile.png');
  for (const theme of ['light', 'dark']) {
    await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    await verifyRowBand(mobile);
    await verifyMotion(mobile);
  }
  await click(`${mobile} a[href="${model.children[0]}"]`);
  await wait(`location.hash === ${JSON.stringify(model.children[0])}`);
  assert.equal(await evaluate(`document.querySelector('${mobile} details').open`), false, 'mobile anchor retains Starlight close behavior');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);

  await navigate('/meddocs/echokardiographie/grundlagen-technik/nomenklatur/');
  await pause(200);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'short/un-numbered article remains usable');
  assert.equal(await evaluate('document.querySelectorAll(".mn-toc-toggle").length'), 0, 'short TOC without children needs no chevrons');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Emulation.setTouchEmulationEnabled', { enabled: false });
  await navigate('/meddocs/echokardiographie/grundlagen-technik/physikalische-grundlagen/');
  await wait(`document.querySelectorAll('${desktop} .mn-toc-toggle').length === 2`);
  await scrollHeading('b-mode');
  assert.deepEqual(await evaluate(openGroups()), ['#bildgebungsmodi'], 'hierarchy works with unnumbered headings');
  await click(button('#ultraschallsonde'));
  assert.deepEqual(await evaluate(openGroups()), ['#ultraschallsonde']);
  await navigate('/meddocs/');
  assert.equal(await evaluate('document.querySelectorAll("meddocs-toc-accordion").length'), 0, 'hub remains without TOC');
  await navigate('/faq/');
  assert.equal(await evaluate('document.querySelectorAll("meddocs-toc-accordion, .mn-toc-toggle").length'), 0, 'other sections retain their TOC');

  await command('Emulation.setScriptExecutionDisabled', { value: true });
  await navigate();
  assert.equal(await evaluate('document.querySelectorAll(".mn-toc-toggle").length'), 0);
  assert.equal(await evaluate(`document.querySelectorAll('${desktop} ul[hidden]').length`), 0);
  assert.ok(await evaluate(`document.querySelectorAll('${desktop} ul ul a').length`) > 4, 'without JS all child anchors remain present');
  await command('Emulation.setScriptExecutionDisabled', { value: false });
  assert.deepEqual(errors, []);
  console.log('✓ MedDocs TOC: Starlight scrollspy, manual priority, CSS opening/closing/reversal, reduced motion, one group, anchors/deep links/history, keyboard, desktop/mobile, themes, no-JS, hub/other sections');
} catch (error) {
  const screenshot = await command('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (screenshot) await writeFile(join(screenshots, 'meddocs-toc-failure.png'), Buffer.from(screenshot.data, 'base64'));
  throw error;
} finally {
  socket.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
