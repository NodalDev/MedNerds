# MedNerds

**Freies medizinisches Wissen – verständlich, fundiert und offen zugänglich.**

MedNerds ist eine unabhängige medizinische Lern- und Wissensplattform.  
Ziel ist es, medizinisches Wissen strukturiert aufzubereiten und für Studium, klinischen Alltag und eigenständiges Lernen zugänglich zu machen.

> **Status:** MedNerds befindet sich aktuell in aktiver Entwicklung.

## Versionierung

Die Projektversion in `package.json` orientiert sich an Semantic Versioning;
`package-lock.json` führt dieselbe Version. Mit `0.5.0` wurde die zuvor
uneinheitliche Nummerierung einmalig vereinheitlicht.

- `0.x.y` kennzeichnet die Entwicklungsphase.
- `1.0.0` steht für den ersten bewusst freigegebenen stabilen Versionsstand.
- Patch-Versionen kennzeichnen kleinere Fehlerkorrekturen; Minor-Versionen neue Entwicklungsmeilensteine.
- Git-Tags haben das Format `vX.Y.Z` und stimmen mit `package.json` überein. Sie werden nur für bewusst freigegebene Versionsstände erstellt, nicht automatisch für jeden Commit.
- SQL-Migrationsversionen bleiben unabhängig von der MedNerds-Projektversion.

## Bereiche

MedNerds besteht aus mehreren Bereichen mit unterschiedlichen Schwerpunkten:

- **MedDocs** – strukturiertes medizinisches Wissen zum Lernen, Verstehen und Nachschlagen
- **MedBlog** – medizinische Beiträge, Hintergründe und aktuelle Themen
- **MedLearn** – interaktive Lerninhalte und Übungen
- **MedCases** – klinische Fälle und fallbasiertes Lernen
- **MedTools** – praktische medizinische Werkzeuge
- **MedNerds Basel** – lokale Community und Austausch

Der aktuelle Entwicklungsschwerpunkt liegt auf **MedDocs** und der technischen Grundlage der Plattform.

## MedDocs

MedDocs bildet die medizinische Wissensbasis von MedNerds.

Aktuell entstehen Inhalte unter anderem zu:

- EKG
- Echokardiographie
- Sonographie
- Notfallmedizin

Die Inhalte werden schrittweise erweitert und strukturiert miteinander verknüpft.

## Technologie

Die Website ist als weitgehend statische und performante Webanwendung aufgebaut.

Zum Einsatz kommen unter anderem:

- [Astro](https://astro.build/)
- [Starlight](https://starlight.astro.build/)
- [React](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- TypeScript

## Lokale Entwicklung

Die konkrete Node.js-Version steht in `.node-version`; der kompatible Bereich
für Node.js und npm in `package.json` unter `engines`. Verwende die angegebene
Node-22-LTS-Version mit aktuellen Sicherheitsupdates. Systemweite Installationen
werden durch diese Dateien nicht automatisch umgestellt.

Repository klonen und Abhängigkeiten installieren:

```bash
git clone https://github.com/NodalDev/MedNerds.git
cd MedNerds
npm ci --include=dev
```

Die DevDependencies werden auch für den statischen Build benötigt: unter anderem
Astro Check, TypeScript, Icon-Daten und `js-yaml` für die lokale
Artikelvorbereitung. `npm ci` installiert die Versionen aus `package-lock.json`;
das Lockfile zusammen mit `package.json` versionieren. Ein Hosting-Build darf
die DevDependencies daher nicht mit `--omit=dev` ausschließen.

Künftige GitHub-Actions-Workflows sollen bei `actions/setup-node`
`node-version-file: .node-version` verwenden. Netlify kann dieselbe Datei lesen;
abweichende `NODE_VERSION`-Overrides dort vermeiden. Es ist kein neuer
Deployment-Workflow eingerichtet worden.

| Anlass | Befehl | Umfang |
| --- | --- | --- |
| Kleine Änderungen während der Entwicklung | `npm run check:quick` | Astro Check und schnelle lokale Auth-/Profil-, Metadaten-, Filter- und Timerprüfungen; kein Build |
| Größere Änderungen / vor GitHub | `npm run check:full` | Quick einmal, weitere lokale Unit-/Mocktests, ein regulärer Build mit Pagefind, Prüfungen seiner Ausgabe und isolierte Quellen-Buildtests |
| Vor öffentlichem Release | `npm run check:release` | Vorerst Alias für Full; keine Bereitstellung oder zusätzliche Cloud-Prüfung |

Alle Stufen arbeiten ohne Datenbankverbindung und ohne Änderungen an
Quelldateien. Full schreibt reguläre Build-Artefakte und eigene temporäre
Testkopien. Seine zwei zusätzlichen Quellen-Builds prüfen gezielt die
Idempotenz des Content-Caches; sie überschreiben kein reguläres `dist/`.
Die Testlisten sind ausdrücklich aufgezählt, ohne automatische `test-*`-Suche.

Einzelne Tests bleiben direkt ausführbar. Browser-/Live-Tests mit CDP, Worker
oder Datenbank sind bewusste manuelle Spezialprüfungen. Inventar, Voraussetzungen
und Sicherheitsgrenzen stehen in [scripts/README.md](scripts/README.md).
`npx astro check` und `npm run build` bleiben separat verfügbar.
Der Befehl `npm run build:production` synchronisiert zusätzlich Kommentare mit
Supabase und ist ausdrücklich kein lokaler Check.

`dev`, `start` und `build` prüfen vorhandene Artikel-UUIDs nur lesend über
`npm run comments:check`. Fehlt einem veröffentlichten MedDocs-Artikel die ID,
vorher ausdrücklich `npm run comments:prepare` ausführen und die ergänzte
Frontmatter-ID prüfen und mit dem Artikel versionieren. Bestehende IDs bei
Umbenennungen beibehalten; der normale Build vergibt keine IDs.

## Linksammlung pflegen

Die Seite `/medtools/links/` liest ausschließlich die Collection `linkResources`.
Jede Ressource liegt als eigene `.md`-Datei unter `src/content/link-resources/`;
ein Artikeltext nach dem Frontmatter ist nicht erforderlich. Die Sammlung startet
leer, bis redaktionell ausgewählte Ressourcen eingetragen werden.
Beim allerersten Eintrag in die bislang leere Collection den lokalen Dev-Server
neu starten; danach übernimmt der vorhandene Astro-Loader das Content-Watching.

Beispiel für das Dateiformat (Platzhalter, keine tatsächliche Empfehlung):

```yaml
---
title: Beispiel
description: Kurze neutrale Beschreibung.
url: https://example.org/
provider: Beispielorganisation
specialties:
  - ultraschall
  - notfallmedizin
formats:
  - website
topics:
  - pocus
languages:
  - de
access: free
featured: false
# checked erst nach einer tatsächlichen redaktionellen Prüfung setzen:
# checked: 2026-10-06
---
```

Pflichtfelder sind Titel, knappe neutrale Beschreibung, vollständige HTTP-/HTTPS-URL,
mindestens ein Fachgebiet, Format und Sprache. `provider` bezeichnet den Anbieter;
`topics` sind freie Suchbegriffe und haben keinen eigenen Filter. `access` ist optional.
`featured: true` sortiert die Ressource vor den anderen Einträgen, ansonsten gilt
die alphabetische Titelreihenfolge. `checked` bedeutet **zuletzt redaktionell geprüft**,
keine automatisierte Verifikation; ISO-Kalenderdaten werden wie bei MedDocs normalisiert.

Erlaubte IDs und UI-Labels stehen zentral in `src/data/link-resources.ts`:

- Fachgebiet: `anaesthesie`, `ekg`, `echokardiographie`, `notfallmedizin`, `ultraschall`, `allgemein`
- Format: `leitlinie`, `literatur`, `podcast`, `video`, `kurs`, `hands-on`, `website`, `tool`
- Sprache: `de`, `en`, `fr`, `it`
- Zugang: `free`, `paid`, `mixed`

Mehrere Fachgebiete, Formate und Sprachen können als YAML-Liste angegeben werden.
`allgemein` gilt ausschließlich für den Filter „Allgemein“, nicht automatisch für alle Gebiete.
Keine HTML-Beschreibungen oder ungeprüften Empfehlungs-/Prüfversprechen eintragen.

`LinkExplorer` rendert alle Ressourcen serverseitig. Suche und Einzelfilter je Dimension
werden lokal im Browser ergänzt und mit AND kombiniert. Die Vollansicht synchronisiert
`q`, `specialty`, `format`, `language`, `access` via `replaceState`; `popstate` liest den
URL-Zustand erneut. Ohne JavaScript bleiben alle Links sichtbar.
Die fünf MedDocs-Seiten „Links & Ressourcen“ verwenden denselben Explorer mit
festem Fachgebiet, verborgenem Fachgebietsfilter und kompakter Darstellung.
`specialties` bestimmt automatisch, auf welchen Seiten eine Ressource erscheint:
`[ultraschall, notfallmedizin]` zeigt sie in beiden Bereichen. `allgemein` hat keine
eigene MedDocs-Ansicht mehr; der Filter bleibt in der zentralen MedTools-Linksammlung erhalten.
Linkdaten werden dafür nicht dupliziert. Die Baseline gilt bereits serverseitig
und kann durch Query-Parameter nicht überschrieben werden. Suche, Format, Sprache
und Zugang werden auf diesen Seiten mit der URL synchronisiert; der Canonical
bleibt die Basisroute. Eingebettete Ansichten ändern die Seiten-URL standardmäßig
nicht (`syncUrl={false}`).

Tests ohne zusätzliche Test-Dependencies:

```sh
node --experimental-strip-types scripts/test-link-resources.mjs
# Mit lokalem Chrome/CDP; der Browsertest startet seinen eigenen Astro-Server:
node --experimental-strip-types scripts/test-link-resources-browser.mjs
```

`LINKS_SITE` (Standard `http://127.0.0.1:4325`) und `LINKS_CDP` (Standard
`http://127.0.0.1:9334`) passen die Testumgebung an. Der Browsertest benötigt
keine leere Collection: Er ergänzt temporäre Testdaten und eine Draft-Testansicht,
lässt vorhandene Ressourcen bestehen und entfernt die Testdaten in `finally`.
Er prüft auch die fünf MedDocs-Ansichten, die Sidebar-Reihenfolge und den entfernten
Diverses-Eintrag. Der Testserver-Port muss
frei sein. Währenddessen keinen Production-Build oder Deployment ausführen.

## Lizenzierung

MedNerds verwendet unterschiedliche Lizenzen für Quellcode, eigene Inhalte und weitere Bestandteile des Projekts.

### Quellcode

Von MedNerds selbst entwickelte Softwarebestandteile und Quellcode dieses Repositorys stehen, soweit nicht anders angegeben, unter der **MIT License**.

Die vollständigen Lizenzbedingungen findest du in der Datei [`LICENSE`](./LICENSE).

### Medizinische und redaktionelle Inhalte

Von MedNerds erstellte medizinische, naturwissenschaftliche und redaktionelle Inhalte stehen, soweit nicht ausdrücklich anders angegeben, unter der:

**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**

Diese Lizenz erlaubt das Teilen und Bearbeiten der betreffenden Inhalte unter anderem unter folgenden Bedingungen:

- angemessene Namensnennung
- Hinweis auf die Lizenz
- Kennzeichnung vorgenommener Änderungen
- ausschließlich nichtkommerzielle Nutzung
- Weitergabe von Bearbeitungen unter CC BY-NC-SA 4.0 oder einer zulässigen kompatiblen Lizenz

Weitere Informationen:

https://creativecommons.org/licenses/by-nc-sa/4.0/

### Ausnahmen

Die MIT- und CC-BY-NC-SA-Lizenzen gelten nicht automatisch für sämtliche Dateien oder Inhalte dieses Repositorys.

Insbesondere können ausgenommen sein:

- das MedNerds-Logo und charakteristische Branding-Elemente
- Bilder, Fotografien und andere Medien Dritter
- zitierte Publikationen, Leitlinien und wissenschaftliche Quellen
- Datensätze Dritter
- Inhalte mit ausdrücklich abweichender Lizenzangabe
- personenbezogene Daten und Nutzerinhalte

Eine konkrete Lizenz- oder Rechteangabe bei einem bestimmten Inhalt oder einer Datei hat Vorrang vor diesen allgemeinen Hinweisen.

Ausführliche Informationen zur Lizenzierung und Weiterverwendung findest du unter:

**https://mednerds.ch/urheberrecht/**

Bei Fragen zu Lizenzen und Nutzungsrechten:

**legal@mednerds.ch**
