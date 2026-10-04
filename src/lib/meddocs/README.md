# Artikel-Metadaten in MedDocs

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

- `MedNerdsPageTitle.astro` ergänzt Terminologie und `MedDocsArticleMeta` nach dem
  Titel und vor dem mobilen Inhaltsverzeichnis.
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
