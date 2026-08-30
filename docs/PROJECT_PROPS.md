# Projekteigene OSCAL-Properties

Dieses Dokument ist der öffentliche Vertrag für OSCAL-Properties des
Grundschutz++ Navigators. Seine einzige Runtime-Quelle ist die tief
unveränderliche Registry in `src/domain/projectProps.ts`.

## Namespace und Vertrauensgrenze

Der Projektnamespace lautet exakt:

```text
https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props
```

Der Namespace ist ausschließlich eine stabile Identität. Er ist keine URL,
die der Navigator auflöst oder über das Netzwerk abruft.

Properties mit einem anderen Namespace bleiben im Quellgraphen unverändert
und werden nicht als Projektsemantik interpretiert. Ein unbekannter Name im
Projektnamespace erzeugt eine redigierte Diagnose und sperrt den semantischen
Schreibpfad. Lesen, No-op-Export und Backup reichen das ursprüngliche Property
einschließlich unbekannter Felder unverändert durch.

## Registry

| Name | Bedeutung | Werteraum | Träger | Kardinalität | Validierung und kanonische Schreibweise | Einführendes Issue |
| --- | --- | --- | --- | --- | --- | --- |
| `implementation-priority` | Fachliche Priorität einer Umsetzungsmaßnahme | `high`, `medium`, `low` | `poam-item` oder die explizit derselben Maßnahme zugeordnete `remediation` | 0..1 je Maßnahme, auf genau einem der beiden Träger | Exakter Token; keine Aliaswerte | [GSPP-356](https://linear.app/grundschutz-plus-plus/issue/GSPP-356) |
| `effort-estimate-hours` | Optionale Aufwandsschätzung in Stunden | Positive kanonische Dezimalzahl mit höchstens zwei Nachkommastellen | `poam-item` oder die explizit derselben Maßnahme zugeordnete `remediation` | 0..1 je Maßnahme, auf genau einem der beiden Träger | Dezimalpunkt, keine Einheit, kein Vorzeichen, keine Exponentialschreibweise; UI-Komma wird vor dem Schreiben normalisiert | [GSPP-356](https://linear.app/grundschutz-plus-plus/issue/GSPP-356) |
| `custom-tag` | Lokales Schlagwort einer implementierten Anforderung | Getrimmter, nichtleerer Klasse-2-Text | `implemented-requirement` | 0..n; je Träger case-insensitiv eindeutig | Wert wird nicht umgedeutet oder automatisch extern ergänzt | [GSPP-312](https://linear.app/grundschutz-plus-plus/issue/GSPP-312) |
| `protection-need-level` | Projektbezogener Schutzbedarf eines Zielobjekts | `normal`, `hoch` | `system-component`, `inventory-item`, `information-type` | 0..1 je Zielobjekt | Nichtleere `remarks` sind Pflicht; keine Ableitung aus OSCAL-CIA-Werten | [GSPP-355](https://linear.app/grundschutz-plus-plus/issue/GSPP-355) |
| `assessed-against-catalog-key` | Stabiler Katalogschlüssel einer Bewertung | Registrierter `catalogKey` | `metadata` | 0..1 je `group` | `group` ist NCName-konform und exakt gleich dem Property-Wert | [GSPP-361](https://linear.app/grundschutz-plus-plus/issue/GSPP-361) |
| `assessed-against-catalog-commit` | Exakter Katalogstand einer Bewertung | Vollständiger Git-Commit-SHA | `metadata` | 0..1 je `group` | Genau 40 kleingeschriebene Hex-Zeichen; Partner-Key mit identischer `group` ist Pflicht | [GSPP-361](https://linear.app/grundschutz-plus-plus/issue/GSPP-361) |

`name` und eine vorhandene `group` müssen OSCALs `TokenDatatype`-/NCName-Regel
erfüllen. Die erlaubten Träger werden der Domain-API als geschlossene Kennung
übergeben; frei zusammengesetzte JSON-Pfade sind nicht zulässig.

## Maßnahmenkontext

Die beiden Planungsproperties dürfen für dieselbe Maßnahme entweder auf dem
`poam-item` oder auf der zugehörigen Risk Response (`remediation`) liegen,
nicht auf beiden. Der Validator erhält diese fachliche Zuordnung ausdrücklich
als Paar von Props-Listen. Er scannt keinen vollständigen Dokumentgraphen und
leitet aus `related-risks` keine bestimmte Remediation ab, weil ein Risk
mehrere Responses besitzen kann.

## Katalogreferenzpaar

Die beiden `assessed-against-*`-Properties werden pro `group` als Paar
ausgewertet. Vollständige Abwesenheit ist gültig. Sobald ein Partner vorhanden
ist, müssen Key und Commit jeweils genau einmal mit derselben Gruppe vorkommen.
Mehrere vollständige Paare für verschiedene registrierte Katalogschlüssel sind
zulässig. Fehlende oder doppelte Partner, abweichende Gruppen, unbekannte Keys
und nicht kanonische Commits sperren den Schreibpfad.

## Kanonischer Aufwand

Gültige Speicherwerte sind beispielsweise `0.25`, `1.5` und `12`.
Nichtkanonisch und damit ungültig sind unter anderem `0`, `1.50`, `1.234`,
`1e3`, `1 h` und `01`. Die UI-Grenze darf genau ein Dezimalkomma normalisieren,
zum Beispiel `1,5` zu `1.5`; der Speicherparser selbst akzeptiert kein Komma.

## Diagnosen und Datenschutz

Properties können Klasse-2-Inhalte wie Systemdetails, Bewertungen oder freie
Schlagworte tragen. Diagnosen enthalten deshalb nur stabile Codes,
geschlossene Strukturpfade, Validatorversionen und strukturelle Zähler. Werte,
Freitexte, unbekannte Namen, Gruppeninhalte und UUIDs dürfen weder in Diagnosen
noch in Logs, URLs oder Telemetrie gelangen.

## Erweiterung

Ein neuer Projektname benötigt vor seiner Nutzung eine explizite
Vertragsänderung: Bedeutung, Werteraum, Träger, Kardinalität, kanonische
Schreibregel, einführendes Issue sowie Unit-, Redaction- und Round-trip-Tests.
Bis dahin bleibt er verlustfrei lesbar, aber semantisch fail-closed.
