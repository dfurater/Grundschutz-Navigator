# Projekteigene OSCAL-Properties

Öffentlicher Vertrag für OSCAL-Properties des Grundschutz++ Navigators.
Einzige Runtime-Quelle ist die tief unveränderliche Registry in
`src/domain/projectProps.ts`.

## Namespace und Vertrauensgrenze

Der Projektnamespace lautet exakt:

```text
https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props
```

Der Namespace ist eine stabile Identität — keine URL, die der Navigator
auflöst oder abruft.

Properties mit einem anderen Namespace bleiben im Quellgraphen unverändert
und werden nicht als Projektsemantik interpretiert. Ein unbekannter Name im
Projektnamespace erzeugt eine redigierte Diagnose und sperrt den semantischen
Schreibpfad. Lesen, No-op-Export und Backup reichen das ursprüngliche Property
einschließlich unbekannter Felder unverändert durch (`preservedProps`).

## Registry

Die Vertragstabelle ist maschinengeprüft
(`projectProps.contract.node.test.ts` vergleicht sie Zelle für Zelle mit der
Registry): zusätzliche, fehlende oder abweichende Einträge brechen den Build.

<!-- project-props-contract:start -->
| Name | Bedeutung | Werteraum | Trägerkennungen | Minimum | Maximum | Scope | Wertvertrag | Kanonisierung | Validierung und Schreibweise | Einführendes Issue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `implementation-priority` | Fachliche Priorität einer Umsetzungsmaßnahme | `high`, `medium`, `low` | `poam-item`, `remediation` | `0` | `1` | `carrier` | `implementation-priority` | `identity` | Exakter Token; keine Aliaswerte | [GSPP-356](https://linear.app/grundschutz-plus-plus/issue/GSPP-356) |
| `effort-estimate-hours` | Optionale Aufwandsschätzung in Stunden | Positive, endliche kanonische Dezimalzahl mit höchstens zwei Nachkommastellen | `poam-item`, `remediation` | `0` | `1` | `carrier` | `effort-estimate-hours` | `decimal-comma-to-point` | Dezimalpunkt, keine Einheit, kein Vorzeichen, keine Exponentialschreibweise; UI-Komma wird vor dem Schreiben normalisiert | [GSPP-356](https://linear.app/grundschutz-plus-plus/issue/GSPP-356) |
| `custom-tag` | Lokales Schlagwort einer implementierten Anforderung | Getrimmter, nichtleerer Klasse-2-Text | `implemented-requirement` | `0` | `n` | `carrier` | `custom-tag` | `identity` | NFC-normalisiert und case-insensitiv je Träger eindeutig; Wert wird nicht umgedeutet oder extern ergänzt | [GSPP-312](https://linear.app/grundschutz-plus-plus/issue/GSPP-312) |
| `protection-need-level` | Projektbezogener Schutzbedarf eines Zielobjekts | `normal`, `hoch` | `system-component`, `inventory-item`, `information-type` | `0` | `1` | `carrier` | `protection-need-level` | `identity` | Nichtleere `remarks` sind Pflicht; keine Ableitung aus OSCAL-CIA-Werten | [GSPP-355](https://linear.app/grundschutz-plus-plus/issue/GSPP-355) |
| `target-object-category` | Direkte Kategorie eines Zielobjekts | Kleingeschriebene Kategorie-UUID | `system-component`, `inventory-item`, `information-type` | `0` | `n` | `carrier` | `target-category` | `identity` | `group: gspp`; je Träger/Gruppe/UUID eindeutig; gebundener GSPP-Stand erforderlich | [GSPP-355](https://linear.app/grundschutz-plus-plus/issue/GSPP-355) |
| `effective-target-object-category` | Berechnete wirksame Kategorien eines Zielobjekts | Kleingeschriebene Kategorie-UUID | `system-component`, `inventory-item`, `information-type` | `0` | `n` | `carrier` | `target-category` | `identity` | `group: gspp`; je Träger/Gruppe/UUID eindeutig; gebundener GSPP-Stand erforderlich | [GSPP-355](https://linear.app/grundschutz-plus-plus/issue/GSPP-355) |
| `protection-need-coverage` | Bewertungsabdeckung der erfassten SSP-Zielobjekte | `complete`, `incomplete` | `metadata` | `0` | `1` | `carrier` | `protection-coverage` | `identity` | Nur SSP-Metadaten; berechnet aus allen vorhandenen Zielobjekten | [GSPP-355](https://linear.app/grundschutz-plus-plus/issue/GSPP-355) |
| `assessed-against-catalog-key` | Stabiler Katalogschlüssel einer Bewertung | Registrierter `catalogKey` | `metadata` | `0` | `1` | `group` | `catalog-key` | `identity` | `group` ist NCName-konform und exakt gleich dem Property-Wert | [GSPP-361](https://linear.app/grundschutz-plus-plus/issue/GSPP-361) |
| `assessed-against-catalog-commit` | Exakter Katalogstand einer Bewertung | Vollständiger Git-Commit-SHA | `metadata` | `0` | `1` | `group` | `catalog-commit` | `identity` | Genau 40 kleingeschriebene Hex-Zeichen; Partner-Key mit identischer `group` ist Pflicht | [GSPP-361](https://linear.app/grundschutz-plus-plus/issue/GSPP-361) |
| `process-id` | Fachliche Kennung eines Geschäftsprozesses | Nichtleerer Klasse-2-Text | `business-process` | `0` | `1` | `carrier` | `process-text` | `identity` | Mindestens ein Nicht-Leerzeichen; im SSP über alle Geschäftsprozesse nach NFC, Trim und case-insensitiv eindeutig | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-application-uuid` | Wesentliche Anwendung eines Geschäftsprozesses | OSCAL-UUID einer anderen SSP-Komponente | `business-process` | `0` | `n` | `carrier` | `uuid` | `identity` | Je Träger case-insensitiv eindeutig; nicht zusammen mit `process-applications-none` | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-applications-none` | Begründeter Nullfall wesentlicher Anwendungen | `true` | `business-process` | `0` | `1` | `carrier` | `confirmed-none` | `identity` | Nichtleere `remarks` sind Pflicht; nicht zusammen mit `process-application-uuid` | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-protection-confidentiality` | Schutzbedarf eines Geschäftsprozesses für Vertraulichkeit | `normal`, `hoch` | `business-process` | `0` | `1` | `carrier` | `protection-need-level` | `identity` | Nichtleere `remarks` sind Pflicht; fehlend bleibt das Schutzziel unbekannt, kein Default | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-protection-integrity` | Schutzbedarf eines Geschäftsprozesses für Integrität | `normal`, `hoch` | `business-process` | `0` | `1` | `carrier` | `protection-need-level` | `identity` | Nichtleere `remarks` sind Pflicht; fehlend bleibt das Schutzziel unbekannt, kein Default | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-protection-availability` | Schutzbedarf eines Geschäftsprozesses für Verfügbarkeit | `normal`, `hoch` | `business-process` | `0` | `1` | `carrier` | `protection-need-level` | `identity` | Nichtleere `remarks` sind Pflicht; fehlend bleibt das Schutzziel unbekannt, kein Default | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-protection-category` | Verwendete eigene Schutzbedarfskategorie je Schutzziel | `group`-Kennung einer eigenen Kategorie | `business-process` | `0` | `1` | `group` | `process-category-use` | `identity` | `group` ist `confidentiality`, `integrity` oder `availability`; Wert ist NCName-konform | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-priority` | Priorität eines Geschäftsprozesses in der Reihenfolge des Scopes | Kanonische Ganzzahl `1` bis `9007199254740991` | `business-process` | `0` | `1` | `carrier` | `canonical-integer` | `identity` | Nur ASCII-Ziffern ohne führende Null; nicht aus CIA-Werten erzeugt | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-category-label` | Anzeigename einer eigenen Schutzbedarfskategorie | Nichtleerer Klasse-2-Text | `metadata` | `0` | `1` | `group` | `process-text` | `identity` | `group` ist die Kategoriekennung; Namen sind über alle Gruppen nach NFC, Trim und case-insensitiv eindeutig | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-category-definition` | Definition einer eigenen Schutzbedarfskategorie | Nichtleerer Klasse-2-Text | `metadata` | `0` | `1` | `group` | `process-text` | `identity` | `group` ist die Kategoriekennung; mindestens ein Nicht-Leerzeichen | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-category-mapping` | Abbildung einer eigenen Kategorie auf die GS++-Kategorien | `normal`, `hoch` | `metadata` | `0` | `1` | `group` | `protection-need-level` | `identity` | `group` ist die Kategoriekennung; nichtleere `remarks` sind Pflicht | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-cia-process-uuid` | Geschäftsprozess einer Prozessentscheidung | OSCAL-UUID eines Geschäftsprozesses | `metadata-action` | `0` | `1` | `carrier` | `uuid` | `identity` | Nur an Aktionen des Systems `…/ns/oscal/process-cia-actions` | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-cia-sequence` | Reihenfolge einer Prozessentscheidung je Prozess | Kanonische Ganzzahl `1` bis `9007199254740991` | `metadata-action` | `0` | `1` | `carrier` | `canonical-integer` | `identity` | Nur an Aktionen des Systems `…/ns/oscal/process-cia-actions`; nur ASCII-Ziffern ohne führende Null | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-cia-content-hash` | Gebundener Bewertungsstand einer Prozessfreigabe | `process-cia/3:sha-256:` und 64 kleingeschriebene Hex-Zeichen | `metadata-action` | `0` | `1` | `carrier` | `process-cia-hash` | `identity` | Nur an Aktionen des Systems `…/ns/oscal/process-cia-actions`; nicht zusammen mit `process-cia-withdraws` | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
| `process-cia-withdraws` | Zurückgenommene Prozessfreigabe | OSCAL-UUID einer Prozessfreigabe | `metadata-action` | `0` | `1` | `carrier` | `uuid` | `identity` | Nur an Aktionen des Systems `…/ns/oscal/process-cia-actions`; nicht zusammen mit `process-cia-content-hash` | [GSPP-679](https://linear.app/grundschutz-plus-plus/issue/GSPP-679) |
<!-- project-props-contract:end -->

`name` und eine vorhandene `group` müssen OSCALs `TokenDatatype`-Regel
erfüllen. Dokumentgebundene Reader-Aufrufe übergeben statt eines freien Pfads
eine geschlossene, typisierte Position mit den tatsächlichen Arrayindizes. Die
Domain-API erzeugt daraus einen RFC-6901-JSON-Pointer ohne Wildcards oder
Dokumentwerte. Freie Pfadstrings sind nicht zulässig.

Der Reader verwendet dieselbe Klasse-2-Objektdefinition wie der Importpfad.
Exotische Prototypen, Deskriptoren, Symbolschlüssel, Sparse Arrays, geteilte
Identitäten und Ressourcenüberschreitungen scheitern deshalb vor der
Projektsemantik. `preservedProps` bleibt auch bei einer defekten Collection
die exakte Eingabe und ist die einzige geordnete, vollständige Quelle für
No-op-Export und Backup. `collectionValid` trennt die strukturelle Listenform
von `writeAllowed`, das zusätzlich die Semantik bewertet. Bekannte
Projekt-Props, fremde Namespaces und unbekannte Projekt-Props werden getrennt
als `projectProps`, `foreignProps` und `unknownProjectProps` klassifiziert.

## Maßnahmenkontext

Die beiden Planungsproperties dürfen für dieselbe Maßnahme entweder auf dem
`poam-item` oder auf der zugehörigen Risk Response (`remediation`) liegen,
nicht auf beiden. Der Validator erhält diese Zuordnung als Paar bereits
geprüfter `ProjectPropReadResult`-Werte. Er liest die Rohlisten nicht erneut,
scannt keinen Dokumentgraphen und leitet aus `related-risks` keine bestimmte
Remediation ab — ein Risk kann mehrere Responses besitzen.

## Katalogreferenzpaar

Die beiden `assessed-against-*`-Properties werden pro `group` als Paar
ausgewertet. Vollständige Abwesenheit ist gültig. Sobald ein Partner vorhanden
ist, müssen Key und Commit jeweils genau einmal mit derselben Gruppe vorkommen.
Mehrere vollständige Paare für verschiedene registrierte Katalogschlüssel sind
zulässig. Fehlende oder doppelte Partner, abweichende Gruppen, unbekannte Keys
und nicht kanonische Commits sperren den Schreibpfad.

Der Writer erzeugt das Paar ausschließlich atomar über
`createCatalogReferenceProjectProps`. `createProjectProp` verweigert beide
Paarhälften einzeln mit `OSCAL_PROJECT_PROP_CATALOG_PAIR_INCOMPLETE`.

## Zielobjekte im SSP

`protection-need-level` liegt auf Components, Inventory Items oder Information Types. Abwesenheit bedeutet „noch nicht bewertet“. `normal` und `hoch` verlangen eine nichtleere Begründung in `remarks`; native CIA-Felder bleiben eigenständig. Components mit `type` `business-process`, `virtual-system`, `room` oder `site` verwenden dokumentierte Projektwerte des offenen NIST-Typfelds.

`target-object-category` transportiert direkte UUID-Zuordnungen; `effective-target-object-category` transportiert die vollständige, berechnete Menge einschließlich direkter Kategorien und aller Eltern. Beide verwenden `group: gspp` und benötigen das GSPP-Katalogreferenzpaar auf `metadata.props`. Die Hierarchie stammt aus dem verifizierten Kategorienvokabular desselben ausgelieferten Commits; sie wird nicht im Workspace kopiert.

`protection-need-coverage` liegt ausschließlich auf SSP-Metadaten. `complete` erfordert mindestens ein Zielobjekt und gültigen Schutzbedarf an jedem erfassten Component-, Inventory-Item- und Information-Type-Träger. `incomplete` beschreibt einen Arbeitsstand mit offenen Bewertungen. Der Marker bestätigt weder einen vollständigen Assetbestand noch Compliance oder fachliche Freigabe. Fehlende Marker bleiben beim Lesen und No-op unverändert; widersprüchliche Marker sperren semantisches Schreiben und validierten Export.

## Geschäftsprozesse und Prozessentscheidungen

Die Prozessnamen auf Components gelten nur für den Träger `business-process`: ein Component mit `type: business-process`. Er trägt zusätzlich alle Namen des Trägers `system-component`. Ein Prozessname auf einem Component anderen Typs ist ein Trägerfehler. `componentProjectPropCarrier` in `src/domain/projectProps.ts` bestimmt den Träger aus `type`.

Der Träger `metadata-action` ist eine SSP-Aktion unter `metadata.actions`, deren `system` exakt `https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/process-cia-actions` lautet (`actionProjectPropCarrier`). Projektproperties an Aktionen mit anderem `system` sind ein Trägerfehler. Andere Aktionen ohne Projektproperties bleiben unverändert und werden nicht als Prozessentscheidung gedeutet.

Für alle Prozessnamen gilt: Die Namen mit Scope `group` verlangen eine `group`, alle übrigen Prozessnamen verbieten sie. Fehlende Prozessangaben sind in einem Arbeitsstand zulässig und erhalten keinen Ersatzwert; vorhandene ungültige Werte sperren semantisches Schreiben und validierten Export. `process-id` ist über alle Geschäftsprozesse eines SSP nach NFC, Trim und case-insensitiv eindeutig (`validateBusinessProcessProjectProps`, aufgerufen von `validateSspTargets` in `src/domain/sspTargetObjects.ts`). `process-application-uuid` und `process-applications-none` schließen sich am selben Träger aus, ebenso `process-cia-content-hash` und `process-cia-withdraws`.

Die Registry prüft Werte, Gruppen, Kardinalität und Eindeutigkeit je Träger. Die Auflösung von Prozess- und Anwendungsreferenzen, die Zuordnung von Hash und Rücknahme zum Aktionstyp `approved` beziehungsweise `withdrawn`, die Ereignisfolge je Prozess und die Eindeutigkeit der Priorität im Scope gehören nicht zum Registry-Vertrag.

## Kanonischer Aufwand

Gültige Speicherwerte sind beispielsweise `0.25`, `1.5` und `12`; die
Dezimaldarstellung muss zusätzlich in JavaScripts endlichen Zahlenraum passen.
Nichtkanonisch und damit ungültig sind unter anderem `0`, `1.50`, `1.234`,
`1e3`, `1 h` und `01`. Die UI-Grenze darf genau ein Dezimalkomma normalisieren,
zum Beispiel `1,5` zu `1.5`; der Speicherparser selbst akzeptiert kein Komma.

## Diagnosen und Datenschutz

Properties können Klasse-2-Inhalte wie Systemdetails, Bewertungen oder freie
Schlagworte tragen. Diagnosen enthalten deshalb nur stabile Codes,
geschlossene Strukturpfade und Validatorversionen. Werte, Freitexte,
unbekannte Namen, Gruppeninhalte und UUIDs dürfen weder in Diagnosen noch in
Logs, URLs oder Telemetrie gelangen.

## Erweiterung

Ein neuer Projektname benötigt vor seiner Nutzung eine explizite
Vertragsänderung: Bedeutung, Werteraum, Träger, Kardinalität, kanonische
Schreibregel, einführendes Issue sowie Unit-, Redaction- und Round-trip-Tests.
Bis dahin bleibt er verlustfrei lesbar, aber semantisch fail-closed.
