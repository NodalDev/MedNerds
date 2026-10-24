import type { Loader } from 'astro/loaders';

/** Exclude drafts before Astro builds the content module and asset import maps. */
export function publishedContentLoader(loader: Loader, preserve: readonly string[] = []): Loader {
  return { ...loader, async load(context) {
    await loader.load(context);
    if (!import.meta.env.PROD) return;
    for (const [id, entry] of context.store.entries()) {
      if (entry.data.draft === true && !preserve.includes(id)) context.store.delete(id);
    }
  } };
}
