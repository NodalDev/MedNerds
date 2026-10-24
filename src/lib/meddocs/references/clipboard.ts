/** Small native fallback; success is never claimed after a rejected permission request. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const focused = document.activeElement;
  const input = document.createElement('textarea'); input.value = text; input.readOnly = true;
  input.setAttribute('aria-label', 'Text zum Kopieren'); input.className = 'citation-copy-fallback';
  (document.querySelector('dialog[open]') ?? document.body).append(input);
  input.select(); let copied = false;
  try { copied = document.execCommand('copy'); } finally { input.remove(); if (focused instanceof HTMLElement) focused.focus({ preventScroll: true }); }
  if (!copied) throw new Error('Bitte markiere und kopiere die Vorschau manuell.');
}
