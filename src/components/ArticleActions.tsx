import { useEffect, useRef, useState } from 'react';

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
        className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-400 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-blue-400 dark:hover:text-blue-300"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">✦</span>
        Werkzeuge
        <span aria-hidden="true" className="text-xs">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        >
          <a
            role="menuitem"
            href="https://chatgpt.com/"
            target="_blank"
            rel="noreferrer"
            className="flex gap-3 rounded-xl px-3 py-3 text-gray-800 no-underline transition hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            <span aria-hidden="true" className="font-semibold text-blue-600">AI</span>
            <span>
              <strong className="block">In ChatGPT öffnen ↗</strong>
              <span className="text-sm text-gray-500 dark:text-gray-400">Artikelkontext folgt später</span>
            </span>
          </a>

          <a
            role="menuitem"
            href="https://claude.ai/new"
            target="_blank"
            rel="noreferrer"
            className="flex gap-3 rounded-xl px-3 py-3 text-gray-800 no-underline transition hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            <span aria-hidden="true" className="font-semibold text-amber-600">C</span>
            <span>
              <strong className="block">In Claude öffnen ↗</strong>
              <span className="text-sm text-gray-500 dark:text-gray-400">Artikelkontext folgt später</span>
            </span>
          </a>

          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

          <button
            role="menuitem"
            type="button"
            onClick={() => window.print()}
            className="flex w-full gap-3 rounded-xl px-3 py-3 text-left text-gray-800 transition hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            <span aria-hidden="true" className="text-xs font-bold text-gray-500">PDF</span>
            <strong>Als PDF speichern</strong>
          </button>
        </div>
      )}
    </div>
  );
}
