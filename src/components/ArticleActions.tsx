import { useEffect, useRef, useState } from 'react';
import medToolsLight from '../assets/SubLogos/MedTools hell.svg?url';
import medToolsDark from '../assets/SubLogos/MedTools dunkel.svg?url';

export default function ArticleActions() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <div ref={menuRef} className="not-content relative w-fit text-left">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--sl-color-hairline)] bg-[var(--mn-surface)] px-4 py-2 text-sm font-semibold text-[var(--sl-color-text)] shadow-sm transition hover:border-[var(--mn-tools)] hover:text-[var(--mn-tools)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mn-tools)]"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="MedTools – Artikelwerkzeuge"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="product-logo" aria-hidden="true">
          <img className="brand-light" src={medToolsLight} width="963" height="230" alt="" />
          <img className="brand-dark" src={medToolsDark} width="963" height="230" alt="" />
        </span>
        <span aria-hidden="true" className="text-xs">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-[var(--sl-color-hairline)] bg-[var(--mn-surface)] p-2 shadow-xl"
        >
          <a
            role="menuitem"
            href="https://chatgpt.com/"
            target="_blank"
            rel="noreferrer"
            className="flex gap-3 rounded-xl px-3 py-3 text-[var(--sl-color-white)] no-underline transition hover:bg-[var(--mn-surface-hover)]"
          >
            <span aria-hidden="true" className="font-semibold text-[var(--mn-tools)]">AI</span>
            <span>
              <strong className="block">In ChatGPT öffnen ↗</strong>
              <span className="text-sm text-[var(--sl-color-gray-3)]">Artikelkontext folgt später</span>
            </span>
          </a>

          <a
            role="menuitem"
            href="https://claude.ai/new"
            target="_blank"
            rel="noreferrer"
            className="flex gap-3 rounded-xl px-3 py-3 text-[var(--sl-color-white)] no-underline transition hover:bg-[var(--mn-surface-hover)]"
          >
            <span aria-hidden="true" className="font-semibold text-[var(--mn-tools)]">C</span>
            <span>
              <strong className="block">In Claude öffnen ↗</strong>
              <span className="text-sm text-[var(--sl-color-gray-3)]">Artikelkontext folgt später</span>
            </span>
          </a>

          <div className="my-1 border-t border-[var(--sl-color-hairline)]" />

          <button
            role="menuitem"
            type="button"
            onClick={() => window.print()}
            className="flex w-full gap-3 rounded-xl bg-transparent px-3 py-3 text-left text-[var(--sl-color-white)] transition hover:bg-[var(--mn-surface-hover)]"
          >
            <span aria-hidden="true" className="text-xs font-bold text-[var(--mn-tools)]">PDF</span>
            <strong>Als PDF speichern</strong>
          </button>
        </div>
      )}
    </div>
  );
}
