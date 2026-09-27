/**
 * Deterministic extraction of HyperHeart tutorial stills (CC BY-NC 4.0).
 * Attribution: third_party/hyperheart/NOTICE.md. Never executes the legacy export.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { hyperHeartPhases } from '../src/lib/tools/hyperheart/phases.ts';
import { hyperHeartSourceSymbols } from '../src/lib/tools/hyperheart/asset-source.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const referenceDir = path.join(root, '_reference/hyperheart-original');
const assetDir = path.join(root, 'src/assets/tools/hyperheart');
const verifyOnly = process.argv.includes('--verify');
const visuals = ['heart', 'wiggers', 'ecg', 'sounds'];
const background = [0, 102, 102];

async function findSource(candidates) {
  for (const name of candidates) {
    const filename = path.join(referenceDir, name);
    try {
      // Preserve actual filename casing so the manifest is identical on Windows/Linux.
      const entries = await readdir(path.dirname(filename));
      if (entries.includes(path.basename(filename))) return filename;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Missing HyperHeart reference: ' + candidates.join(' or '));
}

const sourceFile = await findSource(['HyperHeart.js', 'hyperheart.js']);
const atlasFile = await findSource(['images/HyperHeart_html5_atlas_1.png', 'HyperHeart_html5_atlas_1.png']);
const sourceBuffer = await readFile(sourceFile);
const atlasBuffer = await readFile(atlasFile);
const source = sourceBuffer.toString('utf8');
const metadata = source.match(/name:\s*["']HyperHeart_html5_atlas_1["'],\s*frames:\s*(\[\[[\d,\s\[\]]+\]\])/);
if (!metadata) throw new Error('Atlas frame metadata not found; refusing to guess crops.');
const frames = JSON.parse(metadata[1]);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// Remove only exact #006666 pixels connected to the crop's edge. No tolerance,
// recolouring, smoothing, or removal of enclosed anatomical/diagram regions.
function removeEdgeBackground(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let tail = 0;
  function enqueue(index) {
    if (visited[index]) return;
    const offset = index * 4;
    if (!background.every((channel, i) => data[offset + i] === channel) || data[offset + 3] !== 255) return;
    visited[index] = 1;
    queue[tail++] = index;
  }
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  for (let head = 0; head < tail; head++) {
    const index = queue[head];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * 4 + 3] = 0;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  return tail;
}

async function output(filename, content) {
  if (verifyOnly) {
    const existing = await readFile(filename);
    if (!existing.equals(Buffer.from(content))) throw new Error('Non-reproducible or stale output: ' + path.relative(root, filename));
  } else {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
}

const manifest = {
  source: path.relative(root, sourceFile).replaceAll('\\', '/'), sourceSha256: sha256(sourceBuffer),
  atlas: path.relative(root, atlasFile).replaceAll('\\', '/'), atlasSha256: sha256(atlasBuffer),
  backgroundRemoval: 'Exact RGB 0,102,102; four-connected to crop border; alpha only; no tolerance.',
  assets: [],
};
const imports = [];
const mappings = [];
for (const [phaseIndex, phase] of hyperHeartPhases.entries()) {
  const fields = [];
  for (const visual of visuals) {
    const symbol = hyperHeartSourceSymbols[phase.id][visual];
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const definition = source.match(new RegExp('\\(lib\\.' + escaped + '\\s*=\\s*function\\(\\)\\s*\\{\\s*this\\.initialize\\(ss\\[["\']HyperHeart_html5_atlas_1["\']\\]\\);\\s*this\\.gotoAndStop\\((\\d+)\\)'));
    if (!definition) throw new Error('Unrecognized sprite definition: ' + symbol);
    const frameIndex = Number(definition[1]);
    const [left, top, width, height] = frames[frameIndex] ?? [];
    if (![left, top, width, height].every(Number.isInteger) || width <= 0 || height <= 0) throw new Error('Invalid frame: ' + symbol);
    const { data } = await sharp(atlasBuffer).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const removedPixels = removeEdgeBackground(data, width, height);
    if (removedPixels === 0) throw new Error('Expected background not found: ' + symbol);
    const png = await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    const relative = visual + '/' + phase.id + '.png';
    await output(path.join(assetDir, relative), png);
    manifest.assets.push({ phase: phase.id, visual, symbol, frameIndex, rect: [left, top, width, height], removedPixels, file: relative, sha256: sha256(png) });
    const name = visual + phaseIndex;
    imports.push('import ' + name + " from '../../../assets/tools/hyperheart/" + relative + "';");
    fields.push(visual + ': ' + name);
  }
  mappings.push("  '" + phase.id + "': { " + fields.join(', ') + ' },');
}

await output(path.join(root, 'src/lib/tools/hyperheart/asset-map.ts'),
  '// Generated by scripts/extract-hyperheart-assets.mjs. HyperHeart images: CC BY-NC 4.0.\n' +
  '// Attribution and source relationships: third_party/hyperheart/NOTICE.md and asset-manifest.json.\n' +
  "import type { HyperHeartAssetSet, HyperHeartPhaseId } from './types';\n" + imports.join('\n') + '\n\n' +
  'export const hyperHeartAssets = {\n' + mappings.join('\n') + '\n} as const satisfies Record<HyperHeartPhaseId, HyperHeartAssetSet>;\n');
await output(path.join(root, 'third_party/hyperheart/asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Keep only the needed icons from the project's existing Tabler/Iconify system.
// Nothing from the complete icon collection is loaded by the browser.
const require = createRequire(import.meta.url);
const tabler = JSON.parse(await readFile(require.resolve('@iconify-json/tabler/icons.json'), 'utf8'));
const iconNames = ['player-skip-back', 'player-play', 'player-pause', 'player-skip-forward', 'refresh'];
const controlIcons = Object.fromEntries(iconNames.map((name) => {
  if (!tabler.icons[name]) throw new Error('Missing existing Tabler icon: ' + name);
  return [name, tabler.icons[name].body];
}));
await output(path.join(root, 'src/components/tools/hyperheart/control-icons.ts'),
  '// Generated subset of the existing @iconify-json/tabler icon system (Tabler Icons, MIT).\n' +
  '// Regenerate with scripts/extract-hyperheart-assets.mjs; no icon runtime dependency.\n' +
  'export const hyperHeartControlIcons = ' + JSON.stringify(controlIcons, null, 2) + ' as const;\n');
console.log((verifyOnly ? 'Verified' : 'Extracted') + ' ' + manifest.assets.length + ' phase assets and 5 existing Tabler icons.');
