import type { CslItem } from './model.ts';
import type { ReferencePerson } from './schema.ts';
const bibTypes: Partial<Record<CslItem['type'], string>> = { 'article-journal': 'article', book: 'book', chapter: 'incollection', webpage: 'misc', report: 'techreport' };
const risTypes: Partial<Record<CslItem['type'], string>> = { 'article-journal': 'JOUR', book: 'BOOK', chapter: 'CHAP', webpage: 'ELEC', report: 'RPRT' };
const bibEscape = (value: string) => value.replace(/[\\{}%&#_$~^]/g, (character) => ({ '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[character] ?? `\\${character}`));
const bibPerson = (person: ReferencePerson) => 'literal' in person ? `{${bibEscape(person.literal)}}` : `${bibEscape(person.family)}${person.given ? `, ${bibEscape(person.given)}` : ''}`;
const risPerson = (person: ReferencePerson) => 'literal' in person ? person.literal : `${person.family}${person.given ? `, ${person.given}` : ''}`;
export function exportBibtex(items: readonly CslItem[]): string {
  return items.map((item) => {
    const type = bibTypes[item.type] ?? 'misc';
    const fields: Record<string, string | undefined> = { title: item.title, author: item.author?.map(bibPerson).join(' and '), editor: item.editor?.map(bibPerson).join(' and '),
      year: item.issued?.['date-parts'][0][0]?.toString(), journal: item.type === 'article-journal' ? item['container-title'] : undefined,
      booktitle: item.type === 'chapter' ? item['container-title'] : undefined, publisher: item.publisher, address: item['publisher-place'], volume: item.volume, number: item.issue ?? item.number,
      pages: item.page, edition: item.edition, isbn: item.ISBN, doi: item.DOI, url: item.URL, urldate: item.accessed?.['date-parts'][0].map((part, index) => index ? String(part).padStart(2, '0') : String(part)).join('-') };
    return `@${type}{${item.id},\n${Object.entries(fields).filter(([, value]) => value).map(([key, value]) => `  ${key} = {${['author', 'editor'].includes(key) ? value : bibEscape(value!)}},`).join('\n')}\n}`;
  }).join('\n\n') + (items.length ? '\n' : '');
}
export function exportRis(items: readonly CslItem[]): string {
  return items.map((item) => {
    const tags: [string, string | undefined][] = [['TY', risTypes[item.type] ?? 'GEN'], ['ID', item.id], ['TI', item.title],
      ...(item.author ?? []).map((person): [string, string] => ['AU', risPerson(person)]), ...(item.editor ?? []).map((person): [string, string] => ['ED', risPerson(person)]),
      ['PY', item.issued?.['date-parts'][0][0]?.toString()], ['DA', item.issued?.['date-parts'][0].join('/')], ['T2', item['container-title']], ['PB', item.publisher], ['CY', item['publisher-place']],
      ['VL', item.volume], ['IS', item.issue], ['SP', item.page?.split(/[-–]/)[0]], ['EP', item.page?.split(/[-–]/)[1]], ['ET', item.edition], ['M1', item.number], ['DO', item.DOI], ['UR', item.URL], ['SN', item.ISBN], ['Y2', item.accessed?.['date-parts'][0].join('/')]];
    return tags.filter(([, value]) => value).map(([tag, value]) => `${tag}  - ${value!.replace(/[\r\n]+/g, ' ')}`).join('\r\n') + '\r\nER  - \r\n';
  }).join('\r\n');
}
