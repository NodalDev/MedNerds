# MedNerds Accounts – Datenbank

## MedDocs-Upvotes und Sortierung (lokal vorbereitet)

Neue additive Migration: `20261017000000_meddocs_comment_upvotes_sorting.sql`.
Nach Betreiber-Review vor Auslieferung des neuen Frontends anwenden; hier wurden
keine Remote-Migrationen ausgeführt. Keine zusätzlichen Secrets, Umgebungsvariablen,
Auth-Einstellungen oder Edge Functions erforderlich. Vorherige Migrationen bleiben unverändert.

- Private RLS-Tabelle `meddocs_comment_upvotes`, Primärschlüssel `(comment_id,user_id)`;
  beide Foreign Keys haben `ON DELETE CASCADE`. Keine direkten Browser-Tabellenrechte.
- `meddocs_comment_upvote(target_comment,voted)` setzt idempotent den gewünschten
  Zustand für die verifizierte eigene Identität. Setup-/Legal-/Sessionprüfung,
  Artikel- und Root-/Kommentarsperren verhindern Selbstvotes und Stimmen auf
  nicht veröffentlichten/ausgeblendeten/zurückgezogenen Inhalten. Eine wartende
  Bearbeitung ändert die Bewertbarkeit der weiterhin freigegebenen Fassung nicht.
- Öffentliche DTOs enthalten nur Anzahl, eigene Bewertung und eine unverbindliche
  UI-Verfügbarkeit; niemals Identitäten anderer Abstimmender. Schreibrechte werden
  unabhängig erneut serverseitig geprüft. Stimmen werden mengenbasiert aggregiert.
- Die Listen-RPC erhält `sort_order` (`newest`, `oldest`, `helpful`), Standard
  `newest`. Publikationszeitpunkt und UUID bilden die stabile Reihenfolge;
  `helpful` berücksichtigt davor die Stimmenzahl. Antworten bleiben chronologisch.
  Der Cursor bindet Sortierung, Stimmenzahl, Publikationszeitpunkt und UUID.
  Die bisherige RPC-Signatur mit drei Parametern wird ersetzt, um PostgREST-Mehrdeutigkeit
  zu vermeiden. Bereits offene Clients mit alten Cursorn müssen neu laden.
- Scores sind live: Fremde Abstimmungen zwischen zwei Seitenabrufen können die
  Rangfolge verändern; es gibt keinen eingefrorenen Snapshot. Die UI dedupliziert
  IDs und lädt nach eigenem Abstimmen in „Hilfreichste“ die globale Liste neu.

Lokale Prüfungen: `node --experimental-strip-types scripts/test-meddocs-comments.mjs`,
bestehender `scripts/test-meddocs-comments-browser.mjs` (sämtliche Auth-/Datenaufrufe
gemockt), Astro Check und Build. Ergänzende echte pgTAP-Assertions stehen in
`supabase/tests/meddocs_comment_upvotes.test.sql`: nur auf einer migrierten,
isolierten lokalen Supabase-Testdatenbank ausführen, niemals auf Production.
Sie prüfen unter anderem Eindeutigkeit, Rücknahme, fremde Stimmen, Sichtbarkeit,
Sortierung/Cursor und Auth-Lösch-Cascade. Mock-/Textprüfungen beweisen weder reale
Datenbankberechtigungen noch konkurrierende Transaktionen. In dieser Umgebung
wurden die SQL-Tests mangels laufender lokaler Datenbank noch nicht ausgeführt.

## MedDocs-Kommentare: automatische Production-Synchronisierung

Der installierte Phase-3B-Stand wird um eine gezielte, noch lokal vorbereitete
Folgemigration `20261011010000_meddocs_comments_automatic_sync.sql` ergänzt.
Sie ersetzt nur die bestehende service_role-only Katalog-RPC. Vollständige Manifeste
aktivieren künftig veröffentlichte redaktionelle Artikel automatisch; Drafts,
`comments: false` und entfernte Routen werden deaktiviert, Kommentardaten bleiben erhalten.
Normale Builds greifen weiterhin nicht auf Supabase zu.
[Einmalige Freigabe, serverseitige Secrets und Deployment-Befehl](../docs/architecture/meddocs-comments-automatic-sync.md).

## Stand und Sicherheitsgrenze

Die zwei Phase-2-Migrationen wurden laut Betreiber auf Staging und Production
angewendet; die PostgreSQL-/RLS-Tests wurden erfolgreich ausgeführt. Diese
Migrationen dürfen nicht nachträglich geändert werden. Phase 2.1 wurde laut
Betreiber inzwischen ebenfalls auf Production angewendet und strukturell geprüft:
vier Tabellen mit RLS, zwei bestehende Accounts mit Profil, erhaltene Adminrolle
und genau eine aktive Rechtstextversion. Die anschließend aus Production
generierten Typen liegen vollständig und unverändert unter
`src/lib/auth/database.types.ts` und sind die zentrale
Quelle für den Supabase-Client und die daraus abgeleiteten Profil-/Staff-Typen.
Die temporäre Schema-Erweiterung und die zusätzliche Importdatei wurden entfernt.
Node-/Browser-Mocks und statische SQL-Prüfungen ersetzen keine echten RLS-Tests.
Die untenstehenden CLI-Befehle wurden anhand der offiziellen CLI **2.120.0**
(Versions-/Hilfeabfragen) geprüft. Die CLI wird über npx verwendet, ohne neue
Projektdependency. Bei der Integration der bereitgestellten Typdatei wurde keine
Remote-Verbindung aufgebaut und keine Migration ausgeführt.

## Datenmodell und Rechte

- `auth.users.id` ist die stabile Identität, jetzt auch im AuthStore verfügbar.
- `profiles`: `user_id` (PK/FK, CASCADE), optionaler `display_name`, DB-Zeitstempel.
  Keine E-Mail-Kopie, Passwörter, Rolle oder Biografien.
- `staff_accounts`: `user_id` (PK/FK, CASCADE), `role` (`author`/`admin`), optionaler
  `author_slug`, `created_at`. Ohne Staff-Zeile gilt die Rolle `user`.
- Anon/PUBLIC erhalten keine Tabellenrechte. Authenticated darf über RLS nur
  eigene Profile und eigene Staff-Zeilen lesen. Nur `UPDATE(display_name)` wird
  gewährt; keine Inserts/Deletes. `WITH CHECK` prüft ebenfalls `auth.uid()`.
- Staff-Schreibrechte erhalten nur privilegierte Verwaltungsprozesse
  (`postgres`/Service Role), niemals der Browser. Auch ein MedNerds-Admin bleibt
  als Browserclient die DB-Rolle `authenticated` und darf keine Staff-Zeilen ändern.
- Rollen werden nicht aus E-Mail, `user_metadata`, Local Storage oder
  Anzeigenamen abgeleitet. Ein fehlgeschlagener Staff-Read wird als unbekannter
  Status angezeigt, nicht als bestätigte Nutzerrolle.

Die folgenden Abschnitte beschreiben zunächst Phase 2. Die zusätzliche
Phase-2.1-Migration und ihr Freigabeablauf sind weiter unten dokumentiert.

Ein privater, nicht als RPC exponierter SECURITY-DEFINER-Trigger erzeugt bei
Auth-Registrierung ein leeres Profil. `search_path=''`, qualifizierte Tabellen
und entzogene Ausführungsrechte begrenzen den Zugriff. Er liest keine Metadaten
und vergibt keine Rollen. Der separate Backfill erzeugt Profile für bestehende
Auth-Nutzer mittels `ON CONFLICT DO NOTHING`, ohne Namen zu überschreiben.

Der kleine SECURITY-INVOKER-Profiltrigger normalisiert Namen und verwaltet
Zeitstempel: `created_at` bleibt unverändert, `updated_at` ändert sich nur bei
einer tatsächlichen Änderung des normalisierten Namens. Browser dürfen beide
Zeitstempel und `user_id` wegen Column-Level-Rechten nicht überschreiben.

Anzeigenamen: optional (leere/Whitespace-Eingabe löscht auf NULL), ansonsten
2–60 Unicode-Codepoints; Unicode-Leerzeichen am Rand werden entfernt.
C0/C1-Steuerzeichen, unsichtbare/bidirektionale Steuerzeichen werden abgelehnt.
Normale Unicode-Namen und Akzente sind erlaubt. PostgreSQL validiert unabhängig
vom Client. In der UI wird Text nur über Formularwerte/`textContent` ausgegeben.

## Lokale Prüfung vor Freigabe

Docker Desktop muss installiert und gestartet sein. Die Konfiguration beschreibt
nur das lokale Projekt, niemals die gehostete SMTP-/Turnstile-Konfiguration.
PostgreSQL 17 ist der lokale Default; vor Tests die tatsächliche Remote-Version
prüfen und bei Abweichung `db.major_version` entsprechend wählen.

Aus dem Repository-Root:

```sh
npx --yes supabase@2.120.0 start
npx --yes supabase@2.120.0 db push --local
npx --yes supabase@2.120.0 test db supabase/tests/profiles_staff.test.sql supabase/tests/account_phase21.test.sql supabase/tests/account_deletion.test.sql --local
node --experimental-strip-types scripts/test-profiles.mjs
node --experimental-strip-types scripts/test-auth.mjs
```

Keinen Remote-`db reset` ausführen. Der pgTAP-Test läuft in einer Transaktion mit
synthetischen UUIDs und Rollback. Er testet echte Tabellenrechte/RLS für anon,
Nutzer A, Nutzer B und privilegierte Maintenance, automatische Profilerstellung,
den Backfill, Unicode-Namen, geschützte Spalten, Staff-Eskalation und CASCADE.
Die Testdatei verwendet dieselbe Backfill-Anweisung; der statische Test prüft
die Übereinstimmung mit der Migration. Testdaten nicht an eine Remote-DB senden.

## Datenbanktypen erneut generieren

`src/lib/auth/database.types.ts` enthält die vollständige CLI-Ausgabe, inklusive
`__InternalSupabase`, generierter Helper-Typen und `Constants`. Nicht manuell
bearbeiten und keine zweite Typdefinition anlegen. Projektspezifische Aliase
werden außerhalb dieser Datei daraus abgeleitet.

Vor dem folgenden Befehl die **Production-Project-Ref** mit dem Dashboard
abgleichen und den Platzhalter ersetzen. `--project-id` wählt das Projekt
explizit; die zuletzt gespeicherte CLI-Verknüpfung ist dafür nicht maßgeblich.
Die Typgenerierung liest das Schema und führt keine Migration aus. PowerShell,
aus dem Repository-Root:

```powershell
$accountDbTypes = npx --yes supabase@2.120.0 gen types --project-id <PRODUCTION_PROJECT_REF> --lang typescript --schema public
if ($LASTEXITCODE -ne 0) { throw 'Typgenerierung fehlgeschlagen; vorhandene Typdatei behalten.' }
$accountDbTypes | Set-Content -LiteralPath src/lib/auth/database.types.ts -Encoding utf8
```

Alternativ nach erfolgreicher lokaler Migration aus dem lokalen Schema erzeugen:

```powershell
$accountDbTypes = npx --yes supabase@2.120.0 gen types --local --lang typescript --schema public
if ($LASTEXITCODE -ne 0) { throw 'Typgenerierung fehlgeschlagen; vorhandene Typdatei behalten.' }
$accountDbTypes | Set-Content -LiteralPath src/lib/auth/database.types.ts -Encoding utf8
```

Generierte `Insert`-/`Update`-Typen beschreiben das Schema, keine Berechtigungen.
Phase 2 sendet ausschließlich `display_name`; Phase 2.1 ergänzt nur die unten
genannten freiwilligen Profilfelder. PostgreSQL-Grants und RLS schützen Identität,
Zeitstempel und Staff-Zuordnungen unabhängig von den generierten Typen.

Danach `npx astro check`, `npm run build`, Auth-/Profil-/Browser-Tests ausführen.
Der Browser-Test mockt ausschließlich; er versendet keine echten E-Mails.

## Spätere Remote-Migration – nur nach Prüfung und Freigabe

Die Phase-2- und Phase-2.1-Migrationen sind bereits angewendet. Der bisherige
manuelle Phase-2.1-Ablauf bleibt weiter unten als Referenz dokumentiert. Vor jeder Remote-
Migration Projekt-Ref, Migrationshistorie und Backup-/Recovery-Stand kontrollieren,
verpflichtend einen Dry-Run durchführen und die Anwendung ausdrücklich freigeben.
Staging ist optional, für kritische Änderungen empfohlen. Der Agent erstellt und
prüft lokale Dateien; er führt keine Remote-Migrationen oder schreibenden Remote-
Tests aus. Keine Secrets als CLI-Argumente/Logs oder im Repository ablegen.

Logout beendet die SDK-Session; das Frontend sendet dann keine Profiländerungen
mehr und verwirft alte Antworten. Das ist keine sofortige serverseitige
Invalidierung aller bereits ausgestellten Access-JWTs. RLS bleibt die Grenze
für jeden Request; Supabase verwaltet Token-Gültigkeit und Session-Lifecycle.

## Initialer Admin und Autorenmapping

1. Account regulär per OTP registrieren.
2. Die richtige Nutzer-UUID unter Authentication → Users identifizieren.
3. Einen kontrollierten, privilegierten SQL-Vorgang im Dashboard durchführen.
   Beispiel mit **erst manuell zu ersetzender** UUID, keine produktive Identität:

```sql
begin;
insert into public.staff_accounts (user_id, role, author_slug)
values ('<AUTH_USER_UUID>'::uuid, 'admin', null);
select user_id, role, author_slug from public.staff_accounts
where user_id = '<AUTH_USER_UUID>'::uuid;
commit;
```

Vor Commit Identität/Rolle verifizieren. Bei bestehender Zuordnung zuerst
prüfen statt blind per Upsert zu überschreiben. Keine automatische Ernennung
und kein öffentliches Verwaltungs-RPC. Kein Service-Role-Key im Frontend.

Für eine redaktionelle Zuordnung `author_slug` vor dem privilegierten Insert/
Update gegen **die exakten Schlüssel** in `src/data/authors.ts` prüfen
(`getStaffAuthor` nutzt dieselbe SSOT). SQL prüft nur das stabile Slug-Format;
kein künstlicher FK und keine zweite Biografie. Slugs bei späterer Redaktion
nicht ohne entsprechende, geprüfte Mapping-Migration umbenennen.

Ein bestätigter Staff-Autor ist nicht automatisch Autor jedes Artikels.
`isStaffAuthorOfArticle` verlangt zusätzlich Übereinstimmung von `author_slug`
mit den tatsächlichen Frontmatter-`authors` des Artikels, nicht mit Anzeigenamen
oder aufgelösten Personennamen. Die Helper sind Darstellungshilfen, keine
Autorisierungs-Engine. Künftige Kommentarberechtigungen müssen PostgreSQL/RLS
erzwingen. Öffentliche Autorenkennzeichnung braucht später eine bewusst
begrenzte Projektion ohne E-Mail/private Accountdaten; Phase 2 veröffentlicht
keine Profile. MedLearn kann dieselbe Auth-UUID verwenden, erhält hier keine
Tabellen.

Offizielle Referenzen:
[Profile/Trigger](https://supabase.com/docs/guides/auth/managing-user-data),
[Spaltenrechte](https://supabase.com/docs/guides/database/postgres/column-level-security),
[CLI](https://supabase.com/docs/reference/cli/supabase-db-push).

## Phase 2.1 – auf Production migriert, generierte Typen integriert

Migration: `20261010000000_account_profile_extensions.sql`, laut Betreiber
erfolgreich auf Production angewendet. Der Agent hat bei der lokalen Typintegration
keine Remote-Verbindung aufgebaut, keine Migration angewendet und keine echten
Mails versendet. Keine Profile, Identitäten oder Staff-Zuordnungen wurden dabei
gelöscht/neu zugeordnet. Alle Migrationen bleiben unverändert. Die bereitgestellte
Production-CLI-Ausgabe ersetzt vollständig die älteren Typen am kanonischen
Dateipfad; `Profile` und `ProfileExtensions` werden direkt daraus abgeleitet,
der bestehende Browserclient verwendet `SupabaseClient<Database>`.
Die CLI war zuletzt mit **Production** verbunden: niemals ungeprüft
`--linked` verwenden. `.env.local` und `.env.staging.local` bleiben unverändert.

### Registrierung, Bestätigungen und Freigabegrenze

Ein Formular mit einer Button-Umschaltung (kein unnötiges Tab-Widget):
Registrieren (`shouldCreateUser:true`) und Anmelden (`false`). E-Mail bleibt beim
Wechsel erhalten, CAPTCHA/Fehler/Checkboxen werden zurückgesetzt. Es gibt keinen
Account-Existenzcheck und keine Anzeige "neuer Account garantiert erstellt";
Supabase kann auch eine bestehende Adresse authentifizieren. Die rohe Auth-API
kann Unterschiede im Accountbestand offenlegen; die UI zeigt dafür nur generische
Fehler. Ein öffentliches Browser-Frontend kann diese Unterschiede der Provider-API
nicht vollständig verbergen.

Bei Registrierung sind zwei nicht vorausgewählte Checkboxen erforderlich:
Nutzungsbedingungen akzeptieren und Datenschutzerklärung zur Kenntnis nehmen.
Letzteres ist keine pauschale Einwilligung. Die aktuellen vorhandenen Seiten
`/nutzungsbedingungen/` und `/datenschutz/` werden auf ausdrücklichen Wunsch des
Betreibers **als vorläufig gültige Versionen für Entwicklung und Tests** verwendet.
Die Website ist noch nicht öffentlich gestartet. Keine Rechtstexte wurden umgeschrieben.

Dokument-IDs sind SHA-256 der vollständigen UTF-8-MDX-Quellen (LF statt CRLF,
kein BOM), ermittelt durch `legal-documents.ts`. Die Migration enthält genau
diese aktuellen Snapshots; der statische Test verifiziert die Übereinstimmung.
Es sind keine erfundenen Datums-/Freigabeversionen. Nach Änderungen der Texte
eine neue versionierte Migration zur kontrollierten Dokumentfreigabe erstellen;
angewendete Migrationen niemals ändern. Den jeweiligen Quelltext mit Git-Commit
und Inhalts-Hash dauerhaft zur Version zuordnen.

`mednerds_private.account_legal_releases` ist die serverseitige SSOT der aktuellen
Dokumente und der Gravatar-Aktivierung. Kein Browser darf die Releases ändern.
Die UI vergleicht den freigegebenen Hash mit dem im Build sichtbaren Dokument.
Bei fehlendem RPC/abweichender Version bleibt Registrierung aus technischen
Gründen deaktiviert, damit keine unzutreffenden Bestätigungen gespeichert werden;
Anmeldung bleibt verfügbar. Die aktuellen Dokumente sind technisch aktiv
(`is_current=true`). Es gibt keine zusätzliche rechtliche Freigabesperre oder
Verwaltungsoberfläche. Gravatar ist global verfügbar (`gravatar_enabled=true`),
erfordert aber zusätzlich die eigene gespeicherte freiwillige Aktivierung.

**Vor dem öffentlichen Launch offen:** Nutzungsbedingungen enthalten noch
Passwort-Hinweise und Konto-/Kontakt-Platzhalter; Datenschutz erwähnt Turnstile
als geplant, Konto-Löschung als verfügbar und Gravatar/neue Profilfelder noch
nicht konkret. Texte aktualisieren, inhaltlich/juristisch prüfen und verbindlich
freigeben, dann neue Snapshot-Versionen kontrolliert aktivieren. Die jetzige
Entwicklungs-/Testentscheidung ersetzt diese Prüfung nicht. Die technische
Migration auf das Projekt „MedNerds“ (Production) kann vor dem öffentlichen
Website-Launch nach dem unten dokumentierten Ablauf manuell freigegeben werden.

`account_legal_acceptances` speichert nur Auth-UUID, Terms-/Privacy-Versionen und
DB-Zeitstempel. Eigene Datensätze sind per RLS lesbar; direkte Inserts/Updates/
Deletes sind für Browser gesperrt. `record_account_legal_acceptance` ist ein
eng begrenztes SECURITY-DEFINER-RPC mit `search_path=''`: serverseitige Auth-UID,
bestätigte E-Mail, aktuelle kontrollierte Dokumentversionen und DB-Zeitstempel.
Es akzeptiert keine Nutzer-ID oder Datumsangabe. Wiederholung ist idempotent;
historische Bestätigungen bleiben unverändert und gelten nicht für neue Releases.
`get_account_legal_state` liefert nur öffentliche Releaseinformationen und den
eigenen Bestätigungsstatus, keine Account-/E-Mail-Daten.

Supabase kann einen Auth-User bereits beim Anfordern des Registrierungs-OTPs
anlegen. Zu diesem Zeitpunkt entsteht ein leeres Profil, aber noch kein
Bestätigungsnachweis. Erst nach erfolgreicher OTP-Verifikation erfolgt das RPC.
Fehler zeigen einen erneuten Versuch an, ohne Erfolg vorzutäuschen. Vorhandene
Accounts dürfen sich ohne Nachweis anmelden und separat bestätigen. Unverifizierte
Konten und `user_metadata` erzeugen keine gültigen Nachweise.

### Profile, Gravatar und spätere öffentliche Funktionen

Neue Felder: `professional_role` (optional, max. 80 Unicode-Codepoints),
`professional_role_public` (Default false) und `avatar_provider` (Enum,
Default initials). DB-/Clientvalidierung entfernen Rand-Whitespace, normalisieren
Berufs-Whitespace und lehnen Steuerzeichen ab. Ein leerer Beruf setzt auch seine
Sichtbarkeit auf false. Berufsangaben sind unbestätigt und vergeben keine Rollen.
Column-Grants erlauben nur diese neuen Felder zusätzlich zum Anzeigenamen.
ID, Zeitstempel und Staff bleiben geschützt. Der Profiltrigger aktualisiert
`updated_at` bei tatsächlichen Änderungen aller bearbeitbaren Felder.

Anzeigenamen bleiben in PostgreSQL nullable, damit Auth-Registrierung und alte
Accounts funktionieren. Fehlende Namen bekommen einen klaren Vervollständigungshinweis.
`hasPublicDisplayName` und der aktuelle DB-Bestätigungsstatus bilden die Grundlage
für zukünftige UI-Freigaben. **Kommentar-Schreibrechte müssen in Phase 3 zusätzlich
mit PostgreSQL/RLS einen gültigen Anzeigenamen und aktuelle Akzeptanz erzwingen.**
Phase 2.1 enthält keine öffentlichen Aktionen, Profile oder Löschfunktion.

Initialen werden lokal ausschließlich aus dem Anzeigenamen erstellt, niemals aus
der E-Mail. Gravatar verwendet die SHA-256 der getrimmten, kleingeschriebenen
authentifizierten E-Mail (`crypto.subtle`), HTTPS, `d=404`, Rating g und
`referrerpolicy=no-referrer`. Der Hash wird nicht in PostgreSQL gespeichert.
Kein Request vor dem Speichern der freiwilligen Präferenz, bei deaktivierter
Präferenz, Logout oder für fremde Profile. Fehler/fehlendes Bild zeigen Initialen
ohne Wiederholungsschleife. Keine Gravatar-Profil-API/Existenzprobe, keine Uploads.
Auch ein Hash ist nicht automatisch anonym. Für spätere öffentliche Avatare
eine eigene datenschutzfreundliche Architektur prüfen; weder E-Mail noch Hash
über öffentliche Profilabfragen offenlegen.

### Prüfungen: isolierte Tests und rein lesende Remote-Kontrolle

`tests/account_phase21.test.sql` und `tests/profiles_staff.test.sql` sind nur
für eine **wegwerfbare lokale PostgreSQL-Datenbank** vorgesehen. Sie erstellen
synthetische Auth-Nutzer, verändern Test-Staff/aktive Releases und teilweise
Trigger. Niemals im Production-SQL-Editor oder gegen ein verbundenes Remote-
Projekt ausführen, auch nicht mit `ROLLBACK`. Falls Docker verfügbar ist:
`npx --yes supabase@2.120.0 start`, `db push --local`, danach:

```sh
npx --yes supabase@2.120.0 test db supabase/tests/profiles_staff.test.sql supabase/tests/account_phase21.test.sql supabase/tests/account_deletion.test.sql --local
```

Testdateien explizit auswählen: `account_phase21_remote_checks.sql` ist kein
pgTAP-Test und gehört nicht in den automatischen Testlauf. Die CLI berücksichtigt
sonst auch andere `.sql`-Dateien im Testverzeichnis.
Keinen Remote-Reset verwenden. Ohne isolierte DB bleiben diese Tests offen;
Node-/Browser-Mocks ersetzen keine echten RLS-/Trigger-/Angriffstests.

`tests/account_phase21_remote_checks.sql` enthält ausschließlich lesende
Abfragen, keine Fixtures oder schreibenden RPC-Aufrufe. Der Betreiber kann sie
im privilegierten SQL Editor des **ausdrücklich kontrollierten Projekts** nutzen:

- Abschnitt 1 vor und nach Migration speichern/vergleichen: aggregierte Nutzer-,
  Profil-/Staff-/Adminzahlen und verwaiste/fehlende Profile. Währenddessen möglichst
  keine parallelen Registrierungen/Profiländerungen. Keine personenbezogenen Inhalte.
- Nach Migration Abschnitte 2–8 prüfen: Tabellen/RLS, Spalten/Defaults, eigene
  Policies, effektive Tabellen-/Spaltenrechte, privates Schema, RPC-/Triggerrechte,
  Constraints/Index und genau eine aktive, passende Dokumentversion.
- `rights_match`, Funktions-/Hash-Prüfungen müssen true sein; Defaults und Policy-
  Bedingungen mit der Migration vergleichen. Fehlende Objekte/unerwartete Grants
  untersuchen, nicht durch zusätzliche Rechte „reparieren“.

Gleiche Summen beweisen keine unveränderten einzelnen Anzeigenamen/Staff-
Zuordnungen. Bestehendes Profil und Adminaccount zusätzlich manuell überprüfen.
Reine Struktur-/Aggregatprüfungen ersetzen **keinen vollständigen RLS-Angriffstest**.

### Historische Phase-2.1-Production-Schritte – nur als Referenz

Dieser Phase-2.1-Ablauf wurde laut Betreiber bereits durchgeführt; die Migration
nicht erneut anwenden. Die Befehle bleiben als Referenz für spätere kontrollierte
Änderungen und erneute Typgenerierung erhalten.
Die unten genannte einzelne ausstehende Migration beschreibt ausschließlich den
damaligen Rollout. Bei späteren Änderungen alle tatsächlich ausstehenden Versionen
prüfen, statt diese historische Erwartung zu übernehmen.

Staging (`mednerds-staging`) ist optional; für besonders kritische Änderungen
weiterhin empfohlen. Kleine geprüfte Änderungen dürfen nach Betreiberentscheidung
direkt auf „MedNerds“ (Production) angewendet werden. Die CLI war zuletzt mit
Production verbunden: kein ungeprüftes `--linked`. Für jeden Befehl die Project Ref
explizit einsetzen. Die folgenden Remote-Befehle sind **Anweisungen für den Betreiber**,
keine vom Agenten ausgeführten Aktionen.

1. Diff der neuen Migration und tatsächliche Dokument-Hashes prüfen. Alte Migrationen
   bleiben unverändert. Backup-/Recovery-Stand und Project Ref im Dashboard prüfen.
   Abschnitt 1 der rein lesenden Remote-Prüfungen als Baseline speichern.
2. Migrationshistorie mit `npx --yes supabase@2.120.0 migration list --project-ref <PRODUCTION_PROJECT_REF>`
   kontrollieren. Die zwei Phase-2-Migrationen müssen bereits angewendet sein.
3. **Verpflichtender Dry-Run:**
   `npx --yes supabase@2.120.0 db push --project-ref <PRODUCTION_PROJECT_REF> --dry-run --skip-vault`.
   Erwartet: ausschließlich `20261010000000_account_profile_extensions.sql`.
   Bei Abweichung stoppen und klären. Der Dry-Run listet geplante Migrationen;
   er führt das SQL und keine RLS-/Trigger-Tests aus.
4. **Erst nach ausdrücklicher Freigabe des geprüften Dry-Runs** selbst ausführen:
   `npx --yes supabase@2.120.0 db push --project-ref <PRODUCTION_PROJECT_REF> --skip-vault`.
   Kein Reset, keine schreibenden Fixtures, keine Änderung bestehender Adminrollen.
5. Rein lesende Remote-Prüfungen ausführen, Baseline vergleichen und die unten
   beschriebenen manuellen Funktionstests durchführen. Bei Fehlern Ursache prüfen;
   keine angewendete Migration nachträglich bearbeiten.
6. Offizielle Typen aus dem **migrierten Production-Projekt** erzeugen
   (`--project-id` vermeidet falsches Linking):

```powershell
$accountDbTypes = npx --yes supabase@2.120.0 gen types --project-id <PRODUCTION_PROJECT_REF> --lang typescript --schema public
if ($LASTEXITCODE -ne 0) { throw 'Typgenerierung fehlgeschlagen.' }
$accountDbTypes | Set-Content -LiteralPath src/lib/auth/database.types.ts -Encoding utf8
```

7. Die generierten Typen sind jetzt integriert: `database.types.ts` ist die einzige
   Schemaquelle, die temporäre Erweiterung und Importdatei sind entfernt.
   Projektspezifische Profil-/Staff-/Enum-Aliase leiten sich daraus ab; keine
   manuelle Schema-Erweiterung oder Schema-Casts verwenden. Der vorhandene
   Runtime-Fallback für ältere Backends bleibt unverändert, ebenso JSON-Validierung
   der RPC-Antworten. Das sind keine parallelen Datenbanktypdefinitionen.
8. Astro-Check, Build, Auth-/Profiltests, `test-account-phase21.mjs` und den
   Mock-Browsertest erneut ausführen. Die sichere Konto-Löschung ist separat
   vorbereitet, siehe Phase 2.2 unten.

### Manuelle Funktionstests nach Migration

- Neue Registrierung: beide Checkboxen/Links, Turnstile, sechsstelliger OTP,
  Countdown/Resend und echter Erstversand. Nach Verifikation muss der serverseitige
  Nachweis vorliegen; ein Bestätigungsfehler darf keinen Erfolg vortäuschen und
  muss wiederholbar sein. Keine Test-Fixtures dafür auf Production einspielen.
- Bestehendes Konto und bestehender Admin: Anmeldung ohne künstliche Sperre,
  eigene Bestätigung bei Bedarf, bestehender Name und Staff-/Adminstatus bleiben
  erhalten. Keine Rollen im Rahmen dieser Prüfung neu vergeben.
- Profil: Anzeigename, freiwilliger Beruf/Sichtbarkeit, Speicherung und Reload;
  andere Konten/geschützte Felder bleiben durch RLS/Grants gesperrt.
- Gravatar: vor Opt-in kein Request; erst nach erfolgreichem Speichern laden;
  fehlendes Bild zeigt Initialen; Deaktivieren und Logout unterbinden weitere
  Requests. Kein privater Schlüssel im Browser.
- Session: Reload/neuer Tab, Token-Refresh und Logout. Mobile, Dark/Light Mode,
  Tastaturbedienung und zugängliche Status-/Fehlermeldungen kontrollieren.

Offiziell geprüft: [Supabase OTP](https://supabase.com/docs/reference/javascript/auth-signinwithotp),
[Gravatar-Avatare](https://docs.gravatar.com/sdk/images/),
[Gravatar-Hashing](https://docs.gravatar.com/rest/api-data-specifications/).

## Phase 2.2 – historischer Vorbereitungsstand der Account-Löschung

Die folgenden Aktivierungsangaben dokumentieren den damaligen lokalen Stand;
sie bestätigen keinen aktuellen Remote-Deployment- oder Secret-Status.

Dedizierte Edge Function, neue private Einmal-Intents und letzter-Admin-Guard:
[Architektur, Secrets, manuelle Staging-Bereitstellung und offene Tests](functions/delete-account/README.md).
Keine ältere Migration verändert, keine Remote-Anwendung/Accountlöschung durch
den Agenten. Die Function bleibt ohne explizite serverseitige Aktivierung gesperrt.

## MedDocs-Kommentare – aktueller Ablauf und historischer Initial-Rollout

Das Kommentarbackend wird laut Betreiber bereits auf Production verwendet.
Für vollständige Manifeste und automatische Kommentaraktivierung gilt die
[aktuelle Betriebsanleitung](../docs/architecture/meddocs-comments-automatic-sync.md).
Lokal sind am 24. Oktober 2026 sechs veröffentlichte Fachartikel im Manifest und
acht Migrationen vorhanden. Die Index-Folgemigration `20261024000000` ist laut
Betreiber noch nicht remote registriert, obwohl der Index bereits korrekt besteht.
Der aktuelle Remote-Stand wurde hier nicht erneut geprüft.

### Historische Phase-3B-Referenz

Die folgenden Aussagen zu leerem Katalog, Teilimporten, deaktivierten Kommentaren
und noch ausstehenden Tests beschreiben den Initial-Rollout. Sie sind keine
aktuelle Betriebs- oder Freigabeanleitung; spätere Migrationen ändern dieses Verhalten.

Für das ausdrücklich isolierte Cloud-Projekt `mednerds-security-tests`
(`wpdfduxzqqlizuhkhebb`) gibt es einen separaten, noch nicht ausgeführten
[abgesicherten pgTAP-Operatorablauf](tests/README-meddocs-cloud.md).
Er verwendet die unveränderte lokale Suite in einer einzigen Testtransaktion,
prüft ein festes Ziel und alle Voraussetzungen, wertet TAP zusätzlich zum
SQL-Exitcode aus und rollt die Fixtures vollständig zurück. Production/Staging
und der bestehende localhost-only-Parallelrunner bleiben ausgeschlossen.

Neue additive Migration `20261011000000_meddocs_comments.sql`: fünf private Tabellen,
Default-deny RLS, schmale RPCs, Moderation/Revisionen/Quota und transaktionaler
Auth-DELETE-Cleanup. Kein Remote-Aufruf, keine Aktivierung; der Katalog ist leer,
neue Einträge erlauben standardmäßig keine Beiträge.
`tests/meddocs_comments.test.sql` mit synthetischen Nutzern nur isoliert ausführen;
`tests/meddocs_comments_remote_checks.sql` enthält ausschließlich lesende Prüfungen.
Mocks ersetzen keine SQL-/Parallelitäts-/Auth-Service-Tests.
Vor Staging: `npm run build`, dann
`node --experimental-strip-types scripts/prepare-meddocs-comments-sync.mjs --out=.astro/meddocs-comments-sync.sql`.
Der lokale Abgleich validiert das vollständige Manifest gegen das Repository;
der privilegierte Server-Upsert lässt ausgelassene Artikel unverändert und
aktiviert keine Kommentare. Einen einzelnen echten Testartikel ausschließlich
durch reviewte Betreiberaktion aktivieren. Alle ausstehenden Migrationen einschließlich
gegebenenfalls Phase 2.1 prüfen. Die erweiterten Remote-Checks bleiben read-only
und geben Soll/Ist/`ok` aus; der Anfangscheck „alles deaktiviert“ gilt vor Aktivierung.
`scripts/test-meddocs-comments-concurrency.mjs` ist ausschließlich für eine leere,
vollständig migrierte lokale `mednerds_comments_test_*`-Datenbank vorbereitet;
synthetische Fixtures niemals auf gehostetem Staging oder Production ausführen.
[Migration, Typen, Datenschutz, tatsächliche Testgrenzen und Staging-/Production-Rollout](../docs/architecture/meddocs-comments-phase3b.md).
