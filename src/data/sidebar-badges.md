# Sidebar-Status bearbeiten

Alle Zuordnungen stehen in `sidebar-badges.ts` im Array `sidebarBadges`.

```ts
// Hauptgruppe
{ group: ['Echokardiographie'], badge: 'new' },

// Untergruppe: vollständiger Pfad der sichtbaren Gruppenlabels
{ group: ['Echokardiographie', 'Theorie & Grundlagen'], badge: 'planned' },

// Einzelner Link: exakte URL wie in der Sidebar, inklusive abschließendem /
{ href: '/meddocs/echokardiographie/theorie-grundlagen/test/', badge: 'popular' },
```

| Status | Beschriftung | Farbe |
| --- | --- | --- |
| `new` | Neu | Grün |
| `top` | Top | Rot |
| `soon` | Bald | Blau |
| `planned` | Geplant | Violett |
| `popular` | Beliebt | Orange |

Zum Entfernen eines Status die entsprechende Zeile löschen. Nicht zugeordnete
Einträge behalten gegebenenfalls ihren bereits vorhandenen Starlight-Badge.
Die fünf Hauptgruppen sind als leicht änderbare Beispiele eingetragen.

Die Texte werden zentral in `sidebarBadgeLabels` übersetzt (Deutsch und Englisch
vorbereitet, Deutsch als Fallback). Bei später übersetzten Gruppenlabels oder
URLs müssen auch die entsprechenden Zuordnungen ergänzt werden.

Starlight rendert die Badges als informative, nicht fokussierbare Spans.
Die Zuordnung wird nur auf MedDocs-Seiten angewendet. Farben und kompakte
Darstellung stehen im Sidebar-Abschnitt von `src/styles/global.css`.
