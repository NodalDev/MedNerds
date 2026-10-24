import { copyText } from './clipboard.ts';
import { selectCitationItems, type CitationPayload } from './model.ts';
import type { CitationStyle } from './format.ts';
let formatting: Promise<typeof import('./format.ts')> | undefined;
let assets: Promise<typeof import('./assets.ts')> | undefined;
let exporting: Promise<typeof import('./export.ts')> | undefined;
const initialized = new WeakSet<HTMLDialogElement>();
let listening = false;
const exportTargets: Readonly<Record<string, string>> = { article: 'artikel', cited: 'einzelnachweise', literature: 'literatur', references: 'quellen' };
export function initializeCitationDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#meddocs-citation-dialog');
  if (!dialog || initialized.has(dialog)) return; initialized.add(dialog);
  const payload: CitationPayload = JSON.parse(dialog.dataset.citationPayload ?? '{}');
  const target = dialog.querySelector<HTMLSelectElement>('[data-citation-target]')!;
  const style = dialog.querySelector<HTMLSelectElement>('[data-citation-style]')!;
  const initialStyle = style.value;
  const preview = dialog.querySelector<HTMLElement>('[data-citation-preview]')!;
  const status = dialog.querySelector<HTMLElement>('[data-citation-status]')!;
  const retry = dialog.querySelector<HTMLButtonElement>('[data-citation-retry]')!;
  const controls = [...dialog.querySelectorAll<HTMLButtonElement>('[data-citation-copy], [data-citation-export]')];
  let restore: HTMLElement | null = null; let generation = 0; let ready = false;
  const selection = () => selectCitationItems(payload, target.value);
  async function render(): Promise<void> {
    const current = ++generation; ready = false; retry.hidden = true; controls.forEach((button) => button.disabled = true); status.textContent = 'Zitation wird vorbereitet …';
    try {
      const items = selection(); if (!items.length) throw new Error('Für diese Auswahl sind keine Quellen hinterlegt.');
      const [processor, data] = await Promise.all([formatting ??= import('./format.ts'), assets ??= import('./assets.ts')]);
      const text = processor.formatBibliography(items, style.value as CitationStyle, await data.loadCslAssets(style.value as CitationStyle)).map((row) => row.text).join('\n\n');
      if (current !== generation || !dialog?.open) return;
      preview.textContent = text; ready = true; status.textContent = ''; controls.forEach((button) => button.disabled = false);
    } catch {
      if (current !== generation) return; preview.textContent = ''; status.textContent = selection().length ? 'Die Zitation konnte nicht vorbereitet werden. Bitte versuche es erneut.' : 'Für diese Auswahl sind keine Quellen hinterlegt.'; retry.hidden = !selection().length;
      formatting = undefined; assets = undefined;
    }
  }
  function open(source = 'article', opener?: HTMLElement): void { restore = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); target.value = source; if (!target.value) target.value = 'article'; style.value = initialStyle; dialog!.showModal(); target.focus(); void render(); }
  document.querySelectorAll<HTMLElement>('[data-citation-trigger]').forEach((button) => { button.hidden = false; button.addEventListener('click', () => open(button.dataset.referenceCite ? `reference:${button.dataset.referenceCite}` : 'article', button)); });
  if (!listening) {
    listening = true;
    document.addEventListener('meddocs:cite', () => document.querySelector('#meddocs-citation-dialog')?.dispatchEvent(new Event('citation:open')));
  }
  dialog.addEventListener('citation:open', () => open());
  dialog.querySelector('[data-citation-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; restore?.focus({ preventScroll: true }); });
  target.addEventListener('change', () => void render()); style.addEventListener('change', () => void render());
  retry.addEventListener('click', () => void render());
  dialog.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-citation-copy], [data-citation-export]') : null;
    if (!button || !ready || button.disabled) return;
    try {
      if (button.hasAttribute('data-citation-copy')) { await copyText(preview.textContent ?? ''); status.textContent = 'Zitierung kopiert.'; return; }
      const format = button.dataset.citationExport; let text = preview.textContent ?? '';
      if (format !== 'txt') { const exporter = await (exporting ??= import('./export.ts')); text = format === 'bib' ? exporter.exportBibtex(selection()) : exporter.exportRis(selection()); }
      if (!text.trim()) throw new Error('Keine exportierbaren Literaturangaben.');
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const filenameTarget = exportTargets[target.value] ?? `quelle-${target.value.slice('reference:'.length)}`;
      const link = document.createElement('a'); link.href = url; link.download = `mednerds-${filenameTarget}-${format === 'txt' ? style.value : 'metadaten'}.${format}`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Export zum Download bereitgestellt.';
    } catch { status.textContent = 'Die Aktion ist nicht möglich. Bitte kopiere die Vorschau bei Bedarf manuell.'; }
  });
}
