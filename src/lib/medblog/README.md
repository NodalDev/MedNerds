# MedBlog

MedBlog-Beiträge liegen als einzelne `.md`- oder `.mdx`-Dateien in
`src/content/medblog/`. Der Dateiname ist der stabile Slug: Kleinbuchstaben,
Zahlen und Bindestriche. Die eigene Collection vermeidet Konflikte mit
Starlight-Feldern und hält Blog-Pflichtfelder von MedDocs getrennt.

```yaml
title: Neuer Lagetyptrainer auf MedTools
description: Ein kurzer redaktioneller Einstieg.
type: news
areas:
  - medtools
authors:
  - orlando-frey
published: 2026-09-27
# Optional:
# updated: 2026-10-04
# image:
#   src: ../../assets/medblog/mein-bild.webp
#   alt: Eine konkrete Beschreibung des Bildes.
tags:
  - EKG
featured: false
cta:
  label: Lagetyptrainer ausprobieren
  href: /medtools/ekg/lagetyptrainer/
draft: false
```

Beispieldaten sind keine automatische redaktionelle Datierung. Autoren und
Veröffentlichungs-/Aktualisierungsdaten werden bewusst gepflegt.

- `src/data/medblog.ts` definiert Typen, deutsche URL-Segmente und bekannte Areas.
  `article → artikel`, `news → news`, `update → updates`.
- `areas` sind bekannte Plattformbereiche; `tags` sind davon getrennte freie,
  nicht leere Themenbezeichnungen.
- Die Personen-Registry in `src/data/authors.ts` und die MedDocs-Datumsvalidierung
  werden wiederverwendet. Unbekannte IDs und ungültige Daten sind Content-Fehler.
- Bilder sind optional. Astros `image()` validiert lokale Dateien und liefert
  Abmessungen; `Image` erzeugt responsive Varianten. Neue Blogbilder können unter
  `src/assets/medblog/` abgelegt werden. Keine externen Hotlinks oder Platzhalter.
  Standard ist `fit: cover`; `fit: contain` zeigt bei Illustrationen wie dem
  verwendeten Signet das gesamte Motiv innerhalb derselben 16:9-Fläche.
- CTAs sind optional und erlauben interne absolute Pfade oder HTTPS-URLs.

## Routen und Darstellung

Die `/medblog/`-Seite bindet `MedBlogArchive` ein. `MedBlogHub` bleibt für die
bestehenden Typübersichten zuständig. Statische Astro-Routen
unter `src/pages/medblog/[type]/` erzeugen Typübersichten und Detailseiten mit
`StarlightPage`. Header, Website-Footer und Mobile Drawer bleiben vorhanden;
die MedDocs-Sidebar und ein TOC werden im Blog nicht eingeblendet.

Der Typ ist nur im Frontmatter kodiert; der Dateiname wiederholt ihn nicht.
Ein Wechsel des Beitragstyps ändert den URL-Pfad und sollte bei bereits
veröffentlichten Beiträgen redaktionell mit einer Weiterleitung geplant werden.

`getMedBlogPosts({ type?, area? })` ist die gemeinsame Datenquelle für alle
Übersichten und Detailrouten sowie spätere bereichsspezifische Beitragslisten.
Die Auswahl ist nach `published DESC` sortiert, bei gleichem Datum nach Slug.
Produktions-Builds schließen Drafts zentral aus; lokal sind sie sichtbar.

`MedBlogCard` unterstützt Featured-, Standard-, kompakte Update- und die nur im
Archiv verwendete Editorial-Darstellung. Das Archiv hebt den neuesten Featured-
Beitrag hervor und zeigt alle übrigen Beiträge chronologisch im gemeinsamen Feed.
Ein Beitrag wird nur einmal dargestellt. Bilder haben ein festes
Seitenverhältnis; Karten ohne Bild erhalten keine leere Bildfläche.

`MedBlogPost` verwendet die bestehende Meta-Zeile für Autoren und Datum und
ergänzt Typ, Areas, Tags, optionales Bild und optionalen CTA am Ende.

## Filter

Ein natives Custom Element filtert die bereits serverseitig gerenderten Karten.
Typ und Area sind kombinierbar, im Archiv zusätzlich ein Thema aus den echten Tags.
Dort werden höchstens zwölf Themen nach Häufigkeit und anschließend alphabetisch
angeboten. `filters.ts` validiert URL-Werte und bündelt die Filterbedingungen für
die Datenauswahl und das Archiv. Leere Gruppen werden ausgeblendet; ohne Treffer
erscheint ein erklärender Zustand mit Reset. Query-Parameter `type`, `area` und
im Archiv `tag` sind teilbar.
`pushState` und `popstate` unterstützen Zurück/Vorwärts ohne neue Requests.
Typübersichten behalten ihren festen Typ und bieten weiterhin den Area-Filter.
Event-Listener werden bei Entfernung des Elements aufgeräumt.

Ohne JavaScript bleiben alle Karten und Links zu den Typübersichten nutzbar.
Es gibt weder eine neue Suche noch Pagination oder vollständige Seiten-Hydration.

## Startinhalte und Prüfen

Die drei Startbeiträge sind ausdrücklich als Beispiele gekennzeichnet. Der
redaktionelle Beispielartikel verwendet das vorhandene MedNerds-Signet als
Illustration. Die Lagetyptrainer-News hat bewusst kein Bild, da kein geeigneter
Screenshot im Repository vorhanden war.

```sh
node --experimental-strip-types scripts/test-medblog.mjs
node --experimental-strip-types scripts/test-meddocs-article-metadata.mjs
npx astro check
npm run build
```
