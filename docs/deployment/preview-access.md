# MedNerds Preview Access

Eigenständige Netlify-Edge-Schicht vor der statischen Astro-/Starlight-Website.
Kein SSR-Adapter, keine Datenbank, keine Supabase-Rollen oder zusätzlichen Konten.
Der bisherige Netlify-Passwortschutz wird durch diese Dateien **nicht deaktiviert**.

## Einrichtung in Netlify (später manuell)

Unter **Project configuration → Environment variables** diese drei Variablen
anlegen, mindestens im Scope **Functions** und in allen verwendeten Deploy-Kontexten.
Keine `PUBLIC_`-Variablen, keine Secrets in `netlify.toml` oder Build-Argumenten.

| Variable | Wert |
| --- | --- |
| `MEDNERDS_ACCESS_GATE` | Exakt `enabled` oder `disabled` |
| `MEDNERDS_ACCESS_CREDENTIALS` | Kompaktes JSON des Hilfsskripts, ohne Klartextpasswörter |
| `MEDNERDS_ACCESS_SESSION_SECRET` | Vom Hilfsskript erzeugter Base64url-Schlüssel mit 256 Bit |

Fehlende oder unbekannte Flag-Werte, defekte Konfiguration und fehlende Schlüssel
führen zu HTTP 503. Nur ausdrücklich `disabled` schaltet die Website frei; dann
werden weder Zugangscookies noch Vorschau-Robots-/Cache-Header ergänzt.
Änderungen der Edge-Variablen erfordern einen normalen Build und Redeploy.

## Zugänge verwalten

Mit Node aus `.node-version` ausschliesslich im privaten interaktiven Terminal:

```sh
node --experimental-strip-types scripts/preview-access.mjs session-secret
node --experimental-strip-types scripts/preview-access.mjs generate --id owner
# Vorhandenes Passwort sicher einlesen statt als Shell-Argument übergeben:
node --experimental-strip-types scripts/preview-access.mjs hash --id reviewer-01
```

Das Skript erzeugt keine Dateien und führt keine Netlify-Operationen aus. In CI
oder Pipes verweigert es die Ausgabe. Ein generiertes Passwort ist nur zur sicheren
Weitergabe an die betreffende Person bestimmt; nicht in Chats, Logs oder Git ablegen.
Manuelle Passwörter werden unsichtbar eingelesen und nicht in der Shell-Historie
gespeichert. Lange Zufallspasswörter werden bevorzugt; unterstützt sind 16–256 UTF-8-Bytes.

Bei zusätzlichen/ersetzten Zugängen das aktuelle Credentials-JSON auf Nachfrage
einfügen. Der gleiche `--id` ersetzt den Zugang und erhöht dessen Revision;
eine neue ID ergänzt ihn. Das vollständige ausgegebene JSON in Netlify übernehmen.
Beim Ersetzen bleibt der bisherige Aktivierungsstatus erhalten.
Das Skript prüft, ob das Passwort bereits einem vorhandenen Zugang entspricht.
IDs sind interne Bezeichnungen, keine Benutzernamen oder Rollen.

Struktur: `{ "version": 1, "credentials": [ … ] }`, pro Eintrag exakt `id`,
`enabled`, `passwordHash`, `revision`. Maximal acht Einträge begrenzen die Arbeit
der Prüfung ohne Benutzernamen. Hash-Format:
`pbkdf2-sha256$1$600000$<Salt-Base64url>$<Prüfwert-Base64url>`.
Salt: individuelle 128 Bit; Prüfwert: 256 Bit. Unbekannte Parameter, doppelte IDs
und mehrfach verwendete Salts werden abgelehnt. Identische Passwörter mit
unterschiedlichen Salts sind ohne Passwort nicht erkennbar; bei Mehrfachtreffern
verweigert auch der Server die Anmeldung, unabhängig vom Aktivierungsstatus.

- Sperren: `enabled: false` setzen, JSON übernehmen, Redeploy.
- Passwort ersetzen: Hilfsskript mit gleicher ID verwenden, JSON übernehmen, Redeploy.
- Sitzung eines Zugangs zurücksetzen: dessen `revision` erhöhen und redeployen.
- Alle Sitzungen zurücksetzen: neuen Session-Schlüssel setzen und redeployen.
- Nach Wiederaktivierung eines gesperrten Codes die Revision erhöhen, damit vor der
  Sperrung ausgestellte Cookies nicht erneut verwendbar werden.

## Sitzungen und Abmelden

Cookie `__Host-mednerds_preview`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`,
kein `Domain`, absolute Laufzeit 24 Stunden ohne automatische Verlängerung.
HMAC-SHA-256 schützt die Signatur; der Inhalt ist lesbar, enthält aber kein Passwort.
Signatur, Zeit, Website-Origin, Zugangs-ID, Aktivierung, Revision und Bindung an den
aktuellen Passwort-Hash werden bei jeder Anfrage geprüft. Auch ein Passwortwechsel
ohne manuelle Revisionserhöhung invalidiert die alten Cookies auf dem neuen Deployment.

Zum Abmelden `/_preview-access/logout` öffnen und den Button bestätigen. Nur POST
löscht den Vorschau-Cookie; Supabase-Login und Supabase-Logout bleiben unabhängig.
Login und Logout verlangen eine passende `Origin` und lehnen fremde Sites ab.
`Referrer-Policy: strict-origin` erhält diese Prüfung auch bei nativen Formularen,
ohne Pfad, Query oder Fragment als Referrer weiterzugeben.
Cookies sind an den jeweiligen Host gebunden: weitere Domains benötigen eine eigene
Anmeldung. Ein kopierter gültiger Cookie bleibt bis Ablauf/Sperrung nutzbar;
individuelle gestohlene Tokens können ohne Datenbank nicht separat widerrufen werden.

Die Zugangsseite steht an der ursprünglich angeforderten URL. Ihr kleiner Login-
Handler sendet nur das Formular an den festen Login-Endpunkt und lädt danach die
aktuelle URL neu. Pfad, Query und Fragment bleiben erhalten; ein MedCases-Fragment
wird nicht an den Login-Endpunkt übertragen. Ohne JavaScript gibt es einen geprüften
internen Rücksprung für Pfad/Query; Fragmente lassen sich serverseitig nicht erhalten.
MedCases benötigt ohnehin JavaScript. Der Zugangsschutz selbst ist immer serverseitig.

## Routing, Caching und Crawler

`netlify/edge-functions/preview-access.ts` schützt `/*`, einschliesslich Pagefind,
Linkvorschau-JSON, Sitemap, `/_astro/*` und `/media-assets/*`. Die einzige Routing-
Ausnahme ist der separat abgesicherte Login-Endpunkt in `preview-access-login.ts`.
Beide deklarieren ausdrücklich `onError: 'fail'`. Die gemeinsame Implementierung
liegt in `netlify/lib/preview-access/`; keine dieser Dateien wird in Astro importiert.

Ohne Sitzung gibt es für HTML-Navigation die Zugangsseite mit HTTP 401, für Daten
und Assets eine einfache 401-Antwort. Nur die zwei exakt benannten Logo-SVGs, die
Zugangsdarstellung/Abmeldebestätigung und `robots.txt` benötigen keine Sitzung.
Die Logos werden aus vorhandenen Assets statisch generiert, nicht manuell kopiert.
Bei aktiviertem Gate antwortet `robots.txt` mit `Disallow: /`; Antworten tragen
`X-Robots-Tag: noindex, nofollow` und `private, no-store` sowie CDN-No-Store-Header.
Es wird kein Edge-Caching aktiviert. Nach `disabled` gilt wieder die vorhandene SEO-
Konfiguration, einschliesslich beabsichtigter `noindex`-Regeln auf Kontoseiten.

Netlify führt Edge Functions vor normalen Redirects/Rewrites aus. Der Gatekeeper
ruft `context.next()` erst nach erfolgreicher Prüfung auf; der bestehende R2-Rewrite
bleibt erhalten. Externe R2-/Supabase-/Worker-Adressen und das GitHub-Repository
liegen ausserhalb dieser Zugriffsschicht. Supabase RLS und Backend-Prüfungen bleiben nötig.

Nur der Login-Pfad hat natives Netlify Rate Limiting: zehn Anfragen je IP in
60 Sekunden, dann HTTP 429. Keine eigene IP-Liste oder externe API. Netlify nennt
bis zu zehn Sekunden Verzögerung bis zur Durchsetzung; geteilte institutionelle IPs
teilen dieses Limit. Verteilte Angriffe werden dadurch nicht vollständig verhindert.
Rate-Limit-Durchsetzung, CDN-Verhalten und Netlifys 50-ms-CPU-Budget sind lokal nicht
nachgewiesen. PBKDF2 bleibt bei 600000 Iterationen; Laufzeit vor der späteren Freigabe
in der echten Edge-Umgebung beobachten, nicht die Parameter auf Verdacht abschwächen.

## Lokal prüfen

`npm run dev`/`npm run preview` allein führen keine Edge Functions aus. Die Logik
ist ohne Produktions-Secrets und ohne Netlify CLI prüfbar:

```sh
node --experimental-strip-types scripts/test-preview-access.mjs
npx astro check
npm run build
node --experimental-strip-types scripts/test-preview-access.mjs --built
node --experimental-strip-types scripts/test-preview-access-browser.mjs
git diff --check
```

Der Browsertest verwendet wie vorhandene Tests einen bereits gestarteten lokalen
Chrome mit CDP (Standard `http://127.0.0.1:9223`, optional `PREVIEW_ACCESS_CDP`). Er
führt die echten Handler mit frischen In-Memory-Testdaten vor der gebauten Website
aus und blockiert externe Zugriffe. Dies ersetzt keine Netlify-Routing-/CDN-Prüfung.

Falls Netlify CLI lokal vorhanden ist, mit **ausschliesslich lokalen Testzugängen**
und einem separaten Test-Session-Schlüssel die drei Variablen im Terminal setzen.
Eingaben über einen interaktiven Prompt übernehmen, keine Secrets als Shell-Literale
oder Argumente. Danach mit gebautem Pagefind-Index:

```sh
netlify dev --offline --dir dist --framework '#static'
```

`http://localhost:8888` verwenden; unterstützt der Browser Secure-Cookies auf
localhost nicht, lokales HTTPS verwenden. Cookie-Sicherheit nicht abschwächen.
Für R2-Proxy-Tests vor dem Build zusätzlich `NETLIFY=true` setzen; dieser Build ist
für Netlify Dev bestimmt. Für gewöhnliche Astro Preview ohne Marker neu bauen.
Keine Produktions-Secrets synchronisieren, kein `netlify link`/Deploy nötig.
Die Testvariablen danach aus der Terminal-Umgebung entfernen.

Prüfen: Login, Suchdialog und Suche, direkter Artikel, Linkvorschau, Zitierexport,
MedCases-Einladung mit Fragment, Logout. Für Fehlerprüfung Gate-Flag entfernen oder
`MEDNERDS_ACCESS_CREDENTIALS` ungültig setzen: dann 503 statt Website. Mit `disabled`
erscheint die normale Website. Standardbrowser vollständig neu laden, damit alter
Browsercache vor Einführung des Gates die Prüfung nicht verfälscht.

## Spätere manuelle Ablösung der Netlify-Seite

1. Drei Functions-Variablen für benötigte Kontexte setzen; den nativen Netlify-
   Passwortschutz auf Production und Deploy Previews vorerst aktiviert lassen.
2. Über den normalen, separat freigegebenen Prozess veröffentlichen. Im Deploy-Log
   beide Edge Functions samt Routen und Rate-Limit-Regel prüfen. Split Testing muss
   deaktiviert sein: laut Netlify werden dort keine Edge Functions ausgeführt.
3. Hinter dem bisherigen Passwortschutz den eigenen Login, statische Dateien,
   Suche, Session-Sperrung, Fragment-Erhalt, R2-Proxy und Rate Limit prüfen. Auch
   direkte Dateien und warme CDN-Caches ohne Sitzung prüfen.
4. Erst danach unter Visitor access/Password Protection die **Production visibility**
   manuell für den gewünschten öffentlichen Einstieg umstellen. Deploy Preview
   visibility getrennt entscheiden und bis zur Prüfung auf Password belassen.
5. Ohne Cookies in einem frischen Browser alle vorgesehenen Domains sowie aktuelle
   Deploy-URLs prüfen: nur die eigene Zugangsdarstellung, keine geschützten Dateien.

Ältere Deployments enthalten ihren alten Code und ihre damalige Konfiguration.
Ein Redeploy aktualisiert oder sperrt sie nicht rückwirkend; dort können alte
Zugänge weiter gelten. Vor der manuellen Umstellung bekannte historische URLs und
deren Plattformschutz kontrollieren. Hier wird keine zusätzliche Schutzinfrastruktur
für alte Deployments eingerichtet. Bei später bewusst öffentlicher Website
`MEDNERDS_ACCESS_GATE=disabled` setzen und redeployen; die Edge Functions bleiben
im schnellen Durchreichmodus und verursachen weiterhin Aufrufe. Ihre Registrierung
kann später separat kontrolliert entfernt werden.

## Technische Quellen

- [Edge-Routing und Reihenfolge](https://docs.netlify.com/build/edge-functions/declarations/)
- [Request Chain: Schutz vor CDN, Image CDN und Rewrites](https://docs.netlify.com/resources/troubleshooting/request-chain/)
- [Fail-closed-Konfiguration](https://docs.netlify.com/build/edge-functions/optional-configuration/)
- [Functions-Scope und Deploy-Bindung der Variablen](https://docs.netlify.com/build/edge-functions/environment-variables/)
- [Natives Rate Limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- [Edge-Limits](https://docs.netlify.com/build/edge-functions/limits/)
- [OWASP: PBKDF2-Parameter](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
