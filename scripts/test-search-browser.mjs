import assert from 'node:assert/strict';

// Use the existing local production server + Chrome/CDP workflow; no browser dependency.
const site = process.env.SIDEBAR_SITE ?? 'http://127.0.0.1:4326';
const endpoint = process.env.SIDEBAR_CDP ?? 'http://127.0.0.1:9334';
const target = await (await fetch(endpoint + '/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map(), errors = [];
let holdIndex = false;
const heldIndexes = [];
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data), task = pending.get(message.id);
  if (task) { pending.delete(message.id); message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    if (holdIndex && new URL(request.url).pathname.endsWith('.pf_index')) { heldIndexes.push(requestId); return; }
    void command(new URL(request.url).origin === new URL(site).origin ? 'Fetch.continueRequest' : 'Fetch.failRequest',
      new URL(request.url).origin === new URL(site).origin ? { requestId } : { requestId, errorReason: 'BlockedByClient' });
  }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function wait(expression) {
  for (let n = 0; n < 120; n++) { if (await evaluate(expression)) return; await pause(50); }
  throw Error('Timed out: ' + expression + '; state: ' + JSON.stringify(await evaluate('({input:document.querySelector("#starlight__search input")?.value,message:document.querySelector(".pagefind-ui__message")?.textContent,active:document.activeElement?.getAttribute("aria-label"),menu:document.body.hasAttribute("data-mobile-menu-expanded")})')));
}
async function press(key, code, windowsVirtualKeyCode) {
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
}
async function activate(selector, touch) {
  const point = await evaluate('(() => { const element = document.querySelector(' + JSON.stringify(selector) + '); element.scrollIntoView({block:"nearest",behavior:"instant"}); const r=element.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()');
  assert.equal(await evaluate('document.querySelector(' + JSON.stringify(selector) + ').contains(document.elementFromPoint(' + point.x + ',' + point.y + '))'), true, 'button/link receives pointer input');
  if (touch) {
    await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
}
const input = '#starlight__search input';
const results = '#starlight__search .pagefind-ui__result-link';
const open = 'document.querySelector("site-search dialog").open';
const helpVisible = 'getComputedStyle(document.querySelector(".mn-search-help")).display !== "none"';
const message = 'document.querySelector(".pagefind-ui__message")?.textContent.trim()';
async function searchFor(term) {
  await evaluate('document.querySelector(' + JSON.stringify(input) + ').focus()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await command('Input.insertText', { text: term });
}
async function assertFits() {
  assert.equal(await evaluate('(() => { const element=document.querySelector("site-search dialog"); const r=element.getBoundingClientRect(); const input=document.querySelector("#starlight__search input").getBoundingClientRect(); return r.left>=-1 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 && input.top>=0 && input.bottom<=innerHeight && element.scrollWidth<=element.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth+1; })()'), true, 'dialog/input fit the viewport without horizontal overflow');
  assert.equal(await evaluate('(() => { const close=document.querySelector("site-search [data-close-modal]"); if(getComputedStyle(close).display==="none") return true; const button=close.getBoundingClientRect(), field=document.querySelector("#starlight__search input").getBoundingClientRect(); return button.left>=field.right+4 && button.width>=44 && button.height>=44; })()'), true, 'mobile input and close button have separate, usable touch targets');
}
try {
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Network.enable');
  await command('Network.setCacheDisabled', { cacheDisabled: true });
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  for (const width of [320, 375, 430, 768, 1440]) for (const theme of ['light', 'dark']) {
    const mobile = width < 800;
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    await command('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 });
    await command('Page.navigate', { url: site + '/meddocs/' });
    await wait('document.readyState === "complete" && !!document.querySelector("#starlight__search input") && !!document.querySelector(".mn-search-help")');
    await evaluate('document.documentElement.dataset.theme = ' + JSON.stringify(theme));
    const trigger = mobile ? 'mednerds-drawer-search button' : 'site-search button[data-open-modal]';
    if (mobile) {
      await activate('starlight-menu-button button', true);
      await wait('document.body.hasAttribute("data-mobile-menu-expanded")');
    }
    assert.equal(await evaluate('document.querySelector(' + JSON.stringify(trigger) + ').tagName'), 'BUTTON');
    holdIndex = width === 320 && theme === 'light';
    await activate(trigger, mobile);
    await wait(open);
    await pause(250);
    assert.equal(await evaluate(open), true, 'search stays open after its triggering tap/click');
    assert.equal(await evaluate('document.activeElement === document.querySelector(' + JSON.stringify(input) + ')'), true);
    assert.equal(await evaluate('document.querySelector(' + JSON.stringify(input) + ').placeholder'), 'Suchen');
    assert.equal(await evaluate('document.querySelector(".pagefind-ui__form").getAttribute("aria-label")'), 'MedDocs durchsuchen');
    assert.equal(await evaluate('document.querySelector("#starlight__search").getAttribute("aria-live")'), 'polite');
    assert.equal(await evaluate(helpVisible), true);
    await press('Tab', 'Tab', 9);
    assert.equal(await evaluate('document.activeElement.matches(".pagefind-ui__search-clear")'), false, 'empty search does not focus the invisible clear button');
    await evaluate('document.querySelector(' + JSON.stringify(input) + ').focus()');
    assert.match(await evaluate('document.querySelector(".mn-search-help").textContent'), /Was möchtest du wissen\?/);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".mn-search-keyboard")).display !== "none"'),
      await evaluate('!matchMedia("(hover: none), (pointer: coarse)").matches'), 'hide keyboard hints for touch devices');
    const emptyHeight = await evaluate('document.querySelector("site-search dialog").getBoundingClientRect().height');
    assert.ok(emptyHeight < 280, 'empty dialog fits its short help, without a large minimum height');
    await assertFits();
    await searchFor('tci');
    assert.equal(await evaluate(helpVisible), false, 'help hides immediately on typing');
    if (holdIndex) {
      await wait(message + ' === "Suche nach «tci» …"');
      holdIndex = false;
      await Promise.all(heldIndexes.splice(0).map(requestId => command('Fetch.continueRequest', { requestId })));
    }
    await wait('/^\\d+ Ergebnisse für «tci»$/.test(' + message + ')');
    await wait('document.querySelectorAll(' + JSON.stringify(results) + ').length > 0');
    assert.ok(await evaluate('document.querySelectorAll("#starlight__search mark").length') > 0, 'search terms stay highlighted');
    await assertFits();

    if (width === 320 && theme === 'light') {
      await searchFor('Schnider');
      await wait(message + ' === "1 Ergebnis für «Schnider»"');
      await searchFor('xyznonexistentword');
      await wait(message + ' === "Keine Ergebnisse für «xyznonexistentword»"');
      const longTerm = 'Keintreffer'.repeat(45);
      await searchFor(longTerm);
      await wait(message + '?.includes(' + JSON.stringify(longTerm) + ') && !(' + message + ')?.startsWith("Suche nach")');
      await assertFits();
      await searchFor('Anästhesie');
      await wait('/^\\d+ Ergebnisse für «Anästhesie»$/.test(' + message + ') && !!document.querySelector("#starlight__search .pagefind-ui__button")');
      const before = await evaluate('Array.from(document.querySelectorAll(".pagefind-ui__results > li > .pagefind-ui__result-inner > .pagefind-ui__result-title > a")).map(link=>link.href)');
      assert.equal(await evaluate('document.querySelector("#starlight__search .pagefind-ui__button").textContent.trim()'), 'Weitere Ergebnisse laden');
      await activate('#starlight__search .pagefind-ui__button', mobile);
      await wait('document.querySelectorAll(".pagefind-ui__results > li").length > ' + before.length);
      const after = await evaluate('Array.from(document.querySelectorAll(".pagefind-ui__results > li > .pagefind-ui__result-inner > .pagefind-ui__result-title > a")).map(link=>link.href)');
      assert.deepEqual(after.slice(0, before.length), before, 'loading more retains the original ranking');
      assert.equal(await evaluate('(() => {const drawer=document.querySelector(".pagefind-ui__drawer");return drawer.scrollHeight>drawer.clientHeight&&getComputedStyle(drawer).overflowY==="auto";})()'), true, 'long results scroll inside the dialog');
      await evaluate('document.querySelector(".pagefind-ui__drawer").scrollTop = 10000');
      await assertFits();
      await searchFor('tci');
      await wait('/^\\d+ Ergebnisse für «tci»$/.test(' + message + ')');
    }
    if (width === 375 && theme === 'dark') {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 420, deviceScaleFactor: 1, mobile });
      await assertFits();
      await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    }

    let resultFocused = false;
    for (let n = 0; n < 20 && !resultFocused; n++) {
      await press('Tab', 'Tab', 9);
      resultFocused = await evaluate('document.activeElement.matches(' + JSON.stringify(results) + ')');
      assert.equal(await evaluate('document.querySelector("site-search dialog").contains(document.activeElement)'), true, 'focus stays in the dialog');
    }
    assert.equal(resultFocused, true, 'results are reachable with Tab');
    assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle !== "none"'), true, 'keyboard focus is visible');
    await press('Escape', 'Escape', 27);
    await wait('!' + open);
    // The native dialog closes on Escape keydown; Starlight then sees keyup in the drawer.
    // Its drawer closes as well, so the visible return target is the menu button.
    const returnTarget = mobile ? 'starlight-menu-button button' : trigger;
    assert.equal(await evaluate('document.activeElement === document.querySelector(' + JSON.stringify(returnTarget) + ')'), true, 'focus returns to a visible control');
    if (mobile) {
      await activate('starlight-menu-button button', true);
      await wait('document.body.hasAttribute("data-mobile-menu-expanded")');
      await evaluate('document.querySelector(' + JSON.stringify(trigger) + ').focus()');
    }
    await press('Enter', 'Enter', 13);
    await wait(open);
    if (mobile) {
      await activate('site-search [data-close-modal]', true);
      await wait('!' + open);
      assert.equal(await evaluate('document.activeElement === document.querySelector(' + JSON.stringify(trigger) + ')'), true, 'Cancel returns focus to the drawer search button');
      await activate(trigger, true);
      await wait(open);
    }
    assert.equal(await evaluate('document.querySelector(".pagefind-ui__search-clear").textContent.trim()'), 'Suche löschen');
    await activate('.pagefind-ui__search-clear', mobile);
    await wait(helpVisible);
    assert.equal(await evaluate('document.querySelector(' + JSON.stringify(input) + ').value'), '');
    assert.ok(Math.abs(await evaluate('document.querySelector("site-search dialog").getBoundingClientRect().height') - emptyHeight) <= 1);
    await searchFor('tci');
    await wait('/^\\d+ Ergebnisse für «tci»$/.test(' + message + ')');
    const section = '#starlight__search .pagefind-ui__result-nested a[href*="#"]:not([href$="#_top"])';
    await wait('!!document.querySelector(' + JSON.stringify(section) + ')');
    const destination = await evaluate('document.querySelector(' + JSON.stringify(section) + ').href');
    await activate(section, mobile);
    await wait('location.href === ' + JSON.stringify(destination) + ' && !!document.getElementById(decodeURIComponent(location.hash.slice(1)))');
    console.log('Search: ' + width + 'px / ' + theme + ': compact help, German results, clear, touch/mouse, keyboard/focus, Escape, section navigation and overflow passed.');
  }
  assert.deepEqual(errors, []);
} finally {
  socket.close();
  await fetch(endpoint + '/json/close/' + target.id);
}
