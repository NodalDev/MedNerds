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

- `MedNerdsPageTitle.astro` ergänzt Description und `MedDocsArticleMeta` nach dem
  Titel und vor dem mobilen Inhaltsverzeichnis.
- `MedNerdsContentFooter.astro` ergänzt `MedDocsArticleInfo` nach dem Artikelinhalt
  und vor dem globalen Website-Footer. Dieser Starlight-Footer-Override war vorher
  leer; das bestehende Verhalten der Seitennavigation bleibt erhalten.
- Beide Komponenten erhalten dieselbe typisierte Datenstruktur. Mehrere Autoren
  und Reviewer werden unterstützt. Ohne Reviewer entfällt der gesamte Prüfblock.
- Die Darstellung ist serverseitig; zusätzliche Client-Skripte sind nicht nötig.
  Die bestehende Draft-Behandlung von Starlight wird unverändert verwendet.

Nur der demonstrative Showcase wurde ergänzt. Seine Datumsangaben sind im Text
als Demo gekennzeichnet; er bleibt ein Draft. Andere Artikel werden erst ergänzt,
wenn verlässliche redaktionelle Angaben vorliegen.

## Prüfen

```sh
node --experimental-strip-types scripts/test-meddocs-article-metadata.mjs
npx astro check
npm run build
```
