import { isArticlePreview, previewAssetPath, previewTarget, selectedPreview, type ArticlePreview } from './model';

const cache = new Map<string, Promise<ArticlePreview | undefined>>();
let dispose: (() => void) | undefined;
export function disposeLinkPreviews(): void { dispose?.(); dispose = undefined; }

async function loadPreview(path: string): Promise<ArticlePreview | undefined> {
  let request = cache.get(path);
  if (!request) {
    request = fetch(previewAssetPath(path), { credentials: 'omit', mode: 'same-origin', redirect: 'error' })
      .then(async (response) => {
        if (!response.ok) return;
        const value: unknown = await response.json();
        return isArticlePreview(value, path) ? value : undefined;
      }).catch(() => { cache.delete(path); return undefined; });
    cache.set(path, request);
  }
  return request;
}

/** One delegated controller; no per-link requests/listeners during page initialization. */
export function initializeLinkPreviews(): void {
  disposeLinkPreviews();
  const panel = document.querySelector<HTMLElement>('#meddocs-link-preview');
  const content = document.querySelector<HTMLElement>('main .sl-markdown-content');
  if (!panel || !content) return;
  const canonicalOrigin = panel.dataset.canonicalOrigin ?? location.origin;
  const hover = matchMedia('(any-hover: hover)');
  const kind = panel.querySelector<HTMLElement>('[data-preview-kind]')!;
  const title = panel.querySelector<HTMLElement>('[data-preview-title]')!;
  const parent = panel.querySelector<HTMLElement>('[data-preview-parent]')!;
  const text = panel.querySelector<HTMLElement>('[data-preview-text]')!;
  if (typeof panel.showPopover !== 'function') panel.removeAttribute('popover');
  let active: HTMLAnchorElement | undefined;
  let opening: number | undefined;
  let closing: number | undefined;
  let generation = 0;
  let touchUntil = 0;
  const events = new AbortController();

  function close(): void {
    clearTimeout(opening); clearTimeout(closing); opening = closing = undefined;
    generation++;
    if (active?.getAttribute('aria-details') === panel!.id) active.removeAttribute('aria-details');
    active = undefined;
    if (panel!.hasAttribute('popover') && panel!.matches(':popover-open')) panel!.hidePopover();
    panel!.hidden = true;
  }
  function eligible(target: EventTarget | null): HTMLAnchorElement | undefined {
    const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!hover.matches || !link || !content!.contains(link)
      || link.closest('nav, figure, figcaption, .med-citation, .meddocs-editorial, .meddocs-references, .reference-list, .article-tools, .sl-link-card, .card-grid, meddocs-comments, button, [role="button"], [inert]')
      || link.matches('[download], .sl-link-button, .button, .sl-anchor-link, [data-mednerds-fancybox]')
      || link.hasAttribute('aria-details') && link.getAttribute('aria-details') !== panel!.id
      || link.querySelector('img, button') || !link.closest('p, li, dd')) return;
    return previewTarget(link.href, location.href, canonicalOrigin) ? link : undefined;
  }
  function position(): void {
    if (!active) return;
    const margin = 8, gap = 8;
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    const anchor = active.getBoundingClientRect();
    const below = Math.max(0, height - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    panel!.style.maxHeight = `${Math.max(1, Math.min(height - 2 * margin, Math.max(above, below)))}px`;
    const card = panel!.getBoundingClientRect();
    const top = below >= card.height || below >= above ? anchor.bottom + gap : anchor.top - card.height - gap;
    panel!.style.left = `${Math.max(margin, Math.min(anchor.left, width - card.width - margin))}px`;
    panel!.style.top = `${Math.max(margin, Math.min(top, height - card.height - margin))}px`;
  }
  function scheduleClose(): void {
    if (active === document.activeElement && active?.matches(':focus-visible')) return;
    if (panel!.hidden) { close(); return; }
    clearTimeout(closing);
    closing = window.setTimeout(close, 150);
  }
  function schedule(link: HTMLAnchorElement): void {
    clearTimeout(closing);
    if (active === link) return;
    close();
    active = link;
    const current = generation;
    opening = window.setTimeout(async () => {
      const target = previewTarget(link.href, location.href, canonicalOrigin);
      if (!target) return;
      const article = await loadPreview(target.path);
      if (current !== generation || active !== link || !link.isConnected) return;
      if (!article || !hover.matches) { close(); return; }
      const preview = selectedPreview(article, target.hash);
      kind.textContent = preview.kind;
      title.textContent = preview.title;
      parent.textContent = preview.parent ? `Aus: ${preview.parent}` : '';
      parent.hidden = !preview.parent;
      text.textContent = preview.text ?? '';
      text.hidden = !preview.text;
      panel!.hidden = false;
      if (panel!.hasAttribute('popover')) panel!.showPopover();
      position();
      // Optional structured details, without replacing the link name or reading its full excerpt automatically.
      link.setAttribute('aria-details', panel!.id);
    }, 300);
  }
  content.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const link = eligible(event.target);
    if (link && !(event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) schedule(link);
  }, { signal: events.signal });
  content.addEventListener('pointerout', (event) => {
    if (active?.contains(event.target as Node) && !(event.relatedTarget instanceof Node && active.contains(event.relatedTarget))) scheduleClose();
  }, { signal: events.signal });
  content.addEventListener('focusin', (event) => {
    const link = eligible(event.target);
    if (Date.now() >= touchUntil && link?.matches(':focus-visible')) schedule(link);
  }, { signal: events.signal });
  content.addEventListener('focusout', () => {
    if (panel!.hidden) { close(); return; }
    clearTimeout(closing);
    closing = window.setTimeout(() => { if (active !== document.activeElement) close(); }, 150);
  }, { signal: events.signal });
  panel.addEventListener('pointerenter', () => clearTimeout(closing), { signal: events.signal });
  panel.addEventListener('pointerleave', scheduleClose, { signal: events.signal });
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') { touchUntil = Date.now() + 1000; close(); }
  }, { signal: events.signal, passive: true });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); }, { signal: events.signal });
  document.addEventListener('scroll', (event) => {
    if (!(event.target instanceof Node && panel!.contains(event.target))) close();
  }, { signal: events.signal, capture: true, passive: true });
  window.addEventListener('resize', close, { signal: events.signal, passive: true });
  hover.addEventListener('change', close, { signal: events.signal });
  window.addEventListener('pagehide', close, { signal: events.signal });
  dispose = () => { close(); events.abort(); };
}
