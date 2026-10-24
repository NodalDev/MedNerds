# Netlify-Beta: MedNerds 0.5.0

Stand: 24. Oktober 2026. Vorbereitung ohne Deployment, Commit, Push oder
Supabase-Remote-Zugriff. Medizinische Artikel und die vorhandene lokale
TCI-Artikeländerung wurden nicht verändert.

## Lockfile

Im optionalen WASM-Baum fehlten die übergeordneten Einträge für
`@emnapi/runtime@1.11.3` und `@emnapi/core@1.11.3`:

- `@img/sharp-wasm32@0.35.5` benötigt Runtime `^1.11.3`.
- `@napi-rs/wasm-runtime@1.2.3` benötigt Core und Runtime als Peer-Dependencies.
- Die vorhandenen verschachtelten 1.11.1-Einträge erfüllen diese Auflösung nicht
  für den übergeordneten Baum. Core 1.11.3 verwendet den bereits vorhandenen
  Eintrag `@emnapi/wasi-threads@1.2.3`.

Ergänzt wurden ausschließlich diese beiden optionalen Lockfile-Einträge mit
Registry-URL, originaler SHA-512-Integrität und Abhängigkeiten; Core bleibt als
Peer markiert. Alle bisherigen Einträge einschließlich der Windows-/Linux-
und WASM-Varianten bleiben unverändert. `package.json`, Projektversion 0.5.0,
TLS-/Integritätsprüfungen und Dependency-Versionen bleiben erhalten. Das ist
keine neue direkte Dependency und kein Override. Der genaue historische
npm-Schritt, der die Einträge ausließ, lässt sich aus dem Lockfile nicht beweisen.

Ein sauberer Windows-Installationslauf ohne vorheriges `node_modules` bestand:
Node 22.23.4, npm 11.6.2, `npm ci --include=dev --offline --no-audit --no-fund`.
Die Pakete kamen aus dem vorhandenen Cache; Installationsskripte und
Integritätsprüfungen waren aktiviert. Linux wurde nicht erfolgreich ausgeführt:
WSL meldete Zugriff verweigert, der Docker-Linux-Daemon war nicht verfügbar.
Die Cloud-Kombination Node 22.23.4 / npm 11.9.0 muss noch bestätigt werden.

## Sicherer Build

Netlify verwendet **`npm run build`**:

1. npm führt `prebuild` → `comments:check` aus. Dies liest und validiert IDs und
   Metadaten. Es schreibt weder Artikel noch SQL und erstellt keinen DB-Client.
2. `astro build` erzeugt die statischen Seiten, Assets, Pagefind und Sitemap.
   Generierte Caches und das vollständige interne Kommentar-Manifest liegen
   unter `.astro/`, ausschließlich `dist/` wird veröffentlicht.

Es gibt keinen `postbuild`-Hook und keinen weiteren Hosting-Build-Hook im Repo.
`comments:prepare` schreibt Artikel-IDs und ist eine separate redaktionelle Aktion.
`comments:sync` ruft eine schreibende Supabase-RPC auf. **`build:production` ist
für diesen Netlify-Build ungeeignet**, weil es `comments:sync` anhängt.
Keiner dieser schreibenden Befehle und keine Migration wurde ausgeführt.

## Draft-Ausschluss

Eine tatsächliche Asset-Leckage wurde behoben: Starlight filterte die Routen,
Astros Content-Importliste enthielt aber weiterhin Draft-MDX. Dadurch erschienen
unter anderem HyperHeart-JavaScript, Herzzyklus-CSS und 28 Herzphasen-PNGs in
`dist/_astro/`, obwohl die Draft-Seite keine HTML-Route hatte.

Der kleine `publishedContentLoader` entfernt Drafts jetzt im Production-Modus
nach der bestehenden Validierung und Manifest-Erzeugung aus dem Content-Store,
bevor Astro die Modul-/Asset-Importlisten schreibt. Er wird für Docs und MedBlog
verwendet. Im Entwicklungsmodus bleiben Drafts verfügbar. Starlight-Internals
und medizinische Inhalte bleiben unverändert. Das vollständige interne
Kommentar-Manifest wurde gegen die unveränderten Quelldaten validiert.

Die ausdrücklich erhaltene Systemseite `404` ist eine Starlight-Fallback-Seite,
kein unveröffentlichter Artikel; sie bleibt von Pagefind ausgeschlossen.

Der überprüfte Production-Build enthält keine der 152 unveröffentlichten
Artikel-/Tool-Routen, keine entsprechenden Navigationslinks, Sitemap-Einträge,
Vorschau-JSONs oder Suchdokumente. Die 44 entpackten Pagefind-Fragmente stimmen
exakt mit den tatsächlich indexierbaren HTML-Seiten überein. Alle sieben
publizierten Vorschau-Assets wurden zusätzlich mit dem bestehenden Buildtest
geprüft. Draft-Module, die bekannten Draft-Assets, Roh-MDX, Source Maps,
interne Manifeste und privilegierte Schlüssel wurden nicht ausgeliefert.
Diese Zahlen beschreiben den Befund; die Prüfungen enthalten keine feste
Artikelzahl als Freigaberegel.

## Einstellungen beim späteren Netlify-Import

| Einstellung | Wert |
| --- | --- |
| Repository | `NodalDev/MedNerds` |
| Base Directory | leer lassen: Repository-Wurzel |
| Package Directory, falls angezeigt | Repository-Wurzel / Standard beibehalten |
| Build Command | `npm run build` |
| Publish Directory | `dist` |
| Node.js | `22.23.4` aus der bestehenden `.node-version` |
| `NPM_VERSION` | `11.9.0` empfohlen, um die Cloud-Toolchain festzulegen; Linux-Prüfung steht aus |
| `NPM_FLAGS` | `--include=dev`, damit Check-/Typ-/Build-Abhängigkeiten installiert werden |
| Astro-Adapter | nicht erforderlich: vollständig statischer Output |
| Zusätzliche `netlify.toml` | nicht erforderlich; keine angelegt |

Keinen abweichenden `NODE_VERSION`-Override setzen; kein eigener `NODE_ENV` ist
nötig. Der reguläre Astro-Build verwendet den Production-Modus. `--omit=dev`
und `--omit=optional` nicht als Build-Installationsvorgaben verwenden.

Die bestehende Team-Einstellung „Private for new projects“ beschränkt den
Zugriff zunächst auf berechtigte Netlify-Mitglieder. Ein gemeinsames
Beta-Passwort wird später separat pro Projekt unter **Project configuration →
General → Visitor access → Project visibility → Password** eingestellt,
für **Production and previews**. Diese Einstellung wurde nicht verändert.

## Umgebungsvariablen und dynamische Funktionen

Für die Erstellung der statischen Website sind keine Supabase-, Turnstile-
oder Realtime-Variablen erforderlich. Öffentliche Client-Konfiguration ist
optional und wird beim Build in Browser-JavaScript eingebettet:

| Variablen | Nur für die Nutzung der jeweiligen Funktion erforderlich |
| --- | --- |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TURNSTILE_SITE_KEY` | gemeinsam für die vorhandene Auth-Konfiguration; Account-/Kommentarzugriffe benötigen ein passend konfiguriertes Backend |
| `PUBLIC_MEDCASES_REALTIME_URL` | HTTPS-Origin des separat betriebenen MedCases-Realtime-Workers; ohne gültigen Wert bleibt Live-Realtime deaktiviert |
| `PUBLIC_MEDCASES_JOIN_BASE_URL` | optionale HTTPS-Origin für Join-Links |

Vorhandene lokale Env-Dateien wurden nur hinsichtlich ihrer Variablennamen
geprüft. Sie enthalten die drei öffentlichen Auth-Variablen und werden nicht
ins Git-Repository aufgenommen. Die isolierte Buildkopie erhielt keine Env-Datei.

Keine Service-Role-Keys, `sb_secret_`-Schlüssel,
`MEDDOCS_COMMENTS_SYNC_SECRET_KEY` oder
`MEDDOCS_COMMENTS_SYNC_ENABLED=true` als Website-Build-Konfiguration vorsehen.

Laufzeitkonfiguration erfolgt getrennt: Supabase-Auth-Redirect-URLs und
Turnstile-Hostnamen müssen zur späteren Beta-Adresse passen. Der bestehende
Cloudflare-Worker erlaubt derzeit nur `https://mednerds.ch` als Origin; eine
andere Beta-Origin müsste für Live-Realtime dort separat freigegeben werden.
Der statische Netlify-Deploy betreibt oder konfiguriert diesen Worker nicht.
Backend-Secrets verbleiben beim jeweiligen Backend. Keine dieser Remote-
Einstellungen wurde angefasst.

## Validierung und lokale Grenzen

- Manifest/Lockfile konsistent, genau zwei neue Einträge, keine Änderung an
  bestehenden Auflösungen; sauberer Windows-`npm ci` erfolgreich.
- `npm run check:full` ausgeführt: Astro Check ohne Fehler/Warnungen, zwei
  bestehende Hinweise; alle 207 Node-Tests bestanden.
- Im regulären Windows-`dist/` scheiterte Pagefind an `PermissionDenied`.
  Astro gab dabei trotzdem Exit 0 zurück: Dieser Exitcode ist kein
  vollständiger Build-Nachweis. Das dortige partielle `dist/` ist nicht
  als Deployment-Artefakt freigegeben.
- Der bestehende Buildbefehl wurde deshalb zusätzlich in einer isolierten
  Quellkopie ausgeführt: vollständiger statischer Build einschließlich
  Pagefind und Sitemap erfolgreich, auch nach der Draft-Korrektur mit zuvor
  befülltem Content-Cache. Keine zweite Build-Pipeline oder Hosting-Konfiguration.
- Der Gesamtcheck in der Kopie bestand ebenfalls alle 207 Tests und den
  vollständigen Website-Build. Sein letzter Referenz-Fixture-Schritt konnte
  dort die fest am Checkout erwartete Astro-Binary nicht finden. Der bestehende
  Referenz-Buildtest wurde mit dem korrigierten Code im Original-Checkout
  separat erfolgreich ausgeführt, einschließlich beider Fixture-Builds.
- Der bestehende Vorschau-Buildtest und der neue rein lesende
  `scripts/test-production-drafts.mjs` bestanden am vollständigen isolierten
  Production-Build. Das neue Skript prüft auch positive Build-/Index-Vollständigkeit.
- Hashvergleich der vorbestehenden getrackten Dateien bestätigt die gezielten
  Änderungen; insbesondere bleibt der vorhandene TCI-Diff exakt erhalten.
- `git diff --check` bestanden. Keine Cloud-DB-Tests, Migrationen, Synchronisierung,
  Commits, Pushes, Netlify-Projekterstellung oder Deployments.

Ein durchgehend grüner `check:full`-Gesamtprozess und `npm ci` auf Linux bleiben
vor der ersten Freigabe zu bestätigen. Kein weiterer Code-Blocker wurde gefunden.

## Kurze Codex-Cloud-Verifikation auf Linux

In einem frischen Checkout mit diesen Änderungen, ohne `node_modules` und
lokale Env-Dateien; npm 11.9.0 ist eine Toolchain-Vorgabe, kein Projekt-Upgrade:

```sh
nvm install "$(cat .node-version)"
nvm use "$(cat .node-version)"
npm install --global npm@11.9.0
node --version
npm --version
sha256sum package.json package-lock.json > /tmp/mednerds-manifests.sha256
npm ci --include=dev
npm run check:full
node --experimental-strip-types scripts/test-meddocs-link-previews.mjs --built
node --experimental-strip-types scripts/test-production-drafts.mjs
sha256sum --check /tmp/mednerds-manifests.sha256
git diff --check
git status --short
```

Alle Befehle müssen erfolgreich sein; beim Gesamtcheck zusätzlich auf den
vollständigen Pagefind-/Sitemap-Abschluss achten. Der Draft-Audit schlägt bei
fehlendem Suchindex oder fehlender Sitemap fehl. Der Git-Status darf keine
zusätzlichen Quelländerungen durch Installation, Tests oder Build zeigen.
Kein `npm install --no-save` als Ersatz für den `npm ci`-Nachweis verwenden.

## Offizielle Hosting-Referenzen

- [Netlify: Build-Abhängigkeiten und npm-/Node-Versionen](https://docs.netlify.com/build/configure-builds/manage-dependencies/)
- [Astro: Statische Netlify-Sites und Adapter](https://docs.astro.build/en/guides/integrations-guide/netlify/)
- [Netlify: Projekt-Sichtbarkeit](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
- [Netlify: Passwortschutz und Production/Previews](https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/)
