import type { Loader } from 'astro/loaders';
import { fileURLToPath } from 'node:url';
import { relative, isAbsolute } from 'node:path';
import { readPublicationCatalog, resolvePublications, publicationDirectory, type PublicationCatalog } from './catalog.ts';
import { collectCitations, referenceOrder } from './numbering.ts';

/** Resolve IDs before caching, including content watcher writes and catalog-only changes. */
export function referenceAwareLoader(loader: Loader, loadCatalog: () => Promise<PublicationCatalog> = readPublicationCatalog): Loader {
  return { ...loader, async load(context) {
    let catalog = await loadCatalog();
    const store = { ...context.store, set(entry: Parameters<typeof context.store.set>[0]): boolean {
      if (!entry.id.startsWith('meddocs/')) return context.store.set(entry);
      try {
        const sources = resolvePublications(entry.data.references ?? [], catalog, entry.filePath ?? entry.id);
        const citations = collectCitations(entry.body ?? '');
        if ((sources.length || citations.length) && (!entry.data.authors || !entry.data.published)) throw new Error('Quellen benötigen einen Artikel mit Autoren und Veröffentlichungsdatum.');
        const data = { ...entry.data, resolvedReferences: sources, referenceOrder: referenceOrder(sources, citations) };
        const existing = context.store.get(entry.id);
        // Astro's source digest does not include catalog files. Refresh only changed derived data.
        if (existing && existing.digest === entry.digest && JSON.stringify(existing.data) !== JSON.stringify(data)) context.store.delete(entry.id);
        return context.store.set({ ...entry, data });
      } catch (error) { throw new Error(`[MedDocs Quellen] ${entry.filePath ?? entry.id}: ${error instanceof Error ? error.message : 'Ungültige Quellen'}`); }
    } };
    await loader.load({ ...context, store });
    const refresh = () => {
      for (const [id, entry] of context.store.entries()) if (id.startsWith('meddocs/')) store.set(entry);
    };
    refresh();
    if (context.watcher) {
      const directory = fileURLToPath(publicationDirectory);
      context.watcher.add(directory);
      // Serialize catalog refreshes; content updates keep using the last validated snapshot.
      let pending = Promise.resolve();
      const changed = (path: string) => {
        const local = relative(directory, path);
        if (isAbsolute(local) || local.startsWith('..') || !local.endsWith('.json')) return;
        pending = pending.then(async () => { catalog = await loadCatalog(); refresh(); })
          .catch((error: unknown) => { context.logger.error(error instanceof Error ? error.message : 'Ungültiger Publikationskatalog'); });
      };
      context.watcher.on('add', changed).on('change', changed).on('unlink', changed);
    }
  } };
}
