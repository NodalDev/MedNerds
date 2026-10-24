import { readdir, readFile } from 'node:fs/promises';
import { referenceSchema, publicationIdsSchema, type Reference } from './schema.ts';

export const publicationDirectory = new URL('../../../data/meddocs/publications/', import.meta.url);
export type PublicationCatalog = ReadonlyMap<string, Reference>;

/** Build-side only. The browser receives only the sources selected for its article. */
export async function readPublicationCatalog(directory: URL = publicationDirectory): Promise<PublicationCatalog> {
  const catalog = new Map<string, Reference>();
  const locations = new Map<string, string>();
  const files = (await readdir(directory, { recursive: true })).filter((file) => file.endsWith('.json')).sort();
  for (const file of files) {
    const location = new URL(file.replaceAll('\\', '/'), directory);
    try {
      const source = referenceSchema.parse(JSON.parse(await readFile(location, 'utf8')));
      if (catalog.has(source.id)) throw new Error(`Doppelte Publikations-ID "${source.id}" (auch in ${locations.get(source.id)}).`);
      catalog.set(source.id, source);
      locations.set(source.id, file);
    } catch (error) {
      throw new Error(`[MedDocs Publikationskatalog] ${location.pathname}: ${error instanceof Error ? error.message : 'Ungültige Publikation'}`);
    }
  }
  return catalog;
}

export function resolvePublications(ids: unknown, catalog: PublicationCatalog, articlePath: string): Reference[] {
  try {
    return publicationIdsSchema.parse(ids).map((id) => {
      const source = catalog.get(id);
      if (!source) throw new Error(`Unbekannte Publikations-ID "${id}" im zentralen Katalog.`);
      return source;
    });
  } catch (error) {
    throw new Error(`[MedDocs Quellen] ${articlePath}: ${error instanceof Error ? error.message : 'Ungültige Publikations-IDs'}`);
  }
}
