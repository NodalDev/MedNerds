# Audit Etappe 2: Dependencies und Toolchain

Stand: 24. Oktober 2026. Ausschließlich lokale Paket-, Installations- und Build-Prüfung;
keine Datenbankverbindung, Migration, Synchronisierung oder Bereitstellung.

## Toolchain und Reproduzierbarkeit

- Ausgangsumgebung: Node 22.20.0, `npm --version` 11.6.2. Astro 7.3.x verlangt
  Node >=22.12.0. Supabase und Wrangler verlangen ebenfalls Node 22 oder neuer.
- Projektvorgabe: `.node-version` enthält 22.23.4; `engines.node` erlaubt
  `^22.23.4`, `engines.npm` >=10.9.0 und <12. Node 22 bleibt die bestehende
  LTS-Linie. 22.23.4 ist ein Sicherheitsrelease, kein Node-Major-Wechsel.
  [Node-Release](https://nodejs.org/en/blog/release/v22.23.4).
- Finale Installation, Tests und Build wurden mit Node 22.23.4 und der bereits
  vorhandenen npm-Version 11.6.2 geprüft. Das offizielle Windows-Node-Archiv wurde
  im ignorierten `.astro/toolchain-audit/` entpackt und gegen die offizielle
  SHA-256-Liste geprüft. Keine globale Installation oder dauerhafte PATH-Änderung.
- `npm ci --include=dev --no-audit --no-fund` erfolgreich. Manifest/Lockfile,
  installierte direkte Versionen, Engines und überschneidungsfreie
  Dependency-Deklarationen wurden zusätzlich lokal geprüft.
- DevDependencies müssen auch beim statischen Hosting-Build installiert werden.
  Die README beschreibt `.node-version` für Windows/Versionsmanager, künftige
  GitHub Actions und Netlify. Es wurde kein Workflow angelegt und keine
  Hosting-Einstellung geändert.

## Gezielte Änderungen

| Paket | Vorher → nachher | Grund |
| --- | --- | --- |
| Astro, direkt | 7.3.2 → 7.3.3 | View-Transition-CSS-Sicherheitsfix |
| sharp, direkt | 0.35.4 → 0.35.5 | librsvg-Sicherheitsfix einschließlich zugehöriger Binärpakete |
| Wrangler, direkt/dev | 4.143.1 → 4.152.0 | Aktualisiert den Simulator mit gepinntem sharp auf die korrigierte Version |
| Miniflare, transitiv/dev | 5.20260926.1-alpha → 5.20261019.2-beta | Von Wrangler vorgegebene Version; zugehöriges workerd wird mitgeführt |
| devalue, transitiv | 5.9.2 → 5.9.4 | Serialisierungs-/Deserialisierungs- und DoS-Fixes |
| fast-uri, transitiv | 3.1.7 → 3.1.9 | URI-Normalisierungs- und Spoofing-Fixes |
| http-cache-semantics, transitiv | 4.2.0 → 4.3.0 | Cache-Isolation/max-stale-Fix |
| smol-toml, transitiv | 1.8.0 → 1.9.1 | Parser-Komplexität |
| source-map-js, transitiv | 1.2.1 → 1.2.2 | DoS durch manipulierte Source Maps |
| Undici, transitiv im Astro-Baum | 8.10.1 → 8.12.3 | HTTP-, WebSocket-, EventSource- und Integritäts-Fixes |
| Vite, transitiv | 8.2.2 → 8.2.4 | Editor-Aufrufe und Dev-Server-Sicherheitsfixes |
| Zod, transitiv | 4.5.4 → 4.6.7 | Speicherverbrauch bei übergroßen begrenzten Collections |

Notwendige Unterabhängigkeiten werden von npm mitgeführt, unter anderem
Astros neues `verkit`/`find-proc`, PostCSS-Patch und die nativen sharp/workerd-Pakete.
Vite wurde gezielt im bisherigen 8.2-Patchzweig aufgelöst; Rolldown bleibt bei
1.2.6. Eine zunächst aufgelöste Vite-Minor-/Rolldown-Patch-Kombination mit vielen
neuen `MODULE_LEVEL_DIRECTIVE`-Warnungen wurde nicht übernommen. Vite und
Rolldown sind weiterhin ausschließlich transitiv: keine neuen direkten Pins,
Overrides oder Bundler-Konfigurationsänderungen.

Neu direkt als DevDependencies: `js-yaml` ^4.3.2 für die vorhandenen
Vorbereitungs-/Testskripte und `@types/mdast` ^4.0.4 für den bestehenden direkten
AST-Typimport. Bereits installierte Versionen bleiben dabei erhalten.
`@astrojs/check`, TypeScript und die React-Typen wurden aus `dependencies` nach
`devDependencies` verschoben. Keine direkte Dependency wurde entfernt.
Für `qrcode-generator` wurde keine direkte Verwendung gefunden; eine Entfernung
wurde in dieser Sicherheitskorrektur nicht vorgenommen. Sonstige vorhandene
Build-Integrationen wurden nicht pauschal umsortiert.

## Sicherheitsbewertung

`npm audit` zählt betroffene Paketnamen einschließlich abhängiger Pakete, nicht
unabhängige Angriffsmöglichkeiten. Die beiden Sichten überlappen; insbesondere
war Undici vorher sowohl im Build- als auch im Simulator-Baum betroffen.

| npm-Sicht | Vorher | Nachher |
| --- | --- | --- |
| Gesamter Baum einschließlich Development | 15: 8 hoch, 6 moderat, 1 niedrig | 6: 1 hoch, 5 moderat |
| Production-Tree (`--omit=dev`) | 13: 7 hoch, 5 moderat, 1 niedrig | 3 moderat |

Production-Dependencies sind bei dieser statischen Website überwiegend
Build-Werkzeuge. Daraus folgt weder eine Auslieferung dieser Pakete an Browser
noch pauschale Ungefährlichkeit der lokalen/CI-Verarbeitung fremder Daten.

| Ursache | Einordnung für MedNerds |
| --- | --- |
| Astro-CSS-Injection | Direkte Dependency; kein `astro:transitions`-Import oder fremdgesteuerter Transition-Wert gefunden. Trotzdem durch kompatiblen Patch behoben. [Advisory](https://github.com/advisories/GHSA-mpr7-6m5w-76rw) |
| sharp/librsvg | Direkte Build-Dependency und vorher auch im Dev-Simulator. Manipulierte SVGs können beim Build relevant sein; keine öffentliche Upload-/Bildverarbeitungs-API in der statischen Website. Beiderseits behoben. [Advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) |
| devalue | Transitiver Astro-/React-Serializer: mehrere Meldungen zu Speicherverbrauch, gemeinsamem Speicher und manipulierten Datenstrukturen. Kein entsprechender öffentlicher SSR-Eingabepfad nachgewiesen; kompatibel aktualisiert. |
| fast-uri | Transitiv über Ajv/Astro Check; URI-Vergleich und Normalisierung betroffen, kein eigener MedNerds-URI-Autorisierungsdienst gefunden. Aktualisiert; Astro Check jetzt korrekt als DevDependency eingeordnet. |
| http-cache-semantics | Transitiver Astro-Build-Cache; keine dynamische Auslieferung authentifizierter MedNerds-Antworten über diesen Cache gefunden. Aktualisiert. |
| smol-toml / source-map-js | Transitive TOML-/CSS-/Source-Map-Werkzeuge; vor allem Risiko beim Verarbeiten nicht vertrauenswürdiger Projekte/Build-Eingaben. Aktualisiert. |
| Vite | Transitiver Dev-Server/Bundler. Windows-Editoraufrufe und Dateifreigaben sind für die lokale Entwicklung relevant; kein Vite-Server wird als statische Website deployed. Sicherheits-Patch übernommen. |
| Zod | Transitive Schema-Validierung, überwiegend beim Build. Kein eigener öffentlicher Zod-Validierungsendpunkt gefunden. Kompatibles Minor-Update übernommen. |
| Undici 8 | Transitive HTTP-Implementierung für Build-/Font-Abhängigkeiten: Meldungen zu WebSockets, Retry/Cache, TLS-Optionen, EventSource und Integrität. Ein passender öffentlicher Node-Endpunkt ist nicht nachgewiesen; alle Meldungen dieses Zweigs durch kompatibles Update entfernt. |

### Verbleibend: zwei Ursachen, sechs Paketmeldungen

1. **PostCSS-Parser:** `postcss-selector-parser` 6.1.4 → `postcss-nested` 6.2.0
   → `@expressive-code/core` 0.44.2, drei moderate Production-Tree-Meldungen.
   Sehr große fremde Selektoren können quadratische CPU-Arbeit auslösen. MedNerds
   verwendet diesen Pfad für kontrollierte CSS-/Dokumentations-Builds, nicht als
   öffentlichen CSS-Parser. Der Fix liegt in Parser 7.1.6. Core 0.44.3 würde
   intern `postcss-nested` von 6 auf 7 und damit den Parser-Major wechseln.
   Dieser transitive Major-Wechsel bleibt gemäß Auftrag einer gesonderten
   Entscheidung vorbehalten; kein Override.
   [Advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf).
2. **Undici 7 im Simulator:** `wrangler` → `miniflare` → exakt `undici` 7.29.1,
   ausschließlich Development. npm zählt Undici als hoch und die beiden Eltern
   jeweils als moderat. Offen sind EventSource-Speicherverbrauch, SRI-Algorithmus-
   Normalisierung und ein unbehandelter Fehler bei zu vielen Content-Encodings.
   Relevant, falls der lokale Simulator entsprechende fremde Antworten verarbeitet;
   nicht Bestandteil des statischen Website-Builds oder Browserbundles. Fix ab
   7.30.1, aber der Simulator pinnt weiterhin 7.29.1. Auf einen korrigierten
   Upstream-Pin warten und dann Wrangler kompatibel aktualisieren.
   Der von npm vorgeschlagene Rücksprung auf Wrangler 4.35.0 ist keine geeignete
   pauschale Reparatur und wurde nicht ausgeführt.
   [EventSource](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685),
   [SRI](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472),
   [Content-Encoding](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c).

Keine direkten Major-Upgrades, kein `npm audit fix --force`, keine Overrides.

## Validierung und Grenzen

- Saubere Installation mit `npm ci --include=dev` bestanden; Manifest und
  Lockfile konsistent. npm bezeichnet einige vorhandene optionale WASM-Pakete
  nach frischem `ci` als `extraneous`; keine fehlende/ungültige direkte Dependency.
  Kein Prune-/Override-Workaround hierfür eingebaut.
- Astro Check: 0 Fehler, 0 Warnungen, 2 bereits vorhandene Hinweise.
- Build: 57 Seiten; Pagefind: 58 HTML-Dateien, Index vollständig erstellt.
  Finale Build-Ausgabe ohne Warnungen. Keine neuen Artikel-IDs vergeben.
- 97 lokale Tests für Profile, Kommentar-/Frontmatter-Verarbeitung, Quellen,
  Linkvorschauen und Realtime/Produktionskonfiguration bestanden.
- Worker-TypeScript-Prüfung und Wrangler-Versionsaufruf bestanden.
- Manifest-/Lockfile-/Versionsprüfung sowie gezielter Whitespace-Check bestanden.
  Bestehende Anwendungs- und Migrationsdateien per Inhalts-Hashes unverändert.
- Initiale Installation und Pagefind scheiterten innerhalb der Windows-Sandbox
  an Zugriffsrechten. Die finale Installation und der vollständige lokale Build
  wurden außerhalb der Sandbox erfolgreich geprüft. Keine Anpassung der
  Anwendung oder ihrer Konfiguration wegen dieser Sandbox-Fehler.
- Keine Browser-Testkampagne, keine Remote-Tests oder Remote-Schreiboperationen.
  Die globale Node-Installation muss der Betreiber noch auf die Projektvorgabe
  umstellen; die lokale Prüfung hat diese ausdrücklich nicht verändert.
