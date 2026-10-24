# Linkvorschauen in MedDocs

Veröffentlichte Fachartikel (`draft: false`, `authors` + `published`, normales
Artikellayout) erhalten automatisch Vorschauen. Beschreibung und erste geeignete
Absätze genügen; es sind keine neuen Pflichtfelder nötig. Normale Markdown-Links
bleiben unverändert, z. B.
`[TIVA](/meddocs/anaesthesie/allgemeinanaesthesie/#total-intravenöse-anästhesie-tiva)`.
Die Ziel-ID immer am tatsächlich gerenderten Überschriften-Link ablesen.

Optionale Übersteuerung im Frontmatter des **Zielartikels**, als reiner Text:

```yaml
linkPreview: "Kurzer fachlicher Überblick über den Gesamtartikel."
sectionPreviews:
  total-intravenöse-anästhesie-tiva: "Kurzer fachlicher Überblick ausschließlich über dieses Unterkapitel."
```

Beide Felder sind optional; einzelne Texte haben maximal 240 Zeichen. `description`
bleibt das bestehende SEO-Feld und ist der nächste automatische Artikel-Fallback.
Bei Überschriftenänderungen auch `sectionPreviews` prüfen: Ein nicht mehr vorhandener
Schlüssel führt beim Build zu einem Fehler. Die IDs kommen aus `render(entry).headings`;
es gibt keinen zusätzlichen Slugger. Unbekannte Anker in normalen Links zeigen
sicher den Gesamtartikel, niemals einen ähnlich benannten Abschnitt.

Automatische Auszüge stammen aus dem Markdown-/MDX-AST. Tabellen, Listen, Bilder,
Callouts, Komponenten, Ausdrücke, HTML und LaTeX werden konservativ übersprungen.
Ein leerer Hauptabschnitt übernimmt keinen Text seines nächsten Unterkapitels.
Weichen AST- und kompilierte Überschriften voneinander ab, bleiben nur manuelle
Abschnittstexte und die tatsächlichen Überschriftentitel erhalten.
Es werden vollständige Sätze bis 240 Zeichen bevorzugt. Eine zu lange erste Aussage
wird nicht mitten in einer Negation, Dosis oder Einheit abgeschnitten; dann kann
die Vorschau ohne Auszug erscheinen. Fachlich sensible Zusammenfassungen gezielt
übersteuern. Es werden keine medizinischen Aussagen generiert.

Der normale Build erzeugt unter `/meddocs-previews/meddocs/…json` pro veröffentlichtem
Fachartikel genau einen kleinen Datensatz mit Titel, Auszug und Abschnittsdaten.
Drafts werden **vor** Parsing/Rendering ausgeschlossen, auch im Development-Modus.
Es gibt keinen globalen Inhaltsindex im Artikel-HTML und keine externen Abrufe.
Der Browser lädt erst nach 300 ms tatsächlichem Hover/Tastaturfokus und cached je
Zielartikel; ein Abschnitt braucht keinen zweiten Abruf. Fehler lassen den Link
unverändert funktionieren. Kein Backend, keine Accounts oder Secrets erforderlich.

Der Build-Parser verwendet den vorhandenen MDX-Stack sowie die bereits installierten
Pakete `remark-gfm` und `remark-directive`. Deren bestehende Versionen sind als
direkte Build-Abhängigkeiten festgehalten, damit die Extraktion nicht von zufällig
gehoisteten transitiven Abhängigkeiten abhängt. Keine neuen Pakete werden benötigt.

Die Vorschau nutzt möglichst das native Popover (Top Layer), sonst eine feste
Position im Body. Sie ist nicht modal und verschiebt keinen Fokus. `aria-details`
ermöglicht den optionalen strukturierten Zugriff, ohne den Linknamen zu ersetzen
oder lange Texte über `aria-describedby` automatisch vorzulesen. Escape schließt.
Touch navigiert mit einem Tap direkt; ohne JavaScript bleiben alle Links normal.

Lokale Prüfungen:
`node --experimental-strip-types scripts/test-meddocs-link-previews.mjs`.
Browserprüfung mit bestehender lokaler Chrome/CDP-Infrastruktur:
`node scripts/test-meddocs-link-previews-browser.mjs` (Vorschau Port 4326, CDP 9334).
