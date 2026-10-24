# MedDocs-Kommentare – Phase 3C

## UI-Feinschliff vom 17. Oktober 2026

Nur Darstellung und zugängliche UI-Zustände angepasst, keine SQL-/RPC-/Auth- oder
Moderationsregeln geändert. Der redundante Leserhinweis wurde ohne Platzhalter entfernt.
Der gemeinsam verwendete Composer kehrt weiterhin in seinen bestehenden Container zurück.

Native Moderations- und Rückzugsdialoge behalten `showModal()`/`close()`. Explizite
`inset: 0` und `margin: auto` gleichen Starlights globalen Margin-Reset aus;
die Leser-Abstandsregel schließt Dialoge aus. Dialoge haben begrenzte Breite/Höhe,
lokales Scrolling, umbrechende Pfade und einen neutralen Backdrop. Abbrechen erhält
beim Öffnen den Fokus; Escape/Abbrechen stellen den Auslöser wieder her. Bei einer
erfolgreichen Moderation verschwindet die betreffende Karte gegebenenfalls; dann
bleibt der bestehende Fokuswechsel zur Statusmeldung erhalten. Kein eigener Focus-Trap.

Eigene Pending-Zustände stehen als dezente neutrale Pills in der Autoren-/Datumszeile.
Ausstehende Bearbeitungen heißen weiterhin „Änderung wird geprüft“, abgelehnte und
ausgeblendete Zustände behalten ihre abweichenden Beschriftungen. Aktionen sind
Ghost-Buttons mit Hover-/Active-/Fokusdarstellung und mindestens 44 px Höhe bei Touch.
Zurückziehen bekommt ausschließlich bei Interaktion einen dezenten bestehenden Danger-Ton.

Die Zusatzzeile verwendet ausschließlich die bereits geladenen eigenen DTOs aus der
nach Nutzer/Artikel abgesicherten Map: `pending`, `active`, vorhandener privater Text,
noch keine veröffentlichte Fassung. Eigene Antworten zählen mit; bereits öffentliche
Beiträge mit ausstehender Bearbeitung bleiben bei ihrem separaten Änderungsbadge.
Singular/Plural werden unterschieden. Wegen fehlendem Gesamtcount im RPC wird bei
weiterem privaten Cursor „Mindestens …“ angezeigt, kein scheinbar exakter Gesamtwert.
Bei privaten Ladefehlern, Logout oder Artikel-/Accountwechsel ist die Zeile verborgen.
Es gibt keine zusätzlichen Abfragen. Der öffentliche Kommentarzähler bleibt unabhängig.
Die zugängliche Erfolgsmeldung nach dem Absenden bleibt für drei Sekunden sichtbar;
die Summary ist kein zweiter Live-Bereich mit einer redundanten Erfolgsmeldung.

Der folgende Abschnitt dokumentiert den ursprünglichen Phase-3C-Stand.

Stand: 11. Oktober 2026. Lokal umgesetzt und mit simulierten Diensten geprüft.
Keine Remote-Verbindung, Migration, Aktivierung oder Bereitstellung.
Backend und Rollout bleiben wie in [Phase 3B](meddocs-comments-phase3b.md).

## Leseransicht

`MedDocsComments.astro`, `comments-element.ts`, `dom.ts` und die ausschließlich
auf `meddocs-comments` begrenzten Styles bilden eine einzelne ruhige Card:
Kopfzeile, geschlossener Composer, Diskussion, zentrierte Pagination.
Die große medizinische Einführung und die zweite Liste „Deine Beiträge“ entfallen.
Die Grundstruktur der separaten Moderationsoberfläche bleibt erhalten.

Der Composer öffnet ein beschriftetes, mitwachsendes Textfeld. Derselbe Editor
wird für Antworten/Bearbeitungen direkt am ausgewählten Beitrag eingesetzt.
Abbrechen schließt ihn und stellt den Fokus wieder her. Eingaben und Fokus bleiben
bei Ladefehlern und Aktualisierungen erhalten. Logout, Account- oder Artikelwechsel
leeren private Inhalte und Entwürfe; abgebrochene/veraltete Antworten werden verworfen.

`presentation.ts` führt öffentliche DTOs und ausschließlich die eigenen privaten
DTOs anhand der Kommentar-ID für die Darstellung zusammen. Die öffentliche Fassung
wird durch eine ausstehende/abgelehnte Bearbeitung nicht ersetzt. Der private Entwurf
steht in einem kleinen Disclosure beim Beitrag. Eigene neue Beiträge bekommen einen
kurzen Status; nicht zuordenbare Antworten stehen in „Meine offenen Beiträge“ innerhalb
derselben Card. Öffentliche Counts und öffentliche Daten enthalten keine privaten DTOs.

Avatare verwenden Initialen/neutralen Benutzer-Icon, keine Gravatar-Abfrage. Admin/Autor
stammen aus der vorhandenen Staff-Zuordnung bzw. öffentlichen RPC-Projektion. Berufsangaben
werden nur aus öffentlichen DTOs angezeigt und als ungeprüfte Selbstangaben bezeichnet.
Absolute Kurzdatumsangaben mit `<time>` und vollem Datums-Tooltip altern nicht irreführend.

## Grenzen des vorhandenen RPC-Vertrags

Der unveränderte RPC liefert chronologisch aufsteigende Keyset-Pages und keinen Gesamtcount.
Deshalb ist „Chronologisch“ eine nicht interaktive Angabe. Ein Count erscheint erst, wenn
sämtliche Hauptkommentar-Pages und zugehörigen öffentlichen Antwort-Pages vollständig
geladen sind und die Antwortzahl übereinstimmt. Entfernte Textplatzhalter zählen nicht als
öffentliche Kommentare. Unbekannte Counts werden ausgelassen, niemals als `0` behauptet.
Es werden keine zusätzlichen Abfragen nur zur Berechnung einer Zahl ausgelöst.

## Getrennte Zustände

| Bereich | Verhalten |
| --- | --- |
| Öffentliche Abfrage | Initial kurzer Ladehinweis; leer nur nach erfolgreicher Abfrage. Bei Fehler eine Meldung „Kommentare sind momentan nicht verfügbar.“ mit Retry. Vorhandene öffentliche Daten bleiben lesbar. |
| Auth/Profil/Legal | Vorhandene zentrale Gates, kompakter Account-Link mit sicherem Rückweg. Kein erneutes OTP bei gültiger Session und fehlendem Profil/Legal. |
| Private Abfrage | Kleine lokale Meldung mit Retry, öffentliche Diskussion bleibt erhalten. |
| Schreiben | Fehler direkt beim Editor, Eingabe bleibt erhalten, vorhandene Request-ID/Version und Backend-Autorisierung bleiben maßgeblich. |
| Schreiben gesperrt | Kompakter Hinweis; Lesen bleibt möglich. |

`api.ts` unterscheidet fehlende RPCs/Tabellen (`PGRST202/204/205`, `42P01`, `42883`),
Netzwerkfehler, Berechtigungsfehler, tatsächliche Auth-Ablehnung und kontrollierte fachliche
Fehler. Fehlende Migrationen lösen keinen Logout aus. Nur eine echte Auth-Ablehnung löst
die bestehende Session-Abmeldung aus. Entwicklungsdiagnosen enthalten ausschließlich den
festen RPC-Namen und die klassifizierte Ursache, keine Providertexte, Tokens oder Inhalte.

## Lokale Prüfungen und spätere Inbetriebnahme

Erweiterte Kommentar-Unit-/Browserregressionen prüfen Merge/Revisionen, Counts, unbekannte
Counts bei Fehlern, fehlende RPCs, Netzwerk/Berechtigungen, private Fehler, Gates,
Composer/Antworten, Retry, Fokus, Rückzug, Moderation, Session-/Artikelwechsel und XSS als
Text. Browserbreiten: 320, 375, 768, 1440 px; Dark/Light, lange Wörter/URLs und statische
Darstellung bei Reduced Motion. Alle externen Anfragen werden vor Navigation simuliert
oder blockiert. Zusätzlich bestehen die bisherigen Auth-/Profil-/Legal-/Löschtests,
Account-Browserregression, MedDocs-Metadatentests, strikte TypeScript-Prüfung, Astro Check,
Build und `git diff --check`. Astro meldet ausschließlich den bestehenden Basel-Hint.

Diese Mocks beweisen keine echten PostgreSQL-Rechte, Auth-Service-Trigger oder parallelen
Transaktionen. Screenreader mit NVDA/VoiceOver und echte Bildschirmtastaturen benötigen
weiterhin manuelle Prüfung. SQL, generierte Datenbanktypen, Secrets und Dependencies wurden
gegenüber dem lokalen Ausgangsstand nicht verändert.

Vor Staging: alle ausstehenden Migrationen/Historie und Rechte reviewen, isolierte SQL/RLS-
und Parallelitätstests durchführen, anschließend separat freigegeben in Staging anwenden.
Artikelkatalog kontrolliert importieren, ausgewählte Testartikel ausdrücklich aktivieren,
offizielle Typen generieren und echte User-/Author-/Admin-Tests mit Testaccounts durchführen.
Rechtstexte/Moderationsbetrieb vor öffentlicher Aktivierung freigeben. Die Phase-3C-UI braucht
nach Bereitstellung der bestehenden RPCs keinen weiteren Umbau; Retry/Reload lädt normale Daten.
