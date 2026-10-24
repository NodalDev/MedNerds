interface TocGroup {
  item: HTMLLIElement;
  link: HTMLAnchorElement;
  list: HTMLUListElement;
  button: HTMLButtonElement;
  row: HTMLDivElement;
  panel: HTMLDivElement;
  originalId: string;
  originalInert: boolean;
  originalAriaHidden: string | null;
}

/** Enhance Starlight's existing hierarchy and aria-current scrollspy; no second scroll observer. */
export class MedDocsTocAccordion extends HTMLElement {
  private cleanup?: () => void;

  connectedCallback(): void {
    queueMicrotask(() => {
      if (this.isConnected && !this.cleanup) this.initialize();
    });
  }

  disconnectedCallback(): void {
    this.cleanup?.();
    this.cleanup = undefined;
  }

  private initialize(): void {
    const toc = this.querySelector('starlight-toc, mobile-starlight-toc');
    const root = toc?.querySelector<HTMLUListElement>('nav > ul, .dropdown > ul');
    const template = this.querySelector<HTMLTemplateElement>('[data-toc-toggle-template]');
    if (!toc || !root || !template) return;

    const variant = toc.localName === 'starlight-toc' ? 'desktop' : 'mobile';
    const groups: TocGroup[] = [];
    const roots = new Map<HTMLAnchorElement, HTMLLIElement>();
    for (const [index, item] of [...root.children].entries()) {
      if (!(item instanceof HTMLLIElement)) continue;
      item.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => roots.set(link, item));
      const link = item.querySelector<HTMLAnchorElement>(':scope > a');
      const list = item.querySelector<HTMLUListElement>(':scope > ul');
      if (!link || !list) continue;

      const button = template.content.querySelector('button')!.cloneNode(true) as HTMLButtonElement;
      const originalId = list.id;
      list.id ||= `meddocs-toc-${variant}-${index}`;
      button.setAttribute('aria-controls', list.id);
      item.classList.add('mn-toc-group');
      const row = document.createElement('div');
      row.className = 'mn-toc-row';
      link.before(row);
      row.append(link, button);
      const panel = document.createElement('div');
      panel.className = 'mn-toc-panel';
      const content = document.createElement('div');
      content.className = 'mn-toc-panel-content';
      const originalInert = list.inert;
      const originalAriaHidden = list.getAttribute('aria-hidden');
      list.before(panel);
      panel.append(content);
      content.append(list);
      groups.push({ item, link, list, button, row, panel, originalId, originalInert, originalAriaHidden });
    }
    if (!groups.length) return;

    // Changes within the same main chapter must not override a manual choice.
    let activeRoot: HTMLLIElement | undefined;
    let animationFrame: number | undefined;
    const enableAnimation = (): void => {
      if (animationFrame !== undefined || this.hasAttribute('data-toc-animated')) return;
      animationFrame = requestAnimationFrame(() => {
        this.setAttribute('data-toc-animated', '');
        animationFrame = undefined;
      });
    };
    const setOpenGroup = (open?: HTMLLIElement): void => {
      for (const group of groups) {
        const expanded = group.item === open;
        if (!expanded && group.list.contains(document.activeElement)) {
          // Only relocate focus when its current link would become hidden.
          group.link.focus({ preventScroll: true });
        }
        // Disable interaction immediately, while CSS can finish the visual collapse.
        group.list.inert = !expanded;
        group.list.setAttribute('aria-hidden', String(!expanded));
        group.panel.dataset.expanded = String(expanded);
        group.button.setAttribute('aria-expanded', String(expanded));
        group.button.setAttribute('aria-label', `Unterkapitel von ${group.link.textContent?.trim()} ${expanded ? 'ausblenden' : 'einblenden'}`);
      }
    };
    const synchronize = (): void => {
      const current = toc.querySelector<HTMLAnchorElement>('a[aria-current="true"]');
      const nextRoot = current ? roots.get(current) : undefined;
      if (nextRoot !== activeRoot) {
        activeRoot = nextRoot;
        setOpenGroup(activeRoot);
      }
      // The first scrollspy selection is rendered without an initial animation.
      if (current) enableAnimation();
    };

    // A direct child hash is useful before Starlight's idle-time scrollspy initializes.
    const hashLink = [...roots.keys()].find((link) => link.hash === location.hash);
    const initialLink = hashLink ?? toc.querySelector<HTMLAnchorElement>('a[aria-current="true"]')
      ?? root.querySelector<HTMLAnchorElement>('a');
    activeRoot = initialLink ? roots.get(initialLink) : undefined;
    setOpenGroup(activeRoot);

    const events = new AbortController();
    for (const group of groups) {
      group.button.addEventListener('click', () => {
        setOpenGroup(group.list.inert ? group.item : undefined);
      }, { signal: events.signal });
    }
    toc.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!(link instanceof HTMLAnchorElement) || !roots.has(link)) return;
      setOpenGroup(roots.get(link));
    }, { signal: events.signal });
    window.addEventListener('hashchange', () => {
      const link = [...roots.keys()].find((candidate) => candidate.hash === location.hash);
      if (link) setOpenGroup(roots.get(link));
    }, { signal: events.signal });

    const observer = new MutationObserver(synchronize);
    observer.observe(toc, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    // Reconcile initial state if Starlight has already selected a heading.
    if (toc.querySelector('a[aria-current="true"]')) synchronize();

    this.cleanup = () => {
      observer.disconnect();
      events.abort();
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      this.removeAttribute('data-toc-animated');
      for (const group of groups) {
        group.list.inert = group.originalInert;
        if (group.originalAriaHidden === null) group.list.removeAttribute('aria-hidden');
        else group.list.setAttribute('aria-hidden', group.originalAriaHidden);
        group.list.id = group.originalId;
        group.panel.before(group.list);
        group.panel.remove();
        group.row.before(group.link);
        group.row.remove();
        group.item.classList.remove('mn-toc-group');
      }
    };
  }
}
