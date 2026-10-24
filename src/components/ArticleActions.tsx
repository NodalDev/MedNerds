import { useEffect, useId, useRef, useState } from 'react';
import medToolsLight from '../assets/SubLogos/MedTools hell.webp?url';
import medToolsDark from '../assets/SubLogos/MedTools dunkel.webp?url';
import { copyText } from '../lib/meddocs/references/clipboard';

interface Props { title: string; canonical: string; learningUrl?: string; canCite?: boolean }
export default function ArticleActions({ title, canonical, learningUrl, canCite = true }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    function outside(event: PointerEvent) { if (event.target instanceof Node && !root.current?.contains(event.target)) setIsOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && isOpen) { setIsOpen(false); trigger.current?.focus(); } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    if (isOpen) root.current?.querySelector<HTMLElement>('.article-tools-panel button')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [isOpen]);
  async function share() {
    setIsOpen(false); setStatus('');
    try {
      if (navigator.share) { await navigator.share({ title, url: canonical }); setStatus('Artikel geteilt.'); }
      else { await copyText(canonical); setStatus('Artikellink kopiert.'); }
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('Teilen nicht möglich. Artikellink: ' + canonical); }
    trigger.current?.focus();
  }
  function cite() { setIsOpen(false); trigger.current?.focus(); document.dispatchEvent(new CustomEvent('meddocs:cite')); }
  function print() { setIsOpen(false); trigger.current?.focus(); window.print(); }
  return <div className="article-tools not-content" ref={root}>
    <button className="article-tools-trigger" ref={trigger} type="button" aria-expanded={isOpen} aria-controls={panelId} aria-label="MedTools – Artikelwerkzeuge" onClick={() => setIsOpen((value) => !value)}>
      <span className="product-logo" aria-hidden="true"><img className="brand-light" src={medToolsLight} width="482" height="115" alt="" loading="lazy" /><img className="brand-dark" src={medToolsDark} width="482" height="115" alt="" loading="lazy" /></span><span aria-hidden="true">⌄</span>
    </button>
    {isOpen && <div className="article-tools-panel" id={panelId} aria-label="Artikelwerkzeuge">
      <button type="button" onClick={print}>Drucken / als PDF speichern</button>
      <button type="button" onClick={() => void share()}>Artikel teilen</button>
      {canCite && <button type="button" onClick={cite}>Zitieren &amp; Exportieren</button>}
      {learningUrl && <a href={learningUrl}>Passendes E-Learning öffnen</a>}
    </div>}
    <span className="article-tools-status" role="status" aria-live="polite">{status}</span>
  </div>;
}
