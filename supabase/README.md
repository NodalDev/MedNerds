# MedNerds Accounts – Datenbank, Phase 2

## Stand und Sicherheitsgrenze

Die zwei Migrationen sind für die spätere, **separat freizugebende** Anwendung
vorbereitet. Sie wurden nicht remote angewendet. Lokale Docker-/PostgreSQL-Tests
und Typgenerierung sind in der aktuellen Arbeitsumgebung nicht verfügbar.
Node-/Browser-Mocks und statische SQL-Prüfungen ersetzen keine echten RLS-Tests.
Die untenstehenden CLI-Befehle wurden anhand der offiziellen CLI **2.120.0**
(Versions-/Hilfeabfragen) geprüft. Die CLI wird über npx verwendet, ohne neue
Projektdependency. Kein `supabase login`, `link`, `db push` oder Remote-Test wurde
automatisch ausgeführt.

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
npx --yes supabase@2.120.0 test db --local
node --experimental-strip-types scripts/test-profiles.mjs
node --experimental-strip-types scripts/test-auth.mjs
```

Keinen Remote-`db reset` ausführen. Der pgTAP-Test läuft in einer Transaktion mit
synthetischen UUIDs und Rollback. Er testet echte Tabellenrechte/RLS für anon,
Nutzer A, Nutzer B und privilegierte Maintenance, automatische Profilerstellung,
den Backfill, Unicode-Namen, geschützte Spalten, Staff-Eskalation und CASCADE.
Die Testdatei verwendet dieselbe Backfill-Anweisung; der statische Test prüft
die Übereinstimmung mit der Migration. Testdaten nicht an eine Remote-DB senden.

Typen sind momentan schemagerecht definiert, **nicht DB-generiert**. Nach einem
erfolgreichen lokalen Lauf durch die generierten Typen ersetzen. PowerShell:

```powershell
$accountDbTypes = npx --yes supabase@2.120.0 gen types --local --lang typescript --schema public
if ($LASTEXITCODE -ne 0) { throw 'Typgenerierung fehlgeschlagen; vorhandene Typdatei behalten.' }
$accountDbTypes | Set-Content -LiteralPath src/lib/auth/database.types.ts -Encoding utf8
```

Danach `npx astro check`, `npm run build`, Auth-/Profil-/Browser-Tests ausführen.
Der Browser-Test mockt ausschließlich; er versendet keine echten E-Mails.

## Spätere Remote-Migration – nur nach Prüfung und Freigabe

1. Lokale SQL-/RLS-Tests erfolgreich ausführen und SQL reviewen. Bestehende
   Remote-Tabellen/Migrationshistorie auf Namenskollisionen prüfen.
2. Aktuellen Backup-/Recovery-Stand im Dashboard prüfen. Korrektes Projekt
   (und PostgreSQL-Version) identifizieren. Keine Zugangsdaten ins Repo schreiben.
3. CLI-Anmeldung und Projektverknüpfung **manuell** durchführen:
   `npx --yes supabase@2.120.0 login`, danach
   `npx --yes supabase@2.120.0 link --project-ref <PROJECT_REF>`.
4. `npx --yes supabase@2.120.0 migration list` prüfen.
5. `npx --yes supabase@2.120.0 db push --linked --dry-run --skip-vault` ausführen.
   Erwartet: ausschließlich `20261009000000` und `20261009000001`. Ein Dry-Run
   listet Änderungen; er führt keine RLS-/Trigger-Tests aus.
6. **Erst nach ausdrücklicher Freigabe:**
   `npx --yes supabase@2.120.0 db push --linked --skip-vault`.
   Keine Secrets als CLI-Argumente/Logs ausgeben; erforderliche Credentials
   ausschließlich über den dafür vorgesehenen sicheren CLI-Weg bereitstellen.
7. Eigenes bestehendes Profil, frische Registrierung, Speichern/Reload,
   Logout und negative Autorisierung separat live prüfen. Die Accountseite
   zeigt vor dem Rollout einen verständlichen Profilhinweis; OTP/Logout
   funktionieren trotzdem weiter.

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
