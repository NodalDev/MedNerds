# MedDocs-Kommentare – Phase 3B

Historischer Implementierungs- und Teststand dieser Phase. Aussagen zu noch nicht
ausgeführten Remote-Schritten bestätigen keinen aktuellen Production-Status.

Aktueller Folgeablauf: [Automatische Kommentare und Production-Synchronisierung](meddocs-comments-automatic-sync.md).
Die folgenden Opt-in-/Default-disabled-/Teilimport-Angaben beschreiben den ursprünglichen
Phase-3B-Stand; nach der Folgemigration gelten vollständige Manifeste und automatische Aktivierung.

Separat vorbereitet, noch nicht ausgeführt:
[pgTAP-Operatorablauf für das isolierte Cloud-Sicherheitstestprojekt](../../supabase/tests/README-meddocs-cloud.md).
Diese konkrete Projekt-Ausnahme erlaubt transaktionale synthetische Fixtures
ausschließlich auf `mednerds-security-tests` (`wpdfduxzqqlizuhkhebb`), nicht auf
Production oder Staging. Die lokalen Schutzmechanismen bleiben unverändert.

## Nachbesserungen vor Staging – 11. Oktober 2026

Nur die noch nicht angewendete Phase-3B-Migration wurde korrigiert. Frühere
Migrationen, Auth-/Account-Löschprozess, Frontend-Verhalten und Dependencies bleiben
gegenüber dem Ausgangsstand dieses Tasks unverändert.

- Alle fünf neuen Tabellen gehören ausdrücklich `postgres`, passend zu den
  Definer-RPCs; keine zusätzlichen Browser- oder service_role-Tabellenrechte.
  `comments_enabled` darf nur für `published` wahr sein.
- Katalogsync prüft JSON-Typen, Pflichtfelder, erlaubte UUIDs/Pfade/Autoren-Slugs,
  doppelte UUIDs/Pfade und verbietet Aktivierung über das Manifest. Ein fehlerhafter
  späterer Eintrag rollt den gesamten Aufruf zurück. Weggelassene IDs bleiben erhalten.
- Moderation authentifiziert zunächst ohne Staff-Zeilensperre. Die Sperre auf den
  Beitragsautor kommt vor der abschließenden gesperrten Admin-/Profil-/Legal-Prüfung.
  Dadurch entfällt der konkrete Zyklus: Staff-Zeilensperre des Moderators →
  Rollenänderung wartet auf diese Zeile → Auth-Löschung hält Autor und wartet auf
  Staff-Tabellensperre → Moderator wartet auf Autor. Die erste Rollenprüfung ist
  ausdrücklich keine abschließende Autorisierung.
- Auth-Bereinigung sperrt eigene Hauptbeiträge vor eigenen Antworten. Damit folgt
  dieser Pfad der Root-vor-Reply-Reihenfolge der Kommentar-RPCs statt UUID-only.
  Der vorhandene letzte-Admin-Trigger bleibt unverändert und läuft alphabetisch
  davor. `SHARE ROW EXCLUSIVE` blockiert parallele Staff-Schreibtransaktionen und
  weitere solche Guards; gewöhnliche Staff-Leseabfragen bleiben möglich.
- Dies ist keine Garantie allgemeiner Deadlock-Freiheit. Externe Rollenänderungen,
  mehrere Auth-Ziele und komplexe Moderator-/Löschfolgen bleiben echte
  Integrationstestfälle. Sperrfehler müssen den gesamten Vorgang zurückrollen.
  Eine vorherige Moderator-Authentifizierung hält bereits die eigene Auth-Zeile;
  die spätere sortierte Zielabfrage garantiert daher keine globale UUID-Sperrordnung.
  Getrennte Edge-RPCs und Auth Admin API werden dadurch nicht zu einer Transaktion.

Sperr- und Triggerregeln:
[PostgreSQL 17 Locks](https://www.postgresql.org/docs/17/explicit-locking.html),
[Trigger-Reihenfolge](https://www.postgresql.org/docs/17/sql-createtrigger.html).

### Reproduzierbare lokale Manifest-Vorbereitung

```powershell
npm run build
node --experimental-strip-types scripts/prepare-meddocs-comments-sync.mjs --out=.astro/meddocs-comments-sync.sql
```

Der zweite Befehl vergleicht das Build-Manifest mit den aktuellen Frontmatter-Daten
und der bestehenden Metadatenvalidierung. IDs, Pfade, Autoren, Status und Anzahl
müssen übereinstimmen; stale/teilweise Eingaben und Aktivierungsversuche werden
abgewiesen. Keine neuen UUIDs, keine Verbindung, keine Zugangsdaten. Die SQL-Ausgabe
liegt unter dem bereits ignorierten `.astro/`, wird nicht öffentlich ausgeliefert
und überschreibt keine vorhandene Datei. Bei erneuter Vorbereitung einen neuen
`--out`-Dateinamen wählen. Output enthält `BEGIN` und Sync, absichtlich keinen
automatischen Commit: Betreiber kontrolliert Rückgabewert und Katalog vor Abschluss.
Die lokale Prüfung verlangt das vollständige aktuelle Repository-Manifest; der
Server toleriert dennoch sichere Teilimporte ohne andere Artikel zu deaktivieren.

### Genauer späterer Staging-Ablauf

1. Isolierte Supabase-kompatible Datenbank samt allen Migrationen, pgTAP und echten
   Paralleltests bereitstellen. Read-only Strukturprüfungen ebenfalls dort testen.
   Synthetische Fixtures niemals im gehosteten Staging oder Production verwenden.
2. Tatsächlich verbundenes Staging-Projekt und komplette ausstehende
   Migrationshistorie prüfen, einschließlich möglicherweise fehlender Phase 2.1
   und Phase 2.2. Keine bereits angewendete Datei nachträglich ändern.
3. Migrationen nach separater Freigabe auf Staging anwenden. Noch keine Kommentare
   freigeben. `supabase/tests/meddocs_comments_remote_checks.sql` lesend prüfen:
   Soll, Ist, `ok` für fünf Tabellen, RLS, Tabellen-/Spaltenrechte, alle 31
   Funktionen, Owner/Definer/search_path/EXECUTE sowie beide Auth-Trigger.
4. Lokales Manifest vorbereiten, den gesamten UUID-/Pfad-/Status-Diff reviewen und
   SQL ausschließlich privilegiert im bestätigten Staging-Projekt ausführen.
   Aktuell sind fünf persistente Repository-UUIDs enthalten. Rückgabe 5 und jeden
   Katalogeintrag prüfen, dann bewusst Commit oder Rollback. Betreiber-Editor mit
   passenden PostgreSQL-Rechten oder serverseitiger service_role-RPC, kein Browserkey.
5. **Genau einen** realen Testartikel aktivieren: physikalische Grundlagen mit
   UUID `bbbcdd36-40d7-4668-bd20-35c8064848d6`. Vorher den aktuellen Repository-Pfad
   erneut verifizieren. Folgendes ist eine Review-Vorlage, keine ausgeführte Aktion:

```sql
begin;
select id, canonical_path, state, comments_enabled
from mednerds_private.meddocs_articles
where id='bbbcdd36-40d7-4668-bd20-35c8064848d6';

update mednerds_private.meddocs_articles
set comments_enabled=true, updated_at=clock_timestamp()
where id='bbbcdd36-40d7-4668-bd20-35c8064848d6'
  and canonical_path='/meddocs/echokardiographie/grundlagen-technik/physikalische-grundlagen/'
  and state='published'
returning id, canonical_path, state, comments_enabled;
-- Genau eine passende Zeile prüfen, dann explizit COMMIT oder ROLLBACK.
```

Nur privilegierte Betreiber erhalten direkte Katalogrechte; auch ein eingeloggter
Frontend-Admin erhält dadurch keinen Aktivierungs-RPC. Der read-only Anfangscheck
„keine aktivierten Artikel“ wird nach dieser bewussten Freigabe erwartungsgemäß
falsch; übrige Rechte-/Strukturchecks müssen weiterhin wahr sein.

6. Separat registrierte echte Staging-Testaccounts prüfen: Nutzer/Autor/Admin,
   aktuelles Legal, Profil ohne Namen, widerrufene Session, Moderation/private
   Revisionen, echte Auth-Service-Löschtransaktion und erhaltene fremde Antworten.
   Keine existierenden Production-Accounts oder synthetischen SQL-Auth-Fixtures.
7. Weitere Artikel erst nach erfolgreichem Test und eigener Freigabe aktivieren.
   Typgenerierung und manueller Accessibility-/Datenschutzreview folgen dem
   vorhandenen Rollout. Unpublish/Archivierung müssen bewusst erfolgen:

```sql
-- Nur als einzeln reviewte Betreiberaktionen, UUID vorher bestimmen:
-- UPDATE mednerds_private.meddocs_articles
-- SET state='unpublished', comments_enabled=false, updated_at=clock_timestamp()
-- WHERE id='<geprüfte Artikel-UUID>';
-- state='archived' plus comments_enabled=false bewahrt öffentliches Lesen.
```

### Isolierte Tests und verbleibende Testgrenzen

`meddocs_comments.test.sql` ergänzt Cursor/Timestamp-Ties für Hauptbeiträge und
Antworten, idempotente Requests, private fremde Revisionen, Katalogrechte,
Default-disabled, leere/teilweise Manifeste, bewusstes Unpublish/Archive und atomaren
Batch-Rollback. Bestehende Lösch-/Last-Admin-/Profil-/Legal-Tests bleiben erhalten.

Für echte Parallelität ist `scripts/test-meddocs-comments-concurrency.mjs` vorbereitet:

```powershell
node scripts/test-meddocs-comments-concurrency.mjs --confirm-disposable --database=mednerds_comments_test_phase3b --port=54322
```

Voraussetzung: ausdrücklich separat angelegte **leere**, vollständig migrierte
Supabase-kompatible lokale Testdatenbank dieses Namens. Der Runner erzeugt
committete Fixtures; die Testdatenbank danach als Ganzes separat entsorgen.
Er setzt Host unveränderlich auf 127.0.0.1, verlangt den Testnamen und Bestätigung,
lädt keine .env/linked-Projekte und verweigert eine Datenbank mit Auth-Nutzern oder
Katalogeinträgen. Optional `--psql=lokaler-Pfad`; vorhandenes lokales psql verwenden.
Drei physische Verbindungen, Prüfung von `pg_stat_activity`/`pg_blocking_pids`:
identische parallele Erstellung (ein Kommentar/eine Quota), Moderation vor
Löschung, Löschung vor Moderation, erhaltene fremde Antwort, kein Wiederaufleben
privater Texte und zwei parallele Admin-Löschungen mit verbleibendem Admin.
Blockierung muss tatsächlich beobachtet werden; sequenzielle Mocks zählen nicht.

**Hier nicht ausgeführt:** pgTAP, echte Paralleltests, Remote-Strukturchecks und
Auth-Service-Integration. Docker CLI ist vorhanden, die lokale Docker-Engine
läuft nicht (Pipe fehlt); der PostgreSQL-17-Installation fehlt `postgres.bki`.
Der Parallelrunner wurde nur syntaktisch und gegen unsichere Aufrufparameter
geprüft. Er sowie die SQL-Fixtures brauchen ihre erste Ausführung in der geeigneten
Umgebung; kein bestandener SQL-/RLS-/Deadlock-Test wird behauptet.

Lokaler Prüfstand nach diesen Nachbesserungen: **108** Auth-/Profil-/Legal-/Lösch-/
Kommentar-/Quellen-Unit-Tests und **35** Artikel-Metadatenprüfungen bestanden;
Kommentar- und Account-Browserregressionen mit vollständig gemockten externen
Diensten bestanden. Strikte Kommentar-TypeScript-Prüfung, Astro Check (0 Fehler,
0 Warnungen; zwei bereits bestehende Hinweise), Build und `git diff --check`
bestanden. SHA-256-Vergleich gegen den Task-Ausgangsstand: nur die neun zugehörigen
Migrations-/Test-/Manifest-/Dokumentationsdateien verändert bzw. ergänzt;
sämtliche bisherigen Migrationen, Auth-/UI-Dateien, Dependencies und `.env`-Dateien
unverändert. Keine Remote-Verbindung oder Account-Löschung.


Stand: 11. Oktober 2026. **Lokal implementiert, nicht remote migriert, deployed oder aktiviert.**
Bestehende Migrationen, generierte Production-Typen und `.env`-Dateien bleiben
unverändert. Die unten beschriebenen Remote-Schritte benötigen separate Freigaben.

## Architektur und Produktentscheidungen

Grundlage: [Phase 3A](meddocs-comments-phase3.md), mit bestätigten Abweichungen:
keine öffentliche Revisionshistorie, Gäste, Reaktionen oder Realtime. Nutzer und
Autoren werden vorab moderiert. Nur neue eigene Admin-Beiträge dürfen sofort
veröffentlicht werden; **auch Admin-Bearbeitungen** werden neue Pending-Revisionen.
Die freigegebene Fassung bleibt bis zur atomaren Freigabe sichtbar. Autoren
besitzen keine Moderationsrechte. Private Historie und Moderation sind Admin-only.

Die statische Astro-Hülle steht nach „Über diesen Artikel“. Nur ausgewählte normale
Artikel erhalten `MedDocsComments.astro`; die eigentliche Implementierung lädt
nahe dem Kommentarbereich oder nach „Kommentare laden“. Artikel/SEO bleiben
statisch, kein Build-UGC-Aufruf, `data-pagefind-ignore`. Clientkommentare sind kein
zuverlässig suchmaschinenindexiertes Archiv. Keine neue Dependency/React-Island.

`comments-element.ts`/`moderation-element.ts` nutzen den **einen vorhandenen**
Supabase-Browserclient. `CommentsAccountContext` subscribiert den vorhandenen
AuthStore und verwendet bestehende ProfileStore-/LegalStore-Implementierungen;
keine Tokenkopie, zweite Anmeldung oder zweites Profilsystem. Öffentliche und
private Ergebnisse sind getrennt. Logout/Sessionwechsel leeren Formulare und
private Listen, brechen Requests ab und verwerfen verspätete Antworten.

Frontend-Gates verwenden `account-access.ts`: Auth, gespeichert vollständiges
eigenes Profil und aktuelle Rechtsbestätigung bleiben getrennt. Formulareingaben
genügen nicht. Onboarding-Rückwege sind intern und verwenden die gültige Session.
Die serverseitige Prüfung bleibt Sicherheitsgrenze. Künftige personalisierte
E-Learning-Funktionen brauchen **eigene Backend-/RLS-Autorisierung**; der UI-Gate
allein berechtigt nicht zum Speichern von Lernständen.

## Dauerhafte Artikelkennung und Katalog

```yaml
articleId: bbbcdd36-40d7-4668-bd20-35c8064848d6
comments: true
```

Einmal gespeicherte UUIDs ändern sich nicht beim Build oder einer Umbenennung.
Kopierte eigenständige Artikel benötigen eine neue UUID. Erste Auswahl: Target-
controlled Infusion und Einführung, Nomenklatur, physikalische und praktische
Grundlagen der Echokardiographie. Nur Frontmatter ergänzt, medizinische Texte
unverändert. Fehlendes `comments` bedeutet aus; optionales Schemafeld erhält die
bisherigen Legacy-Parser-Ausgaben. Hubs/Indizes/Splash/fehlende Metadaten sind keine
Kommentarartikel, Drafts werden öffentlich ausgeschlossen.

Der bestehende Starlight-Loader bleibt Routing-/Content-ID-SSOT. Der kleine Wrapper
validiert alle dauerhaften UUIDs einschließlich Drafts beim Content-Sync/Build;
fehlende/ungültige Opt-in-IDs und Duplikate brechen ab. Das lokale Manifest
`.astro/meddocs-comments-manifest.json` enthält nur UUID, Locale, Pfad, Autoren-IDs,
Publikationsstatus und `comments_enabled:false`, keine Artikeltexte. Es steht
weder in Git noch in der öffentlichen Website. Dev-Watcher-Änderungen werden
spätestens beim nächsten vollständigen Sync/Build geprüft.

Der privilegierte Manifest-Import ist ein **separater Betreiberprozess** und ein
Upsert ausschließlich der gelieferten UUIDs. Leere/teilweise Manifeste ändern
ausgelassene Artikel nicht. Neue Einträge bleiben gesperrt; `comments_enabled:true`
im Manifest ist ungültig. Umbenennungen ändern nur den Pfad; bestehende
Redirect-Konvention nutzen. Ein explizit gelieferter Draft/Opt-out-Eintrag setzt
`unpublished`: keine öffentliche Abfrage, keine neue Diskussion. Vollständig aus
dem Repository entfernte Artikel brauchen eine bewusste Betreiber-Deaktivierung,
weil Weglassen kein Löschsignal ist. `archived` bleibt lesbar, Schreiben gesperrt.
Reimport reaktiviert archivierte/gesperrte Einträge nicht automatisch.
Eigene private Daten und Rückzug bleiben zugänglich. Fehlender Katalogeintrag
meldet Nichtverfügbarkeit, ohne den Artikel zu beeinträchtigen.

## Datenmodell und Funktionen

Additive Migration: `20261011000000_meddocs_comments.sql`. Genau fünf private Tabellen:

| Tabelle | Aufgabe |
| --- | --- |
| `meddocs_articles` | Dauerhafte Zuordnung, Publikationsstatus, standardmäßig gesperrtes Schreiben |
| `meddocs_comments` | Eigentümer/Threadstruktur, ursprüngliches Datum, Version, freigegebener Zeiger |
| `meddocs_comment_revisions` | Unveränderliche Fassungen und Pending/Approved/Rejected/Superseded |
| `meddocs_comment_moderation_events` | Private Entscheidungen, DB-Zeit, Moderator-ID, kontrollierte Grundcodes |
| `meddocs_comment_limits` | Eine gesperrte Kontingentzeile pro Account |

Composite-FKs verhindern fremde Artikel-/Revisionszuordnungen. Technisch flache
Threads: Root plus Antworten; Antwort auf Antwort behält `reply_to_id`, Parent
bleibt Root. Trigger verhindern Zyklen, Strukturänderungen und unzulässige Zeiger.
Deferred Constraint-/Strukturtrigger sind ebenfalls sichere Definer, damit
Prüfungen nach Auth-DELETE unter Auth-Service-Rechten funktionieren können.

| RPC | Zugriff |
| --- | --- |
| `meddocs_comments_list`, `meddocs_comment_replies` | Anon/authenticated: freigegebene Fassungen/zulässige Platzhalter |
| `meddocs_comments_mine` | Eigenes aktives Konto, unabhängig von Name/Legal/Artikelpublikation |
| `meddocs_comment_create`, `meddocs_comment_edit` | Vollständiger bestätigter Account, aktuelles Legal, aktiver Artikel, Quota |
| `meddocs_comment_withdraw` | Eigentum/aktive Session, **kein** Name-/Legal-Gate |
| `meddocs_comment_queue`, `meddocs_comment_audit` | Aktueller Admin: private Queue/Vergleich/paginierte Historie |
| `meddocs_comment_decide` | Vollständiger Admin, konkrete Pending-Revision, erwartete Kommentarversion |
| `meddocs_comment_visibility` | Admin Hide/Restore; kein Wiederveröffentlichen redigierter aktueller Fassungen |
| `meddocs_comment_redact` | Admin entfernt gezielt Revisionstext, aktueller Stand wird dabei ausgeblendet |
| `meddocs_articles_sync` | service_role-only Katalogimport, nicht vom Build/Browser aufgerufen |
| `meddocs_comments_retention` | service_role-only manuelle Retention-Bereinigung |

Maximal eine Pending-Revision. Edit ersetzt offene Fassung mit `superseded`, ohne
die Approved-Publikation anzutasten. Freigabe wechselt Status/Zeiger/Audit atomar;
`created_at` bleibt, `edited_at` entsteht erst bei freigegebener Änderung. Ablehnung
erhält die alte Publikation. Konkrete Revision plus `expected_version` schützt
gegen ersetzte Fassungen/verlorene Updates. Gleiches Create/Edit-Request-ID + Text
ist idempotent, anderer Text unter gleicher ID konfligiert. Kein automatischer
Write-Retry; Formular bleibt bei Fehler erhalten. Fehler nach bestätigter Speicherung
beim Refresh behaupten nicht, dass die Speicherung rückgängig gemacht wurde.

## Sicherheit, Limits und Parallelität

Alle fünf Tabellen: RLS, keine Browser-Policies/Grants; privates Schema nicht
exponiert. Public-Execute wird entzogen und gezielt für RPCs vergeben. Private
Helpers sind auch für service_role nicht direkt ausführbar. Keine freien Views,
Relations-Exports, neuen Browser-Secrets oder Service-Keys im Frontend.
Definer verwenden `search_path=''`, qualifizierte Objekte und feste Abfragen.

**Begründete Owner-Abweichung von 3A:** Wie bestehende Legal-RPCs verwenden die
neuen Funktionen ausdrücklich `postgres`. Eine neue NOLOGIN-Rolle würde zusätzliche
Policies/Rechte auf bestehenden Auth-/Profil-/Legal-Tabellen benötigen; diese
bleiben unverändert. Der breite Owner verlangt ein RPC-/Rechte-Review. RLS allein
schützt nicht vor falschen Definer-Projektionen.

Writes prüfen den bestätigten, nicht anonymen Auth-Account anhand `auth.uid()` und
die zum verifizierten JWT passende noch vorhandene Session inklusive `not_after`.
Eigener gespeicherter gültiger Name und aktuelles Legal werden gesperrt geprüft;
Staff-Rolle stammt nur aus `staff_accounts`. Freigabe prüft auch den weiterhin
vorhandenen bestätigten Beitragsautor, dessen aktuelles Profil/Legal und Artikel/
Rootstatus. Eine bloße Auth-Account-Existenz oder Client-Checkbox reicht nicht.

Gates, Kontingent und Root/Ziel werden transaktional gesperrt. Limits: **3** akzeptierte
Create/Edit pro 60-Sekunden-Fenster, **20** pro UTC-Tag, auch für Staff. Erfolgreicher
Idempotenz-Retry kostet kein zweites Kontingent, Rückzug setzt Quota nicht zurück.
Text 1–4.000 Unicode-Codepoints/16 KiB, keine gefährlichen Steuer-/Bidi-Zeichen.
Pages standardmäßig 10, maximal 20, Keyset `(created_at,id)`, passende Indizes.
UI und SQL verwenden **Chronologisch / Älteste Beiträge zuerst** für Hauptbeiträge
und Antworten. UUID ist der Tie-Breaker bei gleichen Zeitstempeln; der nächste
Cursor ist exklusiv (`>`). Es gibt keinen „Neueste“-Modus. Nachladen dedupliziert
nach Kommentar-ID, ohne eine offene private Fassung öffentlich zu projizieren.
Keine Realtime-/Refresh-Timer. Allgemeiner HTTP-/DDoS-Schutz bleibt Anbieteraufgabe.

Echte Parallelität kann Deadlocks verursachen, insbesondere Auth-DELETE/Rollen-
änderungen gegen Moderation. PostgreSQL rollt den betroffenen Vorgang zurück;
Deadlock/Serialization/Lock-Timeout erscheinen als Konflikt mit Refresh-Hinweis.
Mocks beweisen keine DB-Rechte oder Lockpfade. Referenzen:
[PostgreSQL-Locks](https://www.postgresql.org/docs/17/explicit-locking.html),
[Supabase-Funktionen](https://supabase.com/docs/guides/database/functions).

## Darstellung, Identität und Moderation

Public-Daten: strukturelle Artikel-/Kommentar-IDs, freigegebener Text, Zeiten,
gespeicherter gültiger Name, aktuelle Staff-Rolle/-Slug und nur explizit öffentliche
Berufsangabe. **Keine** Auth-UUID, E-Mail, Session, Acceptance, Moderator-ID, Gründe,
Gravatar-Hashes oder private Fassungen. Runtime-Parser verwenden Allowlist-DTOs.
„Administrator“ als Name/Beruf begründet keine Rolle. `getStaffAuthor` löst die
bekannte Registry auf; unbekannter Slug bekommt lediglich „MedNerds-Team“.

Öffentliche Avatare nutzen nur Initialen/neutrale Zeichen; das eigene Account-
Gravatar-Opt-in bleibt unverändert. Es autorisiert kein Besuchertracking. Beruf
ist als nicht überprüfte Selbstangabe markiert. Zurückgezogene Beiträge projizieren
keinen Namen/Staff/Beruf. Content wird nur als Textknoten gerendert, kein HTML/
Markdown oder automatische externe Links. Labels, Live-Status, Zeiten, Fokus und
native Bestätigungsdialoge sind tastaturbedienbar; keine laufende Animation.

`/account/moderation/`: `noindex,nofollow`, Pagefind-ausgeschlossen, nur für geladene
Admin-Rollen sichtbar. Der Accountlink erscheint in vollständiger Admin-Verwaltung.
Jeder private RPC autorisiert weiterhin unabhängig. Queue-Modi Pending/Published/
Hidden, alter/neuer Text, Grundauswahl, Bestätigung vor Entscheidungen, paginierte
Revisionen/Audit sowie gezielte irreversible Textredaktion sind implementiert.

## Rückzug und tatsächliche Account-Löschung

Gemeinsamer privater `comment_scrub`: eigene Revisionen/Texte und zugehörige
Ereignisse entfernen. Nie veröffentlichte Beiträge ohne Nachkommen löschen;
veröffentlichte bleiben textlose strukturelle Platzhalter, fremde Antworten bleiben.
Beim Rückzug kann die interne Eigentümerreferenz für Datenrechte bestehen bleiben,
öffentlich wird sie nicht projiziert. Quota wird nicht gelöscht/zurückgesetzt.

`mednerds_z_scrub_meddocs_comments` läuft **BEFORE DELETE auth.users in derselben
Transaktion** wie Auth-Hard-Deletion. Bestehender `mednerds_protect_last_admin`
sortiert davor und bleibt unverändert. Jeder Fehler rollt alles zurück; keine
nachgelagerte Cleanup-API, kein zweiter Löschprozess. Auth-FKs: SET NULL/CASCADE,
keine neue RESTRICT-Blockade. Autor- und Moderatorbezüge werden entfernt, Profile/
Staff/Legal/Quota folgen den FK-Cascades. Frischer OTP/Einmal-Intent bleiben erhalten.

Die [offizielle Auth-Implementierung](https://github.com/supabase/auth/blob/master/internal/api/admin.go)
führt Hard-Deletion transaktional aus. Tatsächliche Auth-Version, Service-Rollen und
Trigger müssen trotzdem real getestet werden. Phase-2.2-Restgrenzen zwischen finalem
RPC und getrenntem Admin-DELETE sowie fehlende kryptografische OTP-Challenge-Bindung
werden durch Kommentare nicht behoben.

Fremde Zitate können personenbezogene Angaben erhalten; Löschbegehren brauchen
redaktionelle Sichtung/Redaktion, auch fremder Revisionen. Keine pauschale Aussage
vollständiger Anonymität. Keine sofortige Backup-/Log-Löschung versprechen; Betreiber-
und Providerfristen und begründete gesetzliche Ausnahmen individuell prüfen.
Retention-RPC entfernt abgelehnte/supersedete Texte nach 30 Tagen, bewahrt erlaubte
Status/Auditcodes bis Rückzug/Purge. Produktwert, keine gesetzliche Pflicht. Noch
kein Cron: regelmäßige Ausführung muss nach Betreiberprüfung eingerichtet werden.

## Generierte Typen später finalisieren

`database.types.ts` bleibt **unverändert aus Production generiert**. `comments/types.ts`
ist ausdrücklich ein lokaler RPC-/DTO-Vertrag. `BrowserDatabase` ergänzt ausschließlich
RPC-Signaturen für den zentralen Client; keine erfundenen Tabellen oder `any`-/
Double-Casts. Laufzeit-Response-Prüfungen gelten auch nach Typgenerierung.

Nach separat freigegebener Staging-Anwendung den tatsächlich verbundenen Project-Ref
prüfen (nicht ungefragt umverlinken/Production verwenden), dann:

```powershell
npx supabase gen types typescript --linked --schema public | Set-Content -Encoding utf8 src/lib/auth/database.generated.types.ts
```

Ausgabe reviewen, vollständig in kanonische `database.types.ts` übernehmen,
temporäre Datei entfernen. Zentralen Client wieder auf generiertes `Database`
typisieren; lokalen `CommentsRpcFunctions`-Vertrag aus generierten `Functions`
ableiten/entfernen. View-DTOs und Runtime-Parser behalten. Checks wiederholen.
Hier wurde kein Typgenerierungs-/Remote-Befehl ausgeführt.

## Tests und tatsächliche Grenzen

```powershell
node --experimental-strip-types --test scripts/test-auth.mjs scripts/test-profiles.mjs scripts/test-account-phase21.mjs scripts/test-account-deletion.mjs scripts/test-meddocs-comments.mjs
node --experimental-strip-types scripts/test-meddocs-article-metadata.mjs
npx astro check
npm run build
git diff --check
```

Browser: lokales `dist` auf 127.0.0.1:4326, isoliertes Chrome-Profil/CDP 9334;
sämtliche externen Requests vor Navigation gemockt/geblockt:

```powershell
node scripts/test-meddocs-comments-browser.mjs
node scripts/test-auth-browser.mjs
```

Node: IDs, Eligibility, Manifest, Unicode/Größen, DTO-Allowlist/Cursor/Rollen,
Revision-/Statusanzeige, zentrale Gates, RPC-Argumente, Retry/Rate/Errorcodes,
statische Migrationsregeln. Browser: öffentliche/private Listen, Profil/Legal/Anon,
Create/Edit/Reply/Withdraw und Retry, Pagination, Author/Admin, Entscheidung/
Vergleich/History/Redaction, Keyboard/Semantik, 320/390/768/1440 px, Dark/Light,
XSS als Text, echte SDK-Cross-Tab-Events inklusive verspäteter privater Antworten.

`meddocs_comments.test.sql`: pgTAP mit synthetischen Auth-Fixtures, **nur isolierte
wegwerfbare Datenbank**. `meddocs_comments_remote_checks.sql`: getrennte read-only
Strukturabfragen, keine Accounts oder Mutationen. Lokale PostgreSQL-17-Installation
hat Executables, aber keine `share/postgres.bki`; isolierter Clusterstart scheiterte.
**SQL/RLS/FK-/Trigger-/Parallelitätstests wurden nicht ausgeführt.** Erfolgreiche Mocks
sind kein Ersatz. NVDA/VoiceOver, 200%-Zoom, Bildschirmtastatur und tatsächliche
moderative/Datenschutzabläufe bleiben zusätzlich manuell zu prüfen.

## Kontrollierter Rollout – erst nach ausdrücklicher Freigabe

1. Migration/Definer-Rechte reviewen. Backup/Restore und Moderationszuständigkeit
   klären; Rechtstexte für öffentliche Namen/Kommentare/Retention aktualisieren
   und vor öffentlicher Aktivierung freigeben.
2. Tatsächliche Staging-Historie gegen **alle** lokalen Migrationen prüfen:
   Profile/Staff, Backfill, Phase 2.1, Phase 2.2 und 3B. Phase 2.1 könnte fehlen.
   Alte Migrationen nicht verändern; alle ausstehenden Dateien reviewen.
3. Wegwerfbare PostgreSQL-17-/Supabase-Umgebung mit pgTAP: bestehende SQL-Tests
   plus Comments, reale Grants/RLS/FKs/Owner/Trigger. Nachgebautes Auth-Schema
   beweist keine Auth-Service-Rechte. Synthetische Fixtures niemals Production
   oder pauschal auf das bestehende Staging anwenden.
4. Zwei echte Verbindungen/SDK-Testclients: gleiche Create-Request-ID, Quota,
   Parallel-Edit, Edit/Approve, zwei Freigaben, Pending-Ersatz, Root-Hide/Reply,
   Rollenentzug, Legal-Wechsel, Auth-DELETE/Create/Edit/Approve sowie parallele
   Adminlöschungen. Rollback/Zeiger/Quota/Audit prüfen. Last-Admin-Fälle isoliert.
5. Project-Ref/pending erneut prüfen; Staging-Dry-Run und Anwendung gesondert
   freigeben. Hier kein `db push`, keine Remote-Verbindung.
6. Staging kontrolliert migrieren. Leeres Register = deaktiviert. Read-only
   Checks und reale Browser-/Relation-/GraphQL-/Owner-/Service-Rechte prüfen.
7. Vollständiges lokales Manifest/Diff reviewen, privilegiert über
   `meddocs_articles_sync` importieren. Kein Betreiber-Key im Browser/Git.
   Import schaltet Schreiben nicht frei; Archiv-/unpublished-Änderungen separat
   prüfen. Einzelne Staging-Artikel explizit veröffentlichen/aktivieren.
8. Offizielle Staging-Typen generieren, lokale RPC-Ergänzung ersetzen, Checks.
9. Separat über echten OTP registrierte Testaccounts: User/Author/Admin,
   NULL-Name, fehlendes/altes Legal, widerrufene Sessions, private API-Negativ-
   tests. Account-Löschung nur ausdrücklich freigegebener Testaccounts: Texte,
   Revisionen, Identitäten, Profile/Staff/Legal/Quota entfernen; fremde Antwort
   erhalten. Kein Anzeigename als Löschvoraussetzung.
10. Querypläne/kleine Lastmessung, Retention-Job, Moderationsbetrieb, Rechts-
    freigabe und manuelle Accessibility. Production-Migration und öffentliche
    Aktivierung jeweils separat freigeben; vorher Backup/Historie erneut prüfen.

Deaktivierung: `unpublished` plus `comments_enabled=false` sperrt öffentlich alles;
`archived` lässt nur Lesen zu. Keine UUIDs/Tabellen/Cleanup-Trigger löschen, solange
Kommentare bestehen. Ohne Review/Staging-Tests bleibt der Katalog leer/Schreiben aus.

## Geänderte Dateien und lokaler Prüfstand

- `docs/architecture/meddocs-comments-phase3.md`
- `docs/architecture/meddocs-comments-phase3b.md`
- `scripts/test-meddocs-comments-browser.mjs`
- `scripts/test-meddocs-comments.mjs`
- `src/components/MedNerdsContentFooter.astro`
- `src/components/auth/MedNerdsAccount.astro`
- `src/components/meddocs/MedDocsComments.astro`
- `src/components/meddocs/MedDocsModeration.astro`
- `src/content.config.ts`
- `src/content/docs/account/moderation.mdx`
- `src/content/docs/meddocs/anaesthesie/target-controlled-infusion.mdx`
- `src/content/docs/meddocs/echokardiographie/grundlagen-technik/einfuehrung-echokardiographie.mdx`
- `src/content/docs/meddocs/echokardiographie/grundlagen-technik/nomenklatur.mdx`
- `src/content/docs/meddocs/echokardiographie/grundlagen-technik/physikalische-grundlagen.mdx`
- `src/content/docs/meddocs/echokardiographie/grundlagen-technik/praktische-grundlagen.mdx`
- `src/lib/auth/README.md`
- `src/lib/auth/account-element.ts`
- `src/lib/auth/profile.ts`
- `src/lib/auth/supabase-client.ts`
- `src/lib/meddocs/README.md`
- `src/lib/meddocs/article-metadata-schema.ts`
- `src/lib/meddocs/comments/account-context.ts`
- `src/lib/meddocs/comments/api.ts`
- `src/lib/meddocs/comments/articles.ts`
- `src/lib/meddocs/comments/comments-element.ts`
- `src/lib/meddocs/comments/dom.ts`
- `src/lib/meddocs/comments/loader.ts`
- `src/lib/meddocs/comments/moderation-element.ts`
- `src/lib/meddocs/comments/types.ts`
- `src/lib/meddocs/comments/validation.ts`
- `src/styles/comments.css`
- `supabase/README.md`
- `supabase/migrations/20261011000000_meddocs_comments.sql`
- `supabase/tests/meddocs_comments.test.sql`
- `supabase/tests/meddocs_comments_remote_checks.sql`

Lokal bestanden: 78 Auth-/Profil-/Legal-/Lösch-/Kommentar-Tests, 35 MedDocs-
Metadatenprüfungen, bestehender Account-Browsertest und neuer Kommentar-Browsertest
mit vollständig gemockten externen Diensten, strikte gezielte TypeScript-Prüfung,
Astro Check (0 Fehler, 0 Warnungen; bekannter Basel-Hint), statischer Build und
`git diff --check`. Keine SQL-Ausführung oder echte Remote-Integration. Vorhandene
uncommittete Bestandsänderungen bleiben bestehen. SHA-256-Vergleich bestätigt
unveränderte Bestandsmigrationen, generierte Production-Typen, `.env`-Dateien und
Dependencies gegenüber dem Arbeitsstand zu Beginn von Phase 3B.
