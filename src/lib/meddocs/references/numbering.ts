import { createProcessor } from '@mdx-js/mdx';
import type { Root, RootContent } from 'mdast';
import type { Reference } from './schema.ts';

/** Only literal arrays are supported: no evaluation of article JavaScript during indexing. */
export function collectCitations(body: string): string[][] {
  const tree = createProcessor().parse(body);
  const citations: string[][] = [];
  function visit(node: Root | RootContent): void {
    if ((node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') && node.name === 'MedCitation') {
      const attribute = node.attributes.find((value) => value.type === 'mdxJsxAttribute' && value.name === 'sources');
      if (!attribute || attribute.type !== 'mdxJsxAttribute' || typeof attribute.value !== 'object' || !attribute.value) throw new Error('MedCitation benötigt sources={["quellenkennung"]}.');
      const statement = attribute.value.data?.estree?.body[0];
      const expression = statement?.type === 'ExpressionStatement' ? statement.expression : null;
      if (expression?.type !== 'ArrayExpression' || !expression.elements.length) throw new Error('MedCitation.sources muss ein nicht leeres literales String-Array sein.');
      const ids = expression.elements.map((element) => {
        if (element?.type !== 'Literal' || typeof element.value !== 'string') throw new Error('Dynamische Quellenkennungen sind nicht erlaubt.');
        return element.value;
      });
      citations.push([...new Set(ids)]);
    }
    if ('children' in node) for (const child of node.children) visit(child);
  }
  visit(tree);
  return citations;
}
export function referenceOrder(sources: readonly Reference[], citations: readonly string[][]): string[] {
  const known = new Set(sources.map((source) => source.id));
  if (known.size !== sources.length) throw new Error('Doppelte Quellenkennung im Literaturverzeichnis.');
  const used = new Set<string>();
  for (const citation of citations) for (const id of citation) {
    if (!known.has(id)) throw new Error(`MedCitation: Quelle "${id}" ist nicht im Frontmatter hinterlegt.`);
    used.add(id);
  }
  // Only actual inline citations receive numbers. General literature never occupies a number.
  return [...used];
}
export function partitionReferences(sources: readonly Reference[], order: readonly string[]): { cited: Reference[]; literature: Reference[] } {
  const used = new Set(order);
  if (used.size !== order.length) throw new Error('Doppelte Quellenkennung in der Zitierfolge.');
  if (new Set(sources.map((source) => source.id)).size !== sources.length) throw new Error('Doppelte Quellenkennung im Literaturverzeichnis.');
  return { cited: orderedReferences(sources, order), literature: sources.filter((source) => !used.has(source.id)) };
}
export function orderedReferences(sources: readonly Reference[], order: readonly string[]): Reference[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return order.map((id) => { const source = byId.get(id); if (!source) throw new Error(`Unbekannte Quelle: ${id}`); return source; });
}
export function citationNumbers(ids: readonly string[], order: readonly string[]): number[] {
  return [...new Set(ids)].map((id) => { const number = order.indexOf(id) + 1; if (!number) throw new Error(`Unbekannte Zitierung: ${id}`); return number; }).sort((a, b) => a - b);
}
