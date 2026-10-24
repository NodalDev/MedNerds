# MedDocs-Publikationskatalog

Eine JSON-Datei pro Publikation, benannt nach ihrer stabilen `id`. Diese Dateien
sind die einzige redaktionelle Quelle für bibliografische Metadaten. Auch Drafts
referenzieren hier vorhandene Publikationen. Keine Datenbank oder externen Abrufe.

## Neue Publikation erfassen

1. Eindeutige ID wählen: Kleinbuchstaben, Ziffern und Bindestriche, höchstens
   80 Zeichen, beginnend mit einem Buchstaben. Bestehende IDs nicht umbenennen.
2. `<id>.json` anlegen. Die bestehenden MedDocs-Feldnamen bleiben erhalten:
   `authors`, `year`/`published`, `journal`, `bookTitle`, `publisher`, `doi`, `url` usw.
3. Den bibliografisch richtigen CSL-Typ wählen. `journal-article` und `website`
   bleiben unterstützte Bestandsaliase für `article-journal` und `webpage`.
   Alle gültigen CSL-Typen sind in `references/schema.ts` zentral aufgelistet.
4. Nur geprüfte Metadaten übernehmen; keine Autoren/Jahre/DOI ergänzen, die fehlen.

Bestehendes reales Beispiel (gekürzt; die vollständige Datei enthält alle Angaben):

```json
{
  "id": "total-intravenous-anesthesia-and-target-controlled-infusions",
  "type": "book",
  "title": "Total Intravenous Anesthesia and Target Controlled Infusions",
  "authors": [{ "family": "Absalom", "given": "A.R." }, { "family": "Mason", "given": "K.P." }],
  "year": 2017,
  "publisher": "Springer Cham"
}
```

| Typ | Zusätzliche Pflichtangaben |
| --- | --- |
| article-journal / journal-article | authors, journal, year oder published |
| book | authors, publisher, year oder published |
| chapter | authors, bookTitle, publisher, pages, year oder published |
| webpage / website / post / post-weblog | url und accessed (ISO-Datum) |
| report | publisher, year oder published |

Personen: `{ "family": "Frey", "given": "Orlando" }`; Körperschaftsautor:
`{ "literal": "Name der Organisation" }`. Buchkapitel können `editors` enthalten.
Bei übrigen CSL-Typen sind fehlende Autoren/Jahre erlaubt; mindestens `id`, `type`
und `title` sind erforderlich. Unbekannte Felder, ungültige Typen/Kategorien,
Datumswidersprüche und unsichere URLs werden abgewiesen.

## Im Artikel verwenden

Im Frontmatter stehen ausschließlich IDs:

```yaml
references:
  - total-intravenous-anesthesia-and-target-controlled-infusions
  - target-controlled-infusion-a-mature-technology
```

Die bestehende Trennung bleibt automatisch: Ein mit
`<MedCitation sources={["target-controlled-infusion-a-mature-technology"]} />`
im Text zitierter Eintrag erscheint unter **Einzelnachweise**. Alle übrigen IDs
aus `references` erscheinen unter **Literatur & weiterführende Informationen**.
Eine zweite `literature`-Liste ist nicht nötig. Dieselben IDs können in beliebig
vielen Artikeln verwendet werden. Relative MedCitation-Imports bleiben unverändert.

Einzelnachweise werden je Artikel nach erster tatsächlicher Inline-Zitierung
nummeriert. Wiederholungen behalten die Nummer; Katalog-/Frontmatter-Sortierung
ändert keine Nummern. Anker bleiben `#quelle-<id>`. Eine Quelle erscheint nur
einmal, bei Verwendung im Text vorrangig bei den Einzelnachweisen. Doppelte IDs
in `references` und fehlende Katalog-IDs erzeugen einen Buildfehler mit Artikelpfad.

`resolvedReferences` und `referenceOrder` sind abgeleitete Loader-Daten, keine
redaktionellen Frontmatter-Felder. Der Browser erhält nur die Artikelquellen,
niemals den ganzen Katalog.

## Gruppierung und Sortierung

Nur die unnummerierte Literatur wird gruppiert, in dieser festen Reihenfolge:

1. Bücher & Lehrbücher: book, chapter, collection, classic, entry-dictionary, entry-encyclopedia.
2. Fachartikel & Studien: article-journal, article, paper-conference.
3. Leitlinien & Empfehlungen: standard.
4. Online-Ressourcen: webpage, post, post-weblog.
5. Sonstige Quellen: alle übrigen gültigen Typen (z. B. report, thesis, software).

Leere Gruppen entfallen. Eine URL/DOI ändert den Quellentyp nicht.
Optionales `meddocsCategory`: `books`, `articles`, `guidelines`, `online`, `other`.
Beispiel für eine Leitlinie in einer Zeitschrift:

```json
"type": "article-journal",
"meddocsCategory": "guidelines"
```

Dieser Ausschnitt wird in den vollständigen Datensatz eingefügt. `type` bleibt
bibliografisch korrekt; die Kategorie wirkt nur auf die Darstellung und wird
nicht an citeproc, BibTeX oder RIS weitergereicht.

Innerhalb einer Gruppe: erster Personen-Nachname → Körperschaftsautor →
herausgebende Organisation (`publisher`) → Titel. Danach Erscheinungsjahr
aufsteigend (ohne Jahr zuletzt), Titel und stabile ID. Deutsche Kollation
berücksichtigt Umlaute; sortiert werden Kopien, nicht die Katalogdaten.

## Korrekturen und Sonderfälle

Metadaten einmal in der zentralen Datei korrigieren. Beim nächsten Build werden
alle referenzierenden Artikel aktualisiert, auch bei unverändertem Artikeltext.
Der Dev-Watcher berücksichtigt Katalogänderungen ebenfalls. Artikel-UUIDs,
Inline-Zitate und medizinische Texte bleiben unberührt.

Andere Auflagen/Versionen und eigenständige Buchkapitel erhalten eigene IDs.
Identische Metadaten nicht mehrfach anlegen. Bei widersprüchlichen Angaben erst
redaktionell prüfen; keine Metadaten stillschweigend überschreiben.
Die `demo-*`-Dateien sind die übernommenen, ausdrücklich illustrativen
Showcase-Testdaten und keine medizinischen Belegquellen.

## Migration am 23. Oktober 2026

172 MedDocs-Dateien einschließlich Drafts untersucht. 10 Definitionen aus zwei
Artikeln in 10 Katalogdateien übernommen: zwei reale TCI-Publikationen und acht
bestehende illustrative Showcase-Datensätze. Keine mehrfachen Definitionen,
keine ID-/Metadatenkonflikte oder doppelten Artikelzuordnungen gefunden.
Alle bisherigen IDs und Inline-Zitierungen beibehalten. Im Showcase bleibt die
Zitierfolge: demo-zeitschriftenartikel, demo-buch, demo-buchkapitel, demo-handbuch.
Die beiden TCI-Quellen waren und bleiben unnummerierte weiterführende Literatur.

Prüfungen: `node --experimental-strip-types scripts/test-meddocs-references.mjs`,
bestehende Quellen-Build-/Browserregressionen, `npx astro check`, `npm run build`.
