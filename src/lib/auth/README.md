# MedNerds Account

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
  nur der Anzeigename wird geändert. Logout/Accountwechsel brechen Requests ab
  und verwerfen verspätete Antworten. Die UI entscheidet keine DB-Berechtigungen.

Phase 2 ergänzt private Profile und kontrollierte Staff-Zuordnungen.
Migrationen, RLS-/Spaltenrechte, lokale DB-Tests, Typgenerierung und die separat
freizugebende Remote-Anwendung sind in [supabase/README.md](../../../supabase/README.md)
dokumentiert. Ein fehlendes Profilbackend verhindert weder OTP noch Logout.

Der SMTP-Versand und die CAPTCHA-Verifikation erfolgen ausschließlich bei Supabase.
Die App fordert mit `shouldCreateUser: true` einen Code an und bestätigt ihn über
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
# Nach npm run build; lokales Chrome/CDP und statischer Build-Server erforderlich:
node scripts/test-auth-browser.mjs
```

`AUTH_SITE` (Standard `http://127.0.0.1:4326`) und `AUTH_CDP` (Standard
`http://127.0.0.1:9334`) passen die lokale Testumgebung an. Ausschließlich ein
eigenes temporäres Browserprofil verwenden. `AUTH_SCREENSHOTS` kann einen
Ausgabeordner für Screenshots der gemockten UI festlegen. Gegen einen Build
ohne Auth-Konfiguration prüft `AUTH_EXPECT_UNCONFIGURED=1` den deaktivierten Zustand.
