# Artikel-Metadaten in MedDocs

## Interne Linkvorschauen

Veröffentlichte Fachartikel erhalten automatisch Artikel- und Abschnittsvorschauen.
Optionale Übersteuerungen: `linkPreview` und `sectionPreviews` im Zielartikel.
Details und Beispiele: [Linkvorschauen](./link-previews/README.md).

## Kommentare: erst schreiben, dann anmelden

Der bestehende Composer erlaubt Gästen das Schreiben. Erst ein gültiges ausdrückliches
Absenden öffnet den nativen Auth-Dialog; für Gast-Upvotes wird derselbe Dialog verwendet.
Es gibt weder einen zweiten Composer noch eine eigene Authentifizierung. `/account/`
nutzt weiter E-Mail-OTP, Profilvervollständigung, aktuelle Legal-Prüfung und den
validierten internen `returnTo`-Pfad. `mode=login` bzw. `mode=register` wählt nur
die anfängliche bestehende Account-Ansicht aus. Rückkehr zum Artikel mit `#kommentare`.

`comments/draft.ts` hält den Entwurf während der Bearbeitung nicht dauerhaft vor.
Erst der bewusste Wechsel über einen Account-Link sichert ihn in `sessionStorage`
für höchstens 30 Minuten: Artikel-ID/Pfad, Text, gegebenenfalls Antwort-/Bearbeitungsziel
und Version, Accountzuordnung sowie eine bereits verwendete Idempotenz-ID. Keine
Tokens, URLs mit Kommentartext, Cookies, Logs, serverseitigen anonymen Entwürfe oder
`localStorage` für diese Texte. Ungültige/veraltete Datensätze werden beim Zugriff
entfernt. Ein begonnener Auth-Handoff bleibt bis zum Absenden, Abbrechen oder Ablauf
wiederherstellbar, auch bei einem Reload nach der Rückkehr. Änderungen an diesem
wiederhergestellten Entwurf werden innerhalb derselben ursprünglichen Frist gesichert;
Tippen verlängert diese Frist nicht. Ohne vorherigen Auth-Handoff bleiben Entwürfe
ausschließlich im Composer. Dies ist kein allgemeiner dauerhafter Entwurfs-Autosave.

Der erste verifizierte Account wird bereits im bestehenden Account-Return-Flow an
den anonymen Entwurf gebunden. Ein anderes Konto verwirft ihn statt ihn zu übernehmen.
Bei Logout werden private Texte ausgeblendet; bei erneutem Login mit demselben Konto
kann der tabinterne Entwurf fortgesetzt werden. Ein erkannter Sessionablauf bei der
Einreichung erhält den Text und bietet erneute Anmeldung an. Blockierter Sitzungsspeicher
stoppt den Wechsel bei vorhandenem Entwurf mit einer Meldung, statt den Text zu verlieren.

Rückkehr, OTP, Profil-/Legal-Abschluss und Upvote-Anmeldung führen **keine** automatische
Kommentar- oder Vote-Mutation aus. Erst erneutes ausdrückliches Absenden verwendet
die bisherigen RPCs einschließlich Backend-Gates, Rate-Limits, Versionen und Idempotenz.
Schreibfehler erhalten den Text; erfolgreiche Einreichung oder explizites Abbrechen
entfernen den Entwurf. Keine SQL-/RLS-Änderungen oder zusätzlichen Production-Secrets.
Die vorhandenen Node- und Browser-Regressionstests decken den Ablauf mit vollständig
gemockten externen Diensten ab.

## Kommentare: automatisch für veröffentlichte Artikel

Normale MedDocs-Artikel mit `authors` und `published`, ohne `draft: true`, erhalten
standardmäßig Kommentare. Fehlendes `comments` bedeutet jetzt **an**;
`comments: false` blendet den Bereich aus und deaktiviert ihn beim nächsten Sync.
Drafts, Index-/Hub-/Hero-Seiten und Seiten ohne redaktionelle Metadaten bleiben aus.
`published` bezeichnet das redaktionell gepflegte Datum, kein neues Scheduling-System.

`npm run dev`, `npm start` und `npm run build` ergänzen fehlende `articleId`-UUIDs
vorab automatisch im Frontmatter, ohne bestehende IDs/Artikeltexte zu verändern.
Diese IDs zusammen mit dem Artikel versionieren. Bei Umbenennung die gespeicherte
UUID behalten; bei eigenständigen Kopien `articleId` entfernen, damit unter dem
neuen Pfad eine eigene UUID entsteht. Die erste Zuordnung ist deterministisch,
weitere Builds und Umbenennungen verwenden die gespeicherte Identität.
Für direkte `npx astro ...`-Aufrufe bei neuen Artikeln zuerst `npm run comments:prepare`.

Die zentrale Footer-Komponente rendert genau einen Kommentarbereich nach
„Über diesen Artikel“. Der gewöhnliche Build erstellt nur das private Manifest
`.astro/meddocs-comments-manifest.json`; er greift nicht auf Supabase zu.
Der separat freizugebende Production-Ablauf synchronisiert und aktiviert alle
veröffentlichten Artikel atomar. Frontmatter erteilt keine Browser-Schreibrechte;
die vorhandenen Auth-/Profil-/Legal-/Moderationsprüfungen gelten weiter.
[Automatischer Production-Ablauf](../../../docs/architecture/meddocs-comments-automatic-sync.md).

Normale MedDocs-Artikel referenzieren Personen und Lizenzen über IDs im Frontmatter:

```yaml
authors:
  - orlando-frey
published: 2026-09-27
# Optional, nur bei einer tatsächlichen redaktionellen Aktualisierung:
updated: 2026-10-04
# Optional: IDs tatsächlich beteiligter fachlicher Prüfer aus authors.ts.
# reviewers:
#   - person-id
# Optional: abweichende Lizenz aus licenses.ts.
# license: cc-by-nc-4.0
```

Die Datumswerte im Beispiel dienen nur der Demonstration. Datum und Urheberschaft
werden ausdrücklich redaktionell gepflegt; Git, Dateisystem und Build-Zeit setzen
keine Werte automatisch.

## Daten und Validierung

- `src/data/authors.ts`: eine gemeinsame Registry für Autoren und fachliche Prüfer.
  Nur belegte Namen und Beschreibungen aufnehmen; IDs bleiben stabil.
- `src/data/licenses.ts`: bekannte Lizenzen. Eigene MedDocs-Inhalte verwenden ohne
  Override `cc-by-nc-sa-4.0`. Fremdinhalte müssen ihre tatsächlich gültige Lizenz
  angeben; Third-party Notices und spezifische Hinweise bleiben maßgeblich.
- `article-metadata-schema.ts`: wird in `src/content.config.ts` mit dem vorhandenen
  Starlight-Schema zusammengeführt. Unbekannte IDs, ungültige Kalenderdaten,
  leere Autorenlisten und eine Aktualisierung vor Veröffentlichung sind Fehler.
- Bestehende Seiten dürfen alle Felder weglassen. Sobald `authors`, `published`,
  `updated` oder `reviewers` gepflegt werden, sind `authors` und `published` Pflicht.
- Datumswerte können YAML-Daten oder zitierte `YYYY-MM-DD`-Strings sein. Sie werden
  auf UTC-Mitternacht normalisiert und mit `Intl.DateTimeFormat('de-CH')` in UTC
  formatiert. `updated` am selben Tag wie `published` wird nicht angezeigt.

## Automatische Darstellung

`getMedDocsArticleMetadata()` löst die validierten Angaben einmal nach derselben
Regel für beide Darstellungen auf. Er nutzt die Starlight-Content-ID, das Layout
und den Quelldateinamen. Nur normale Artikel unter `meddocs/` mit vollständigen
Metadaten erhalten die Darstellung. `hub`, `legal`, `splash`, Hero-Seiten und
die bestehenden `index.md`-/`index.mdx`-Übersichten bleiben ausgeschlossen.
Die aktuelle Artikelkonvention verwendet benannte Dateien, z. B. `test.mdx`.

- `MedNerdsPageTitle.astro` ergänzt Terminologie nach dem Titel und vor dem
  mobilen Inhaltsverzeichnis; die redaktionelle Metazeile wird nur am Artikelende gezeigt.
- `MedNerdsContentFooter.astro` ergänzt `MedDocsArticleInfo` nach dem Artikelinhalt
  und vor dem globalen Website-Footer. Dieser Starlight-Footer-Override war vorher
  leer; das bestehende Verhalten der Seitennavigation bleibt erhalten.
- Beide Komponenten erhalten dieselbe typisierte Datenstruktur. Mehrere Autoren
  und Reviewer werden unterstützt. Ohne Reviewer entfällt der gesamte Prüfblock.
- Die Darstellung ist serverseitig; zusätzliche Client-Skripte sind nicht nötig.
  Die bestehende Draft-Behandlung von Starlight wird unverändert verwendet.

`description` ist eine kurze Seiten-/SEO-Zusammenfassung im Frontmatter. Starlight
verwendet sie weiterhin für Metadaten; sie wird nicht als sichtbare Einleitung
unter dem Titel gerendert. Eine sichtbare fachliche Einleitung gehört in den
eigentlichen Artikelinhalt.

Nur der demonstrative Showcase wurde ergänzt. Seine Datumsangaben sind im Text
als Demo gekennzeichnet; er bleibt ein Draft. Andere Artikel werden erst ergänzt,
wenn verlässliche redaktionelle Angaben vorliegen.

## Abbildungen

Neue inhaltliche MedDocs-Abbildungen verwenden `MedDocsFigure`. Bestehende
Markdown-Bilder werden nicht automatisch umgeschrieben. Andere Produktbereiche
können die neutrale `MediaFigure` verwenden; beide nutzen dieselbe zentrale
Lightbox-Initialisierung im PageFrame. Es werden ausschließlich markierte
Figures eingebunden, keine sonstigen Bilder oder Logos.

```mdx
import MedDocsFigure from '@components/meddocs/MedDocsFigure.astro';
import image from './abbildung.webp';

<MedDocsFigure
  src={image}
  alt="Konkrete Beschreibung des Bildinhalts"
  align="center"
  captionTitle="Kurzer Abbildungstitel"
  caption="Beschreibung der Abbildung"
/>
```

- `src`: lokales Astro-`ImageMetadata` (optimierte Vorschau) oder URL/Dateipfad
  als String (normales `<img>`). Bei String-Quellen bekannte `width` und `height`
  mitgeben, um Platz vor dem Laden zu reservieren. Es gibt keine externen
  Größenabfragen und keine fest konfigurierte Medien-Domain.
- `fullSrc`: große Bilddatei für Lightbox und normalen Link ohne JavaScript;
  ohne Angabe wird die ursprüngliche `src`-Datei verwendet.
- `downloadable`: standardmäßig `false`. Bei `true` lädt die offizielle
  Fancybox-Toolbar `downloadSrc`, sonst `fullSrc` bzw. die ursprüngliche Datei.
  `downloadFilename` ist optional. Browserregeln für Downloads von anderen
  Domains bleiben maßgeblich; es wird kein Download-Proxy eingerichtet.
  `MedDocsFigure` zeigt zusätzlich einen direkten Link in der Metazeile zur
  selben Datei. Das Formatlabel kommt aus `downloadFilename`. Ohne explizites
  `downloadSrc` weist eine Development-Warnung auf den verwendeten Fallback hin.
- `gallery`: gemeinsamer, nicht leerer Name verbindet die betreffenden Figures.
  Ohne Namen öffnet jede Figure einzeln.
- `zoomable={false}`: Bild ohne Link oder Lightbox-Markierung.
- `align`: `start` (Standard), `center` oder `end` richtet Bild und Caption als
  gemeinsamen Block aus. Die Caption bleibt linksbündig und auf die Bildbreite
  begrenzt; schmale Viewports bleiben responsiv.
- `captionTitle`: optionaler, etwas prominenterer Abbildungstitel ohne zusätzliche
  Heading-Ebene. `caption` ist die ruhigere Beschreibung in einer eigenen Zeile;
  darunter folgt die bestehende Metazeile. Beide erscheinen auch in Fancybox.
- Optional: `class`; bei `MedDocsFigure` zusätzlich `creator`,
  `organization`, `license`, `licenseUrl`, `sourceUrl`, `citationTitle`. Rechteangaben werden
  ausschließlich redaktionell und passend zum jeweiligen Asset gepflegt;
  keine Lizenz oder Urheberschaft wird vorausgesetzt.

Für „Zitation kopieren“ gilt `citationTitle` → `captionTitle` → `caption`; `alt`
bleibt ausschließlich die Bildbeschreibung. Mit Titel, Lizenz und Quelle wird
die Zitation als `„Titel“ – Urheber, Lizenz, Quelle: URL` erzeugt. Urheber und
Organisation werden nur übernommen, wenn angegeben; identische Angaben erscheinen
nur einmal. `sourceUrl` hat Vorrang, sonst gilt `Astro.site` mit dem aktuellen Pfad.
Development-URLs werden nicht als Zitationsquelle verwendet. Die kleine Kopieraktion
nutzt die Clipboard API mit zugänglicher Erfolgs-/Fehlerrückmeldung. Ohne JavaScript
oder Clipboard API bleibt sie ausgeblendet; Bild- und Download-Links bleiben nutzbar.

Captions sind Text, kein HTML. Creator, Organisation, Lizenz und explizite Quelle
erscheinen auch in Fancybox; Lizenz und Quelle sind dort ebenfalls verlinkt.
Der Showcase verwendet vorhandenes Branding mit dessen eigenen Rechtehinweisen,
keine erfundene Creative-Commons-Lizenz.

Browser-Regressionstest mit laufendem Astro-Dev-Server und Headless-Chrome/CDP:

```sh
# MEDIA_SITE und MEDIA_CDP können die lokalen URLs überschreiben.
node --experimental-strip-types scripts/test-media-figures-browser.mjs
```

## Prüfen

```sh
node --experimental-strip-types scripts/test-meddocs-article-metadata.mjs
npx astro check
npm run build
```
## Wissenschaftliche Quellen und Zitierexport

Publikationen werden zentral als einzelne JSON-Dateien unter
`src/data/meddocs/publications/` gepflegt. Im Artikel-Frontmatter stehen unter
`references` ausschließlich stabile Publikations-IDs. Der bestehende Loader löst
sie vor der Darstellung auf. [Redaktionelle Anleitung](../../data/meddocs/publications/README.md).
MDX verwendet `<MedCitation sources={["quellenkennung"]} />`; Vancouver-Nummern
entstehen ausschließlich für zitierte Quellen beim Build nach erster Verwendung.
`referenceOrder` enthält nur deren Kennungen und wird nicht manuell gepflegt.
Nicht zitierte Einträge erscheinen nach Publikationstyp gruppiert und innerhalb
der Gruppen alphabetisch sortiert als unnummerierte
„Literatur & weiterführende Informationen“. Ohne MedCitation ist ein Artikel somit
automatisch ein reiner Literaturartikel. Bei Kombination stehen zuerst
„Einzelnachweise“, danach die allgemeine Literatur; jede Liste hat ihren eigenen
Fade-out. Der MedTools-Dialog exportiert Artikel, jede Kategorie, alle Quellen
oder eine einzelne Quelle; Vancouver kann im Export auch Literatur nummerieren.
Quellen, vollständige Artikelinformationen und MedTools teilen eine redaktionelle
Kachel. Davor steht die kompakte Pagination, danach die separate Kommentar-Card.
Pflege, Typen, Styles/Lizenzen, Exporte, Druck und Tests sind in
[Quellen und Seitenende](../../../docs/architecture/meddocs-references-and-footer.md) beschrieben.
