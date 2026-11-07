import type { SatteriProcessorOptions } from '@astrojs/markdown-satteri';
import { resolveMediaUrl } from './urls.ts';

type HastPlugin = Exclude<NonNullable<SatteriProcessorOptions['hastPlugins']>[number],
  ((...args: never[]) => unknown) | readonly unknown[] | null | undefined | false>;
type JsxVisitor = Extract<NonNullable<HastPlugin['mdxJsxFlowElement' | 'mdxJsxTextElement']>, { visit: unknown }>['visit'];

// Only media URLs: ordinary links to other hosts, text and code are untouched.
const mediaAttributes: Record<string, string> = { img: 'src', a: 'href' };

/** Use Astro 7's existing Sätteri pipeline for Markdown images and literal MDX HTML. */
export function mediaUrlPlugin(useProxy: boolean): HastPlugin {
  const rewriteJsx = (node: Parameters<JsxVisitor>[0]) => {
    const name = node.name && mediaAttributes[node.name];
    if (!useProxy || !name) return;
    let changed = false;
    const attributes = node.attributes.map((attribute) => {
      if (attribute.type !== 'mdxJsxAttribute' || attribute.name !== name || typeof attribute.value !== 'string') return attribute;
      const value = resolveMediaUrl(attribute.value, true);
      if (value === attribute.value) return attribute;
      changed = true;
      return { ...attribute, value };
    });
    if (changed) return { ...node, attributes };
  };
  return {
    name: 'mednerds-media-urls',
    element: {
      filter: Object.keys(mediaAttributes),
      visit(node, ctx) {
        const name = mediaAttributes[node.tagName];
        const value = node.properties?.[name];
        if (!useProxy || typeof value !== 'string') return;
        const resolved = resolveMediaUrl(value, true);
        if (resolved !== value) ctx.setProperty(node, name, resolved);
      },
    },
    mdxJsxFlowElement: { filter: Object.keys(mediaAttributes), visit: rewriteJsx },
    mdxJsxTextElement: { filter: Object.keys(mediaAttributes), visit: rewriteJsx },
  };
}
