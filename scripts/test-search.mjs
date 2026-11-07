import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the installed Starlight handler and the actual drawer component together.
// Only browser DOM APIs are simulated; event bubbling includes listeners added during a click.
const scripts = await Promise.all([
  '../node_modules/@astrojs/starlight/components/Search.astro',
  '../src/components/MedNerdsDrawerSearch.astro',
  '../src/components/MedNerdsSearch.astro',
].map(async path => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, path + ' contains its client script');
  return ts.transpileModule(script.replaceAll('import.meta.env.DEV', 'true').replaceAll('import.meta.env.BASE_URL', "'/'"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}));

function searchFixture() {
  const document = { activeElement: undefined };
  class Element {
    listeners = new Map();
    attributes = new Map();
    dataset = {};
    selectors = new Map();
    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener));
    }
    dispatch(type, properties = {}, bubbles = true) {
      const event = { target: this, cancelBubble: false, ...properties,
        stopPropagation() { this.cancelBubble = true; }, preventDefault() {},
      };
      for (let node = this; node; node = bubbles && !event.cancelBubble ? node.parent : undefined) {
        for (const listener of [...(node.listeners.get(type) ?? [])]) listener(event);
      }
    }
    click() { this.dispatch('click'); }
    focus() { document.activeElement = this; }
    contains(node) { return node === this || Boolean(node?.parent && this.contains(node.parent)); }
    querySelector(selector) { return this.selectors.get(selector) ?? null; }
    toggleAttribute(name, force) { force ? this.attributes.set(name, '') : this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
  }
  const window = new Element(), body = new Element();
  body.parent = window;
  document.body = body;
  const registry = new Map();
  const customElements = { define: (name, value) => registry.set(name, value), get: name => registry.get(name) };
  let selectors;
  class HTMLElement extends Element {
    constructor() { super(); this.parent = body; this.selectors = selectors; }
  }
  const execute = code => new Function('HTMLElement', 'document', 'window', 'customElements', 'require', 'exports', code)(
    HTMLElement, document, window, customElements, () => ({ pagefindUserConfig: {} }), {},
  );
  const openButton = new Element(), closeButton = new Element(), dialog = new Element();
  const frame = new Element(), input = new Element();
  selectors = new Map([['button[data-open-modal]', openButton], ['button[data-close-modal]', closeButton],
    ['dialog', dialog], ['.dialog-frame', frame], ['input', input]]);
  let opened = 0, closed = 0, previousFocus;
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; opened++; previousFocus = document.activeElement; };
  dialog.close = () => { dialog.open = false; closed++; previousFocus?.focus(); dialog.dispatch('close', {}, false); };
  execute(scripts[0]);
  const search = new (registry.get('site-search'))();
  openButton.parent = dialog.parent = search;
  frame.parent = dialog;
  input.parent = closeButton.parent = frame;
  const drawerButton = new Element();
  selectors = new Map([['button', drawerButton]]);
  execute(scripts[1]);
  const drawer = new (registry.get('mednerds-drawer-search'))();
  drawerButton.parent = drawer;
  document.querySelector = selector => selector === 'site-search button[data-open-modal]' ? openButton : null;
  drawer.connectedCallback();
  return { window, body, dialog, frame, input, drawer, drawerButton, openButton, closeButton, document,
    counts: () => ({ opened, closed }) };
}

test('mobile search click stays open, focuses the input and does not reach the outside-click handler', () => {
  const fixture = searchFixture();
  fixture.drawerButton.focus();
  fixture.drawerButton.click();
  assert.deepEqual(fixture.counts(), { opened: 1, closed: 0 });
  assert.equal(fixture.dialog.open, true);
  assert.equal(fixture.body.hasAttribute('data-search-modal-open'), true);
  assert.equal(fixture.document.activeElement, fixture.input);
});

test('Starlight still handles inside clicks, close button, outside clicks and focus restoration', () => {
  const fixture = searchFixture();
  fixture.drawer.connectedCallback(); // Reconnection must not register a second forwarding listener.
  fixture.drawerButton.focus();
  fixture.drawerButton.click();
  fixture.input.click();
  assert.equal(fixture.dialog.open, true);
  fixture.closeButton.click();
  assert.equal(fixture.dialog.open, false);
  assert.equal(fixture.body.hasAttribute('data-search-modal-open'), false);
  assert.equal(fixture.document.activeElement, fixture.drawerButton);
  fixture.drawerButton.click();
  fixture.body.click();
  assert.equal(fixture.dialog.open, false);
  assert.deepEqual(fixture.counts(), { opened: 2, closed: 2 });
});

test('desktop search and the existing Control+K shortcut keep working', () => {
  const fixture = searchFixture();
  fixture.openButton.click();
  assert.equal(fixture.dialog.open, true);
  fixture.window.dispatch('keydown', { ctrlKey: true, key: 'k' });
  assert.equal(fixture.dialog.open, false);
  fixture.window.dispatch('keydown', { metaKey: true, key: 'k' });
  assert.equal(fixture.dialog.open, true);
  assert.equal(fixture.document.activeElement, fixture.input);
});

test('search wrapper mounts one help block, preserves the original search and makes updates polite', t => {
  const registry = new Map(), help = {};
  const container = { append: t.mock.fn() };
  const search = { setAttribute: t.mock.fn() };
  let template = { content: { cloneNode: () => help }, remove: () => { template = undefined; } };
  class HTMLElement {
    querySelector(selector) {
      return selector === 'template' ? template : selector === '#starlight__search' ? search : container;
    }
  }
  new Function('HTMLElement', 'customElements', scripts[2])(
    HTMLElement, { get: name => registry.get(name), define: (name, value) => registry.set(name, value) },
  );
  const wrapper = new (registry.get('mednerds-search'))();
  wrapper.connectedCallback();
  wrapper.connectedCallback();
  assert.equal(container.append.mock.callCount(), 1);
  assert.equal(container.append.mock.calls[0].arguments[0], help);
  assert.deepEqual(search.setAttribute.mock.calls[0].arguments, ['aria-live', 'polite']);
});

if (process.argv.includes('--built')) test('built search passes the complete German dictionary to the original Starlight dialog', async () => {
  const { parse } = await import('parse5');
  const tree = parse(await readFile(new URL('../dist/meddocs/index.html', import.meta.url), 'utf8'));
  const all = node => [node, ...(node.childNodes ?? []).flatMap(all)];
  const nodes = all(tree);
  const searches = nodes.filter(node => node.tagName === 'site-search');
  assert.equal(searches.length, 1, 'one shared search implementation');
  assert.equal(nodes.filter(node => node.tagName === 'mednerds-search').length, 1);
  const actual = JSON.parse(searches[0].attrs.find(attr => attr.name === 'data-translations').value);
  const expected = JSON.parse(await readFile(new URL('../src/content/i18n/de.json', import.meta.url), 'utf8'));
  for (const [key, value] of Object.entries(expected).filter(([key]) => key.startsWith('pagefind.'))) {
    assert.equal(actual[key.slice('pagefind.'.length)], value, 'Starlight forwards ' + key);
  }
  assert.equal(actual.language, 'de');
  assert.equal(actual.search_label, 'MedDocs durchsuchen');
  assert.equal(actual.one_result.replace('[COUNT]', '1').replace('[SEARCH_TERM]', 'tci'), '1 Ergebnis für «tci»');
  assert.equal(actual.many_results.replace('[COUNT]', '3').replace('[SEARCH_TERM]', 'tci'), '3 Ergebnisse für «tci»');
  assert.equal(actual.zero_results.replace('[SEARCH_TERM]', 'xyz'), 'Keine Ergebnisse für «xyz»');
  assert.equal(actual.searching.replace('[SEARCH_TERM]', 'tci'), 'Suche nach «tci» …');
  assert.equal(actual.clear_search, 'Suche löschen');
  assert.equal(actual.load_more, 'Weitere Ergebnisse laden');
  assert.ok(actual.alt_search.includes('[SEARCH_TERM]') && actual.alt_search.includes('[DIFFERENT_TERM]'));
  assert.ok(actual.search_suggestion.includes('[SEARCH_TERM]'));
  const wrapper = nodes.find(node => node.tagName === 'mednerds-search');
  const template = all(wrapper).find(node => node.tagName === 'template');
  const text = all(template.content).filter(node => node.nodeName === '#text').map(node => node.value).join(' ');
  assert.match(text, /Was möchtest du wissen\?/);
  assert.match(text, /Begriffen, Abkürzungen oder Themen/);
});
