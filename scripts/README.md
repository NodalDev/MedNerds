# Tests und Wartungswerkzeuge

Node gemäß `../.node-version`, Installation mit `npm ci --include=dev`.
Die flache Struktur bleibt bestehen: alle 42 Node-Testskripte haben einen
eigenständigen Zweck. Keine Löschungen, Verschiebungen, neue Testbibliothek oder
neuer Runner. Seltene Nutzung oder überlappende Themen sind kein Redundanznachweis.

## Standardchecks

| Befehl | Reihenfolge |
| --- | --- |
| `npm run check:quick` | Astro Check → sieben schnelle lokale Testdateien |
| `npm run check:full` | Quick → zehn weitere lokale Testdateien → genau ein regulärer Build einschließlich Pagefind → drei Prüfungen der Build-Ausgabe → isolierter Quellen-Buildtest |
| `npm run check:release` | Alias für Full, bis Hosting-/Release-Anforderungen konkret feststehen |

Die Dateilisten stehen ausschließlich in `../package.json`. Full verwendet Quick
einmal; die weiteren Listen enthalten keine seiner Testdateien. Der eingebaute
Node-Runner führt die Dateien mit `--test-concurrency=1` sequenziell aus. Ein
fehlgeschlagener Teil beendet die `&&`-Kette. Keine Globs wie `scripts/test-*.mjs`:
darunter liegen auch echte Datenbank-/Browser-Runner.

Full prüft 21 der 42 Testskripte automatisch. Der isolierte Quellen-Buildtest
benötigt bewusst zwei Builds derselben Fixture-Kopie: Der zweite prüft stabile
Zitationsnummern nach erneutem Laden des Content-Caches. Das ist zusätzlich zum
einmaligen regulären Build erforderlich und keine zweite reguläre Buildausgabe.
Beide Fixture-Builds teilen genau eine private Arbeitskopie und werden bereinigt.

Die 16 CDP-Browsertests brauchen einen separat gestarteten Browser und passende
lokale Server; fünf weitere Node-Spezialtests benötigen Worker, PostgreSQL oder
gehören zum historischen Cloud-Ablauf. Keine dieser Voraussetzungen wird von
den Standardchecks gestartet. Tests mit eingebauten API-/HTTP-Mocks zählen
dagegen zu den lokalen Checks, auch wenn ihr Dateiname Auth, Deletion oder Cloud
enthält. Es findet dabei keine echte Anmeldung, Löschung oder RPC-Verbindung statt.

## Inventar: automatisch ausgeführte Tests

Alle Pfade dieser Tabellen sind relativ zu `scripts/`. Einzelaufruf:
`node --experimental-strip-types <Datei>`; für `node:test` auch `node --experimental-strip-types --test <Datei>`.

| Datei | Stufe | Eigenständiger Zweck |
| --- | --- | --- |
| `test-auth.mjs` | Quick | OTP-/Session-/Logout-Zustände und Turnstile mit Mocks |
| `test-profiles.mjs` | Quick | Profilzustände, Validierung, Staff-Mapping, statische Migrationsverträge |
| `test-meddocs-article-metadata.mjs` | Quick | Autoren, Terminologie, Datums-/Review-/Lizenzmetadaten |
| `test-link-resources.mjs` | Quick | Linksammlungs-Schema, Filter, feste Fachgebiets-Baseline, URL-State |
| `test-medblog.mjs` | Quick | Blog-Schema, Auswahl, Sortierung, Filter und URLs |
| `test-osce-timer.mjs` | Quick | Gemeinsame Timer-Core-Engine und Zeitberechnung |
| `test-osce-timer-tool.mjs` | Quick | Timer-Konfiguration, Sound-Cues und Sound-Adapter |
| `test-account-phase21.mjs` | Full | Rechtliche Bestätigungen, Onboarding, Avatar und Profil-Erweiterungen mit Mocks |
| `test-account-deletion.mjs` | Full | Lösch-Handler/Client, frische Bestätigung, Race-/Fehlerfälle und statische SQL-Verträge; keine echte Löschung |
| `test-hyperheart-timeline.mjs` | Full | Bestehende interne Timeline-, Sampling- und Bewegungsdaten, auch solange das Feature verborgen bleibt |
| `test-medcases-production-config.mjs` | Full | Lokale Validierung von Origins, Realtime-URL und Worker-Konfiguration; keine Production-Anfrage |
| `test-medcases-realtime.mjs` | Full | Protokoll, serverseitige Timer-Zustände, Identitäten und Materialfreigabe ohne Worker-Server |
| `test-medcases-realtime-ui.mjs` | Full | Realtime-Client-/Verbindungszustände unabhängig vom Browser |
| `test-medcases-realtime-abuse.mjs` | Full | Größen-, Raten- und Missbrauchsschutz mit lokalen Request-Objekten |
| `test-meddocs-comments.mjs` | Full | Kommentarzustände, Autorisierungshilfen, UUID-/Manifestlogik und Sync mit Client-Mocks |
| `test-meddocs-references.mjs` | Full | Referenzen, Katalogauflösung, CSL-Formatierung, Exporte und Cache-Verträge |
| `test-meddocs-cloud-pgtap.mjs` | Full | Ausschließlich lokale Parser-/TLS-/Ziel-/Rollback-Mocktests der historischen Basis; kein psql-Prozess |
| `test-medcases.mjs` | Full, nach Build | Fallprojektionen, Rollenansichten und öffentliche/fehlende Routen im Build |
| `test-medcases-browser-security.mjs` | Full, nach Build | Trotz Dateiname kein Browser: Security-Headers und gerenderte Integrationsgrenzen lesen |
| `test-meddocs-link-previews.mjs` | Full, nach Build | Preview-Extraktion, Sicherheits-/Pfadregeln und generierte HTML-/JSON-/Sitemap-Konsistenz |
| `test-meddocs-references-build.mjs` | Full | Zwei isolierte Fixture-Builds für Zitationsmarker und Cache-Idempotenz; `--keep` nur für bewusste Browserinspektion |

Diese Prüfungen überschneiden sich fachlich, aber nicht im Prüfziel: zum
Beispiel Timer-Core/Sound-Tool, Rollenprojektion/gerenderte Rolle und
Lösch-Handler/Account-Browserflow sind keine austauschbaren Tests.

## Manuelle Spezialtests: außerhalb aller Standardchecks

CDP bedeutet ein bereits gestarteter lokaler Chrome/Chromium mit Debug-Port.
Die Kopfzeilen der Skripte nennen Ports und gegebenenfalls `*_SITE`/`*_CDP`-
Variablen. Bei parallelen Läufen Ports und Screenshotziele trennen. Keine
persönlichen Browserprofile verwenden und keine Server fremder Läufe beenden.

| Datei | Voraussetzung / Zweck / Grenze |
| --- | --- |
| `test-auth-browser.mjs` | Lokaler Build + CDP; Auth-, OTP-, Profil- und Lösch-UI mit blockierten/gemockten externen Requests |
| `test-link-resources-browser.mjs` | Regulärer Build zum Lesen + CDP; eigener isolierter Dev-Server mit Ressourcen-Fixtures |
| `test-medblog-browser.mjs` | Lokaler Build + CDP; Blog-Filter, Links und responsive Darstellung |
| `test-medcases-browser.mjs` | Lokaler Build + CDP; statische Candidate-/Patient-/Examiner-Ansichten |
| `test-medcases-candidate-browser.mjs` | Astro + lokaler Entwicklungs-Worker + CDP; Candidate-Einstieg und Verbindungsgrenzen |
| `test-medcases-display-browser.mjs` | Astro + lokaler Worker + CDP; passiver Display-Modus |
| `test-medcases-mode-browser.mjs` | Astro + lokaler Worker + CDP; Moduswechsel und Benutzerführung |
| `test-medcases-patient-browser.mjs` | Astro + lokaler Worker + CDP; Patient-Realtime und Materialfreigabe |
| `test-medcases-realtime-browser.mjs` | Astro + lokaler Worker + CDP; Geräte-/Tab-Synchronisierung |
| `test-meddocs-comments-browser.mjs` | Lokaler Build + CDP; Kommentar-/Moderations- und Auth-UI mit gemockten externen Requests |
| `test-meddocs-link-previews-browser.mjs` | Lokaler Server + CDP; Hover, Tastatur, Touch und Lazy Loading |
| `test-meddocs-references-browser.mjs` | CDP + ausdrücklich behaltene Quellen-Testkopie; Dialog, Exporte und Layout. Vorbereitung/Cleanup siehe [Etappe-3-Bericht](../docs/audits/2026-10-24-tests-build.md) |
| `test-meddocs-toc-browser.mjs` | Lokaler Server + CDP; Scrollspy, Accordion und Keyboard/Reduced Motion |
| `test-media-figures-browser.mjs` | Lokaler Dev-Server + CDP; Figure, Fancybox, Download, Clipboard und Zoom |
| `test-osce-timer-browser.mjs` | Lokaler Build + CDP; Timer-/Sound-/Fullscreen-Oberfläche |
| `test-sidebar-browser.mjs` | Lokaler Build + CDP; Sidebar-Zustände und responsive Interaktion |
| `test-medcases-production-live.mjs` | Trotz Name ausschließlich Loopback-Worker `127.0.0.1:8787` im Production-Modus; erzeugt lokale Sessions und prüft Origin-/Sicherheitsregeln |
| `test-medcases-realtime-abuse-live.mjs` | Lokaler Worker; echte lokale HTTP-/WebSocket-Missbrauchs-/Grenzprüfungen, verändert dessen Testzustand |
| `test-medcases-realtime-live.mjs` | Lokaler Worker; Multi-Client-/Persistenzlauf. Temp-Datei bleibt absichtlich zwischen zwei Neustart-Phasen bestehen |
| `test-meddocs-comments-concurrency.mjs` | Explizit bestätigte leere, bereits migrierte Wegwerf-PostgreSQL-DB auf Loopback; führt lokale Test-DML aus, kein Docker-/DB-Setup durch Standardchecks |
| `test-meddocs-comments-cloud.mjs` | Historischer gesperrter Phase-3B-Runner; könnte bei separat bestätigter passender Basis SQL-Fixtures auf dem festgelegten Sicherheitstestprojekt ausführen. Nicht reaktiviert |

Der zusätzliche PowerShell-Wrapper `test-meddocs-comments-cloud.ps1` übergibt
Credentials ausschließlich verdeckt an den historischen Cloud-Runner. Auch er
bleibt ausgeschlossen. Dessen fünf freigegebene Migrationen passen nicht zur
heutigen Acht-Migrationen-Basis; Abbruch vor Credentials/Verbindung bleibt
bestehen. Siehe [Cloud-README](../supabase/tests/README-meddocs-cloud.md).
Parser-/Mocktests bleiben sinnvoll. Eine Archivierung oder neue Baseline ist
eine spätere ausdrückliche Entscheidung, kein bloßes Erhöhen von Zählern.

## Wartung und gemeinsame Dateien

| Datei / npm-Befehl | Zweck und Schreibgrenze |
| --- | --- |
| `prepare-meddocs-comments-sync.mjs` / `comments:check` | `--check`: nur vorhandene Artikel-IDs und das Manifest validieren; normale dev/start/build-Hooks verwenden nur diesen Modus |
| dieselbe Datei / `comments:prepare` | `--assign-ids`: bewusste redaktionelle Aktion, ergänzt fehlende Frontmatter-UUIDs; Änderungen prüfen und mit Artikeln versionieren |
| dieselbe Datei, `--manifest` / `--out` | Validiertes Operator-SQL vorbereiten; `--out` erzeugt eine neue lokale Datei, führt SQL nicht aus |
| `sync-meddocs-comments.mjs` / `comments:sync` | Ohne `--dry-run` echte Production-RPC-Schreiboperation: erfordert bestätigtes Ziel, Enablement und serverseitigen Secret-Key. Nicht automatisch lokal ausführen |
| dieselbe Datei, `--dry-run` | Nur Manifestabgleich, kein Client/Request; kein Bestandteil der allgemeinen Checks erforderlich |
| `build:production` | Build plus echter Kommentar-Sync; nur separat freigegebener Production-Deployment-Ablauf, niemals lokaler Check |
| `extract-hyperheart-assets.mjs` | Lokale Asset-/Manifest-/Icon-Generierung aus `_reference/`; verändert Quelldateien. `--verify` liest und vergleicht nur |
| `extract-hyperheart-motion.mjs` | Lokale Bewegungsdaten aus `_reference/` erzeugen, nie Legacy-JS ausführen. `--verify` liest und vergleicht nur |
| `realtime:dev` | Startet lokalen Worker und schreibt lokale Worker-Persistenz; keine automatische Standardprüfung |
| `realtime:typecheck` | Generiert die ignorierte `worker-configuration.d.ts` mit Wrangler und prüft Worker-Typen. Bewusster eigener Toolchain-Schritt, kein Source-/Schema-Generator in den allgemeinen Checkketten |
| `realtime:test` | Vorhandener Einzelalias für `test-medcases-realtime.mjs`; keine zusätzliche Ausführung durch Full |
| `lib/test-workspace.mjs` | Gemeinsame isolierte Kopie und eigentumsgeprüftes Cleanup für Quellen-Buildtest und Ressourcen-Browsertest |
| `lib/meddocs-cloud-pgtap.mjs` | Gemeinsame Parser, feste Projekt-/TLS-/Transaktionsregeln und SQL-Guards für Cloud-Runner und lokale Mocktests |
| `fixtures/link-resources.mjs` | Synthetische Daten für Ressourcen-Unit- und Browsertest; keine ausführbare Wartung |
| `fixtures/meddocs-references.mjs` | Synthetische Referenzen für Quellen-Unit- und Fixture-Buildtests |

Für Wartung mit Änderungen an Quellen, Assets oder Remote-Daten ist ein bewusster
Aufruf im passenden Arbeitsauftrag erforderlich. Die bestehenden Ziel-/Enablement-
Kontrollen des Syncs und die Beschränkungen der DB-Runner bleiben erhalten.
Keine Credentials aus vorhandenen Umgebungen werden durch eine Checkkette zum
Synchronisieren, Migrieren, Zurücksetzen oder Deployen verwendet.

### Supabase-Dateien

Alle folgenden SQL-Dateien liegen unter `supabase/tests/`, bleiben erhalten und
werden von keinem Standardcheck als SQL ausgeführt:

| Datei | Einordnung |
| --- | --- |
| `profiles_staff.test.sql` | SQL-/RLS-Verträge für Profile, Staff, Eindeutigkeit und Berechtigungen; synthetische Fixtures |
| `account_phase21.test.sql` | Profil-Erweiterungen und rechtliche Bestätigungen mit Fixtures |
| `account_deletion.test.sql` | Löschablauf, Cascades und letzter Administrator mit Fixtures |
| `meddocs_comments.test.sql` | Kommentar-/Moderations-/RLS-Prüfungen mit Fixtures; vom historischen Cloud-Parser nur lokal gelesen |
| `meddocs_comment_upvotes.test.sql` | Stimmen, Sortierung und Rechte mit Fixtures |
| `account_phase21_remote_checks.sql` | Gesonderter lesender Schema-/Rechteabgleich; nur nach ausdrücklicher Zielauswahl/Freigabe |
| `meddocs_comments_remote_checks.sql` | Historischer lesender Initial-Rollout-Abgleich; kein aktueller allgemeiner Production-Healthcheck |

SQL-Fixtures ausschließlich in ausdrücklich freigegebenen isolierten
Testumgebungen; keine automatische Migration, Cloud-Verbindung oder DB-Löschung.

## GitHub Actions: Vorschlag für Etappe 5

Aktuell existieren unter `.github/` nur Issue-Vorlagen und Funding-Konfiguration,
kein Workflow. Nach Prüfung möglicher Deployment-Trigger genügt später:
Checkout → `actions/setup-node` mit `node-version-file: .node-version` →
`npm ci --include=dev` → `npm run check:full` (alternativ der Release-Alias).
Keine zweite Testliste im Workflow, keine Supabase-/Cloud-Secrets, kein
`build:production`. Diese Etappe fügt ausdrücklich keinen Workflow hinzu und
ist keine Freigabe für einen öffentlichen Release.
