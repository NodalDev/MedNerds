# Inhalte hinzufügen und in MedDocs einordnen

Diese Datei beschreibt, wie neue MedDocs-Inhalte angelegt, benannt und in der Sidebar sortiert werden.

> Bearbeite ausschließlich die Quelldateien unter `src/content/docs/`.
> Dateien in `dist/` werden beim Build erzeugt und dürfen nicht manuell bearbeitet werden.

## MedDocs-Struktur

Die MedDocs-Inhalte liegen unter:

```text
src/content/docs/meddocs/
```

Die wichtigsten Bereiche sind aktuell:

| Bereich | Ordner |
| --- | --- |
| MedDocs-Übersicht | `src/content/docs/meddocs/` |
| EKG | `src/content/docs/meddocs/ekg/` |
| Echokardiographie | `src/content/docs/meddocs/echokardiographie/` |
| Sonographie | `src/content/docs/meddocs/sonographie/` |
| Notfallmedizin | `src/content/docs/meddocs/notfallmedizin/` |
| Diverses | `src/content/docs/meddocs/diverses/` |

Die übergeordneten MedDocs-Bereiche und ihre Reihenfolge werden zentral in der Starlight-Konfiguration definiert.

Innerhalb der Bereiche können weitere Unterordner angelegt werden.

Beispiel:

```text
src/content/docs/meddocs/
├── index.mdx
├── ekg/
│   └── index.mdx
├── echokardiographie/
│   ├── index.mdx
│   └── theorie-grundlagen/
│       └── ...
├── sonographie/
│   └── index.mdx
├── notfallmedizin/
│   └── index.mdx
└── diverses/
    └── index.mdx
```

## Markdown oder MDX

Für normale Artikel können sowohl `.md`- als auch `.mdx`-Dateien verwendet werden.

Verwende `.mdx`, wenn innerhalb des Inhalts Astro-/MDX-Komponenten oder andere erweiterte Elemente benötigt werden.

Beispiel:

```text
src/content/docs/meddocs/ekg/sinusrythmus.mdx
```

## Übersicht eines Bereichs

Die Übersichtsseite eines Ordners wird als:

```text
index.mdx
```

angelegt.

Beispiel:

```text
src/content/docs/meddocs/echokardiographie/index.mdx
```

entspricht:

```text
/meddocs/echokardiographie/
```

Eine Datei:

```text
src/content/docs/meddocs/echokardiographie/theorie-grundlagen.mdx
```

würde entsprechend unter:

```text
/meddocs/echokardiographie/theorie-grundlagen/
```

erreichbar sein.

## Neue Seite anlegen

Eine neue Seite benötigt mindestens einen Frontmatter-Block mit einem Titel.

Beispiel:

```yaml
---
title: Grundlagen des EKG
---
```

Danach folgt der eigentliche Inhalt:

```md
---
title: Grundlagen des EKG
---

Einleitung des Artikels.

## Grundlagen

...
```

## Reihenfolge in der Sidebar

Mit `sidebar.order` kann die Position einer Seite innerhalb ihrer Gruppe festgelegt werden.

Beispiel:

```yaml
---
title: Grundlagen des EKG
sidebar:
  order: 10
---
```

Kleinere Zahlen erscheinen vor größeren Zahlen.

Verwende möglichst Abstände wie:

```text
10
20
30
40
```

Dadurch kann später problemlos ein weiterer Artikel dazwischen eingefügt werden:

```text
10
15
20
30
```

Die Sortierung gilt jeweils innerhalb der entsprechenden Sidebar-Gruppe.

## Kürzerer Titel in der Sidebar

Wenn der Seitentitel ausführlicher sein soll als der Eintrag in der Sidebar, kann `sidebar.label` verwendet werden.

Beispiel:

```yaml
---
title: Einführung in die Echokardiographie
sidebar:
  label: Einführung
  order: 10
---
```

Die Seite trägt weiterhin den Titel:

```text
Einführung in die Echokardiographie
```

In der Sidebar erscheint jedoch:

```text
Einführung
```

## Seite aus der Sidebar ausblenden

Eine Seite kann bei Bedarf aus der Sidebar ausgeblendet werden:

```yaml
---
title: Beispielseite
sidebar:
  hidden: true
---
```

Die Seite bleibt weiterhin über ihre URL erreichbar.

Diese Option sollte nur verwendet werden, wenn die Seite bewusst nicht Teil der normalen MedDocs-Navigation sein soll.

## Dateinamen

Verwende für Dateien und Ordner:

- nur Kleinbuchstaben
- keine Leerzeichen
- möglichst keine Umlaute
- Wörter mit Bindestrichen trennen

Gut:

```text
theorie-grundlagen.mdx
anatomie-des-herzens.mdx
herzinsuffizienz.mdx
```

Vermeiden:

```text
Theorie Grundlagen.mdx
Anatomie_des_Herzens.mdx
Übersicht.mdx
```

Das ist insbesondere wichtig, weil bei Deployment-Systemen auf Linux Groß- und Kleinschreibung unterschieden wird.

Beispielsweise sind:

```text
echokardiographie/
```

und:

```text
Echokardiographie/
```

technisch unterschiedliche Ordner.

## URLs

Die URL einer Seite ergibt sich normalerweise automatisch aus ihrer Position unter `src/content/docs/`.

Beispiel:

```text
src/content/docs/meddocs/ekg/grundlagen.mdx
```

wird zu:

```text
/meddocs/ekg/grundlagen/
```

Ein `index.mdx` repräsentiert jeweils den Ordner selbst:

```text
src/content/docs/meddocs/ekg/index.mdx
```

wird zu:

```text
/meddocs/ekg/
```

Manuelle `slug`-Angaben sollten nur verwendet werden, wenn bewusst eine bestehende URL erhalten oder eine abweichende URL benötigt wird.

## Untergruppen

Unterordner innerhalb eines MedDocs-Bereichs können als weitere thematische Gruppen verwendet werden.

Beispiel:

```text
src/content/docs/meddocs/echokardiographie/
├── index.mdx
└── theorie-grundlagen/
    ├── grundlagen.mdx
    └── schallphysik.mdx
```

Dadurch können größere Fachgebiete strukturiert erweitert werden, ohne alle Artikel direkt auf einer Ebene abzulegen.

## Seitenlayouts

MedNerds unterstützt für bestimmte Seitentypen eigene Layouts über `pageLayout`.

Diese Layouts sollten nur verwendet werden, wenn die Seite tatsächlich dem entsprechenden Seitentyp entspricht.

Beispiel für eine Hub-/Übersichtsseite:

```yaml
---
title: MedDocs
pageLayout: hub
---
```

Das `hub`-Layout ist für zentrale Bereichsübersichten gedacht.

Normale medizinische Artikel benötigen in der Regel kein eigenes `pageLayout`.

Rechtliche Seiten verwenden das dafür vorgesehene Legal-Layout.

## Änderungen prüfen

Nach Änderungen an Inhalten oder Frontmatter sollte mindestens ausgeführt werden:

```powershell
npx astro check
```

und:

```powershell
npm run build
```

Beide Befehle sollten ohne Fehler durchlaufen.

## Wichtig

- `dist/` niemals manuell bearbeiten.
- Keine generierten Dateien als Inhaltsquelle verwenden.
- Dateinamen und Ordner konsequent klein schreiben.
- Bestehende URLs möglichst nicht ohne Grund ändern.
- `sidebar.order` mit ausreichend Abstand vergeben.
- Für Bereichsübersichten `index.mdx` verwenden.
- Neue Sonderlayouts oder Sidebar-Strukturen nicht pro Artikel improvisieren.

## Weiterführende Dokumentation

Starlight-Dokumentation zur Sidebar:

https://starlight.astro.build/guides/sidebar/

Astro Content Collections:

https://docs.astro.build/en/guides/content-collections/