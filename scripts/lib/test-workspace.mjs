import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(repository, '.astro/test-workspaces');
const marker = '.mednerds-test-workspace.json';

/** Only remove a workspace created here, never an arbitrary path or the real dist. */
export async function removeTestWorkspace(path) {
  const root = resolve(path);
  if (dirname(root) !== directory || !basename(root).startsWith('mednerds-')
    || (await lstat(root)).isSymbolicLink()) throw new Error('Not an owned MedNerds test workspace.');
  const owner = JSON.parse(await readFile(join(root, marker), 'utf8'));
  if (owner.repository !== repository) throw new Error('Test workspace belongs to another repository.');
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/** Dependencies resolve from the parent checkout; source, cache and output stay private. */
export async function createTestWorkspace(name) {
  if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid test workspace name.');
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(join(directory, `mednerds-${name}-`));
  await writeFile(join(root, marker), JSON.stringify({ repository }), { flag: 'wx' });
  try {
    for (const input of ['src', 'public', 'third_party', 'package.json', 'tsconfig.json', 'astro.config.mjs']) {
      await cp(join(repository, input), join(root, input), { recursive: true, errorOnExist: true, force: false });
    }
    return {
      root,
      url: pathToFileURL(root + sep),
      astro(args, options = {}) {
        return spawn(process.execPath, [join(repository, 'node_modules/astro/bin/astro.mjs'), ...args], {
          cwd: root, windowsHide: true, stdio: 'inherit', ...options,
        });
      },
      cleanup: () => removeTestWorkspace(root),
    };
  } catch (error) {
    await removeTestWorkspace(root);
    throw error;
  }
}
