# Automatische MedDocs-Kommentare

## Umfang und Identität

Die vorhandene Artikelerkennung bleibt maßgeblich: normale MedDocs-Dateien mit
Autoren und Veröffentlichungsdatum. Lokal geprüft am 24. Oktober 2026:
**6 veröffentlichte Fachartikel**, eine
technische Showcase-Seite mit `comments: false` und 151 redaktionelle Drafts.
Test-/Legacy-Seiten ohne Metadaten, Ressourcenlisten,
Index-/Hub-/Hero-Seiten erhalten keine Kommentare. Es werden keine Autoren oder
Veröffentlichungsdaten erfunden. `comments: false` ist der gezielte Opt-out.

Die bestehende zentrale Einbindung in `MedNerdsContentFooter.astro` genügt;
keine manuellen MDX-Komponentenimporte. `commentsVisible()` und das Build-Manifest
verwenden dieselben Kriterien. Drafts werden auch im Development nicht aktiviert.

Vor dev/start/build prüft `npm run comments:check` die vorhandenen IDs nur lesend.
Fehlende IDs führen zu einem Fehler mit Hinweis auf `npm run comments:prepare`.
Nur dieser ausdrücklich aufgerufene Wartungsbefehl ergänzt fehlende IDs im
Frontmatter. Alle Quellen werden vor den Schreiboperationen validiert.
Erste Zuordnung: UUID v5 aus dem DNS-Namespace und dem Repository-Pfad;
danach ausschließlich die gespeicherte UUID. Die fünf bestehenden Production-IDs
bleiben unverändert. Neue IDs mit dem Artikel versionieren, bei Umbenennung
behalten und bei eigenständigen Kopien entfernen. Kein UUID-Neuberechnen bei Sync.

## Warum eine Folgemigration nötig ist

Die ursprüngliche Migration `20261011000000_meddocs_comments.sql` verbietet
`comments_enabled: true` und reaktiviert veröffentlichte Artikel nicht.
Sie bleibt unverändert. Die notwendige additive Migration
`20261011010000_meddocs_comments_automatic_sync.sql` ersetzt ausschließlich
`public.meddocs_articles_sync(jsonb)`, bei unveränderter Signatur und
service_role-only EXECUTE-Rechten. Kein neues Kommentar-Datenmodell.

Die RPC erwartet künftig ein **vollständiges**, nicht leeres Manifest:

`comments_enabled` bleibt zwingend ein JSON-Boolean. Die Statusvalidierung erlaubt:

| state | comments_enabled | Zulässig |
| --- | --- | --- |
| published | true | ja |
| published | false | ja |
| unpublished | false | ja |
| unpublished | true | nein |

Der bestehende Generator bleibt unverändert: Ein Frontmatter-Opt-out wird als
`unpublished`/`false` ausgegeben und blendet den Kommentarbereich aus. Zusätzlich
akzeptieren SQL und lokaler Manifestvalidator nun auch `published`/`false`;
der Abgleich mit den tatsächlich erzeugten Repository-Daten bleibt verpflichtend.

- UUID-/Pfad-/Typ-/Autorenvalidierung bleibt erhalten; fehlerhafte Batches rollen zurück.
- Veröffentlichte Artikel werden automatisch aktiviert, auch nach einem früheren Draft.
- Drafts/Opt-outs/ehemalige Artikel und im vollständigen Manifest fehlende IDs werden
  `unpublished` und deaktiviert. Keine Thread-, Antwort-, Revisions- oder Auditdaten löschen.
- Ein ausdrücklich durch Betreiber gesetztes `archived` bleibt bei vorhandenen
  veröffentlichten Quellen read-only; Reaktivierung verlangt bewusstes Unarchivieren.
- Upserts erfolgen nach UUID. Unveränderte Zeilen behalten auch `updated_at`.
- Eine Katalog-Tabellensperre serialisiert parallele Syncs; Lock-/SQL-Fehler brechen ab.
- Alte partielle SQL-Dateien nicht wiederverwenden. Ein erfolgreiches vollständiges
  Deployment darf ausgeschlossene/entfernte Routen nicht weiter freigeben.

## Production-Betrieb, ausschließlich nach Freigabe

Das Kommentarbackend wird laut Betreiber bereits auf Production verwendet.
Der aktuelle Remote-Migrations- und Konfigurationsstand wurde hier nicht erneut
geprüft. Die folgenden Schritte sind eine Operatorreferenz, keine Aufforderung,
bereits erledigte Migrationen oder die Einrichtung erneut auszuführen.

1. Aktuelles überprüfbares Production-Backup und das Ziel
   `hwuqqeixfxnyvpzwyjvq` bestätigen. Bestehende CLI-Verknüpfungen sind kein Zielnachweis.
2. Vor späteren Datenbankänderungen die tatsächliche Remote-Migrationshistorie
   und einen separat freigegebenen Dry-Run mit allen **acht** lokalen Migrationen
   vergleichen. Keine angewendete Migration verändern oder erneut ausführen.
   Die frühere Erwartung „ausschließlich Automatic-Sync-Migration“ ist historisch
   und gilt nicht mehr als allgemeiner Freigabecheck.
   `20261024000000_staff_author_slug_unique.sql` ist laut bestätigtem Betreiberstand
   noch nicht im Production-Migrationstracking registriert; der gleichnamige Index
   ist dort bereits als eindeutig, gültig und einsatzbereit bestätigt.
   Dieser Unterschied erfordert eine gesonderte Migrationsfreigabe, keinen
   erneuten Indexaufbau. Der GitHub-Push führt diese Migration nicht selbst aus.
   Keine Zugangsdaten als Argumente übergeben; das Production-Ziel ausdrücklich
   prüfen und keine ungeprüfte lokale CLI-Verknüpfung verwenden.
3. Im vertrauenswürdigen Deployment-System eine Supabase-Secret-Key-Variable
   `MEDDOCS_COMMENTS_SYNC_SECRET_KEY` bereitstellen, **nur im Production-Kontext**.
   Dazu `MEDDOCS_COMMENTS_SYNC_ENABLED=true` und
   `PUBLIC_SUPABASE_URL=https://hwuqqeixfxnyvpzwyjvq.supabase.co`.
   Moderne `sb_secret_...`-Keys verwenden, keine Publishable-Keys oder Nutzer-JWTs.
   Niemals Secret-Werte in Git, CLI-Argumente, PUBLIC_* oder öffentliche Artefakte schreiben.
   Im Dashboard des **Production-Projekts** unter **Settings → API Keys** einen
   separaten Secret-Key für diesen Build-Prozess anlegen, z. B. `meddocs-comment-sync`.
   Supabase erzeugt den Schlüssel; kein selbst generierter Zufallswert und kein PAT.
   Den Wert direkt in die geschützte Netlify-Umgebungsvariable übertragen, als
   geheim markieren, Kontext **Production**, Scope **Builds**. Enablement ebenfalls
   nur dort setzen. Keine Werte in Chat, Screenshots, Logs oder `netlify.toml` ablegen.
   [Supabase: Secret-Keys](https://supabase.com/docs/guides/getting-started/api-keys),
   [Netlify: Build-Umgebungsvariablen](https://docs.netlify.com/build/configure-builds/environment-variables/).
4. Production-Build-Befehl auf `npm run build:production` setzen.
   Preview-/Branch-Builds weiterhin `npm run build` verwenden. Netlify-Konfiguration:

   ```toml
   [context.production]
     command = "npm run build:production"
   ```

   Secret und Enablement ausschließlich dort hinterlegen. Der Sync verweigert
   Netlify-Kontexte außer `production`, auch wenn versehentlich ein Secret vorhanden ist.
   Andere CI-Systeme müssen denselben Schutz durch geschützte Production-Jobs einrichten.
   Nur vertrauenswürdigen Code mit Schreib-Secrets bauen, keine PR-Builds/Forks.
5. Einmal den freigegebenen Production-Build ausführen. Danach berücksichtigt jeder
   weitere Production-Build neue veröffentlichte Artikel automatisch.
   Erwartete Meldung für den am 24. Oktober 2026 lokal geprüften Stand:
   `6 catalog entries, 6 published articles`. Künftige Artikel ändern diese Zahlen;
   maßgeblich bleiben das aktuelle vollständige Manifest und dessen Validierung.
   Für Login und Kommentar-UI zusätzlich die bisherigen öffentlichen Build-Variablen
   `PUBLIC_SUPABASE_PUBLISHABLE_KEY` und `PUBLIC_TURNSTILE_SITE_KEY` beibehalten.

Die Node-Synchronisierung liest kein `.env` automatisch, sondern ausschließlich
die Prozessumgebung. Der normale Astro-Build übernimmt seine öffentlichen Variablen
wie bisher. Für einen späteren manuellen Operatorlauf müssen die drei genannten
Sync-Variablen sicher in der Prozessumgebung verfügbar sein. Keine Browser-Session nötig.

## Ablauf und Fehlerverhalten

`npm run build:production` führt erst den normalen Build, danach den separaten
Node-Sync aus. Dieser vergleicht das private Build-Manifest erneut mit den aktuellen
Quellen, bevor er den Supabase-Client erzeugt. Falsche Projekte, leere/alte/partielle
Manifeste, fehlendes Enablement, falsche Credentials oder RPC-Fehler stoppen den Job.
Der Client persistiert keine Session; Logs enthalten nur Artikelanzahlen und generische
Fehler. Das Secret wird ausschließlich in diesem Node-Prozess verwendet.

Die vorhandene RPC führt den gesamten Katalog-Abgleich in einer Transaktion aus.
Rückgabewert muss der Manifestanzahl entsprechen. Antworten/Revisionen/Moderation
werden nicht synchronisiert und bleiben unverändert. RLS und die bestehenden
Account-/Legal-/Session-Prüfungen bleiben die serverseitige Berechtigungsgrenze.

Der Sync erfolgt **vor** Veröffentlichung der statischen Dateien. Deshalb können
neue Freigaben kurz vor der Website öffentlich über Supabase lesbar werden; ein
danach fehlgeschlagenes Hosting-Publish rollt die bereits bestätigte RPC nicht zurück.
Production-Deployments seriell ausführen und keine älteren Builds nach einem neueren
Sync veröffentlichen. Ein unerwartet unterbrochener Request kann vor seiner Bestätigung
bereits committed sein; Wiederholung desselben vollständigen Manifests ist idempotent.

## Lokale Prüfung ohne Remote-Zugriff

```powershell
npm run build
npm run comments:sync -- --dry-run
npx astro check
node --experimental-strip-types scripts/test-meddocs-comments.mjs
node scripts/test-meddocs-comments-browser.mjs
git diff --check
```

Der Dry-Run liest/validiert nur lokale Dateien, erzeugt keinen Supabase-Client und
benötigt kein Secret. Browser-Tests mocken/blockieren sämtliche externen Requests.
Die vier Statuskombinationen und der Frontmatter-Opt-out sind im bestehenden lokalen
Kommentartest abgedeckt. Die SQL-Bedingung und ihre unveränderten Berechtigungen
werden dort statisch geprüft; die Folgemigration wird dabei nicht in PostgreSQL ausgeführt.
Der vorhandene Cloud-pgTAP-/Parallelrunner bleibt unverändert und ist kein
Production-Deployment-Werkzeug.

Alternativ kann der vorhandene Generator nach einem Build eine vollständige SQL-Datei
vorbereiten: `node --experimental-strip-types scripts/prepare-meddocs-comments-sync.mjs
--out=.astro/meddocs-comments-sync-production.sql`. Diese aktiviert nun Kommentare
und deaktiviert ausgelassene Artikel; nur nach der Folgemigration bewusst ausführen.
Kein automatischer Commit im generierten Operator-SQL.
