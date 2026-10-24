import { createProcessor } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import type { MarkdownHeading } from 'astro';
import type { ArticlePreview } from './model.ts';

interface Node {
  type: string;
  value?: string;
  depth?: number;
  name?: string | null;
  children?: Node[];
}

interface PreviewEntry {
  id: string;
  filePath?: string;
  body?: string;
  data: {
    title: string;
    description?: string;
    draft?: boolean;
    authors?: readonly string[];
    published?: unknown;
    pageLayout?: string;
    template?: string;
    hero?: unknown;
    linkPreview?: string;
    sectionPreviews?: Record<string, string>;
  };
}

export function isPreviewArticle(entry: PreviewEntry): boolean {
  return entry.id.startsWith('meddocs/') && !/(?:^|\/)index$/.test(entry.id)
    && !/(?:^|[/\\])index\.[^.]+$/.test(entry.filePath ?? '')
    && (entry.data.pageLayout === undefined || entry.data.pageLayout === 'default')
    && entry.data.template !== 'splash' && !entry.data.hero && entry.data.draft === false
    && Boolean(entry.data.authors?.length && entry.data.published);
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const unsuitable = /lorem ipsum|dolor sit amet|beschreibung folgt|\bTODO\b|platzhalter|nur testdaten|illustrative testdaten/i;

/** Prefer a complete statement over a medically ambiguous fragment. Never cut a sentence. */
export function compactPreview(value?: string): string | undefined {
  if (!value) return;
  const text = normalize(value);
  if (!text || unsuitable.test(text) || /<\/?[a-z][^>]*>|\$|\\[a-z]+\{|(?:^|\s)\^(?:\s|$)/.test(text)) return;
  if (text.length <= 240 && !/[:;]$/.test(text)) return text;
  const sentences = [...new Intl.Segmenter('de', { granularity: 'sentence' }).segment(text)];
  let result = '';
  for (const { segment } of sentences.slice(0, 3)) {
    if (!/[.!?][»”"']?\s*$/.test(segment)) break;
    if (/(?:\bz\.\s?B|\bu\.\s?a|\bz|\bu|\bbzw|\bca|\bDr|\bProf|\bsog)\.\s*$/i.test(segment)) break;
    const next = normalize(`${result} ${segment}`);
    if (next.length > 240) break;
    result = next;
  }
  return result || undefined;
}

function inlineText(node: Node): string | undefined {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'break' || node.type === 'footnoteReference') return ' ';
  if (!['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference'].includes(node.type)) return;
  const children = (node.children ?? []).map(inlineText);
  return children.some((text) => text === undefined) ? undefined : children.join('');
}

const referenceHeading = /^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:quellen|literatur(?:verzeichnis)?|referenzen|einzelnachweise|weiterführende (?:links|quellen))\b/i;
function firstParagraph(nodes: Node[]): string | undefined {
  let referenceDepth: number | undefined;
  for (const node of nodes) {
    if (node.type === 'heading') {
      if (referenceHeading.test(inlineText(node) ?? '')) referenceDepth = node.depth;
      else if (referenceDepth !== undefined && node.depth! <= referenceDepth) referenceDepth = undefined;
    }
    if (referenceDepth !== undefined || node.type !== 'paragraph') continue;
    const text = inlineText(node);
    if (!text || /^(?:in diesem artikel|dieser artikel|hier (?:findest|erfährst)|stand:|autoren?:|(?:abb\.|abbildung|fig\.|figure|bild)\s*\d*[:.\s])/i.test(text)) continue;
    const preview = compactPreview(text);
    if (preview) return preview;
  }
}

/** Only the published caller may invoke this; draft bodies are never parsed for public assets. */
export function extractArticlePreview(entry: PreviewEntry, headings: readonly MarkdownHeading[]): ArticlePreview {
  if (!isPreviewArticle(entry)) throw new Error(`No public preview permitted: ${entry.id}`);
  let nodes: Node[] = [];
  try {
    // Reuse the existing MDX/remark stack. Do not evaluate any MDX expression/component.
    nodes = (createProcessor({ remarkPlugins: [remarkGfm, remarkDirective] }).parse(entry.body ?? '') as unknown as Node).children ?? [];
  } catch { /* Complex syntax: validated manual text/description and heading titles remain safe fallbacks. */ }

  const sourceHeadings = nodes.flatMap((node, index) => node.type === 'heading' ? [{ node, index }] : []);
  // IDs come from render(entry), not from an independent slugger. If compilation adds/removes
  // headings (e.g. inside MDX), do not guess which section a paragraph belongs to.
  const aligned = sourceHeadings.length === headings.length && sourceHeadings.every(({ node }, index) =>
    node.depth === headings[index].depth && normalize(inlineText(node) ?? '') === normalize(headings[index].text));
  const actualIds = new Set(headings.map((heading) => heading.slug));
  for (const id of Object.keys(entry.data.sectionPreviews ?? {})) {
    if (!actualIds.has(id)) throw new Error(`[MedDocs Linkvorschau] ${entry.id}: unbekannte Abschnitts-ID "${id}" in sectionPreviews.`);
  }
  const sections: ArticlePreview['sections'] = Object.create(null);
  let referenceDepth: number | undefined;
  for (const [index, heading] of headings.entries()) {
    if (referenceHeading.test(heading.text)) referenceDepth = heading.depth;
    else if (referenceDepth !== undefined && heading.depth <= referenceDepth) referenceDepth = undefined;
    const overrides = entry.data.sectionPreviews;
    const manual = overrides && Object.hasOwn(overrides, heading.slug) ? overrides[heading.slug] : undefined;
    const nextIndex = sourceHeadings[index + 1]?.index ?? nodes.length;
    // Stop at the next heading, including a child: an empty parent must not borrow its child's introduction.
    const automatic = aligned && referenceDepth === undefined
      ? firstParagraph(nodes.slice(sourceHeadings[index].index + 1, nextIndex)) : undefined;
    sections[heading.slug] = { title: heading.text, text: compactPreview(manual) ?? automatic };
  }
  return {
    path: '/' + entry.id.normalize('NFC').replace(/\/$/, '') + '/',
    title: entry.data.title,
    text: compactPreview(entry.data.linkPreview) ?? compactPreview(entry.data.description) ?? firstParagraph(nodes),
    sections,
  };
}
