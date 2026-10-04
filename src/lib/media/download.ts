import type { ImageMetadata } from 'astro';
import { validateFigureUrl } from './urls.ts';

type DownloadOptions = {
  src: ImageMetadata | string;
  fullSrc?: string;
  downloadable?: boolean;
  downloadSrc?: string;
};

const downloadFormats = new Map([
  ['png', 'PNG'], ['jpg', 'JPEG'], ['jpeg', 'JPEG'], ['svg', 'SVG'], ['webp', 'WebP'],
]);

/** Shared source selection for the figure's native link and Fancybox toolbar. */
export function resolveFigureDownload(options: DownloadOptions): string | undefined {
  if (!options.downloadable) return undefined;
  return validateFigureUrl(
    options.downloadSrc || options.fullSrc ||
      (typeof options.src === 'string' ? options.src : options.src.src),
  );
}

/** Use the filename alone; signed URLs and URL suffixes are not format evidence. */
export function getFigureDownloadLabel(filename?: string): string {
  const extension = filename?.trim().match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const format = extension ? downloadFormats.get(extension) : undefined;
  return format ? `${format} herunterladen` : 'Herunterladen';
}
