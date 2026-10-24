# Phase 2.2 – eigene Account-Löschung (vorbereitet, noch nicht aktiviert)

Statushinweis: „noch nicht aktiviert“ bezeichnet den historischen lokalen
Vorbereitungsstand dieser Phase. Ein aktueller Remote-Deployment- oder
Secret-Status wird damit nicht bestätigt und wurde hier nicht erneut geprüft.

Die statische Website nutzt weiterhin genau ihren bestehenden Browserclient.
`deletion.ts` ruft nur diese dedizierte Edge Function auf. Keine User-ID wird
übermittelt. `handler.ts` ist mit Web APIs unabhängig von Deno mockbar;
`index.ts` bindet serverseitig den bereits verwendeten Supabase-SDK an.
`deno.json` pinnt dessen Version für die Edge Runtime, ohne npm-Dependencyänderung.

## Autorisierung und einmalige Bestätigung

1. Nativer modaler Dialog mit Abbrechen als initialem Fokus. Der erste Klick
   löscht nichts; erst nach CAPTCHA wird ein **neuer** OTP angefordert.
2. Die Function ist standardmäßig deaktiviert. Jeder aktive Aufruf benötigt
   einen Bearer-Token, den `auth.getUser(token)` beim konfigurierten Auth-Projekt
   verifiziert. Nur dessen bestätigte E-Mail und User-ID bestimmen das Ziel.
   `session_id` wird erst nach dieser Verifikation aus dem JWT gelesen.
   Frei übermittelte IDs/zusätzliche Felder werden abgewiesen.
3. Ein service-only RPC erzeugt pro Nutzer genau einen privaten Intent, an die
   existierende Originalsession gebunden. Fünf Minuten Gültigkeit, mindestens
   60 Sekunden zwischen Anforderungen, keine gespeicherten E-Mails/OTPs/Tokens.
   Erst nach erfolgreichem `signInWithOtp(shouldCreateUser:false, captchaToken)`
   wird der Intent verwendbar. Das OTP-Template muss weiterhin sechs Ziffern
   (`{{ .Token }}`) enthalten; SMTP/CAPTCHA sind im Auth-Projekt zu konfigurieren.
4. Der endgültige Button übermittelt Intent-ID, OTP und explizite Bestätigung.
   **Vor** OTP-Prüfung wird der Intent per bedingtem SQL-UPDATE atomar verbraucht.
   Ein falscher Code verbraucht ebenfalls den Versuch. Doppelrequests/replays
   können dieselbe Bestätigung nicht erneut nutzen, auch über mehrere Instanzen.
5. Ein isolierter, nicht persistierender Server-OTP-Client verifiziert den Code
   für die serverseitig bestimmte E-Mail. Ergebnis-ID muss mit dem authentifizierten
   Nutzer übereinstimmen. Das erzeugt keine zweite Browser-Session/Anmeldung.
   Die kurzlebige zusätzliche Auth-Session wird im `finally` lokal abgemeldet.
6. Authentifizierung, Originalsession und Intent-Ablauf werden vor dem Löschen
   erneut geprüft. Nur dann führt der **Server** `auth.admin.deleteUser(id,false)`
   aus. Fehler liefern ausschließlich feste Statuscodes, keine Providerdetails.
7. Nur ein bestätigtes `deleted` führt zur SDK-Abmeldung (`scope:local`) und zum
   Leeren von Auth-/Profil-/Avatar-/Formularzustand. Ein zusätzlicher Cleanup
   entfernt ausschließlich die eigenen, explizit konfigurierten SDK-Storagekeys.
   Alte/fehlgeschlagene Antworten nach Logout/Accountwechsel werden verworfen.

Die Bestätigung ist für diesen Löschversuch gedacht. Abbrechen vor dem letzten
Button löscht nichts. Nach Absenden des endgültigen Requests kann Schließen der
Seite/Netzverlust den serverseitigen Vorgang nicht zuverlässig stoppen. Ohne
bestätigte Antwort wird deshalb nie Erfolg behauptet; Accountzustand anschließend
prüfen. Keine Tokens, Codes, Authorization-Header oder Secrets protokollieren.

`verify_jwt=false` im Function-Eintrag ist bewusst: der Handler prüft selbst über
`getUser`, auch mit asymmetrischen Projekt-JWTs. Das ist **kein öffentlicher
Löschendpunkt**. Kein Pfad darf den eigenen Auth-Check umgehen. CORS erlaubt nur
die exakt konfigurierten Origins; Origin-Prüfung ersetzt keine Authentifizierung.
Requests ohne `Origin` (z.B. ein API-Client) durchlaufen dieselben JWT-/Intent-/
OTP-Prüfungen. Ein erlaubter OPTIONS-Preflight führt keine Auth-/Löschoperation aus.

### Sicherheitsgrenzen vor Staging

`account_deletion_authorize` ist wegen `clock_timestamp()` ausdrücklich
`VOLATILE`. Claim und letzte Prüfung kontrollieren Nutzer, Originalsession,
Challenge-ID und die fünfminütige Intent-Gültigkeit. Der Claim ist ein einzelnes
bedingtes UPDATE; ein paralleler Request kann denselben Intent nicht erneut
beanspruchen. Fehlgeschlagene OTP-Prüfung oder Auth-Löschung geben ihn nicht frei.

**Keine gemeinsame Transaktion:** Der letzte Autorisierungs-RPC und
`auth.admin.deleteUser()` sind getrennte Requests/Transaktionen. Läuft der Intent
erst danach ab oder wird die Originalsession in diesem Zeitfenster widerrufen,
kann die bereits angestoßene Admin-Löschung trotzdem erfolgen. Die fünf Minuten
werden bis zum letzten RPC erzwungen, nicht garantiert bis zum tatsächlichen
DELETE/Commit. Ein weiterer Vorab-RPC, ein HTTP-Abbruch oder ein JavaScript-Timer
würde diese Grenze nicht atomar schließen. Dafür wäre ein ausdrücklich geprüfter
DB-seitiger Autorisierungsmechanismus innerhalb der Auth-Löschtransaktion nötig;
dieser kleine Nachbesserungsschritt führt ihn bewusst nicht ein. Vor Aktivierung
muss diese Grenze bewertet werden. Die Mock-Tests prüfen die Übergänge **bis**
zum letzten RPC; sie beweisen keine transaktionsübergreifende Atomarität.

**OTP ist nicht an unsere Challenge-ID gebunden:** Supabase verifiziert den
aktuellen E-Mail-Code für die bestätigte E-Mail. Unsere Challenge bindet den
einmaligen Löschversuch an Nutzer und Originalsession; sie ist kein Bestandteil
der OTP-Verifikation. Ein gleichzeitig angeforderter Login-Code kann den Code
beeinflussen; eine kryptografische Bindung eines bestimmten Codes an einen
bestimmten Lösch-Intent wird nicht zugesichert. Single-Session-Konfigurationen
können außerdem durch die OTP-Verifikation die Originalsession ungültig machen;
der Ablauf muss dann ohne Löschung scheitern. Bei fehlgeschlagenem serverseitigem
OTP-Session-Cleanup kann diese zusätzliche Session bis zur Anbieterbereinigung
bestehen bleiben. Auch diese Konfigurationen auf Staging gezielt prüfen.

## Datenbank und letzter Administrator

Neue Migration: `20261010010000_account_deletion.sql`; ältere Migrationen bleiben
unverändert. Die privaten Intents haben RLS und keinerlei direkte Browserrechte;
die vier neuen öffentlichen RPCs sind ausschließlich für `service_role`
ausführbar. Die vorhandenen Profil-/Staff-/Legal-Policies ändern sich nicht.

Die tatsächlichen FKs der bestehenden Migrationen sind geprüft:

| Tabelle | Beziehung bei Auth-Nutzerlöschung |
| --- | --- |
| `public.profiles` | `user_id → auth.users(id) ON DELETE CASCADE` |
| `public.staff_accounts` | identischer CASCADE, inklusive eigener Staff-Zuordnung |
| `public.account_legal_acceptances` | identischer CASCADE, inklusive eigener Nachweise |
| `mednerds_private.account_deletion_intents` | CASCADE von User oder Originalsession |

Der letzte Administrator wird beim Intent-Beginn verständlich blockiert.
Entscheidend ist zusätzlich ein `BEFORE DELETE`-Trigger auf `auth.users`:
`SHARE ROW EXCLUSIVE`-Lock auf `staff_accounts`, dann aktueller Adminbestand.
Das serialisiert parallele Accountlöschungen und konkurrierende Staff-Schreibvorgänge
bis zum Ende der Löschtransaktion; nur eine vorab gezählte Zahl wäre unzureichend.
Der Trigger schützt auch direkte Auth-Adminlöschungen. Die Überprüfung ist kein
Frontend-Rollencheck. Direkte privilegierte Staff-Änderungen bleiben bewusst ein
Administrationsvorgang; der Betreiber darf darüber nicht den letzten Admin entfernen.

Unter PostgreSQL `READ COMMITTED` stehen `SHARE ROW EXCLUSIVE`-Locks miteinander
und mit den `ROW EXCLUSIVE`-Locks von Staff-Schreibvorgängen in Konflikt. Die
PL/pgSQL-Triggerfunktion ist `VOLATILE`; ihre Abfragen nach dem erhaltenen Lock
verwenden aktuelle Snapshots. Zwei parallele Admin-Löschungen werden so
serialisiert; nach der ersten Löschung sieht die zweite den verbleibenden Admin.
Bei Deadlocks muss eine Transaktion fehlschlagen, ohne Erfolg in der UI zu melden.
Eine anschließende privilegierte Rollenänderung ist dadurch weiterhin nicht
verboten: Der Trigger schützt Auth-Löschungen, kein universelles Rollen-Invariant.

Voraussetzung: Der `SECURITY DEFINER`-Eigentümer hat Lock-/Leserechte und sieht
den vollständigen Staff-Bestand trotz RLS. Der vorbereitete lokale pgTAP-Test
prüft diese Voraussetzungen. Der aktuelle offizielle Auth-Quellcode führt die
Hard-Deletion (`should_soft_delete=false`) als DELETE auf `auth.users` in einer
DB-Transaktion aus; die Sessions werden dabei über Cascades entfernt. Der Guard
läuft innerhalb dieser Transaktion. Das ersetzt nicht die Prüfung der tatsächlich
eingesetzten Auth-/PostgreSQL-Version, des Eigentümers und der Rechte auf Staging.
Echte parallele Löschungen/Staff-Änderungen nur in einer isolierten DB testen.

Kontrollierte Übergabe: einen anderen bereits bestätigten Account sicher
identifizieren, dessen Admin-Zuordnung mit einem geprüften privilegierten Vorgang
anlegen, Anmeldung/Adminstatus tatsächlich prüfen, erst danach die eigene Löschung
erneut anfordern. Keine automatische Ernennung, kein Browser-RPC zur Rollenvergabe,
kein Abschalten des Guards. Für verlorenen Zugang ist ein geprüfter Betreiberprozess
im Supabase-Dashboard nötig. Keine echten Accounts/Rollen für Tests verändern.

## Aufbewahrung und künftige Kommentare

Aktuelle Auth-Accountdaten und die genannten FK-Daten werden bei bestätigter
Hard-Deletion entfernt. Veröffentlichte redaktionelle Inhalte/Autorenbiografien
sind eigenständige Content-Daten und werden dadurch nicht automatisch gelöscht.
Supabase Storage kann eine Auth-Löschung bei verbleibenden eigenen Objekten
verhindern; eine spätere Uploadfunktion benötigt einen geprüften Löschablauf.

Noch gibt es keine Kommentartabelle. Vor deren Einführung verbindlich entscheiden:
entweder Kommentare löschen oder erhaltene Veröffentlichungen anonymisieren
(z.B. nullable Autorbezug/`ON DELETE SET NULL`, öffentlich „Gelöschter Account“).
Anonymisierung muss auch Namen, Avatare, E-Mail-/Hashbezüge, Zitate und ggf.
personenbezogenen Kommentartext berücksichtigen; bloßes Entfernen der FK-UUID
genügt nicht immer. Dafür eine eigene Migration und serverseitige Tests planen.

Gesetzliche Aufbewahrungspflichten oder andere begründete Ausnahmen können eine
gesonderte Behandlung bestimmter Daten verlangen; relevante Kategorien und Fristen
müssen vor Einführung entsprechender Funktionen geprüft und dokumentiert werden.
Keine pauschale gesetzliche Frist für diese Accounttabellen erfinden.
Grundlage: [EDÖB – Datenschutz in Vereinen](https://www.edoeb.admin.ch/de/datenschutz-in-vereinen)
und [Rechte/Löschbegehren](https://www.edoeb.admin.ch/de/meine-rechte-kennen-und-durchsetzen).
Backup-, PITR- und technische Log-Kopien folgen den konfigurierten Anbieterfristen;
dieser Endpoint löscht sie nicht sofort. Fristen und Wiederherstellungsprozess
(bereits gelöschte Accounts nicht wieder veröffentlichen) vor Launch festlegen.

## Konfiguration und Bereitstellung – ausschließlich manuell

Erforderliche serverseitige Variablen:

| Variable | Zweck |
| --- | --- |
| `SUPABASE_URL` | Projekt-URL (Edge Runtime liefert sie gewöhnlich) |
| `ACCOUNT_DELETION_PUBLIC_KEY` | Publishable-/Anon-Key desselben Projekts für OTP |
| `ACCOUNT_DELETION_SECRET_KEY` | Secret-/Service-Role-Key desselben Projekts, ausschließlich serverseitig |
| `ACCOUNT_DELETION_ALLOWED_ORIGINS` | Kommagetrennte exakte Frontend-Origins, keine Wildcards |
| `ACCOUNT_DELETION_ENABLED` | zunächst `false`; nur nach Review/Test gezielt `true` |

Keine Werte in Git, keine Änderung an den bestehenden Frontend-Env-Dateien.
Eine außerhalb des Repositories oder durch `.env.*` ignorierte lokale Secretdatei
verwenden. Die folgenden Befehle sind **Betreiberanweisungen**, nicht vom Agenten
ausgeführte Remote-Aktionen:

1. Migration, Auth-Triggerkompatibilität und function reviewen. Backupstand und
   explizite **Staging-Project-Ref** kontrollieren. Neue Migration zuerst in einer
   wegwerfbaren lokalen DB prüfen; keine Fixture-Datei auf Remote ausführen.
2. Lokale Edge Runtime: `npx --yes supabase@2.120.0 functions serve delete-account --env-file <LOCAL_SECRET_FILE>`.
   Handler-Mocks laufen ohne Deno/Docker; echte lokale Auth-/DB-Tests benötigen diese.
3. Staging-Dry-Run: `npx --yes supabase@2.120.0 db push --project-ref <STAGING_PROJECT_REF> --dry-run --skip-vault`.
   Zuvor die tatsächliche Staging-Migrationshistorie mit dem lokalen Verzeichnis
   abgleichen. Staging kann insbesondere `20261010000000_account_profile_extensions.sql`
   (Phase 2.1) noch fehlen; der Dry-Run darf nicht nur Phase 2.2 betrachten.
   Phase 2, Backfill, Phase 2.1 und Phase 2.2 in ihrer tatsächlichen Reihenfolge
   prüfen, einschließlich Legal-Releases und benötigter Schemas/Funktionen.
   Nur die erwarteten, dort noch fehlenden Migrationen nach individueller Freigabe
   anwenden: denselben Befehl ohne `--dry-run`. Keine bestehende Migration bearbeiten.
4. Secrets zunächst deaktiviert setzen:
   `npx --yes supabase@2.120.0 secrets set --project-ref <STAGING_PROJECT_REF> --env-file <STAGING_SECRET_FILE>`.
   Function nach Review manuell bereitstellen:
   `npx --yes supabase@2.120.0 functions deploy delete-account --project-ref <STAGING_PROJECT_REF>`.
5. Nur auf Staging für gezielte Tests aktivieren. Ausschließlich separate über OTP
   registrierte Testaccounts verwenden; Authprojekt und Frontendprojekt abgleichen.
   Nie die bestehenden Production-/Staging-Betreiberaccounts löschen/demoten.
6. Erst nach erfolgreichen Staging-/DB-Tests Production separat reviewen, Dry-Run
   prüfen und ausdrücklich freigeben. Keine automatische Aktivierung/Deployment.
   Nach Anwendung Typen erneut aus dem tatsächlich migrierten Schema generieren;
   die aktuelle `database.types.ts` wurde hierfür nicht manuell erweitert.

## Tests und offene Integration

```sh
deno check --config supabase/functions/delete-account/deno.json supabase/functions/delete-account/index.ts
node --experimental-strip-types scripts/test-account-deletion.mjs
node --experimental-strip-types scripts/test-auth.mjs
node --experimental-strip-types scripts/test-profiles.mjs
node --experimental-strip-types scripts/test-account-phase21.mjs
node scripts/test-auth-browser.mjs
```

Der Browser-Test blockiert/mockt alle externen Dienste, einschließlich Löschfunction.
Keine echten E-Mails oder Kontolöschungen. Separat vorbereitet:
`supabase/tests/account_deletion.test.sql`, nur wegwerfbare lokale DB. pgTAP explizit
mit den drei `*.test.sql`-Dateien aufrufen, keine Remote-Strukturchecks als Tests.
Mocks/statische SQL-Assertions ersetzen weder reale FK-/RLS-Tests noch tatsächliche
konkurrierende Transaktionen oder Auth-Service-Verhalten.

Vor Aktivierung offen: Deno/Edge Runtime check, lokale pgTAP-Tests, zwei parallele
DB-/HTTP-Löschversuche und Staff-Übergaben, JWT-Verfahren des Zielprojekts, SMTP-/
CAPTCHA-/CORS-Konfiguration, sechsstelliger neu versendeter OTP, expirierte/verwendete
Bestätigung, Auth-Sessionwechsel während Verifikation, Storage-Abhängigkeiten,
FK-Cascades und UI-Cleanup nach realer Staging-Testaccountlöschung. Den last-admin-
Negativtest ausschließlich mit künstlichen Admins in isolierter DB durchführen.
Die Browserprüfungen kontrollieren Fokus, Tastatur, Labels und Live-Regionen.
Echte Screenreader-Ausgabe (z.B. NVDA/VoiceOver), mobile Bildschirmtastatur und
der reale Turnstile-Dialog sind vor Aktivierung zusätzlich manuell zu prüfen.

Offizielle API-Grundlagen: [getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[OTP](https://supabase.com/docs/reference/javascript/auth-verifyotp),
[deleteUser](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser),
[Edge-Konfiguration](https://supabase.com/docs/guides/functions/function-configuration).
Prüfgrundlagen für Transaktionen/Locks:
[Auth Admin Hard-Deletion](https://github.com/supabase/auth/blob/master/internal/api/admin.go),
[Sessionwiderruf](https://supabase.com/docs/guides/auth/sessions),
[PostgreSQL-Volatilität](https://www.postgresql.org/docs/17/xfunc-volatility.html),
[PostgreSQL-Locks](https://www.postgresql.org/docs/17/explicit-locking.html).
