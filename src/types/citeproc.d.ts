declare module 'citeproc' {
  interface Item { id: string; type: string; title: string }
  interface Bibliography { entry_ids: string[][]; bibliography_errors: unknown[] }
  class Engine {
    constructor(system: { retrieveLocale(language: string): string | false; retrieveItem(id: string): Item }, style: string, language?: string);
    setOutputFormat(format: 'text'): void;
    updateItems(ids: string[]): void;
    makeBibliography(): [Bibliography, string[]] | false;
  }
  const CSL: { Engine: typeof Engine };
  export default CSL;
}
