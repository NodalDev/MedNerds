import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Build/test only. Never imported by browser code. Versions track exact source snapshots. */
export async function getLegalDocumentVersions() {
  const hash = async (path: string) => {
    const content = (await readFile(resolve(process.cwd(), 'src/content/docs', path), 'utf8'))
      .replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
  };
  const [terms, privacy] = await Promise.all([
    hash('nutzungsbedingungen/index.mdx'),
    hash('datenschutz/index.mdx'),
  ]);
  return { terms, privacy };
}
