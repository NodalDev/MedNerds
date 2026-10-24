# MedDocs – Quellen, Zitierexport und Seitenende

## Aktueller Stand: zentraler Katalog (23. Oktober 2026)

Die redaktionell maßgebliche Anleitung ist jetzt
[Publikationskatalog](../../src/data/meddocs/publications/README.md).
Publikationen stehen einzeln in `src/data/meddocs/publications/*.json`;
Artikel führen unter `references` nur IDs. `referenceAwareLoader` validiert und
füllt `resolvedReferences`/`referenceOrder`, einschließlich Cache- und Watcher-
Aktualisierung. Die bisherigen Komponenten und CSL-Konverter bleiben die
Rendering-/Exportstrecke. Nur die unnummerierte Literatur wird nach Typ bzw.
optionalem `meddocsCategory` gruppiert und innerhalb jeder Gruppe sortiert.
Inline-Zitate und Einzelnachweisnummern bleiben unverändert.
Dialogdefault bleibt Vancouver; Artikeldarstellung bleibt MedNerds-Vancouver.

Die folgenden Abschnitte dokumentieren die vorherigen Implementierungsphasen;
deren Inline-Frontmatter-Beispiele sind durch den zentralen Katalog abgelöst.

Stand: 17. Oktober 2026. Lokal implementiert, einschließlich eigener
MedNerds-Vancouver-Variante. Keine medizinischen Artikeltexte geändert;
keine Supabase-, Auth-, Moderations- oder SQL-Änderungen.

## Redaktionelle Pflege

### MedNerds – Vancouver (17. Oktober 2026)

Die Artikelseite und der Zitierdialog verwenden standardmäßig die eigene
CSL-Variante `mednerds-vancouver`: Initialen mit Punkten und Leerzeichen
(z. B. `Absalom A. R.`), keine Kennzeichnung `[Internet]`, kein
`Available from`/`Available at`. Eine vorhandene DOI erscheint als vollständiger
`https://doi.org/…`-Link direkt im Literaturtext. Ohne DOI wird die normale URL
verwendet. Die Links auf der Artikelseite sind ohne JavaScript anklickbar;
Copy/TXT enthalten die vollständigen Adressen als Klartext. Eine zusätzliche
abweichende Quellen-URL bleibt bei vorhandener DOI separat erreichbar.
Die nummerierten MDX-Verweise und ihre Reihenfolge bleiben unverändert.

DOI-Adressen unter `doi` pflegen, z. B. `doi: "10.1234/beispiel"`; zusätzliche
Webadressen gehören unter `url`. Der ursprüngliche Vancouver-Stil bleibt im
Zitierdialog als eigene Auswahl erhalten. Die neue lokale Variante ist separat
als Bearbeitung unter CC BY-SA 3.0 mit Herkunft und Hash dokumentiert;
die fünf ursprünglichen CSL-Dateien bleiben unverändert.

Quellen gehören in das optionale Frontmatter-Feld `references` des jeweiligen
Artikels. Das vermeidet ein zweites Register, zusätzliche Collections, Remote-Aufrufe
oder Supabase-Abhängigkeiten. Kennungen sind innerhalb des Artikels dauerhaft und
eindeutig. `referenceOrder` ist abgeleitete Build-Metadaten mit ausschließlich den
tatsächlich zitierten Kennungen und wird nicht redaktionell gepflegt. Artikel ohne
Quellen bauen weiterhin; keine leeren Quellenüberschriften.

Beispiel mit einer tatsächlich verfügbaren technischen Dokumentation, **keine
medizinische Belegquelle**:

```yaml
references:
  - id: astro-markdown
    type: website
    title: Markdown in Astro
    url: https://docs.astro.build/en/guides/markdown-content/
    accessed: 2026-10-11
```

| Typ | Pflichtangaben zusätzlich zu id und title |
| --- | --- |
| journal-article | strukturierte authors, journal, year oder published |
| book | strukturierte authors, publisher, year oder published |
| chapter | strukturierte authors, bookTitle, publisher, pages, year oder published |
| website | URL und accessed; undatierte Websites sind erlaubt |
| report | publisher, year oder published |

Personen: `{ family: Frey, given: Orlando }` oder eine Organisation als
`{ literal: MedNerds }`. Kapitel können editors enthalten. Optionale Felder:
DOI/URL/Abrufdatum, volume/issue/pages/articleNumber, publisherPlace, edition,
ISBN bzw. reportNumber, passend zum Quellentyp. Freie Felder werden abgewiesen;
Datumswidersprüche, fehlende Pflichtfelder, unsichere URLs, ungültige DOI und
doppelte IDs führen zu verständlichen Schema-/Buildfehlern. Keine DOI-/Jahr-/
Autorensuche, keine geschätzten Metadaten. Die Redaktion prüft Quellen inhaltlich.

## MDX-Verweise und Nummerierung

```mdx
import MedCitation from '…/components/meddocs/MedCitation.astro';

Text <MedCitation sources={["astro-markdown"]} />.
```

Den relativen Import passend zur Artikeltiefe setzen. `sources` muss ein nicht
leeres literales String-Array sein; keine Variablen, Funktionen oder dynamischen
IDs. Die bestehende MDX-Parser-Implementierung wird als Build-Abhängigkeit direkt
deklariert, statt eine Regex für JSX oder eine zweite Markdown-Pipeline zu bauen.
Codebeispiele zählen nicht als echte Zitierungen.

Der Quellen-Wrapper um den bestehenden Loader ergänzt Nummern vor dessen Cache-
Speicherung, einschließlich Dev-Watcher-Schreibvorgängen. Alte Cache-Einträge werden
bei fehlender/abweichender Reihenfolge aktualisiert. Erste Zitierung bestimmt die
Nummer; Wiederholungen behalten sie. Mehrfachzitate werden dedupliziert und numerisch
sortiert, z. B. `[1, 3]`. Nur tatsächliche MDX-Zitierungen erhalten Nummern.
`partitionReferences` teilt dieselben Frontmatter-Datensätze deterministisch in
nummerierte **Einzelnachweise** und unzitierte **Literatur & weiterführende Quellen**.
Letztere behalten die ausdrückliche Frontmatter-Reihenfolge. Es gibt kein zweites
Quellenregister und kein manuelles Kategoriefeld. Eine Kennung gehört genau einer
Gruppe an. Zusätzliche allgemeine Literatur ändert bestehende Zitiernummern nicht.
Alte Digest-Caches, deren Reihenfolge noch alle Quellen enthielt, werden durch
denselben Loader auf die neue abgeleitete Folge aktualisiert. Unbekannte Ziele
brechen den Build ab. Keine DOM-Neunummerierung oder Browser-Analyse der Artikeltexte.

Reine Literaturartikel zeigen nur „Literatur & weiterführende Quellen“, reine
Nachweisartikel nur „Einzelnachweise“. Gemischte Artikel zeigen Einzelnachweise,
dezente Trennung, allgemeine Literatur und anschließend „Über diesen Artikel“ in
derselben redaktionellen Kachel. Die bisherige Bibliografie wird weiterhin statisch
in MedNerds – Vancouver formatiert; Einzelnachweise bilden einen OL, allgemeine Literatur
einen UL mit expliziter Listensemantik und ohne sichtbare Nummern oder Bulletpoints.
Die gemeinsame Quellenkomponente wird pro vorhandener Gruppe einmal verwendet.
Keine verschachtelten Listen, doppelten Einträge oder leeren Rubriken.

Der Fade-out gilt unabhängig pro Kategorie. Bei mehr als drei Quellen in der
jeweiligen Liste bleiben die ersten drei vollständig
sichtbar; die tatsächliche Fortsetzung fadet über eine CSS-Maske aus. Ein zentrierter
nativer Button bietet „Mehr anzeigen“ bzw. „Weniger anzeigen“ mit `aria-expanded`
und `aria-controls`. Die Ausschnitthöhe ergibt sich aus dem tatsächlichen Beginn
der vierten Quelle und ihrer Zeilenhöhe. Ein ResizeObserver an der vollständigen Liste
aktualisiert sie bei Umbrüchen, Schrift-/Breitenänderungen, ohne fixe Kartenhöhe
oder neue Nummerierung. Ab der vierten Quelle verhindern `inert`, `aria-hidden`
und ein Tabindex-Fallback die Interaktion mit verborgenen Einträgen. Quelle-Anker heißen
`quelle-<id>`, bleiben bei Umnummerierung stabil und erhalten bei Direktlinks Fokus.
Mit JavaScript öffnet ein Verweis nur seine betroffene Liste vor der Navigation; ohne JS
bleiben sämtliche Quellen von Anfang an sichtbar und erreichbar. Beim Drucken
sind immer alle Quellen ohne Maske sichtbar, unabhängig vom Disclosure-Zustand.
Before-/Afterprint stellen auch die Zugänglichkeit her und anschließend den alten
Zustand wieder her. Die Ein-/Ausklappfunktion animiert nicht und bleibt daher auch
bei Reduced Motion statisch.

Der native Modal-Zitierdialog verwendet `showModal()`. Starlights Reset setzt
Außenabstände auf null; ein komponentenbezogenes `margin: auto` mit `inset: 0`
stellt die Desktop-Zentrierung wieder her. Maximalbreite: 40rem (bei 16px Grundschrift
640px), mit sicherem Viewport-Abstand und maximaler Höhe. Auf Smartphones nutzt
der Dialog dynamische Viewport-Maße und Safe-Area-Innenabstände am nativen Top Layer.
Das berücksichtigt auch eine durch große Schrift vergrößerte mobile Layoutfläche,
ohne die tatsächliche sichtbare Fläche zu überschreiten. Der Kopf kann umbrechen
und bleibt beim internen Scrollen erreichbar; Exportaktionen stehen mobil untereinander.
Titel und beschreibender Hinweis sind programmatisch zugeordnet. Native Fokusbegrenzung,
Escape und Fokuswiederherstellung bleiben erhalten; Exporte und CSL sind unverändert.

## CSL und Exporte

`citeproc@2.4.63`, ohne weitere Laufzeit-Abhängigkeiten, übernimmt die sechs
Stile: MedNerds – Vancouver, Vancouver, APA 7, **Harvard – Cite Them Right 12th edition**, Chicago
Author-Date (18th) und MLA 9. Unveränderte CSL-Dateien/Locales sind mit Upstream-
Commit-URLs und Hashes versioniert. Keine Laufzeit-API, kein externer Stilabruf.
Engine und jeweils ausgewählter Style laden erst nach Öffnen des Dialogs;
weitere Styles beim ersten Wechsel. Die Engine wird einmal importiert, Assets
werden gecacht, fehlgeschlagene Imports können erneut versucht werden.

Lizenz: der unveränderte Prozessor unter CPAL 1.0 mit sichtbarer Attribution,
Styles/Locales CC BY-SA 3.0. Siehe die NOTICE-/LICENSE-Dateien; keine pauschale
MIT-Aussage über diese Fremdbestandteile. Im lokalen Build etwa 95 KB gzip für
die Engine, zusätzliche kleine styleabhängige XML-Chunks; nicht im initialen
Artikel-Bundle. Der bereits vorhandene React-MedTools-Button bleibt eine kleine
Island und lädt bei Idle. Kein React-Umbau des Artikels.
Der gepinnte npm-Release von citeproc stammt vom 17. April 2023; das ist eine
bewährte ältere Engine, kein Versprechen laufender Release-Pflege. Citation.js
wurde als Alternative geprüft: sein CSL-Plugin verwendet dieselbe citeproc-
Engine und würde zusätzliche Adapter/Abhängigkeiten für bereits strukturierte
CSL-Daten einführen. Deshalb wird der Prozessor hier direkt und typisiert genutzt.
Bei späteren Style-/Engine-Updates die bekannten CSL-Ergebnisse erneut prüfen.

Artikelzitation verwendet die tatsächliche Personenregistry, Titel, ursprüngliche
Veröffentlichung, Plattform „MedNerds MedDocs“ und `Astro.site` plus Pfad. Niemals
localhost oder eine Platzhalterdomain. Optionale `citationName`-Felder strukturieren
bekannte Autorennamen; andere Personen werden als vollständige Literale erhalten,
nicht heuristisch in Familiennamen zerlegt. Bestehende Beschreibungen bleiben voll.

Der Dialog bietet den Artikel, Einzelnachweise, allgemeine Literatur, alle Quellen
und einzelne Quellen. Leere Kategorien und Einzelquellenauswahl ohne Datensätze
werden gar nicht angeboten. Einzelquellen tragen in der Auswahl keine künstlichen
Nummern aus der allgemeinen Literatur. `selectCitationItems` bestimmt zentral
die Datensätze; alle Quellen folgen in der Reihenfolge Einzelnachweise → Literatur,
ohne Duplikate. Gruppierte Daten für Anzeige und Export stammen aus demselben
Build-Ergebnis. Der Browser ermittelt keine Kategorie aus Text oder DOM.
Stilwahl verändert Vorschau, Clipboard und TXT. BibTeX/RIS sind unabhängig vom Stil
strukturierte Metadatenexporte. Eigene kleine Serializer decken ausschließlich die
fünf modellierten Typen ab, ohne fünf manuelle Zitierformatter einzuführen. BibTeX
nutzt UTF-8, Escaping und strukturierte Namen; RIS verwendet echte Records/Tags.
Leere Exporte werden verhindert. Die Artikel-URL kann geteilt werden: Web Share API,
sonst Clipboard. Permission-Fehler behaupten keinen Erfolg. Ohne Clipboard API
steht ein kleiner nativer Legacy-Copy-Fallback zur Verfügung; bei dessen Scheitern
kann die Vorschau manuell kopiert werden.
Vorschau und Clipboard/TXT sind Klartext; typografische Kursivsetzungen werden
dort nicht als Rich Text übertragen. Autor-/Datums-/Titel-/Publikationsangaben
und die stilabhängige Reihenfolge/Interpunktion kommen aus den CSL-Styles.
Die unnummerierte Literaturdarstellung auf der Webseite ist davon unabhängig:
Ein ausdrücklich gewählter Vancouver-Export darf Nummern gemäß diesem Stil enthalten.
Dateinamen unterscheiden artikel, einzelnachweise, literatur, quellen bzw. quelle-ID.

## Redaktionelle Einordnung und ein Literaturartikel

MedDocs ist eine medizinische Lernplattform und kein Peer-Reviewed-Journal.
Grundlagenartikel können allgemeine Literatur pflegen; gezielte Studiennachweise
stehen als MedCitation direkt bei der belegten Aussage. Klinisch relevante Zahlen,
Dosierungen, konkrete Empfehlungen und strittige Aussagen sollen präzise
Einzelnachweise erhalten. Eine allgemeine Literaturliste belegt nicht automatisch
jede Aussage einzeln. Moderierte Kommentare sind keine wissenschaftliche Peer-Review.
Fehlende Autoren-, Datums- oder Publikationsangaben dürfen nicht erfunden werden.

Für einen neuen Artikel ausschließlich mit Literatur die Artikel-Metadaten und
`references` pflegen und keine MedCitation-Marker hinzufügen. Beispiel mit der
oben verwendeten technischen Dokumentation, **keine medizinische Belegquelle**:

```mdx
---
title: Technischer Beispielartikel
authors: [orlando-frey]
published: 2026-10-11
draft: true
references:
  - id: astro-markdown
    type: website
    title: Markdown in Astro
    url: https://docs.astro.build/en/guides/markdown-content/
    accessed: 2026-10-11
---

Der Artikelinhalt benötigt keine Inline-Zitierkomponente, um unten
„Literatur & weiterführende Quellen“ darzustellen.
```

Wenn später eine Aussage diese Quelle ausdrücklich verwendet, MedCitation
importieren und dort `<MedCitation sources={["astro-markdown"]} />` ergänzen:
Die Quelle wechselt automatisch zu „Einzelnachweise“. Nichts doppelt pflegen.

## Variante B und Druck

Reihenfolge: kompakte Starlight-Pagination, redaktionelle Kachel (Quellen,
Trennlinie, vollständige Artikelinfos und MedTools), unveränderte eigene Kommentar-Card.
Pagination bezieht prev/next weiterhin aus Starlight, einschließlich Frontmatter-
Overrides. Ihr kompaktes Styling gilt nur in MedDocs. Kommentarsicherheit und
fehlende Phase-3B-Remote-Migration bleiben unverändert; UI-Fehler bleiben ruhig.

MedTools: Browser-Druckdialog („Drucken / als PDF speichern“), Teilen und Zitierdialog.
ChatGPT-/Claude-Einträge sind entfernt. Der Zitierdialog wird ausschließlich über
„Zitieren & Exportieren“ geöffnet; Artikel, Einzelquelle und gesamtes Verzeichnis
bleiben dort auswählbar. Keine zusätzlichen Zitierlinks in Artikelinfo oder Quellen.
E-Learning
ist optional via `learningUrl: /medlearn/…/`; nur ein existierender veröffentlichter
MedLearn-Content-Eintrag wird als aktiver Link gerendert. Keine erfundenen Zuordnungen.
Legacy-Artikel ohne vollständige redaktionelle Metadaten behalten ihre vorhandenen
Druck-/Share-Werkzeuge bei der Pagination. Artikelzitation wird dort nicht
angeboten, statt Autor oder Veröffentlichungsdatum zu erfinden.

Druckstyles gelten nur für MedDocs-Artikel mit redaktioneller Kachel: helle
Systemfarben, vollständiger Inhalt/Quellen/Autoren/Review/Datums-/Lizenzinformationen,
ohne Header, Sidebar, TOC, Tools, Seitennavigation, Kommentare oder Site-Footer.
Native Before-/Afterprint-Hooks öffnen alle Literaturverzeichnisse und stellen
deren Zustand wieder her. Keine serverseitige PDF-Erzeugung. Die Artikellizenz
gilt ausdrücklich nicht pauschal für zitierte Drittquellen.

## Reproduzierbare Prüfungen

```powershell
node --experimental-strip-types --test scripts/test-meddocs-references.mjs
node scripts/test-meddocs-references-build.mjs
# Danach isoliertes Chrome/CDP auf 9334, lokales dist auf 4326:
node scripts/test-meddocs-references-browser.mjs
node scripts/test-meddocs-comments-browser.mjs
node scripts/test-auth-browser.mjs
# Normalen Build nach den Fixtures wiederherstellen:
npm run build
npx astro check
git diff --check
```

Die bestehende Design-/Funktionsdemo `/meddocs/diverses/beispielartikel/` enthält
acht ausdrücklich illustrative Testquellen: zwei Zeitschriftenartikel, zwei Bücher,
ein Buchkapitel, zwei Websites und einen Bericht. Alle Links verwenden `example.org`,
keine Quelle hat eine erfundene DOI. MDX zeigt Einzel-/Mehrfachzitate, Wiederholung
und den Direktverweis auf den zunächst verborgenen vierten Einzelnachweis.
Vier Quellen sind im Text verwendet, vier bleiben allgemeine Literatur. Die
vorhandenen Datensätze wurden wiederverwendet; keine zusätzlichen Publikationen
erfunden. Beide Gruppen haben vier Einträge und somit einen unabhängigen Fade-out.
Nummern entstehen ausschließlich aus der ersten Zitierung.
Die Seite bleibt ein versteckter Draft mit `pagefind: false`, erreichbar in der
lokalen Entwicklung; sie wird dadurch nicht neu im Production-Build veröffentlicht.

Fixture-Build erzeugt ausschließlich klar markierte synthetische Testseiten
mit 0/1/3/4/5/6/8/30 Einzelnachweisen, einer reinen Literaturseite, einem Hybridartikel
und einer temporären Kopie der acht Quellen umfassenden
Showcase-Seite. Nur die Testkopie wird für den Browser-Build aus dem Draft-Zustand
genommen; die Originaldatei bleibt unverändert als Draft markiert. Er entfernt
alle Testquelldateien im finally-Block. Er überschreibt
keine vorhandenen Dateien (wx). Der anschließende normale Build entfernt auch die
Testseiten aus dist/Sitemap. Zwei aufeinanderfolgende Fixture-Builds vergleichen
gerenderte Quellenkennungen und Zitiernummern einschließlich Digest-Cache.
Keine synthetischen Literaturangaben in echten Artikeln.
Browser blockiert externe Dienste vor Navigation. Tests: Schemas/Typen, AST-Reihenfolge,
Cache/Watcher, bekannte CSL-Erwartungen, SHA-256, Sonderzeichen, TXT/BibTeX/RIS,
kanonische URL, Disclosure/Hash/Fokus, MedTools/Teilen/Clipboard-Fallback und Fehler,
Druck aller Quellen, kein JS, Dark/Light und 320/375/768/1440 px. Bestehende Auth-,
Profil-, Lösch-, Kommentar-/Moderations- und Metadatenregressionen ebenfalls ausführen.

Manuell verbleiben: reale Literatur redaktionell einpflegen und prüfen, Journals-
Abkürzungen/Styles gemäß Publikationsvorgaben, NVDA/VoiceOver, echte Share-/Clipboard-
Permissions in Safari/Firefox/Mobile, lange reale Abbildungen/Tabellen beim Druck.
Die Browser-PDF-Ausgabe beweist keine perfekte Paginierung aller künftigen Artikel.
Der Legacy-Copy-Fallback erzeugt bewusst einen TypeScript-Deprecation-Hint;
Astro meldet außerdem den bereits vorhandenen unbenutzten Basel-activities-Hint.

Keine Remote-Datenbankprüfung in Phase 3D. Die späteren Phase-3B-Migrations-/RLS-
Schritte bleiben separat freizugeben. Kein Commit, Push oder Deployment.

## Dateien und abgeschlossene lokale Validierung

Geändert gegenüber dem Ausgangsstand: `ArticleActions.tsx`,
`MedDocsArticleInfo.astro`, `MedNerdsContentFooter.astro`, `MedNerdsPagination.astro`,
`content.config.ts`, `authors.ts`, `article-metadata-schema.ts`, die MedDocs-README
sowie package.json/package-lock.json. Neu: `MedCitation.astro`,
`MedDocsReferences.astro`, `MedDocsCitationDialog.astro`, `references/` mit
Schema/Loader/Nummerierung/CSL/Export/Dialog/Clipboard, `meddocs-editorial.css`,
citeproc-Typen, Lizenz-/NOTICE-Dateien und drei Quellen-Testskripte mit Fixture-Daten.

Bestanden: 104 Auth-/Profil-/Legal-/Lösch-/Kommentar-/Quellen-Tests, 35 MedDocs-
Metadatenprüfungen, alle drei Quellen-/Kommentar-/Moderations-/Account-Browser-
regressionen, strikte TypeScript-Prüfung, Astro Check (0 Fehler/0 Warnungen,
die zwei genannten Hints), normaler Build inklusive Pagefind und `git diff --check`.
Der normale Build enthält keine Fixture-Seiten; Reihenfolge, kanonische URL und
Meta-Description wurden im HTML geprüft. SHA-256-Vergleich bestätigt unveränderte
medizinische Texte, bestehende Kommentar- und Auth-Logik, SQL und `.env`-Dateien.
Vorhandene uncommittete Arbeiten bleiben erhalten.

### Gezielte Nachschärfung

Betroffene Darstellung: `MedNerdsContentFooter.astro` (nur Reihenfolge),
`ArticleActions.tsx` (KI-Links entfernt), `MedDocsArticleInfo.astro` und
`MedDocsReferences.astro` (zusätzliche Zitierbuttons entfernt),
`meddocs-editorial.css` (ausschließlich nicht mehr benötigte Button-Selektoren).
Die Pagination-Komponente, Typografie, Farben, Abstände, Autorenbeschreibungen,
Zitierprozessor und Exportlogik wurden bei dieser Nachschärfung nicht verändert.

Inhalt: ausschließlich `src/content/docs/meddocs/diverses/beispielartikel.mdx`
mit acht illustrierten Testquellen. In Phase 3E zitieren vier MDX-Marker vier
Quellen mit Wiederholung; vier weitere Quellen bleiben allgemeine Literatur.
Dokumentation: diese Datei sowie `src/lib/meddocs/README.md`.
Prüfungen angepasst: `test-meddocs-references.mjs`,
`test-meddocs-references-build.mjs`, `test-meddocs-references-browser.mjs` und
`test-meddocs-comments-browser.mjs`.

Browser bestätigt die Reihenfolge ohne doppelte Navigation, den ausschließlichen
MedTools-Zugang zum Dialog, den verborgenen Nachweis einschließlich Öffnen/Fokus, alle acht Quellen
in fünf Stilen und Druckansicht sowie TXT/BibTeX/RIS mit allen fünf Quellentypen.
Auth-/Profil-/Lösch-/Kommentar-Browserregressionen bleiben erfolgreich.

Weitere UI-Nachschärfung: ausschließlich `MedDocsReferences.astro`,
`MedDocsCitationDialog.astro`, `meddocs-editorial.css`, die drei Quellen-Testskripte
und diese Dokumentation. Die Quellenansicht enthält einen echten OL mit dynamischem
Fade und erweitertem Tastatur-/Accessibility-Test. Der Browser prüft jetzt zudem
die tatsächliche Zentrierung bei 320/375/768/1440px, den sichtbaren Smartphone-Viewport
bei 200% Schriftgröße/geringer Höhe, interne Scrollbarkeit und den erreichbaren
Schließen-Button. Keine medizinischen Inhalte, Quellenbestände, Auth-, SQL-,
Profil- oder Moderationslogik geändert. Manuell bleiben insbesondere VoiceOver/NVDA
und reale mobile Bildschirmtastaturen/Safe Areas in Safari zu prüfen.

### Phase 3E: Hybride Quellen

Gezielt geändert: `references/numbering.ts` (nur zitierte IDs und Partition),
`references/loader.ts` (Cache-Konvention dokumentiert),
`article-metadata-schema.ts` (abgeleitete Folge dokumentiert),
`references/model.ts` und `references/dialog.ts` (gemeinsame gruppierte Auswahl),
`MedNerdsContentFooter.astro`, `MedDocsReferences.astro`,
`MedDocsCitationDialog.astro`, `meddocs-editorial.css`,
`beispielartikel.mdx`, drei Quellen-Testskripte und beide bestehende Quellen-READMEs.
CSL-Prozessor, Styles, Serializer, MedCitation-Komponente, kompakte Pagination,
Artikelinformationen, Auth-/Profil-/Kommentar-/Löschlogik, SQL und Dependencies
bleiben in dieser Phase unverändert.

Bestanden: reine Literatur/reine Einzelnachweise/Hybrid/keine Quellen,
unveränderte Nummerierung nach Hinzufügen allgemeiner Literatur und bei zwei
aufeinanderfolgenden Builds, alte Cache-Einträge und Dev-Watcher,
getrennte Fade-outs/ARIA-Controls/Listensemantik, Direktverweise, Druck beider
Listen, kein JavaScript sowie Kategorie-/Gesamt-/Einzelquellenexport in fünf
Stilen mit TXT/Clipboard/BibTeX/RIS. Die Demo bleibt ein versteckter Draft mit
denselben acht ausdrücklich illustrativen Datensätzen; es gibt keine neue
wissenschaftliche Belegquelle in einem echten medizinischen Artikel.
