import { docsLoader } from '@astrojs/starlight/loaders';
import type { Loader } from 'astro/loaders';
import { mkdir, writeFile } from 'node:fs/promises';
import { createArticleManifest } from './articles.ts';

/** Wrap the existing loader without changing routing, rendering or draft handling. */
export function commentAwareDocsLoader(): Loader {
  const loader = docsLoader();
  return { ...loader, async load(context) {
    await loader.load(context);
    const manifest = createArticleManifest([...context.store.entries()].map(([id, entry]) => ({
      id, filePath: entry.filePath, data: entry.data,
    })));
    await mkdir(new URL('.astro/', context.config.root), { recursive: true });
    await writeFile(new URL('.astro/meddocs-comments-manifest.json', context.config.root), JSON.stringify(manifest, null, 2) + '\n');
    // The same validation also runs on the next sync/build after dev watcher updates.
  } };
}
