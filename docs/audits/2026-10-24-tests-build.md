# Audit Etappe 3: Tests und Build

## Bestätigte Ursachen und Korrekturen

- `test-meddocs-references-build.mjs` legte synthetische Artikel und Publikationen
  im echten `src/` an und führte zweimal `npm run build` in das reguläre `dist/`
  aus. Das Cleanup entfernte Quellen, ließ aber den Fixture-Build zurück. Sein
  altes `--clean` löschte feste Dateinamen ohne Nachweis eigener Erzeugung.
- `test-link-resources-browser.mjs` legte Ressourcen und eine Testseite im echten
  Content-Baum an. Damit teilte sein Dev-Server Content und generierten Store mit
  anderen Läufen. Fehler beim Browser-Cleanup konnten Dateien zurücklassen.
- Beide Tests verwenden jetzt `scripts/lib/test-workspace.mjs`: eine eigene
  Kopie der benötigten Eingaben unter `.astro/test-workspaces/mednerds-*`.
  Content, Astro-Cache und `dist/` gehören dieser Kopie; Pakete werden über die
  normale Modulauflösung im übergeordneten Checkout gefunden. Keine erneute
  Installation, Junctions, globalen Konfigurationsänderungen oder Secrets-Kopie.
- Builds laufen weiterhin sequenziell, jetzt direkt über Astro und die tatsächlich
  verwendete Node-Binary, ohne Windows-Shell und ohne redaktionellen npm-Hook.
  Der Content-Loader validiert auch dabei die vorhandenen UUIDs.
- Cleanup läuft in `finally`, beim Dev-Server erst nach dessen Beendigung.
  Die rekursive Löschung akzeptiert nur direkte Kinder des eigenen Testbereichs
  mit passendem Namen und Eigentumsmarker; ein Symlink als Wurzel ist verboten.
  Das Repository selbst und sein reguläres `dist/` werden abgewiesen.

## Bestehende Browser- und temporäre Tests

Der Quellen-Buildtest entfernt seine Kopie standardmäßig vollständig, auch bei
Fehlern. Für den vorhandenen separaten Quellen-Browsertest ist ausdrücklich
`node scripts/test-meddocs-references-build.mjs --keep` möglich. Nur nach einem
erfolgreichen Test wird der ausgegebene Workspace zur Inspektion behalten.
Dessen `dist/` lokal bereitstellen und `AUTH_SITE` des vorhandenen
`test-meddocs-references-browser.mjs` auf diesen lokalen Server richten.
Danach gezielt `node scripts/test-meddocs-references-build.mjs --clean="<ausgegebener Workspace>"`
ausführen. Das alte pauschale `--clean` wird nicht mehr akzeptiert.

`test-medcases.mjs`, `test-medcases-browser-security.mjs`,
`test-meddocs-link-previews.mjs`, der Kommentar-Browsertest und Teile des
Linksammlungs-Browsertests lesen den regulären Build bewusst nur zur Prüfung.
Das bleibt erhalten. Sonstige CDP-Browsertests bauen nicht selbst, sondern
benutzen ihren separat bereitgestellten lokalen Server. Screenshots in
Temp-/ausdrücklich angegebenen Verzeichnissen bleiben Diagnoseartefakte.

UUID-/Sync-/Katalog-Unit-Tests verwenden bereits eigene `mkdtemp`-Verzeichnisse
mit Cleanup; keine grundlegende Umorganisation nötig. Der lokale Realtime-
Persistenztest behält seine Temp-Datei absichtlich zwischen zwei Prozessen für
einen Worker-Neustart. Das ist ein anderer, expliziter Ablauf und wurde nicht
ausgeführt oder verändert.

Private Arbeitsverzeichnisse vermeiden Konflikte mit regulären Builds und
anderen Testkopien. Manuell bereitgestellte CDP-/Serverports und Screenshotziele
müssen bei parallelen Browserläufen weiterhin getrennt gewählt werden.
`finally` kann bei gewaltsamem Prozessabbruch/Stromausfall nicht laufen;
verwaiste, markierte Kopien sind mit dem gezielten Cleanup entfernbar. Es werden
keine fremden Prozesse beendet und keine bestehenden Builds bereinigt.

## UUIDs ohne Build-Seiteneffekte

`comments:prepare` bleibt die vorhandene ausdrückliche redaktionelle Aktion:

```powershell
npm run comments:prepare
# Ergänzte Frontmatter-IDs prüfen und mit den Artikeln versionieren.
npm run comments:check
npm run build
```

`predev`, `prestart` und `prebuild` rufen jetzt ausschließlich `comments:check`
auf. Die kleine `--check`-Option des vorhandenen Generators liest und validiert
das Repository-Manifest; sie schreibt weder Quellen noch SQL oder Remote-Daten.
Fehlende Pflicht-UUIDs führen mit Artikelpfad und Hinweis auf `comments:prepare`
zum Fehler. Die UUID-v5-Erzeugung, gespeicherte IDs, URLs, Draft-/Opt-out-Regeln
und das Supabase-Mapping bleiben unverändert. Der normale Loader darf weiterhin
sein generiertes Manifest im ignorierten `.astro/` schreiben.

## Historische Cloud-Annahmen

Die Cloud-Mocktests kombinierten die heutigen Migrationen mit Erwartungen für
die frühere Fünf-Migrationen-Basis: 40 statt 42 Funktionsnamen. Jetzt lesen sie
nur die fünf ausdrücklich durch `MIGRATIONS` freigegebenen Dateien. Die 40er-
Erwartung und die 92 Assertions sind deshalb weiterhin ein sinnvoller fester
Vertrag dieser historischen Basis, kein allgemeiner Sollzähler des Projekts.

Der ausführbare Cloud-Runner ist nicht auf das aktuelle Acht-Migrationen-Schema
umgestellt worden: Sync-RPC, Listensignatur und Upvote-Tabelle passen nicht zu
seiner alten Allowlist/Remote-Strukturprüfung. Er bleibt vor Credentials/Netzwerk
gesperrt. TLS-, Projekt-, Transaktions-, Schema- und Rollback-Prüfungen wurden
nicht abgeschwächt. Lokale Parser-/Mocktests bleiben relevant; der konkrete
historische Orchestrator und Initial-Rollout-SQL sind im späteren Skript-Audit
auf Archivierung oder eine bewusst geprüfte neue Baseline zu beurteilen.
Siehe auch `supabase/tests/README-meddocs-cloud.md`.

## Gezielte Nachweise

- Tatsächliche Systemversion: Node 22.20.0. Für alle Ausführungen wurde die bereits
  lokal vorhandene Node-22.23.4-Binary aus Etappe 2 verwendet, keine Installation.
- 56 Kommentar-/Cloud-Parser-/Mocktests einschließlich lesender UUID-Prüfung,
  Fehler bei fehlender ID, ausdrücklicher Vergabe und stabiler Umbenennung bestanden.
- 35 bestehende Metadatenprüfungen und die Linksammlungs-Unit-Prüfungen bestanden.
- Quellen-Buildtest: zwei erfolgreiche Builds mit identischen Markern; danach
  sämtliche 262 vorher vorhandenen regulären Build-Dateien per SHA-256 unverändert.
- Isolierter Astro-Dev-Server mit synthetischer Linkressource erfolgreich geprüft,
  anschließend beendet und dessen Workspace entfernt. Keine Browser-Testkampagne.
- Absichtlich fehlende UUID in einer isolierten Kopie erzeugte den erwarteten
  Buildfehler; Cleanup und Schutz gegen Repository-/`dist/`-Löschziele bestätigt.
- Syntaxprüfung der angepassten Browser-/Buildskripte bestanden.

- Astro Check: 0 Fehler, 0 Warnungen, 2 bekannte Hinweise.
- Ein regulärer Build einschließlich Pagefind erfolgreich: 57 Seiten und 58
  HTML-Dateien im Suchindex. Alle 647 erfassten Repository-Dateien waren direkt
  vor und nach diesem Build SHA-256-identisch; damit auch sämtliche vorhandenen
  Artikel-IDs und medizinischen Inhalte. Keine Cloud-Zugangsdaten erforderlich.
- Gezielter `git diff --check` und abschließender Vergleich zum Etappenbeginn:
  ausschließlich beabsichtigte Skript-/Dokumentationsänderungen; keine
  Dependency-, Migrations- oder Anwendungsdatei verändert. Keine Testkopien übrig.

Keine SQL-/Cloud-Tests, Datenbank-Resets, Migrationen, Dependency-Updates, Commits
oder Deployments.

## Geänderte Dateien

- `package.json`
- `scripts/prepare-meddocs-comments-sync.mjs`
- `scripts/lib/test-workspace.mjs` (neu)
- `scripts/test-meddocs-references-build.mjs`
- `scripts/test-link-resources-browser.mjs`
- `scripts/test-meddocs-comments.mjs`
- `scripts/test-meddocs-cloud-pgtap.mjs`
- `README.md`
- `docs/architecture/meddocs-comments-automatic-sync.md`
- `supabase/tests/README-meddocs-cloud.md`
- `docs/audits/2026-10-24-tests-build.md` (neu)
