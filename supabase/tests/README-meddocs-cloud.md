# MedDocs-pgTAP im isolierten Cloud-Sicherheitstestprojekt

Status: **historischer Phase-3B-Runner für die fünf unten genannten Migrationen**.
Der heutige Repository-Stand enthält weitere Migrationen. Der ausführbare Runner
weist diesen Stand vor Passworteingabe und Verbindung bewusst zurück; er wurde
in Audit-Etappe 3 nicht für das heutige Schema freigegeben oder remote ausgeführt.
Ausschließlich
**mednerds-security-tests**, Projekt-Referenz **wpdfduxzqqlizuhkhebb**.
Production und mednerds-staging sind ausgeschlossen. Dieser Ablauf ist eine
eng begrenzte Ausnahme von „synthetische Fixtures niemals gehostet“: ausschließlich
dieses eigens dafür angelegte, leere Sicherheitstestprojekt. Bestehende lokale
Testdatei, Remote-Strukturprüfung und localhost-only-Parallelrunner bleiben unverändert.

Die lokalen Parser-/Mocktests lesen gezielt die fünf durch `MIGRATIONS`
festgelegten Dateien. Die frühere Kombination aus allen heutigen Migrationen
und der Erwartung von 40 historischen Funktionen war inkonsistent. Diese
Korrektur erweitert weder die Cloud-Allowlist noch Schema-/TLS-/Rollback-Rechte.
Automatischer Sync und Upvotes änderten insbesondere RPC-Körper, Listensignatur
und Tabellenbestand; die nachgezogene Indexmigration erweitert die Historie.
Ein schlichtes Erhöhen von Zählern würde deshalb keinen aktuellen Cloud-Test
herstellen. Die folgenden Operatorbefehle beschreiben weiterhin nur die alte Basis.

Die Parser-/Mocktests bleiben für TLS-, Ziel-, Transaktions- und Rollback-Schutz
relevant. Der konkrete Cloud-Orchestrator samt Initial-Rollout-SQL ist ein
Kandidat für spätere Archivierung oder eine ausdrücklich geprüfte neue Baseline
im Skript-Audit. Bis dahin nicht gegen ein aktuelles Projekt ausführen; nicht
einfach Migrationen oder Sicherheitsprüfungen aus der Allowlist entfernen.

## Dateien und Wiederverwendung

- scripts/test-meddocs-comments-cloud.ps1: Windows-Bedienung, verborgenes
  Passwort-Prompt, private Pipe zum Node-Prozess.
- scripts/test-meddocs-comments-cloud.mjs: eine psql-Verbindung, Prerequisites,
  Tests, TAP-Auswertung, Rollback und Nachkontrolle.
- scripts/lib/meddocs-cloud-pgtap.mjs: SQL-Aufbereitung und Schutzprüfungen.
- scripts/test-meddocs-cloud-pgtap.mjs: ausschließlich lokale Parser-/Mocktests,
  ohne Datenbank, Netzwerk oder Passwort.

Der Cloud-Runner liest die bestehende supabase/tests/meddocs_comments.test.sql.
Er übernimmt die Assertions und Fixtures vollständig in derselben Reihenfolge.
Nur das äußere lokale BEGIN/CREATE EXTENSION/no_plan()/finish()/ROLLBACK wird
im Speicher durch den abgesicherten Ablauf und einen festen Plan ersetzt.
Keine Datei wird umgeschrieben; pgTAP wird nicht installiert. Aktuell **92**
Assertions; bei einer Erweiterung wird die Zahl aus den kontrollierten
Top-Level-Assertions neu berechnet. Unbekannte Anweisungen, psql-Metabefehle und
abweichende Transaktionsrahmen werden vor einer Verbindung zurückgewiesen.

Die bestehende meddocs_comments_remote_checks.sql wird ebenfalls wiederverwendet:
lesende Soll/Ist/ok-Prüfungen innerhalb derselben Verbindung vor den Fixtures.
Nur deren eigener Transaktionsrahmen entfällt im Speicher. Jede fehlerhafte
Voraussetzung stoppt den Lauf. Keine Änderung an Produktions-RPCs nötig.

## Voraussetzungen vor dem ersten Operatorlauf

1. PostgreSQL-17-psql.exe, Node.js und das vorhandene Repository.
2. Ausschließlich der IPv4-Session-Pooler
   **aws-0-eu-central-2.pooler.supabase.com:5432**, Datenbank **postgres**,
   Pooler-Benutzer **postgres.wpdfduxzqqlizuhkhebb**. Die Datenbankrolle hinter dem
   Pooler bleibt **postgres**. Port 6543, andere Hosts/Benutzer und direkte
   Verbindungen werden nicht unterstützt; kein automatischer Fallback.
3. Passende CA-Datei für das TLS-Zertifikat des **Pooler-Hosts**,
   als lokale öffentliche Zertifikatsdatei außerhalb des Repositories.
   Der Client verwendet zwingend **sslmode=verify-full**. Keine Hostnamenprüfung
   abschalten; keine Passwörter oder Verbindungs-URLs in Dateien speichern.
   Supabase dokumentiert den CA-Download im Dashboard und verify-full auch für
   Pooler-Verbindungen. Die Datei muss die aktuell präsentierte Pooler-Kette
   vertrauen; eine für den direkten DB-Host verwendete Datei wird nicht blind als
   passend angenommen. Aktuelle Kette/SANs wurden hier nicht remote geprüft.
   libpq muss beim Operatorlauf die Signaturkette und den konkreten Pooler-Hostnamen
   erfolgreich prüfen. Fehler führen zum Abbruch, niemals zu require/verify-ca.
4. Genau die fünf lokalen Migrationsversionen sind in
   supabase_migrations.schema_migrations dokumentiert:
   20261009000000, 20261009000001, 20261010000000,
   20261010010000, 20261011000000.
   **Falls die SQL-Dateien nur im SQL-Editor ausgeführt wurden und die Historie
   fehlt, bricht der Runner ab.** Installation/Historie separat reviewen und
   bestätigen; der Runner erzeugt keine Historieneinträge und wendet nichts an.
5. pgTAP exakt **1.3.3** im Schema extensions; PostgreSQL-Server 15–17.
   Funktionskörper der 40 Projektfunktionen müssen nach normalisierten Zeilenenden
   dem aktuellen Repository entsprechen. MD5 dient hier nur dem Driftvergleich,
   nicht als kryptografischer Herkunftsnachweis. Kommentar-/Whitespace-Abweichungen
   können einen Review-Abbruch auslösen; keine automatische Anpassung.
6. Keine Auth-Nutzer, Sessions, Identitäten, Audit-/MFA-/anderen Auth-Nutzdaten;
   keine Profile, Staff-Zuordnungen, Acceptances, Lösch-Intents oder Kommentare.
   Alle fünf Kommentartabellen müssen leer sein. Einzige erlaubte Seed-Daten:
   genau die eine aktive rechtliche Release-Zeile aus Phase 2.1 mit ihren beiden
   im Repository gespeicherten Versionskennungen.
   Supabase-Auth-Migrationsmetadaten bleiben zulässig.
7. Keine zusätzlichen Anwendungstabellen oder fremden/abgeschalteten DML-Trigger.
   Die sieben erwarteten Profil-/Kommentar-/Auth-Trigger müssen vorhanden sein.
   **Aktive DDL-Event-Trigger führen zu einem gesonderten Review-Abbruch.**
   pgTAP und die Suite legen temporäre Objekte an; unbekannte DDL-Hooks könnten
   externe, nicht rollbackbare Effekte auslösen. Auch übliche verwaltete Supabase-
   DDL-Hooks werden hier nicht ungeprüft freigegeben. Der Runner deaktiviert oder
   verändert keine Provider-Trigger. Diese mögliche Voraussetzung ist vor Ort
   zu prüfen; eine notwendige Ausnahme braucht einen eigenen nachvollziehbaren
   Review statt Entfernen des Guards.
8. Das Testprojekt exklusiv reservieren: keine Auth-Clients, Webseiten oder
   anderen Operatoren, die während des Tests schreiben oder DDL ausführen.
   Der Runner setzt für die Testtransaktion Tabellen-Sperren gegen konkurrierende
   Auth-/Anwendungswrites und kurze Lock-/Statement-/Idle-Timeouts.

Client/TLS-Grundlagen:
[Supabase psql](https://supabase.com/docs/guides/database/psql),
[Supabase SSL/CA und Pooler](https://supabase.com/docs/guides/platform/ssl-enforcement),
[Session-Pooler und Tenant-Benutzer](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI),
[PostgreSQL libpq-Umgebungsvariablen](https://www.postgresql.org/docs/17/libpq-envars.html).

## PowerShell – später ausschließlich durch den Operator

Im Repository mit dem tatsächlichen lokalen CA-Dateipfad:

~~~powershell
Set-Location 'C:\Users\Orlan\Documents\GitHub\MedNerds'
$testCertificate = 'C:\Pfad\zum\Pooler-CA-Zertifikat.crt'

# Voraussetzungen und leeren Ausgangszustand zunächst lesend prüfen:
powershell.exe -NoProfile -File .\scripts\test-meddocs-comments-cloud.ps1 -ConfirmProject mednerds-security-tests -ProjectRef wpdfduxzqqlizuhkhebb -SslRootCert $testCertificate -VerifyClean

# Erst nach erfolgreicher Prüfung: transaktionale pgTAP-Suite:
powershell.exe -NoProfile -File .\scripts\test-meddocs-comments-cloud.ps1 -ConfirmProject mednerds-security-tests -ProjectRef wpdfduxzqqlizuhkhebb -SslRootCert $testCertificate

# Falls psql anders installiert ist, zusätzlich:
# -PsqlPath 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
~~~

pwsh -NoProfile -File funktioniert ebenfalls. Keine ExecutionPolicy oder
Sicherheitsrichtlinie automatisch ändern. Der Zertifikatspfad ist ein bewusst
einzusetzender lokaler Pfad; das Datenbankpasswort wird danach unsichtbar erfragt.
Es steht weder im Befehlsargument noch in einer Datei. Der Wrapper übergibt es
über eine private Standard-Input-Pipe; ausschließlich der psql-Kindprozess erhält
es kurzzeitig als PGPASSWORD. Es wird nie ausgegeben. Raw-psql-Fehlerdiagnostik
wird nicht geloggt; kontrollierte Guard-Fehler bzw. fehlgeschlagene Testnummern
werden gemeldet. Wie bei jedem passwortbasierten Client können lokale Prozesse
mit ausreichenden OS-Rechten auf Prozessspeicher/-umgebung zugreifen.

**VerifyClean** führt eine READ ONLY-Transaktion ohne Fixtures, pgTAP-Plan oder
Schreibsperren aus. Es ist auch die spätere Nachkontrolle nach einem Fehler.
Es öffnet eine neue Verbindung, führt aber keine Tests und keine Datenänderung aus.

## Zielbindung und Schutz vor falschen Verbindungen

- Projektname und Referenz sind exakt bestätigt und als Allowlist gebunden.
- Session-Pooler-Host, Port 5432, Datenbank und projektgebundener Benutzer werden
  vom Runner fest vorgegeben. Freie Hosts, Connection-URLs, Port-/Benutzer-
  Overrides, User-IDs oder Passwort-Argumente fehlen.
- TLS prüft Zertifikatskette **und den erwarteten Pooler-Hostnamen**. Der regionale
  Host ist geteilt und allein kein Projektnachweis. Die feste Tenant-Kennung im
  authentifizierten Benutzer, die Projektbestätigung und sämtliche Schema-/Daten-
  Prüfungen werden gemeinsam verwendet. Eine allgemeine DB mit denselben Tabellen
  oder eine frei gesetzte SQL-Variable beweist keine konkrete Projektidentität.
- Alle geerbten PG-Overrides werden entfernt, darunter PGHOSTADDR,
  PGSERVICE, PGOPTIONS, PGPASSFILE. psql -X ignoriert Startdateien.
  Der Wrapper entfernt zusätzlich Node-Preload-Variablen. Kein .env-Loader,
  Supabase-SDK/CLI-Link oder Management-API-Aufruf.
- TLS hat zwei Strecken: **psql → Pooler** und **Pooler → PostgreSQL**.
  Das offizielle psql-17-Kommando **\conninfo** liefert die libpq-Informationen
  zur ersten Strecke. Vor SQL/Testbeginn sowie am Ende werden exakter Host,
  IPv4-Adresse, Tenant-Benutzer, Port, Datenbank und TLS 1.2/1.3 geprüft. Locale C
  sorgt für die festgelegte Ausgabe; unbekannte/fehlende Angaben führen zum Abbruch.
  Diese Informationen enthalten kein Passwort und werden nicht ausgegeben.
- **pg_stat_ssl** betrachtet nur die zum PostgreSQL-Backend führende zweite
  Strecke. Der bestehende Pflicht-Guard bleibt deshalb als **zusätzliche** Prüfung
  erhalten. Meldet er kein TLS, wird abgebrochen: Client-TLS allein beweist keine
  Verschlüsselung zum Backend. Die tatsächliche Pooler-Backend-Konfiguration wurde
  nicht remote geprüft; ein Scheitern verlangt Review, kein Entfernen des Guards.
- Versionen, Funktionskörper, Trigger, Berechtigungen und Daten bleiben geprüft.
  Die ursprüngliche pg_backend_pid() wird vor jedem Transaktionsschritt kontrolliert.
  Eine zufällige, nicht geheime **SET LOCAL**-Kennung markiert zusätzlich die
  konkrete Testtransaktion, auch wenn READ ONLY keinen XID erhält. Ein unerwartetes
  Transaktionsende oder Backend-Wechsel führt vor dem nächsten Schritt zum Abbruch.
  Die Kennung erzeugt keine Tabelle oder dauerhaft gespeicherte Zugangsdaten.
- Vor **jeder** Testanweisung wird privilegiert erneut geprüft. Nach Beginn der
  Suite sind ausschließlich ihre bekannten synthetischen Nutzer-/Session-/
  Artikel-IDs zugelassen; andere Tabellen bleiben leer. Tabellen-Sperren bleiben
  bis zum Rollback erhalten. Der vorherige anon/authenticated/service_role-
  Testkontext wird anschließend exakt wiederhergestellt.

Ein kompromittierter Betreiber, veränderter Runner oder manipulierter Provider
ist damit nicht kryptografisch ausgeschlossen. Die Schutzmechanismen verhindern
insbesondere falsche Ziele durch Parameter, lokale Konfiguration und libpq-Defaults.

## Eine Testtransaktion, Rollback und TAP

1. Genau ein psql-Prozess/eine Clientverbindung, Session-Pooling auf Port 5432.
   Client-TLS/Endpunkt prüfen, Backend-PID merken, anschließend BEGIN und SET LOCAL-
   Transaktionskennung. Jeder weitere Schritt prüft PID und Kennung.
2. Prerequisites und leere Ausgangsdaten prüfen, Sperren nehmen und erneut prüfen.
3. Bestehende lesende Struktur-/Rechtechecks auswerten.
4. plan(92) statt no_plan(); vollständige bestehende Suite ausführen.
5. finish() tatsächlich erreichen und seine Diagnose berücksichtigen.
6. Immer ROLLBACK, niemals COMMIT; keine Migrations-/Extension-Installation.
7. Gleiche Backend-ID, zurückgesetzte LOCAL-Kennung, kein verbleibender XID und erneut vollständig leere
   Auth-/Anwendungsdaten überprüfen. Auch der Release-Seed muss unverändert sein.
   Anschließend Client-TLS/Endpunkt und Backend-/Rollbackzustand nochmals prüfen.
8. Erst danach Erfolg melden – und nur wenn alle Assertions erfolgreich waren.

SQL-Fehler: ON_ERROR_STOP=1 beendet psql; PostgreSQL verwirft die offene
Transaktion beim Verbindungsende. Auch Timeout/EOF/Abbruch darf keinen Commit
auslösen. Bei nicht bestätigtem Verbindungsende/Netzwerkverlust wird **keine**
erfolgreiche Nachkontrolle behauptet: Verbindung schließen lassen, danach
   VerifyClean erneut ausführen. Statement-Timeout 15 s, Lock-Timeout 3 s,
Idle-in-Transaction-Timeout 30 s begrenzen blockierte/verwaiste Abläufe.

Ein pgTAP-not-ok kann trotz psql-Exitcode 0 auftreten. Deshalb prüft der Runner
zusätzlich genau einen korrekten Plan, lückenlose Nummern 1–92, exakte Anzahl,
keine not-ok-/Bail-out-Ergebnisse und keine Fehlerdiagnose von finish().
Fehlerhafte Assertions dürfen vollständig bis finish() durchlaufen, werden
anschließend zurückgerollt und mit Exitcode 1 einschließlich Testnummern gemeldet.
Fehlende oder doppelte Assertions können niemals erfolgreich sein.
[pgTAP Plan/finish](https://pgtap.org/documentation.html).

Rollback betrifft transaktionale Tabellen-/Schemaänderungen. Es ist kein
Versprechen, technische Logs, WAL oder Provider-Metriken rückwirkend zu entfernen.
Es werden nur synthetische Daten verwendet, keine echten E-Mails oder OTPs.

## Auth-Fixtures und Testumfang

Die bestehende Suite fügt ausschließlich synthetische auth.users mit
id,email_confirmed_at und auth.sessions mit id,user_id ein. Kein Auth-API-
Signup, SMTP oder Edge-Function-Aufruf. Der Runtime-Guard prüft diese Spalten und
Typen sowie weitere NOT NULL-Felder ohne Default **am tatsächlich verbundenen
Schema**. Bei Abweichung stoppt er vor den Fixtures. Die aktuelle Cloud-Instanz
wurde hier nicht untersucht; Kompatibilität bleibt bis zum Operatorlauf unbewiesen.
Default-/CHECK-/FK-Anforderungen, die der Katalogguard nicht vollständig beweist,
führen spätestens zum SQL-Abbruch und Rollback; nichts wird automatisch ergänzt.

Die vorhandenen Tests zu RLS/direkten Rechten, privater Queue/Historie,
Premoderation, User/Autor/Admin, Profile/Legal/Sessions, Quota, Idempotenz,
Versionskonflikten, Edit/Reply/Thread, Rückzug, Auth-DELETE, persönlichen Texten,
erhaltenen fremden Antworten und letztem Admin bleiben erhalten. Zusätzlich
bestehende Katalog-/Cursor-/Timestamp-Tie-Tests. Das ist SQL-Integration;
echte OTP-/Auth-Service-/Browserintegration bleibt separat erforderlich.

## Parallelität – nur als späterer Plan

scripts/test-meddocs-comments-concurrency.mjs bleibt exakt localhost-only.
Keine Cloud-Option hinzufügen, nicht auf dieses Projekt umleiten.

Ein späterer Cloud-Parallelrunner benötigt gesonderte Freigabe, dieselbe
Projekt-/TLS-/Schema-Allowlist, mehrere nachweislich physische Verbindungen und
einen vorher abgestimmten Umgang mit committeten Fixtures. Vorher exklusives
Testprojekt/Reset-Strategie und letzte-Admin-Cleanup reviewen. Szenarien:
identische gleichzeitige Create-Requests und Quota, Moderation vor/gegen
Auth-DELETE, fremde Antworten, parallele Admin-Löschungen/Rollenentzug. Sperr-
überlappung tatsächlich beobachten, Ergebnisse/Revisionen/Audit prüfen, getrennte
Nachkontrolle. Der jetzige Runner behauptet **keinen Parallelitätsnachweis** und
führt keine solchen dauerhaften Fixtures aus.

## Lokale Validierung dieser Vorbereitung

~~~powershell
node --test scripts/test-meddocs-cloud-pgtap.mjs
node --experimental-strip-types --test scripts/test-meddocs-comments.mjs
npx astro check
npm run build
git diff --check
~~~

Die neuen Tests simulieren Verbindungen; kein psql-Prozess und kein Netzwerk
werden darin gestartet. Fehlerhafte Assertions, SQL-Abbruch, fehlgeschlagene
Prerequisites, verbliebene Daten und VerifyClean sind als getrennte Fälle geprüft.
PowerShell-Wrapper wurde nur mit dem Parser überprüft, nicht ausgeführt.
Die echten 92 Cloud-pgTAP-Assertions sind noch **nicht ausgeführt**. Sämtliche fünf
Migrationen, lokale Suite, Remote-Checks, Parallelrunner, Dependencies, Secrets
und .env bleiben gegenüber dem Ausgangsstand dieses Tasks unverändert.

### Session-Pooler-Nachbesserung

Lokale Regressionen prüfen außerdem das exakte feste Pooler-Ziel, das Verbot von
Host-/Port-/User-/URL-Overrides, Client-TLS einschließlich Tenant-Kennung,
Backend-Umschaltung vor Fixtures und während Strukturprüfungen, verloren gegangene
Transaktionskennung, unbestätigten Rollback und erfolgreichen/fehlgeschlagenen
VerifyClean. Echte Authentifizierung, CA-Kompatibilität, Backend-TLS und die
tatsächliche Session-Affinität bleiben bis zum manuellen Operatorlauf unbewiesen.
Keine Remote-Verbindung oder Cloud-pgTAP-Ausführung durch Codex.
