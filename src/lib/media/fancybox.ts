import type { FancyboxInstance, FancyboxOptions } from '@fancyapps/ui/dist/fancybox/fancybox.js';
import { validateFigureUrl } from './urls';
import type { FigureCredit } from './figure-metadata';

const figureSelector = '[data-mednerds-fancybox]';
let initialization: Promise<void> | undefined;

function readFigureCredits(value?: string): FigureCredit[] {
  if (!value) return [];
  try {
    const credits: unknown = JSON.parse(value);
    if (!Array.isArray(credits)) return [];
    return credits.flatMap((credit) => {
      if (!credit || typeof credit.text !== 'string') return [];
      let href: string | undefined;
      if (typeof credit.href === 'string') {
        try { href = validateFigureUrl(credit.href); } catch { /* Keep invalid links as text. */ }
      }
      return [{ text: credit.text, href }];
    });
  } catch { return []; }
}

/** Content data is only ever assigned to DOM text or validated link attributes. */
function createFigureCaption(trigger?: HTMLElement): HTMLElement | string {
  const titleText = trigger?.dataset.mnCaptionTitle;
  const text = trigger?.dataset.mnCaption;
  const credits = readFigureCredits(trigger?.dataset.mnCredits);
  if (!titleText && !text && credits.length === 0) return '';
  const caption = document.createElement('div');
  caption.className = 'mn-figure-caption';
  if (titleText) {
    const title = document.createElement('p');
    title.className = 'mn-figure-caption-title';
    title.textContent = titleText;
    caption.append(title);
  }
  if (text) {
    const description = document.createElement('p');
    description.className = 'mn-figure-caption-description';
    description.textContent = text;
    caption.append(description);
  }
  if (credits.length > 0) {
    const meta = document.createElement('p');
    meta.className = 'mn-figure-caption-meta';
    credits.forEach(({ text, href }, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.textContent = ' · ';
        separator.setAttribute('aria-hidden', 'true');
        meta.append(separator);
      }
      const credit = document.createElement(href ? 'a' : 'span');
      credit.textContent = text;
      if (credit instanceof HTMLAnchorElement && href) credit.href = href;
      meta.append(credit);
    });
    caption.append(meta);
  }
  return caption;
}

/** Keep the native download button exclusive to explicitly downloadable slides. */
function syncDownloadButton(instance: FancyboxInstance): void {
  const button = instance.getContainer()?.querySelector<HTMLButtonElement>('[data-carousel-download]');
  if (!button) return;
  const allowed = Boolean(instance.getSlide()?.triggerEl?.dataset.downloadSrc);
  button.hidden = !allowed;
  button.disabled = !allowed;
}

async function bindFigures(): Promise<void> {
  const [{ Fancybox }, { de_DE }, { default: styles }] = await Promise.all([
    import('@fancyapps/ui/dist/fancybox/fancybox.js'),
    import('@fancyapps/ui/dist/fancybox/l10n/de_DE.js'),
    // Inline import avoids Astro collecting this CSS into every page's styles.
    import('../../styles/fancybox.css?inline'),
  ]);

  if (!document.querySelector('style[data-mednerds-fancybox-styles]')) {
    const stylesheet = document.createElement('style');
    stylesheet.dataset.mednerdsFancyboxStyles = '';
    stylesheet.textContent = styles;
    document.head.append(stylesheet);
  }

  const options: Partial<FancyboxOptions> = {
    mainClass: 'mn-fancybox',
    Hash: false,
    l10n: de_DE,
    Carousel: {
      Zoomable: {
        Panzoom: {
          // 6.1.15 types accept a numeric scale here, resolved through the official API.
          startPos: (panzoom) => ({ x: 0, y: 0, scale: panzoom.getScale('base') }),
        },
      },
      formatCaption: (_carousel, slide) => createFigureCaption(slide.triggerEl),
      Thumbs: { minCount: 2, showOnStart: false },
    },
    on: {
      init: (instance) => {
        const settings = instance.getOptions();
        settings.theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          settings.zoomEffect = false;
          settings.fadeEffect = false;
          settings.showClass = false;
          settings.hideClass = false;
          settings.Carousel.transition = false;
        }
      },
      initSlides: (instance, slides) => {
        instance.getOptions().Carousel.Toolbar = {
          // Reserve the actual toolbar height, including its two-row mobile layout.
          absolute: false,
          display: {
            left: slides.length > 1 ? ['counter'] : [],
            middle: ['zoomIn', 'zoomOut', 'toggle1to1'],
            right: [
              ...(slides.some((slide) => slide.triggerEl?.dataset.downloadSrc) ? ['download'] : []),
              'fullscreen', 'thumbs', 'close',
            ],
          },
        };
      },
      ready: syncDownloadButton,
      'Carousel.change': syncDownloadButton,
    },
  };
  Fancybox.bind(figureSelector, options);
}

/** One shared binding per document; unmarked pages do not load Fancybox or its CSS. */
export function initializeMediaLightbox(): Promise<void> {
  if (!document.querySelector(figureSelector)) return Promise.resolve();
  initialization ??= bindFigures().catch((error: unknown) => {
    // Ordinary image links remain usable if the enhancement cannot load.
    initialization = undefined;
    console.warn('MedNerds: Die Bildvergrößerung konnte nicht geladen werden.', error);
  });
  return initialization;
}
