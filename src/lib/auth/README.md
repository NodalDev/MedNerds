# MedNerds Account

## MedDocs-Kommentare (Phase 3B)

Der zentrale Browserclient verwendet zusätzlich den explizit lokalen RPC-Vertrag
`../meddocs/comments/types.ts` (`BrowserDatabase`). Die generierten Production-
Typen sind unverändert; nach kontrollierter Staging-Migration wird die Ergänzung
durch offiziell generierte Signaturen ersetzt. Kommentare verwenden AuthStore,
ProfileStore, LegalStore und `account-access.ts`, keine zweite Authentifizierung.
Serverseitige RPCs prüfen zusätzlich gespeicherten Namen, aktuelles Legal,
aktive Session und gegebenenfalls die tatsächliche Admin-Rolle.
Account-Löschung und eigener Kommentar-Rückzug bleiben unabhängig vom Profil-
Gate. Öffentliche Kommentar-Avatare sind Initialen, kein Besucher-Gravatar.
[Implementierung, Grenzen und Rollout](../../../docs/architecture/meddocs-comments-phase3b.md).

Statische Route: `/account/`. Kein globaler Login-Link, kein SSR, keine eigene
Session-API. `MedNerdsAccount.astro` nutzt Vanilla TypeScript und den bestehenden
Starlight-PageFrame. Die Seite ist `noindex, nofollow`, aus der Sidebar und aus
Pagefind ausgeschlossen.

## Konfiguration

Die drei öffentlichen Variablen aus `.env.example` lokal in `.env.local` bzw.
beim späteren Hosting als Build-Variablen bereitstellen:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ein `sb_publishable_…`-Key)
- `PUBLIC_TURNSTILE_SITE_KEY`

Keine Secret-/Service-Role-Keys, SMTP-Zugangsdaten oder Turnstile-Secrets im Browser
verwenden. `.env.local` bleibt ignoriert. Fehlende/ungültige Konfiguration verhindert
den Build nicht; die Account-Seite zeigt dann einen verständlichen Hinweis.

## Verantwortlichkeiten

- `supabase-client.ts`: eine Browser-Client-Instanz und ein gemeinsam genutzter AuthStore.
  Supabase übernimmt Persistenz, Cross-Tab-Synchronisation und Token-Refresh.
- `auth-store.ts`: `getSession` und synchroner `onAuthStateChange`-Listener;
  im UI-State stehen Anmeldestatus, Auth-UUID, E-Mail und laufender Vorgang, keine Tokens.
  Ein Listener für alle Verbraucher, Abmeldung des Listeners nach dem letzten Verbraucher.
- `account-element.ts`: E-Mail-/Code-/Session-Ansicht, zugängliche Statusmeldungen und
  Cleanup bei Disconnect/`astro:before-swap`. Der 60-Sekunden-Countdown ist nur UX;
  Supabase prüft tatsächliche Rate Limits und Code-Gültigkeit.
- `turnstile.ts`: einmaliges, bedarfsgesteuertes Laden des offiziellen Scripts,
  ein aktives Widget, Token-Verbrauch, Ablauf/Reset und Schutz gegen verspätete
  Callbacks nach Navigation. Neue Requests benötigen eine frische Challenge.
- `profile-store.ts`: Profil-/Staff-Abfragen über denselben typisierten Client;
  nur ausdrücklich freigegebene Profilfelder werden geändert. Logout/Accountwechsel brechen Requests ab
  und verwerfen verspätete Antworten. Die UI entscheidet keine DB-Berechtigungen.

Phase 2 ergänzt private Profile und kontrollierte Staff-Zuordnungen.
Migrationen, RLS-/Spaltenrechte, lokale DB-Tests, Typgenerierung und die separat
freizugebende Remote-Anwendung sind in [supabase/README.md](../../../supabase/README.md)
dokumentiert. Ein fehlendes Profilbackend verhindert weder OTP noch Logout.

Der SMTP-Versand und die CAPTCHA-Verifikation erfolgen ausschließlich bei Supabase.
Die App fordert bei Registrierung mit `shouldCreateUser: true`, bei Anmeldung mit
`shouldCreateUser: false` einen Code an und bestätigt ihn über
`verifyOtp({ email, token, type: 'email' })`. Ein Code wird als Text behandelt,
damit führende Nullen erhalten bleiben. Session-Daten bleiben beim SDK;
die UI ersetzt keine serverseitige Autorisierung.

## Lokaler Live-Test durch den Betreiber

1. Supabase-E-Mail-OTP aktivieren; das Magic-Link-Template muss `{{ .Token }}`
   als Code ausgeben. Auch den Erstversand für eine neue Adresse prüfen.
2. Serverseitig sechs Ziffern, 600 Sekunden Gültigkeit und mindestens 60 Sekunden
   Abstand einstellen; SMTP und CAPTCHA-Schutz mit dem Turnstile-Secret aktivieren.
3. Die verwendete lokale Hostadresse und später `mednerds.ch` bei Turnstile erlauben.
4. `/account/` öffnen: Code anfordern, echten sechsstelligen Code eingeben,
   erneut laden, neuen Tab öffnen und abmelden. Abgelaufene/falsche Codes sowie
   erneuten Versand und eine abgelaufene Challenge prüfen.

Automatisierte Tests senden keine echten E-Mails und verwenden keine echten Sessions.
Der Browsertest blockiert externe Requests und mockt Supabase und Turnstile.
Keine Zugriffsdaten oder Session-Tokens in Testausgaben/Screenshots aufnehmen.

```sh
node --experimental-strip-types scripts/test-auth.mjs
node --experimental-strip-types scripts/test-profiles.mjs
node --experimental-strip-types scripts/test-account-phase21.mjs
# Nach npm run build; lokales Chrome/CDP und statischer Build-Server erforderlich:
node scripts/test-auth-browser.mjs
```

`AUTH_SITE` (Standard `http://127.0.0.1:4326`) und `AUTH_CDP` (Standard
`http://127.0.0.1:9334`) passen die lokale Testumgebung an. Ausschließlich ein
eigenes temporäres Browserprofil verwenden. `AUTH_SCREENSHOTS` kann einen
Ausgabeordner für Screenshots der gemockten UI festlegen. Gegen einen Build
ohne Auth-Konfiguration prüft `AUTH_EXPECT_UNCONFIGURED=1` den deaktivierten Zustand.

Phase 2.1 verwendet denselben OTP-Schritt. Rechtliche Bestätigungen liegen in einer
separaten Tabelle und werden ausschließlich nach Verifikation geschrieben. Ohne
Phase-2.1-Backend bleiben Anmeldung und das Speichern des Anzeigenamens verfügbar;
Registrierung/Gravatar werden nicht ohne passende serverseitige Freigabe aktiviert.
Beruf/Sichtbarkeit/Avatarpräferenz sind freiwillig. Initialen entstehen lokal;
Gravatar wird nur nach gespeicherter Aktivierung im eigenen Account geladen.
Nach Registrierung oder Anmeldung mit fehlendem/ungültigem gespeichertem Namen
zeigt dieselbe Account-Komponente die eigene Ansicht „Vervollständige dein Profil“.
Accountübersicht, Avatar und erweiterte Profilverwaltung sind vollständig verborgen.
Nur Anzeigename, freiwilliger Beruf, Abschlussbutton und der dezente Textbutton
„Einrichtung abbrechen“ werden angeboten. Dieser nutzt die bestehende sichere
Abmeldung. „Konto“ und „Gefahrenbereich“ erscheinen erst in der normalen Verwaltung.
Rechtliche Bestätigungen bleiben unabhängig erreichbar.
Die beiden Ansichten verwenden dieselben Basisfelder und denselben Speicherweg.
`getAccountSetupStatus` in `account-access.ts` und `ProfileStore.requiresCompletion`
leiten den Zustand ausschließlich aus der eigenen geladenen Profilzeile ab.
`completeProfile` verwendet den bestehenden Speicherweg:
Anzeigename 2–60 Unicode-Codepoints, freiwilliger Beruf, Abschluss erst nach
Bestätigung des gespeicherten Namens in der eigenen zurückgegebenen Profilzeile.
Fehler erhalten die Eingaben; Reload/Login prüft erneut das gespeicherte Profil.
Die Account-UI akzeptiert auch bei späterer Bearbeitung keinen leeren Namen;
die Datenbank und die generische Profil-API erlauben weiterhin NULL.
Account-Löschung und rechtliche Bestätigungen bleiben unabhängig vom Profilstatus.
Ohne gültigen gespeicherten Namen erscheint ein lokales neutrales Benutzer-Icon.
### Schnittstelle für künftige Feature-Gates

`account-access.ts` ist die zentrale UI-Schnittstelle:

- `getAccountSetupStatus(profileSnapshot, authenticatedUserId)` liefert `pending`,
  `required` oder `complete`. Nur `status: ready`, passende Snapshot-/Profil-UUID
  und ein gültiger gespeicherter Anzeigename erlauben `complete`. Formulareingaben
  sind kein Snapshot; bis zur bestätigten Speicherantwort bleibt Onboarding aktiv.
- `getAccountFeatureAccess({ auth, profile, legal, versions })` trennt Auth-,
  Profil- und Rechtszustand. Standardmäßig müssen auch die eigenen aktuellen
  rechtlichen Bestätigungen vorliegen. `requireLegalAcceptance: false` ist nur
  für Funktionen vorgesehen, die diese Voraussetzung ausdrücklich nicht benötigen.
- Bei `profile-required` erklären: „Vervollständige zuerst dein MedNerds-Profil.“
  Mit `createAccountSetupHref(pathname + search + hash, location.origin)` direkt
  zum Onboarding führen. Eine gültige Session erfordert dabei keinen neuen OTP.
  Nach gespeichertem Namen und aktuellen Bestätigungen kehrt `/account/` über
  `returnTo` zum gewünschten lokalen Ziel zurück. Externe Ziele und Account-Schleifen
  werden verworfen. Ohne Rückkehrziel erscheint die normale Profilverwaltung.

**Verbindliche Backend-Anforderung:** Angemeldete Nutzer dürfen Kommentare erst
schreiben, beantworten oder bearbeiten, wenn der eigene gespeicherte Anzeigename
gültig ist und erforderliche aktuelle Bestätigungen vorliegen. Ebenso müssen
personalisierte Lernfortschritte, Antworten, Testergebnisse und sonstige
accountgebundene Lernstände serverseitig durch PostgreSQL/RLS oder sichere
DB-Funktionen autorisiert werden. Der Server muss die Identität selbst verifizieren
und den aktuellen DB-Zustand prüfen; ein UI-Status oder übergebenes `complete`
genügt nie. Diese Feature-Gates sind erst mit der jeweiligen Backend-Implementierung
vollständig abgesichert. Das Kommentarbackend wird laut Betreiber bereits auf
Production verwendet; sein aktueller Remote-Stand wurde hier nicht erneut geprüft.
Für den Betrieb gilt die [Anleitung zur automatischen Kommentarsynchronisierung](../../../docs/architecture/meddocs-comments-automatic-sync.md).
E-Learning-Tabellen/Endpunkte fehlen weiterhin.
Öffentliche Lernmaterialien bleiben frei zugänglich. Moderierte/anonyme
Gastkommentare benötigen einen getrennten, später zu definierenden Workflow.
Der bisherige `isProfileReadyForPublicActions` ist lediglich eine niedrigere
Profil-/Namensprüfung; künftige Verbraucher nutzen die vollständige Zustandsprüfung.

Die vollständigen Production-Schema-Typen liegen ausschließlich in
`database.types.ts`; Profil-Aliase und der bestehende Supabase-Client verwenden
diese generierten Typen. Die temporäre Schema-Erweiterung ist entfernt.
Migration und der manuelle Ablauf mit optionalem Staging stehen in
der Supabase-README. Phase 2.2 ist dort separat mit Edge Function und neuer
Migration vorbereitet; vor Review/gezielten Staging-Tests nicht aktivieren.
`deletion.ts` besitzt ausschließlich den modalen Löschdialog. AuthStore und SDK
bleiben die Session-SSOT. Die Auth-Identität wird für die Löschung serverseitig
verifiziert; frischer OTP und einmaliger Intent sind Pflicht. Auch unvollständige
Accounts können den separaten Zugang `/account/?action=delete` nutzen. Dieser
ist in der nicht angemeldeten Accountansicht verlinkt und öffnet nach Anmeldung
den bestehenden Bestätigungsdialog, ohne vorher einen Anzeigenamen zu verlangen.
Bei gültiger Session ist keine zusätzliche Anmeldung nötig; frischer Lösch-OTP
und alle serverseitigen Löschprüfungen bleiben Pflicht. Der URL-Aufruf allein
sendet keinen Code und löscht nichts. Abbrechen schließt nur den Dialog; Fokus
kehrt zum Einrichtungs-Abbruch bzw. zum normalen Löschbutton zurück. Die Function
und der Browser-Löschaufruf verwenden kein Profil-/Legal-Feature-Gate. Die explizite
Löschansicht hat Vorrang vor einem optionalen `returnTo`. Nach serverseitig bestätigter Löschung
werden eigener SDK-Storage und alle sichtbaren persönlichen UI-Daten entfernt.
