# OSCAL-Validierungsvertrag

Dieser Vertrag gilt für OSCAL-JSON-Artefakte, die der Navigator künftig
importiert, exportiert oder in der Build-Pipeline prüft. Er definiert die
Prüfkette und ihre Lieferkette; er aktiviert noch keinen produktiven Import.
YAML und XML sind nicht unterstützt.

## Status: Stufe 1 bis 3 für Klasse 2 und unabhängiger CI-Schema-Korpuslauf umgesetzt

Dieses Dokument legt den verbindlichen Zielzustand für den künftigen
OSCAL-Import- und -Prüfpfad fest. Die Schutzkette ist **nicht** vollständig in
den bestehenden Klasse-1-Katalog-Ladepfad integriert. Der aktuelle Katalog-Loader in
[`CatalogContext.tsx`](../src/state/CatalogContext.tsx) ruft
`fetchCatalogWithBuffer` auf; dessen Implementierung in
[`integrity.ts`](../src/domain/integrity.ts) dekodiert mit einem nicht-fatalen
`TextDecoder`. `CatalogContext` übergibt den zurückgegebenen Text anschließend
unmittelbar `JSON.parse`. Dieser Klasse-1-Pfad besitzt weiterhin kein Byte-Limit,
keinen Duplicate-Member-Scanner und keine OSCAL-Schema-Prüfung.

**Stufe 1 ist seit [GSPP-289](https://linear.app/grundschutz-plus-plus/issue/GSPP-289)
für den einzigen Klasse-2-Einstieg umgesetzt.**
[`importClass2OscalDocument()`](../src/adapters/oscalImportGate.ts) überträgt
`ArrayBuffer` oder `Uint8Array` nach einem 10-MiB-Bytelimit an einen Modul-Worker.
Dort dekodiert die Pipeline mit fatalem UTF-8-Decoder, erkennt doppelte
JSON-Member nach Escape-Auflösung und parst erst danach JSON. Seit
[GSPP-291](https://linear.app/grundschutz-plus-plus/issue/GSPP-291) (ADR-8
Festlegung 1) übergibt sie das unmittelbare Ergebnis ihres eigenen `JSON.parse`
an die **gemeinsame objektorientierte Prüfkette**
([`oscalObjectPipeline.ts`](../src/domain/oscalObjectPipeline.ts)); dort laufen
Ressourcenlimits (Tiefe 64, Knotenzahl 1 000 000, arithmetische Base64-Summe
10 MiB), die Strukturinvariante, `dispatchOscalDocument()` und die Schemastufe
in einer Einheit. Es gibt noch keine Import-UI, Persistenz oder
Klasse-2-Anzeige.

**Stufe 2 ist seit
[GSPP-285](https://linear.app/grundschutz-plus-plus/issue/GSPP-285) umgesetzt
und im Katalogpfad aktiv.** `dispatchOscalDocument()` in
[`oscalRootDispatch.ts`](../src/adapters/oscalRootDispatch.ts) ist der exakte
Root-Dispatcher dieses Vertrags; `parseCatalogDocument()` läuft über ihn, und
die Katalog-Interpretation als Fallback existiert nicht mehr. Der Dispatcher
wählt zugleich den Schema-Pin aus; **angewandt** wird er in Stufe 3.

**Stufe 3 ist seit
[GSPP-343](https://linear.app/grundschutz-plus-plus/issue/GSPP-343) im Browser
aktiv.** `validateAgainstPinnedSchema()` in
[`oscalSchemaValidation.ts`](../src/domain/oscalSchemaValidation.ts) prüft das
Dokument im Modul-Worker gegen das gepinnte NIST-Schema der von Stufe 2
gewählten Zelle. Validator, Schemabytes, Hashprüfung und Implementierung wurden
atomar aktiviert: `ajv` exakt 8.20.0 als direkte Abhängigkeit mit
Lockfile-Eintrag, die 30 Schemadateien unter `schemas/oscal/`, das CI-Gate
`npm run verify-oscal-schemas` und die Tests. Einzelheiten unten unter
[Umgesetzte Stufe 3](#umgesetzte-stufe-3-ajv-konfiguration-schemazugriff-und-codes).

**GSPP-336 führt zusätzlich die unabhängige CI-Schema-Stufe ein.**
[`npm run verify-upstream-oscal`](../package.json) lädt ausschließlich
`go-oscal` 0.7.1 aus der statisch gepinnten Release-Tabelle,
verifiziert Release-Metadaten, API-Digest, `checksums.txt` und berechnete
SHA-256-Werte und prüft den vollständigen im gepinnten
`upstream-manifest.json` registrierten OSCAL-Korpus. Der Lauf verarbeitet die
19 registrierten OSCAL-Artefakte über alle vier belegten Versionen und
überspringt die 13 `vocabulary`-Dateien, weil sie kein OSCAL-Root-Modell
tragen. Ein als `blocked-by-upstream` registrierter, im Snapshot fehlender
Katalog wird dabei transparent als übersprungen gemeldet. Sein Ergebnis ist
ein eigenständiges Schema-Orakel: Es aktiviert weder den Browser-Validator noch
behauptet es eine vollständige Validierung der Stufen 1, 2, 4 oder 5.

Ein geworfener Transportfehler oder ein HTTP-5xx beim CI-Abruf wird pro
einzelnem HTTP-Aufruf höchstens zweimal mit festen kurzen Delays wiederholt.
Das gilt für Release-Metadaten, jeden erlaubten Redirect-Hop und gepinnte
BSI-Blob-Abrufe. HTTP-4xx, Redirect-Verstöße, Größen- und Parsefehler sowie
sämtliche API-, Checksum-, SHA-256- und Blob-Pin-Abweichungen bleiben dagegen
sofort fail-closed. Die Wiederholung verbessert ausschließlich die
Verfügbarkeit des bereits gepinnten Abrufs; sie ist keine Lieferkettenausnahme.

Die bestehende Integritätsprüfung und `parseCatalog` ersetzen diese Gates
nicht. Die App darf ausschließlich die für den Klasse-2-Einstieg tatsächlich
ausgeführten Stufen 1 und 2 ausweisen, nie die vollständige Kette. Insbesondere
ist der aktuelle Klasse-1-Katalog-Loader nicht durch diesen Vertrag abgesichert.

Die Validierung ist von der bestehenden
[Integritätsprüfung](INTEGRITY.md) getrennt: SHA-256 schützt die Übereinstimmung
eines ausgelieferten Artefakts mit seinen Build-Metadaten. Die hier beschriebene
Kette prüft Syntax, Modellstruktur und fachliche Invarianten eines Dokuments.
Keine der beiden Prüfungen ist allein ein Herkunfts-, Vertrauens- oder
Compliance-Nachweis.

## Verbindliche Kette

Stufe 1 und 2 sind harte Eingangsgates: Schlagen sie fehl, erhalten alle
folgenden Stufen den terminalen Status `not-run`. Stufe 3 läuft nur nach
bestandener Stufe 2. Stufe 4 und die von ihr unabhängige Stufe 5 laufen nur
nach `passed` in Stufe 3. Stufe 5 läuft auch dann, wenn Stufe 4 für eine
dokumentierte versionsgebundene Lücke `not-checked` ist. Ein Fehler oder eine
technisch nicht verfügbare, aber für die jeweilige Aussage erforderliche Stufe
hält das Validierungsergebnis fail-closed negativ. Unabhängig ausführbare
Folgestufen werden trotzdem geprüft und mit einem eigenen terminalen Status
ausgewiesen. Diagnosen werden separat erzeugt und verändern das
Validierungsergebnis nicht.

„CI“ bezeichnet in diesem Dokument die Build- und Prüfzeit auf einem isolierten
GitHub-Actions-Runner; Browserprüfungen laufen ausschließlich im Modul-Worker.

Der modellübergreifende [Round-trip-Harnisch](OSCAL_ROUND_TRIP.md) konsumiert
diese Kette für den No-op-Lauf — inklusive des hier dokumentierten
`not-checked`-Status der Constraint-Stufe, der dort nicht dupliziert, sondern
nur referenziert wird.

| Stufe | Vorgeschriebener Zielzustand | Pinning und Fehlersemantik |
| --- | --- | --- |
| 1. Größenlimit und JSON-Syntax | **Für Klasse 2 umgesetzt:** Plattformfunktionen (`Uint8Array`, fataler UTF-8-Decoder), projekteigener Token-Scanner und danach `JSON.parse` im isolierten Modul-Worker | Das Bytelimit von 10 MiB greift vor Worker-Erzeugung, Kopie, Decoder, Scanner und Parser. Nach erfolgreicher fataler Dekodierung lehnt der Scanner doppelte Member auf jeder erlaubten Objekttiefe ab und begrenzt seinen eigenen Abstieg auf Tiefe 64; nur dann wird `JSON.parse` aufgerufen. Ein vom Scanner als ungültig bewerteter Text endet ebenfalls vor `JSON.parse` fail-closed. Stufe 1 endet mit dem unmittelbaren `JSON.parse`-Ergebnis; die iterative Grenzprüfung (Tiefe 64, Knotenzahl 1 000 000, Base64-Summe 10 MiB ohne Dekodierung) gehört seit [GSPP-291](https://linear.app/grundschutz-plus-plus/issue/GSPP-291) zur objektorientierten Kette (Stufe 2a). Der Adapter beendet einen antwortlosen Worker nach 30 Sekunden mit einer redigierten Fehlerdiagnose. Node-Tests verwenden dieselbe Worker-Logik; der Browsernachweis läuft in Chromium. |
| 2a. Objektgraph-Invariante | **Für Klasse 2 umgesetzt:** gemeinsame objektorientierte Prüfkette in [`oscalObjectGraph.ts`](../src/domain/oscalObjectGraph.ts) und [`oscalObjectPipeline.ts`](../src/domain/oscalObjectPipeline.ts); setzt keine Bytes voraus | Strukturinvariante und Ressourcenlimits in **einem** terminierenden Baumdurchlauf mit Identitätsmenge über den ganzen Lauf (Zyklen und geteilte Containeridentität fail-closed). Positivdefinition: null, Boolean, String, Number außer NaN (±Infinity zulässig), Arrays exakt `Array.prototype` mit dichten Indizes plus `length`, Objekte exakt `Object.prototype`; keine Symbol-Schlüssel; nur voll schreibbare, aufzählbare, konfigurierbare Data-Properties. Kein Serialisieren, kein Klonen; keine Proxy-Erkennungsbehauptung — der Ausschluss entsteht durch den Herkunftsnachweis (unmittelbares `JSON.parse`-Ergebnis oder Builder-Handle). Diagnosen tragen stabile Codes auf der eigenen Stufe `object-structure` und nennen weder Werte noch Property-Namen. Details unter [Die gemeinsame objektorientierte Prüfkette](#die-gemeinsame-objektorientierte-prüfkette). |
| 2. Root-Erkennung | **Umgesetzt:** `dispatchOscalDocument()` in [`oscalRootDispatch.ts`](../src/adapters/oscalRootDispatch.ts), projekteigen und ohne externes Werkzeug | Das Top-Level-Objekt muss genau einen der acht bekannten Root-Keys besitzen. Null, Arrays, mehrere Root-Keys und unbekannte Keys werden abgelehnt. Die optionale Schema-Direktive `$schema` ist die einzige zusätzlich zulässige Top-Level-Property; sie ist kein zweiter Root und **niemals** Versionsautorität. Eine Katalog-Interpretation als Fallback ist verboten. |
| 3. JSON-Schema | **Für Klasse 2 umgesetzt:** `ajv` 8.20.0 im Modul-Worker, gegen die eingecheckten NIST-Schemas unter `schemas/oscal/`. **CI umgesetzt:** [`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs) nutzt `go-oscal` 0.7.1 als unabhängiges Schema- und Upgrade-Orakel | Auswahl ausschließlich über den exakten Root×`oscal-version`-Schlüssel; kein Fallback auf eine Nachbarversion. Die Schemabytes kommen aus dem eigenen Bundle; der Chunk der ausgewählten Zelle wird zur Laufzeit von derselben Origin nachgeladen, nie von einer fremden. Ihre Integrität trägt der Bauzeitschritt `npm run verify-oscal-schemas`. Ist die Zelle nicht im Bundle oder lässt sich ihr Validator nicht bauen, endet der Import fail-closed mit `OSCAL_SCHEMA_UNAVAILABLE` — Stufe 3 wird weder übersprungen noch als bestanden ausgewiesen. Der CI-Korpuslauf bezieht Dokumente nur aus dem gepinnten BSI-Snapshot und führt weder Schema- noch Dokumentreferenz-Anfragen aus. Jedes nicht gesperrte Artefakt muss bestehen; ein gesperrtes Artefakt muss fehlschlagen. Fehlende oder nicht auswertbare Werkzeugergebnisse bleiben ein eigener fail-closed Werkzeugfehler. |
| 4. zusätzliche OSCAL-Constraints | Derzeit **kein zugelassener Validator** für OSCAL 1.2.2; im Browser und in CI als `not-checked` ausgewiesen | Diese Stufe darf weder übersprungen noch als bestanden dargestellt werden. Die zulässige Konformitätsaussage wird deshalb begrenzt. Das konkrete Mapping-Orakel ist als bekannte Lücke registriert. |
| 5. Referenzen und Projektregeln | **Umgesetzt:** [`referenceResolution.ts`](../src/domain/referenceResolution.ts) ist der gemeinsame, fail-closed Klassifikator; der Referenzgraph darüber steht in [`referenceGraph.ts`](../src/domain/referenceGraph.ts) mit der CI-Politik in [`referenceGraphPolicy.ts`](../src/domain/referenceGraphPolicy.ts) ([GSPP-251](https://linear.app/grundschutz-plus-plus/issue/GSPP-251)) | Prüft UUID-/ID-Eindeutigkeit, interne und dokumentübergreifende Referenzen, URI- und Medientypregeln sowie ausdrücklich benannte GRC-Regeln. Die Schicht klassifiziert externe `https:`-Ziele, relative Ziele und abgelehnte Protokolle ohne sie abzurufen; der Graph konsumiert sie und führt keine zweite Klassifikation ein. Unbekannte Regeln gelten nicht als bestanden. Details unter [Stufe 5 — Referenzgraph](#stufe-5--referenzgraph). |

Der Token-Scanner führt für jedes geöffnete JSON-Objekt eine eigene
Menge bereits gelesener Member-Namen. Verglichen wird der logische Name nach
Auflösung von JSON-Escapes, sodass etwa `catalog` und eine escape-äquivalente
Schreibweise als Duplikat gelten. Ein Duplikat beendet Stufe 1 vor `JSON.parse`
mit `OSCAL_JSON_DUPLICATE_MEMBER`; Root-Dispatcher und alle späteren Stufen
erhalten `not-run`. Die Diagnose nennt weder den unvertrauenswürdigen
Member-Namen noch dessen Wert, sondern nur den stabilen Code und einen sicheren,
generischen strukturellen Containerpfad aus Objekt- und Arraypositionen. Damit
interpretieren Browser und nachgelagerte Werkzeuge dasselbe eindeutige Dokument,
ohne eine zusätzliche Abhängigkeit einzuführen.

### Die gemeinsame objektorientierte Prüfkette

Seit [GSPP-291](https://linear.app/grundschutz-plus-plus/issue/GSPP-291)
(ADR-8 Festlegungen 1 und 3) verläuft der Schnitt der Prüfkette zwischen
Stufe 1 und Stufe 2: **Stufe 1 gilt für jedes Dokument, das als Bytes in die
Anwendung gelangt; alles, was auf dem geparsten Objekt arbeitet —
Ressourcenlimits, Strukturinvariante, Stufe 2 und 3 — gilt für jedes Dokument
unabhängig von seiner Entstehung** und läuft durch genau eine exportierte
Einheit: [`processClass2OscalValue()`](../src/domain/oscalObjectPipeline.ts).
Es gibt keine zweite Root-, Versions-, Limit- oder Referenzlogik.

Zwei Herkunftsnachweise berechtigen zum Eintritt in diese Einheit:

| Weg | Herkunftsnachweis |
| --- | --- |
| Importweg (Bytes) | Das unmittelbare Ergebnis des eigenen `JSON.parse`-Aufrufs in [`parseClass2OscalInput()`](../src/domain/oscalImportProcessing.ts) — es gibt keinen öffentlichen Objekt-Eintrittspunkt, der ein beliebiges Ersatzobjekt als „geparst“ markieren könnte. |
| Ableitungsweg (GSPP-291 Commit B) | Ein kontrollierter Builder erzeugt alle Container selbst und gibt nur ein über eine private `WeakMap` registriertes, opakes `DerivedJsonTree`-Handle aus; Rohobjekte und nachgebaute Handles scheitern vor jeder Reflexion. |

Die Strukturinvariante ist eine **Positivdefinition** — zulässig ist nur, was
hier steht; alles andere wird fail-closed abgelehnt:

| Form | Bedingung |
| --- | --- |
| `null`, Boolean, String | Primitiv |
| Number | Primitiv außer `NaN`; `±Infinity` bleibt zulässig, weil `JSON.parse("1e400")` es erzeugt |
| Array | Prototyp exakt `Array.prototype`; eigene Schlüssel genau die Indizes `0..length-1` plus `length`; keine Symbol-Schlüssel; jede Elementposition eine Data-Property mit `writable`, `enumerable`, `configurable` je `true` |
| Objekt | Prototyp exakt `Object.prototype`; keine Symbol-Schlüssel; jede eigene Property eine solche Data-Property |

Dazu die **Baumform**: Der Durchlauf führt eine Identitätsmenge über den
**gesamten** Lauf, nicht nur über den aktiven Rekursionspfad. Ein Container, der
an zweiter Stelle erscheint, wird abgelehnt (`OSCAL_OBJECT_IDENTITY_REJECTED`) —
das deckt Zyklen und geteilte Containeridentität gleichermaßen ab und macht den
Limitdurchlauf terminierend. Weder `JSON.stringify` noch `structuredClone`
werden als Prüfmittel verwendet; beide reparieren still statt zu melden.

Diagnosen dieser Kette tragen die eigene Stufe `object-structure` mit stabilen,
redigierten Codes (`OSCAL_OBJECT_*`); Pfad ist stets `/`, die Parameterliste
leer — Werte und unvertrauenswürdige Property-Namen treten strukturell nicht
auf. Die Positivprüfung behauptet ausdrücklich **nicht**, Proxy-Werte erkennen
zu können; deren Ausschluss entsteht allein durch den vorgelagerten
Herkunftsnachweis.

Zulässige terminale Zustände für den Eintritt in das Dokumentmodell:

| Status | Eintritt erlaubt? |
| --- | --- |
| `passed` | ja |
| `failed` | nein — fail-closed, ohne Ausnahme |
| `not-checked` | nur dort, wo der Vertrag ihn ausdrücklich vorsieht (heute ausschließlich Stufe 4) |
| `not-run` | nein, sobald die Stufe für die getroffene Aussage erforderlich ist |


Für Klasse-2-Referenzen ist `https:` das einzige als extern klassifizierbare
Protokoll. `javascript:`, `data:`, `file:` sowie jedes andere Protokoll werden
von [`referenceResolution.ts`](../src/domain/referenceResolution.ts)
fail-closed als `unsafe-protocol` behandelt; die Klassifikation führt weder
Netzwerk- noch Dateizugriffe aus. Fehlende `rlink.hashes` ergeben
`integrity: 'missing'`, nicht Vertrauen.

### Klasse-2-Grenzwerte

Die Startwerte wurden am 2026-08-11 gegen `public/data/catalog.json` als
größtes ausgeliefertes Artefakt gemessen: 5 399 453 Bytes, maximale
Verschachtelungstiefe 18 und 70 851 Knoten. Sie begrenzen ausschließlich den
lokalen Klasse-2-Einstieg; der bestehende Klasse-1-Loader bleibt davon getrennt.

| Grenze | Wert | Begründung |
| --- | --- | --- |
| Bytes vor Dekodierung | 10 MiB | Entspricht `MAX_CATALOG_ARTIFACT_BYTES` in [`fetch-catalog.mjs`](../scripts/fetch-catalog.mjs) und liegt rund doppelt über dem gemessenen Katalog. |
| Verschachtelungstiefe | 64 | Mehr als das Dreifache der gemessenen Tiefe 18. |
| Knoten | 1 000 000 | Rund das Vierzehnfache der gemessenen 70 851 Knoten. |
| Summe dekodierter Base64-Größen | 10 MiB | Dieselbe Sicherheitsgrenze wie das Bytelimit; ausschließlich arithmetisch über kodierte Länge bestimmt. |

Ajv wurde als Validator gegenüber `@hyperjump/json-schema` 1.17.7
ausgewählt. Beide Kandidaten trafen die Schema-Orakel, aber Hyperjump startete
in einem echten ESM-Web-Worker nicht unverändert: Eine transitive
Browserkomponente greift auf `document.location` zu, das im Worker nicht
existiert. Ein Kompatibilitäts-Shim wird nicht Teil der Produktarchitektur. Der
vollständige Auswahlnachweis ist in
[GSPP-282](https://linear.app/grundschutz-plus-plus/issue/GSPP-282)
nachvollziehbar; der temporäre Harnisch gehört nicht in das Repository.

### Die Schema-Direktive `$schema`

Alle acht NIST-Schemas führen `$schema` ausdrücklich in ihren
Root-`properties` (`$ref: "#/definitions/json-schema-directive"`, Typ
`URIReferenceDatatype`). Die Property fällt damit **nicht** unter
`additionalProperties: false`: ein Dokument mit `$schema` ist nach
NIST-Schema gültig, und der Dispatcher darf es nicht deshalb ablehnen.

Sie ist aber nicht Pflichtfeld, nicht wertbeschränkt und in keiner Weise an
`metadata.oscal-version` gekoppelt. Ein unbeschränkter, vom Autor frei
gesetzter URI darf die Schemaauswahl nicht steuern — das wäre eine
Schema-Selection-Confusion. Verbindlich gilt deshalb:

- `metadata.oscal-version` ist die **alleinige** Versionsautorität.
- `$schema` ist zulässig, wird aber nur als Kreuzprobe ausgewertet.
- Widerspricht ein vorhandenes `$schema` der gewählten Zelle, wird das
  Dokument mit `OSCAL_SCHEMA_DIRECTIVE_CONFLICT` fail-closed abgelehnt.

Belegt am realen Bestand: `mapping-itgs2023-zu-gspp` trägt
`$schema: "http://csrc.nist.gov/ns/oscal/1.2.1/oscal-mapping-schema.json"`
neben `oscal-version: 1.2.1`. Die offiziellen NIST-Beispieldokumente setzen
`$schema` dagegen nicht.

### Umgesetzte Stufe 2: Codes, Reihenfolge und Validatoridentität

Die Prüfreihenfolge ist festgelegt, damit ein Dokument die inhaltlich engste
Diagnose erhält, und nicht bloß die erste, die zufällig zutrifft:

| Reihenfolge | Fall | Code | Herkunft |
| --- | --- | --- | --- |
| 1 | Top-Level ist kein JSON-Objekt (`null`, Array, String, Zahl) | `OSCAL_DOCUMENT_NOT_OBJECT` | Dispatch |
| 2 | kein Root-Key | `OSCAL_ROOT_KEY_MISSING` | Dispatch |
| 3 | mehrere Root-Keys, auch wenn einer `catalog` ist | `OSCAL_ROOT_KEY_AMBIGUOUS` | Dispatch |
| 4 | Root-Key gehört nicht zu den acht bekannten | `OSCAL_ROOT_TYPE_UNKNOWN` | Versionsmatrix |
| 5 | Root widerspricht `getExpectedRootType()` des Quellregisters | `OSCAL_ROOT_TYPE_MISMATCH` | Dispatch |
| 6 | Root × `metadata.oscal-version` × `$schema` | `OSCAL_VERSION_MISSING`, `OSCAL_VERSION_MALFORMED`, `OSCAL_ROOT_VERSION_IMPOSSIBLE`, `OSCAL_ROOT_VERSION_UNSUPPORTED`, `OSCAL_SCHEMA_DIRECTIVE_CONFLICT` | Versionsmatrix |
| 7 | Root bekannt, aber kein Modelladapter registriert | `OSCAL_ROOT_TYPE_UNSUPPORTED` | Dispatch |

Die Codes der Versionsmatrix werden aus `src/domain/oscalVersionMatrix.mjs`
bezogen und unverändert durchgereicht; der Dispatcher definiert sie nicht neu
und führt keine eigene Versionskonstante. Zeile 4 und Zeile 7 sind bewusst
unterscheidbar: „nicht bekannt“ ist etwas anderes als „bekannt, aber noch nicht
verarbeitbar“.

Stufe 2 verwendet kein externes Werkzeug. Ihre Diagnosen tragen deshalb die
projekteigene Validatoridentität `gspp-root-dispatch@1`; die Version ist die
Vertragsversion des Moduls und wird erhöht, sobald sich Code, Pfad oder
Parameter einer bestehenden Diagnose ändern. Der Modulinhalt selbst ist wie
jede projekteigene Regel über den Commit-SHA gepinnt.

Ein `metadata.oscal-version`, das kein String ist, gilt als fehlende Angabe und
führt zu `OSCAL_VERSION_MISSING`. Es wird ausdrücklich **nicht** nach String
konvertiert: Eine Koerzierung würde unvertrauenswürdige Eingabe in eine
scheinbare Versionsangabe verwandeln.

### Umgesetzte Stufe 3: Ajv-Konfiguration, Schemazugriff und Codes

#### „Schema-valide" ist eine Strukturaussage, keine Vertrauensaussage

Das ist keine Vorsichtsformel, sondern am Modell belegt: OSCAL erzeugt für
jedes Feld mit `allow-other="yes"` das Muster `anyOf: [<Datatype>, enum]`, und
die Aufzählung bindet dann nicht. Betroffen sind unter anderem
`implementation-status.state`, `risk.status`, `response.lifecycle`,
`observation.methods[]`, `defined-component.type`, `hash.algorithm` und
`link.rel`. **Ein erfundener Wert besteht die Schemavalidierung.** NIST kennt
genau zwei Validierungsstufen — Wohlgeformtheit und Validität; Referenzintegrität,
Vokabulartreue und Zykelfreiheit sind keine davon. Eine Vokabularprüfung ist
eigene Projektarbeit, gehört sichtbar getrennt und ist nicht Teil von Stufe 3.
Stufe 4 bleibt `not-checked`.

#### Konfiguration des Validators

| Option | Wert | Begründung |
| --- | --- | --- |
| Einstieg | Standardexport (draft-07) | Alle 30 gepinnten Schemas deklarieren `http://json-schema.org/draft-07/schema#` und sind selbstenthalten — kein externer `$ref`. Deshalb **nicht** `ajv/dist/2019` oder `ajv/dist/2020`, kein `loadSchema`, kein `addSchema` fremder Dokumente. |
| `validateFormats` | `false` | In draft-07 ist `format` eine Annotation, keine Assertion. In den Schemas erscheinen `date-time`, `email`, `uri` und `uri-reference`. Eine Formatprüfung bräuchte `ajv-formats` als zweite Lieferkettenabhängigkeit, ohne eine Vertrauensaussage zu begründen. |
| `allErrors` | `false` | Die erste Verletzung genügt und verkleinert die Leckfläche. |
| `unicodeRegExp` | Vorgabe `true`, nicht gesetzt | OSCALs `TokenDatatype` lautet `^(\p{L}\|_)(\p{L}\|\p{N}\|[.\-_])*$`. Ohne `u`-Flag liest eine JavaScript-Regex `\p` als `p` und **jedes** OSCAL-Dokument fällt durch. Der Wert wird bewusst nicht gesetzt, damit er nicht versehentlich abgeschaltet werden kann; ein Positivfixture mit der gewöhnlichen `id` `ac-1` ist das billige Negativorakel dafür. |
| `strictTypes` | `false` | NISTs `DecimalDatatype` und `percentage` setzen `pattern` ohne begleitendes `type`. Das ist ein Autorenhinweis über das Schema, keine Abschwächung der Prüfung; ohne diese Zeile schreibt Ajv ihn bei jedem Import in die Konsole. |

Das transitiv über den ESLint-Pfad vorhandene `ajv` 6.15.0 ist ausdrücklich
**nicht** der Validator dieses Vertrags: Es kennt `unicodeRegExp` nicht und
lehnt jedes OSCAL-Dokument am `TokenDatatype`-Muster ab. Die direkte
Abhängigkeit ist deshalb keine Doppelung, sondern notwendig.

#### Schemazugriff: ein lazy Chunk derselben Origin, kein externer Bezug

[`oscalSchemaBundle.ts`](../src/domain/oscalSchemaBundle.ts) bildet jede
Matrixzelle auf **einen festen** `import()` einer Datei unter `schemas/oscal/`
ab. Die Tabelle ist ausgeschrieben und wird nicht aus `vendorPath`
zusammengesetzt: Ein aus Daten gebauter Importpfad wäre zur Bauzeit nicht
analysierbar, ein aus Dokumentinhalt gebauter eine Pfadinjektion. Geladen wird
nur die ausgewählte Zelle; `worker.format: 'es'` in `vite.config.ts` hält den
Modul-Worker code-splitting-fähig, sonst lägen alle 30 Schemas in einer
einzigen Worker-Datei. Der kompilierte Validator wird je Zelle im Worker
zwischengespeichert.

Was das für den Laufzeitbezug heißt, gehört auseinandergehalten:

* **Verboten und nicht vorhanden:** jeder Bezug von einer fremden Origin —
  insbesondere das Release-Asset auf `github.com` und die `$id`-Domain
  `csrc.nist.gov`. Kein Schema, kein Validator und keine Constraint-Datei wird
  zur Laufzeit von außen geholt.
* **Vorhanden und beabsichtigt:** genau ein Modulabruf **derselben Origin** für
  den Chunk der ausgewählten Zelle. Der `import()` ist lazy, sonst lägen die
  Bytes aller 30 Zellen im Worker.

Das ist auch die Grenze, die das Egress-Orakel aus
[GSPP-339](https://linear.app/grundschutz-plus-plus/issue/GSPP-339) zieht:
`decideBrowserEgress()` bewertet einen HTTP-Bezug genau dann als Verletzung,
wenn seine Origin nicht die erlaubte ist. Der Browsernachweis über Import und
Validierung endet deshalb mit `violations`, `httpAborts` und `webSocketCloses`
je `0`, ohne den Same-Origin-Chunk zu verschweigen.

#### Diagnosen der Stufe 3

Diagnosen tragen die Validatoridentität `ajv@8.20.0`. Übernommen werden
ausschließlich ein aus dem Ajv-Keyword abgeleiteter projekteigener Code und der
redigierte `instancePath`. **Ajvs `message` und `params` werden nie
durchgereicht** — `params.additionalProperty` trägt einen Dokumentschlüssel.

Redaktionsregel für den Pfad: Ein Segment wird übernommen, wenn es ein
numerischer Arrayindex oder ein im ausgewählten Schema deklarierter
Property-Name ist; jedes andere Segment wird durch den festen Platzhalter `*`
ersetzt. Bei `additionalProperties` zeigt Ajv auf das Elternobjekt — die
Diagnose hängt dort den Platzhalter an, statt den beanstandeten Namen zu
nennen.

| Ajv-Keyword | Code |
| --- | --- |
| `required` | `OSCAL_SCHEMA_REQUIRED_PROPERTY_MISSING` |
| `additionalProperties` | `OSCAL_SCHEMA_ADDITIONAL_PROPERTY` |
| `propertyNames` | `OSCAL_SCHEMA_PROPERTY_NAME_INVALID` |
| `type` | `OSCAL_SCHEMA_TYPE_MISMATCH` |
| `enum`, `const` | `OSCAL_SCHEMA_ENUM_MISMATCH`, `OSCAL_SCHEMA_CONST_MISMATCH` |
| `pattern` | `OSCAL_SCHEMA_PATTERN_MISMATCH` |
| `minLength`, `maxLength` | `OSCAL_SCHEMA_LENGTH_OUT_OF_RANGE` |
| `minItems`, `maxItems` | `OSCAL_SCHEMA_ITEM_COUNT_OUT_OF_RANGE` |
| `minProperties`, `maxProperties` | `OSCAL_SCHEMA_PROPERTY_COUNT_OUT_OF_RANGE` |
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` | `OSCAL_SCHEMA_NUMBER_OUT_OF_RANGE` |
| `uniqueItems` | `OSCAL_SCHEMA_DUPLICATE_ITEM` |
| `contains` | `OSCAL_SCHEMA_CONTAINS_UNSATISFIED` |
| `items`, `additionalItems` | `OSCAL_SCHEMA_ITEM_INVALID` |
| `dependencies`, `dependentRequired`, `dependentSchemas` | `OSCAL_SCHEMA_DEPENDENCY_UNSATISFIED` |
| `anyOf`, `oneOf`, `allOf`, `not`, `if`, `false schema` | `OSCAL_SCHEMA_COMBINATOR_MISMATCH` |
| jedes andere Keyword | `OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED` |
| Zelle nicht ladbar oder nicht kompilierbar | `OSCAL_SCHEMA_UNAVAILABLE` |

Die Tabelle ist eine Positivliste: Ein hier nicht geführtes Keyword erzeugt
nach Vertrag `OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED` und das Gate schlägt fehl,
statt eine geratene Diagnose zu erzeugen. `format` fehlt bewusst — die
Formatprüfung ist abgeschaltet.

## Root- und Versionsauswahl

Der Root-Key und `metadata.oscal-version` bilden gemeinsam den Schema-Schlüssel.
Die verbindliche Matrix samt Schema-Provenienz, Hash-Pins und
Migrationspolitik steht in [OSCAL_VERSION_MATRIX.md](OSCAL_VERSION_MATRIX.md)
und ist als Daten in `src/domain/oscalVersionMatrix.mjs` verankert. Die
Projektmatrix umfasst ausschließlich die vier im BSI-Bestand belegten
Versionen:

| Root-Key | 1.1.2 | 1.1.3 | 1.2.1 | 1.2.2 |
| --- | --- | --- | --- | --- |
| `catalog` | ja | ja | ja | ja |
| `profile` | ja | ja | ja | ja |
| `component-definition` | ja | ja | ja | ja |
| `system-security-plan` | ja | ja | ja | ja |
| `assessment-plan` | ja | ja | ja | ja |
| `assessment-results` | ja | ja | ja | ja |
| `plan-of-action-and-milestones` | ja | ja | ja | ja |
| `mapping-collection` | **nein** | **nein** | ja | ja |

`mapping-collection` besitzt in OSCAL 1.1.2 und 1.1.3 kein offizielles
Root-Schema. Eine nicht aufgeführte Version, ein fehlendes Schema oder ein
Hashfehler ist daher immer `OSCAL_ROOT_VERSION_UNSUPPORTED`; es wird niemals
eine Nachbarversion verwendet.

Welche Root×Version-Paare produktiv freigegeben sind, bleibt zusätzlich durch
den Lifecycle des jeweiligen Artefakts im Quellregister begrenzt
([GSPP-283](https://linear.app/grundschutz-plus-plus/issue/GSPP-283)). Die
obige Tabelle beschreibt nur die technisch vorhandenen NIST-Schemas und
erweitert keine Produktfreigabe.

| Artefakt | Root / Version | Schema-Datei und SHA-256 |
| --- | --- | --- |
| Alle 30 existierenden Zellen | acht Roots × vier Versionen minus zwei Mapping-Zellen | in `src/domain/oscalVersionMatrix.mjs` gepinnt, siehe [OSCAL_VERSION_MATRIX.md](OSCAL_VERSION_MATRIX.md) |

## Lieferkettenregeln

Für die aktivierte Zielkette ist kein **externer** Laufzeitbezug für Schema,
Validator, Constraint-Datei oder Dokumentreferenz zulässig: Was geprüft wird,
liegt zur Bauzeit eingecheckt und gehasht im Repository, nicht auf einem
fremden Host. Zulässig und tatsächlich vorhanden ist allein der lazy Modulabruf
des Schema-Chunks **derselben Origin** — siehe
[Schemazugriff](#schemazugriff-ein-lazy-chunk-derselben-origin-kein-externer-bezug).

Ajv 8.20.0 ist seit
[GSPP-343](https://linear.app/grundschutz-plus-plus/issue/GSPP-343) exakte
direkte Abhängigkeit der App, mit `package-lock.json`-Eintrag samt
SRI-Integrität. Lizenz MIT; Transitivabhängigkeiten sind `fast-deep-equal`,
`fast-uri`, `json-schema-traverse` und `require-from-string`. Das ebenfalls
vorhandene transitive `ajv` 6.15.0 stammt ausschließlich aus dem
ESLint-Werkzeugpfad und ist ausdrücklich nicht der OSCAL-Validator dieses
Vertrags. Validator, Paket-Lock, Schemabytes, Hashprüfung und Implementierung
samt Tests wurden wie gefordert atomar eingeführt.

| Artefakt | Verbindliche Herkunft und Pinning | Verifikation |
| --- | --- | --- |
| NIST-JSON-Schemas, eingecheckt | Offizielle Releases `v1.1.2`, `v1.1.3`, `v1.2.1` und `v1.2.2`; root-spezifische JSON-Schemadatei, abgelegt unter `schemas/oscal/v<VERSION>/<ASSET>`. CC0 1.0 / Public Domain | Eine maschinenlesbare Allowlist bindet Release, Root, Version, Dateiname und SHA-256. Download ist nur im expliziten Wartungslauf `npm run sync-oscal-schemas` erlaubt. Das netzfreie CI-Gate `npm run verify-oscal-schemas` prüft jede eingecheckte Datei gegen SHA-256, `$id` und draft-07 und lehnt jede Datei ohne Pin ab. Fehlender oder abweichender Hash blockiert den Build. |
| Ajv, aktiviert | npm-Paket `ajv` exakt 8.20.0, MIT | Der `package-lock.json` bindet Tarball und SRI-Integrität. Transitiv: `fast-deep-equal`, `fast-uri`, `json-schema-traverse`, `require-from-string`. Konfiguration und Begründung stehen unter [Umgesetzte Stufe 3](#umgesetzte-stufe-3-ajv-konfiguration-schemazugriff-und-codes). |
| go-oscal, CI aktiviert | Offizielles GitHub-Release `v0.7.1`, Apache-2.0; Namen und SHA-256 aller unterstützten Plattformartefakte sind statisch in [`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs) gepinnt | Vor der Ausführung müssen Tag, direkter Release-URL und GitHub-API-Digest zum statischen Pin passen. Das geladene Binary und die SBOM müssen zusätzlich ihren statischen SHA-256 und den zugehörigen Eintrag aus `checksums.txt` erfüllen. Ausschließlich geworfene Transportfehler und HTTP-5xx erhalten pro HTTP-Aufruf höchstens zwei Wiederholungen; alle Pin- und sonstigen Prüffehler bleiben sofort fail-closed. CI nutzt Linux amd64, schreibt die verifizierte SBOM nur nach `$RUNNER_TEMP` und archiviert sie via SHA-gepinntem `actions/upload-artifact`. Die ausführbare Datei wird weder eingecheckt noch außerhalb des temporären Laufs abgelegt. |
| Eigene Regeln | App-Quellcode und Tests | Pinning durch Commit-SHA; jede Regel nennt betroffene Root×Version-Paare und stabile Diagnostic-Codes. |

Schema- und Toolupdates sind atomar: neue Datei beziehungsweise neue Version,
neuer Hash, Positiv- und Negativorakel und Review im selben Änderungssatz. Ein
Update, das die Constraint-Lücke, die Lifecycle-Erwartung oder die
`$schema`-Kompatibilitätsgrenze verändert, erfordert auch die Anpassung der
Aussagegrenzen und Tests.

## Befund zur Constraint-Stufe

NIST unterscheidet offiziell JSON-Wohlgeformtheit und Modellvalidität. Das
OSCAL-Metaschema enthält darüber hinaus Constraints, die nicht vollständig in
das generierte JSON-Schema gelangen. Für OSCAL 1.2.2 wurde kein allgemein
geeigneter, reproduzierbar gepinnter Constraint-Validator gefunden:

| Kandidat | Belegter Befund | Entscheidung |
| --- | --- | --- |
| go-oscal 0.7.1 | Unterstützt die relevanten JSON-Schemas bis 1.2.2 und ist das primäre CI-Schema-/Upgrade-Orakel. Das Constraint-Orakel `relationship: "maps-to"` wird akzeptiert. | Beibehalten für Schema und Upgrade, nicht als vollständiger Constraint-Validator ausgeben. |
| Metaschema OSCAL CLI 3.2.0 | Release bindet liboscal-java 7.2.0 und OSCAL 1.2.1. Ein isolierter Constraint-Lauf akzeptiert `maps-to`; der ungültige Status wird abgelehnt. Eine belastbare 1.2.2-Abdeckung ist nicht belegt. | Nicht in CI aufnehmen; kein zusätzlicher, versionsgerechter Bedarf gegenüber go-oscal erfüllt. |
| Compliance Trestle 4.2.0 | Deklariert OSCAL 1.2.1. Der isolierte Mapping-Lauf akzeptiert sowohl `maps-to` als auch den schemawidrigen Status. | Nicht als Schema- oder Constraint-Orakel verwenden. |
| Originale NIST OSCAL CLI 1.0.3 | Modellstand ist für den unterstützten Bestand zu alt. | Nicht verwenden. |

Solange dieser Negativbefund gilt, darf der Navigator insbesondere nicht
behaupten:

- ein Dokument erfülle alle OSCAL-Metaschema-Constraints;
- ein Dokument sei uneingeschränkt „OSCAL-konform“;
- ein Mapping verwende nach bestandener Schema-Prüfung nur das kontrollierte
  OSCAL-Beziehungsvokabular;
- Schema-Validität belege Referenzintegrität, fachliche Richtigkeit,
  Vertrauenswürdigkeit, Freigabe oder Compliance.

Zulässig sind nur präzise Teilbefunde wie „gültiges JSON“, „gegen das gepinnte
JSON-Schema für Root und Version geprüft“ und „die ausdrücklich benannten
Projektregeln wurden geprüft“. Der Status der Constraint-Stufe muss daneben
sichtbar bleiben.

### Provenienzträger aufgelöster Kataloge sind in keinem Schema abgebildet

Ein versionsunabhängiger Teil dieser Lücke betrifft die Provenienzträger eines
durch Profile Resolution erzeugten Katalogs. Alle vier Träger —
`resolution-tool` und `source-profile-uuid` als `metadata`-`prop`,
`source-profile` und `source-profile-uuid` als `metadata`-`link` — kommen in
keinem der vier gepinnten `oscal_catalog_schema.json` und auch nicht in
`oscal_catalog_schema.xsd` 1.2.2 vor. Dasselbe gilt für die übrigen
target-gebundenen `prop`-Werte `keywords` und `marking`. Geprüft am 2026-08-04
über alle vier Releases: null Treffer je Begriff und Datei.

Die Träger existieren ausschließlich als Metaschema-Constraint. Über den
Schemapfad aus
[GSPP-283](https://linear.app/grundschutz-plus-plus/issue/GSPP-283) sind sie
deshalb grundsätzlich nicht prüfbar: Weder ihre Anwesenheit noch ihre
Schreibweise lässt sich mit Stufe 3 belegen. Solange Stufe 4 `not-checked`
bleibt, ist ein ausdrücklich benanntes Projektorakel nach Stufe 5 der einzige
Weg, sie zu prüfen — und ein solches Orakel ist ein Projektbefund, kein
Schemabeleg. Die vollständige Normklärung samt Normstärke je Träger steht in
[GSPP-327](https://linear.app/grundschutz-plus-plus/issue/GSPP-327).

## Stufe 5 — Referenzgraph

Der Referenzgraph in
[`referenceGraph.ts`](../src/domain/referenceGraph.ts) verbindet den Control
Layer (`catalog`, `profile`, `mapping-collection`) mit dem Implementation Layer
(`component-definition`). Er läuft nur über Artefakte, die Stufe 3 bestanden
haben, und ist rein: kein Netzwerk-, kein Dateizugriff, keine Auswertung
eingebetteter Nutzlasten. Der Assessment Layer ist noch nicht erschlossen; die
Kantendefinition ist so gefasst, dass `import-ssp` und `import-ap` ohne Umbau
ergänzt werden können.

### Vier Zustände, nicht drei

Die schärfste Anforderung an diese Stufe ist, vier Aussagen **nicht** zu
vermischen. Werden sie vermischt, entsteht genau die falsche Abdeckungsaussage,
die dieses Projekt ausschließt.

| Zustand | Bedeutung | Diagnose |
| --- | --- | --- |
| `resolved` | Das Ziel liegt im geprüften Kontext und ist dort vorhanden | keine |
| `unresolvable` | Das Ziel liegt im geprüften Kontext und ist dort **nicht** vorhanden — ein Referenzfehler | ja |
| `not-evaluable` | Das Ziel liegt **außerhalb** des geprüften Kontexts (relativ oder extern) und wird bewusst nicht aufgelöst | nur für Kontextverweise nach außen |
| `no-relationship` | Eine gültige fachliche Aussage: „es besteht keine Beziehung" — gar keine Kante, sondern eine Lückenaussage | keine |

Das Fehlen eines Eintrags ist keiner dieser Zustände: Es bedeutet
ausschließlich, dass nichts ausgesagt wurde, und erzeugt weder Kante noch
Befund.

### Knotenidentität

`control/@id` trägt im Catalog-Metaschema `identifier-uniqueness="local"` —
dieselbe Control-ID bezeichnet in zwei Katalogen zwei verschiedene Controls. Ein
Knoten ist deshalb nie eine nackte ID, sondern immer das Paar aus
Dokumentidentität und lokaler ID. Es gibt keinen Typ, der eine kontextlose ID
ausdrücken könnte, und keinen Codepfad, der beim Auflösen auf einen anderen
geladenen Katalog ausweicht.

Die Knoten entstehen aus dem Quellgraphen, nicht aus der Projektion: Eine
Projektion, die IDs in einer Map führt, hat eine doppelt vergebene ID bereits
eingeebnet. Jeder Knoten trägt die `metadata.oscal-version` seines
Quelldokuments; eine gemeinsame Versionsannahme gibt es nicht.

### Geprüfte Kanten

| Kante | Feld | Prüffrage |
| --- | --- | --- |
| `profile-import` | `profile.imports[].href` | Ziel vorhanden, Root-Typ ∈ {`catalog`, `profile`}, kein Zyklus |
| `profile-selection` | `include-controls[].with-ids`, `exclude-controls[].with-ids` | ID im importierten Kontext vorhanden |
| `mapping-resource` | `mapping.source-resource.href` / `target-resource.href` | Ziel vorhanden, `type` ∈ {`catalog`, `profile`} |
| `mapping-item` | `mapping-item.id-ref` mit `type` ∈ {`control`, `statement`} | ID im Kontext der jeweiligen Ressource auflösbar |
| `component-source` | `control-implementation.source` | Ziel vorhanden oder als extern gekennzeichnet |
| `component-control` | `implemented-requirement.control-id` | ID im Kontext der `source` auflösbar |
| `document-internal` | `link.href = "#<uuid>"` bzw. `"#<control-id>"` | Ziel in `back-matter/resources` oder im eigenen Katalog vorhanden |

`implemented-requirements` werden aus `components[]` **und** `capabilities[]`
erhoben. Eine Capability kann eine eigene `control-implementation` führen; ein
Durchlauf nur über `components` verlöre deren Referenzen still.

### Keine Auflösung relativer oder externer Ziele

Der Graph verzweigt an keiner Stelle selbst auf die Form eines `href`. Die
Klassifikation kommt ausschließlich aus
[`referenceResolution.ts`](../src/domain/referenceResolution.ts); ein
Fragmentvergleich oder Protokollvergleich außerhalb dieses Moduls existiert
nicht.

Ein relatives oder externes Ziel wird nie aufgelöst — auch nicht über
Titelähnlichkeit, Dateinamen oder Fremd-Namespace-`props`. Die
`catalog_uuid`-`props` der ITGS-Zielressourcen sehen wie ein Auflösungsweg aus
und sind keiner: Ein Fremd-Namespace-`prop` ist keine OSCAL-Referenzkante. Die
Klassifikation ist außerdem invariant dagegen, ob das durch einen Dateinamen
benannte Zielartefakt im Upstream-Tree vorhanden, gesperrt oder vollständig
entfernt ist.

Dokumentübergreifend auflösbar wird eine Referenz allein durch eine
**ausdrückliche Bindung des Aufrufers** (`bindings`). Der CI-Lauf übergibt
keine: Welcher relative Dateiname welches Artefakt meint, ist eine Behauptung,
die niemand belegen kann.

### Diagnostic-Codes

Alle Befunde entstehen über `createOscalDiagnostic()` mit `stage: 'reference'`
und dem Validatorpin `reference-graph@1`. Es gibt kein zweites Diagnosemodell
und keine eigene Severity-Skala. Eine Diagnose benennt die Referenz über ihren
strukturellen JSON Pointer und trägt nie einen `href`-Wert, eine ID oder
sonstigen Dokumentinhalt.

| Code | Bedeutung |
| --- | --- |
| `OSCAL_GRAPH_TARGET_NOT_FOUND` | Das Ziel liegt im geprüften Kontext und fehlt dort |
| `OSCAL_GRAPH_TARGET_AMBIGUOUS` | Die ID ist im Zielkontext mehrfach vergeben |
| `OSCAL_GRAPH_DUPLICATE_NODE_ID` | Zwei Knoten desselben Dokuments tragen dieselbe lokale Identität |
| `OSCAL_GRAPH_ROOT_TYPE_MISMATCH` | Das gebundene Zieldokument hat für diese Kante den falschen Root-Typ |
| `OSCAL_GRAPH_EXTERNAL_CONTEXT_UNPINNED` | Ein Kontextverweis zeigt nach außen und ist damit nicht versionsstabil überprüfbar |
| `OSCAL_GRAPH_ITEM_TYPE_UNSUPPORTED` | `mapping-item.type` außerhalb von {`control`, `statement`} |
| `OSCAL_GRAPH_RESOURCE_TYPE_UNSUPPORTED` | `mapping-resource-reference.type` außerhalb von {`catalog`, `profile`} |
| `OSCAL_GRAPH_IMPORT_CYCLE` | Eine Profilkette schließt sich; die Auswertung endet dort |

`OSCAL_GRAPH_EXTERNAL_CONTEXT_UNPINNED` entsteht je Vorkommen eines
Kontextverweises nach außen, nicht je untergeordneter ID. Das ist der Befund
„extern und deshalb nicht versionsstabil überprüfbar" und ausdrücklich **nicht**
„ID nicht gefunden". Ein rein informativer `link` nach außen erzeugt keinen
Befund: Er eröffnet keinen Auflösungskontext.

### CI-Lauf

Der Graphlauf hängt an der bestehenden Korpuslane
[`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs); es gibt
keine zweite CI-Lane. Er verarbeitet dieselben gepinnten, gegen Content- und
Blobpin geprüften Bytes wie Stufe 3 und lädt nichts erneut. Ein registriertes,
gesperrtes Artefakt, das vollständig aus dem BSI-Tree entfernt wurde, hat keinen
Manifesteintrag mehr, wird über `missingBlockedArtifacts` gemeldet und ist für
den Graphen schlicht nicht geladen — kein Knoten, kein Abbruch.

Ein neuer Referenzfehler an einem `supported`-Artefakt lässt den Lauf
fehlschlagen. Befunde an `preview`, `draft` und `blocked-by-upstream` werden
ausgewiesen, blockieren aber nicht; ein Artefakt außerhalb von `supported`
erscheint in keiner Ausgabe als abschließend bewertet. Die Allowlist-Politik mit
ihrer Auslaufregel steht in [INTEGRITY.md](INTEGRITY.md#referenzbefunde-und-ihre-allowlist).

Damit die Node-Lane denselben Klassifikator ausführt wie App und Tests, lädt
[`oscal-domain-bridge.mjs`](../scripts/oscal-domain-bridge.mjs) die
TypeScript-Module über Nodes eigenes Typ-Stripping und bildet dabei nur den
Projektalias `@/` auf `src/` ab — dieselbe Abbildung wie in `vite.config.ts`.
Deshalb ist `erasableSyntaxOnly` in beiden `tsconfig`-Projekten gesetzt: Nicht
löschbare TypeScript-Syntax würde die CI-Lane brechen.

### Gemessener Bestand

`npm run verify-upstream-oscal` am Snapshot
`9008ca0baecd958d175bbb994d6121865e266600`: Von 19 registrierten OSCAL-
Artefakten wird eines als `blocked-by-upstream` aus dem Snapshot fehlend
übersprungen. Zwei weitere gesperrte Artefakte scheitern erwartungsgemäß an
Stufe 3. **12** Artefakte gehen in den Graphen ein; die vier profilbasierten
Quellkataloge bleiben ohne App-`catalogKey` bewusst außerhalb des Graphen und
liefern keine belastbaren Referenzaussagen.

Ergebnis: 2742 Knoten, 344 aufgelöste Kanten, **0 Referenzfehler**, 2734 nicht
bewertbare Kanten, keine `no-relationship`-Aussage, kein blockierender Befund.

* Der ausgelieferte Grundschutz++-Katalog löst alle 278 dokumentinternen
  Verweise auf.
* Die 2374 `mapping-item`-Verweise des ITGS-Mappings sind nicht bewertbar, weil
  sämtliche Ressourcen-`href` relative Dateinamen sind — ausdrücklich keine
  Referenzfehler. Dasselbe gilt für die 96 `maps` des ISO-Mappings, sobald es
  wieder in den Graphen eingeht.
* Die drei `control-implementation.source` der AWS-Component-Definition tragen
  denselben externen Wert auf einem beweglichen Branch und erzeugen je einen
  Befund `OSCAL_GRAPH_EXTERNAL_CONTEXT_UNPINNED`; die 17
  `implemented-requirements` darunter bleiben nicht bewertbar und erzeugen
  keinen einzigen Referenzfehler.
* Die Profilimporte zeigen als `#uuid` auf eigene `back-matter`-Ressourcen. Sie
  lösen auf, eröffnen aber keinen Katalogkontext — die 195 `with-ids` darunter
  sind deshalb nicht bewertbar.

## Prüftiefen-Landkarte

Die Landkarte hält je Feldpfad fest, wo die Schemaprüfung endet und ab wo
ausschließlich ein Metaschema-Constraint greift. Sie ist das Instrument, mit dem
das Projekt eine ungeprüfte Konformitätsaussage vermeidet, solange die
Constraint-Stufe nach dem obigen Negativbefund `not-checked` bleibt.

Erfasst sind das Mapping-Modell und das Catalog-Modell. Die übrigen sechs
Root-Modelle folgen mit ihrer jeweiligen Erschließung; ihr Fehlen ist eine
bekannte Lücke und keine Aussage über ihre Prüftiefe.

### Reichweite der namespace-gebundenen Constraints

Die `prop`-Constraints des OSCAL-Metaschemas binden ihr Ziel über ein
`has-oscal-namespace(...)`-Prädikat. Diese Metapath-Funktion vergleicht die
Zeichenkette **exakt** und nicht als Präfix. Belegkette aus
[liboscal-java](https://github.com/usnistgov/liboscal-java), NISTs
Referenzbibliothek hinter der OSCAL CLI, Stand `49e9768`:

| Baustein | Datei | Befund |
| --- | --- | --- |
| Konstante | [`IProperty.java`](https://github.com/usnistgov/liboscal-java/blob/49e9768b0551aec7202c46b23aee6feed668eff4/src/main/java/gov/nist/secauto/oscal/lib/model/metadata/IProperty.java#L36) | `URI OSCAL_NAMESPACE = URI.create("http://csrc.nist.gov/ns/oscal")` — ohne `/1.0` |
| Normalisierung | [`AbstractProperty.java`](https://github.com/usnistgov/liboscal-java/blob/49e9768b0551aec7202c46b23aee6feed668eff4/src/main/java/gov/nist/secauto/oscal/lib/model/metadata/AbstractProperty.java#L58-L64) | `normalizeNamespace()` ersetzt ausschließlich `null` durch `OSCAL_NAMESPACE` und reicht jeden anderen Wert unverändert durch |
| Vergleich | [`HasOscalNamespace.java`](https://github.com/usnistgov/liboscal-java/blob/49e9768b0551aec7202c46b23aee6feed668eff4/src/main/java/gov/nist/secauto/oscal/lib/metapath/function/library/HasOscalNamespace.java#L170-L173) | `nodeNamespaceString.equals(node.asString())` über `.anyMatch(...)` |

Daraus folgt für jede Zeile der Landkarte, deren Constraint ein
`has-oscal-namespace(...)`-Prädikat trägt: Ein `prop` in einem abweichenden
Namespace ist vom Constraint **nicht erfasst**. Die Prüftiefe fällt dort auf die
reine Schemaprüfung zurück, ohne dass das aus dem Dokument selbst erkennbar
wäre. Ein fehlendes `ns` bedeutet dagegen den OSCAL-Namespace; dort greift der
Constraint.

Am Bestand belegt: Der ausgelieferte Grundschutz++-Anwenderkatalog führt in
`metadata` zwei `props`. `keywords` trägt kein `ns`, liegt damit im
OSCAL-Namespace und im erlaubten Wertesatz. `scope_implements_norm` trägt
`ns` = `http://csrc.nist.gov/ns/oscal/1.0` — den XML-Dokumentnamespace und
nicht den Property-Namespace — und wird deshalb von keinem OSCAL-Constraint
erfasst. Der Bestand ist konform; die Konformität beruht an dieser Stelle aber
auf einem Namespace, der wie OSCAL aussieht und keiner ist. Details in
[GSPP-241](https://linear.app/grundschutz-plus-plus/issue/GSPP-241).

### Mapping 1.2.2

Die unterschiedliche Tiefe entsteht durch die Modellierung im NIST-Metaschema:
`relationship` ist ein Feld, dessen bedingte `allowed-values` nicht in das
JSON-Schema übernommen werden. `method`, `matching-rationale` und `status` sind
Flags; ihre Wertelisten erscheinen als Enum im generierten JSON-Schema.

| JSON-Pfad | JSON-Schema | Zusätzlicher Metaschema-Constraint | Konsequenz |
| --- | --- | --- | --- |
| `/mapping-collection/mappings/*/maps/*/relationship` | Pflichtfeld und `TokenDatatype`, kein Enum | Bei OSCAL-Namespace nur `equivalent-to`, `equal-to`, `subset-of`, `superset-of`, `intersects-with`, `no-relationship` | `maps-to` besteht die Schema-Stufe, obwohl es den OSCAL-Constraint verletzt. |
| `/mapping-collection/mappings/*/source-resource/type` und `/target-resource/type` | Pflichtfeld, `anyOf` aus `TokenDatatype` und Enum — das Muster für `allow-other="yes"`; die Aufzählung bindet nicht | Bei OSCAL-Namespace `catalog` oder `profile`, ausdrücklich mit `allow-other="yes"` | `component-definition` besteht die Schema-Stufe. Der Mapping-Adapter (GSPP-245) weist es fail-closed als `OSCAL_MAPPING_RESOURCE_TYPE_INVALID` aus und ist damit bewusst strenger als `allow-other`; ein fremder `ns` hebt die Bindung dagegen auf. |
| `/mapping-collection/mappings/*/maps/*/sources/*/type` und `/targets/*/type` | Pflichtfeld, `allOf` mit Enum `control`, `statement` | dieselbe Werteliste, ohne `allow-other` | `group` scheitert bereits am Schema. |
| `/mapping-collection/provenance/method` und `/mapping-collection/mappings/*/method` | Enum `human`, `automation`, `hybrid` | dieselbe Werteliste | Ungültige Werte scheitern bereits am Schema. |
| `/mapping-collection/provenance/matching-rationale`, optional auf Mapping und Map | Enum `syntactic`, `semantic`, `functional` | dieselbe Werteliste | Ungültige Werte scheitern bereits am Schema. |
| `/mapping-collection/provenance/status` und `/mapping-collection/mappings/*/status` | Enum `complete`, `not-complete`, `draft`, `deprecated`, `superseded` | dieselbe Werteliste | `veröffentlicht` scheitert bereits am Schema. |

Primärquellen sind die
[Mapping-Referenz 1.2.2](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/mapping/json-reference/),
die [Mapping-Metaschema-Quelle](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_mapping-common_metaschema.xml#L99-L150)
und die [Wertelisten für Status und Methode](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_mapping-common_metaschema.xml#L590-L642).

### Catalog 1.1.2 bis 1.2.2

Das Catalog-Modell ist das einzige, das der Navigator heute produktiv
verarbeitet. Beide `metadata`-Wertebereiche entstehen aus je **drei**
`allowed-values`-Constraints, die denselben Knoten treffen. Sie sitzen auf drei
verschiedenen Definitionsebenen:

| Ebene | Wirkt auf | `metadata`-`prop`-Name | `metadata`-`link`-`rel` |
| --- | --- | --- | --- |
| globale `property`- beziehungsweise `link`-Definition | jede Instanz im gesamten Dokument | `marking` | `reference` |
| `metadata`-Assembly | `metadata` jedes Modells | `keywords` | `canonical`, `alternate`, `latest-version`, `predecessor-version`, `successor-version` |
| `catalog`-Assembly | nur `catalog/metadata` | `resolution-tool`, `source-profile-uuid` | `source-profile`, `source-profile-uuid` |

Die oberste Zeile ist leicht zu übersehen: Ihr Constraint ist auf der globalen
`property`-Definition mit dem Target `.[has-oscal-namespace(...)]/@name`
verankert und gilt deshalb für **jeden** `prop` im Dokument, auch für die in
`catalog/metadata`. `catalog/metadata/props` referenziert genau diese globale
Definition (`<assembly ref="property" group-as="props">`).

Der Referenzvalidator wertet alle auf einen Knoten registrierten
`allowed-values`-Constraints gemeinsam aus. In
[`DefaultConstraintValidator.ValueStatus`](https://github.com/usnistgov/metaschema-java/blob/030d102dcbf51564edb5bb9dd98286d684e06250/core/src/main/java/gov/nist/secauto/metaschema/core/model/constraint/DefaultConstraintValidator.java#L482-L547)
gilt ein Wert als zulässig, sobald **ein** Constraint ihn kennt, und der
Wertebereich ist geschlossen, sobald **ein** Constraint `@allow-other` = `no`
trägt. Der effektive Wertebereich ist damit die **Vereinigung** der Wertelisten
bei der restriktivsten Offenheit.

Der Metaschema-Default für `@allow-other` ist `no`, der für `@level` ist
`ERROR`. Keiner der sechs Constraints setzt `@level`; die drei `prop`-Constraints
setzen auch `@allow-other` nicht und sind damit geschlossen, die drei
`link`-Constraints setzen es ausdrücklich auf `yes`. Der Default für
`@extensible` taugt dagegen nicht als Begründung: Er ist in den
NIST-Quellen widersprüchlich dokumentiert — die
[Syntaxtabelle der Metaschema-Spezifikation](https://pages.nist.gov/metaschema/specification/syntax/constraints/)
nennt `no`, was kein gültiger Wert der eigenen Werteliste
`model`/`external`/`none` ist, das
[Metaschema-Modell](https://github.com/usnistgov/metaschema/blob/2673565db0d2dd937a8c2da013e3843b52c73d5c/schema/metaschema/metaschema-module-metaschema.xml#L1042)
und das
[zugehörige XSD](https://github.com/usnistgov/metaschema/blob/2673565db0d2dd937a8c2da013e3843b52c73d5c/schema/xml/metaschema.xsd#L902)
nennen `external`, und die Referenzimplementierung nennt in
[`IAllowedValuesConstraint`](https://github.com/usnistgov/metaschema-java/blob/030d102dcbf51564edb5bb9dd98286d684e06250/core/src/main/java/gov/nist/secauto/metaschema/core/model/constraint/IAllowedValuesConstraint.java#L39-L41)
je nach Branch `MODEL` oder `EXTERNAL`. Die Vereinigung hängt nicht daran: Die
oben belegte Auswertungslogik ist in beiden Branches wortgleich, und
`@extensible` wirkt dort nur als Erweiterungs-Scope, nicht als Wertebereich.

| JSON-Pfad | JSON-Schema | Zusätzlicher Metaschema-Constraint | Konsequenz |
| --- | --- | --- | --- |
| `/catalog/metadata/props/*/name` | `TokenDatatype`, kein Enum | Bei OSCAL-Namespace **geschlossen** auf die Vereinigung `marking` ∪ `keywords` ∪ `resolution-tool`, `source-profile-uuid`; alle drei Constraints ohne `@allow-other`, also `no` | Ein OSCAL-namespaced `metadata`-`prop` mit anderem Namen besteht die Schema-Stufe und verletzt den Constraint auf `ERROR`-Niveau. |
| `/catalog/metadata/links/*/rel` | `anyOf[TokenDatatype, enum["reference"]]` — faktisch jeder Token | **Offen**; alle drei Constraints tragen `allow-other="yes"`. Benannt sind `reference` ∪ `canonical`, `alternate`, `latest-version`, `predecessor-version`, `successor-version` ∪ `source-profile`, `source-profile-uuid` | Keine Prüftiefendifferenz, weil der Wertebereich offen ist. Die benannten Werte sind Empfehlungen, keine Schranke. |

Dass ausgerechnet `reference` als einziger dieser Werte im JSON-Schema
auftaucht, ist strukturell begründet: Diese Werteliste sitzt unmittelbar auf der
`rel`-Flagdefinition und gelangt deshalb in das generierte Schema. Alle übrigen
Wertelisten sind an ein `@target` gebunden und gelangen nicht hinein — auch der
globale `marking`-Constraint nicht, dessen Target `.[has-oscal-namespace(...)]`
lautet. `prop/name` besitzt keine Flag-Werteliste und bleibt deshalb ohne jedes
Enum.

Beide Zeilen gelten unverändert für alle vier gepinnten Versionen: Alle sechs
beteiligten Constraints sind in den Catalog- und Metadata-Metaschemata von
1.1.2, 1.1.3, 1.2.1 und 1.2.2 wortgleich; ab 1.2.1 tragen sie zusätzlich stabile
`@id`s. Primärquellen sind die
[Katalogreferenz 1.2.2](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/catalog/json-reference/),
die [Constraints der `catalog`-Assembly](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_catalog_metaschema.xml#L53-L60),
die [Constraints der `metadata`-Assembly](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_metadata_metaschema.xml#L407-L416)
sowie die globalen Wertelisten für
[`property`](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_metadata_metaschema.xml#L705-L707)
und [`link`](https://github.com/usnistgov/OSCAL/blob/v1.2.2/src/metaschema/oscal_metadata_metaschema.xml#L734-L736).

## Diagnostic-Vertrag

Jede Diagnose ist maschinenlesbar und besitzt mindestens:

```json
{
  "code": "OSCAL_SCHEMA_ADDITIONAL_PROPERTY",
  "severity": "error",
  "stage": "json-schema",
  "artifact": {
    "key": "mapping-iso27001-annex-a-zu-gspp",
    "rootType": "mapping-collection",
    "oscalVersion": "1.2.2"
  },
  "path": "/mapping-collection/provenance/*",
  "validator": {
    "name": "ajv",
    "version": "8.20.0"
  },
  "signature": "ajv@8.20.0|OSCAL_SCHEMA_ADDITIONAL_PROPERTY|/mapping-collection/provenance/*",
  "messageKey": "oscal.jsonSchema.schemaAdditionalProperty",
  "params": {}
}
```

Das Beispiel zeigt die Redaktionsregel an ihrem schärfsten Fall: Der
beanstandete Property-Name steht bei Ajv allein in `params.additionalProperty`
und ist Dokumentinhalt. Er erscheint deshalb weder im Pfad noch in den
Parametern — an seiner Stelle steht der feste Platzhalter `*`.

`stage` verwendet die stabilen Werte `resource-limit`, `json-syntax`,
`root-dispatch`, `json-schema`, `oscal-constraint`, `reference` und `domain`.
Der Artefaktkontext kann zusätzlich Lifecycle und Snapshot tragen. Die zentrale
Referenzauflösung und die spätere Referenzprüfung aus
[GSPP-251](https://linear.app/grundschutz-plus-plus/issue/GSPP-251)
verwenden dieses Grundformat; es entsteht kein zweites Diagnosemodell. Nicht
auflösbare Ziele liefern ausschließlich Code, Stufe und strukturellen JSON
Pointer — nie den `href`-Wert.

Das Format ist als Typ und Konstruktor in
[`oscalDiagnostics.ts`](../src/domain/oscalDiagnostics.ts) verankert.
`messageKey` und `signature` werden dort deterministisch aus Stufe, Code, Pfad
und Validatorpin abgeleitet, damit sie nicht je Aufrufstelle neu erfunden
werden. `artifact.key`, `artifact.rootType` und `artifact.oscalVersion` sind
`null`, solange sie nicht aus einer geschlossenen Menge belegt sind — sie
werden nie aus dem Dokument geraten.

### Redaction

Diagnosen werden aus einer Positivliste konstruiert, nicht aus rohen
Validatorobjekten gefiltert. Erlaubt sind stabile Codes, bekannte
Registry-Schlüssel, Root/Version, strukturelle JSON Pointer, Validatorpin,
Signatur, Message-Key und ausdrücklich freigegebene strukturelle Parameter.

Verboten sind insbesondere:

- `failedValue`, `rawValue` und andere Dokumentwerte;
- Titel, Beschreibungen, Bemerkungen, Evidenzen und Geheimnisse;
- komplette Validator-Meldungen, Stacktraces und lokale Systempfade;
- Dokument- oder Referenz-URLs sowie Request-/Response-Inhalte;
- rohe doppelte Member-Namen und die zugehörigen Werte;
- unvertrauenswürdiges Markup oder dessen HTML-Rendering.

Beispiel: Ein roher Validatorbefund mit `failedValue: "<EVIDENZ>"`, lokalem
Dateipfad und Stacktrace wird ausschließlich als Code, Stufe, sicherer
Strukturpfad und Message-Key ausgegeben. Der Marker, Pfad und Stack erscheinen
weder in Einzeldiagnose noch CI-Zusammenfassung. Kann ein Validatorbefund nicht
sicher normalisiert werden, entsteht stattdessen
`OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED` und das Gate schlägt fehl.

## Bekannte BSI-Schemaabweichungen

Ein Klasse-1-Artefakt mit reproduziertem, im Upstream-Artefakt liegendem und
upstream gemeldetem Schemadefekt wird als `blocked-by-upstream` im
Quellregister gesperrt. Die BSI-Meldung ist Pflichtreferenz des Eintrags. Die
Sperrung ist keine Validatorausnahme: Das Artefakt wird weiter geprüft und sein
Schema-Status bleibt sichtbar `failed`.

| Artefakt | Root / Version | Upstream-Meldung |
| --- | --- | --- |
| `catalog-iso27001-annex-a` | `catalog` / 1.1.3 | [BSI #69](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/69) |
| `component-ga-lotse-grundmodul` | `component-definition` / 1.1.2 | [BSI #70](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/70) |
| `component-lieferkette` | `component-definition` / 1.1.2 | [BSI #71](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/71) |
| `mapping-iso27001-annex-a-zu-gspp` | `mapping-collection` / 1.2.2 | [BSI #68](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/68) |

Der Korpuslauf erwartet für jedes nicht gesperrte Artefakt `schema=passed` und
für jedes gesperrte Artefakt `schema=failed`. Ein neuer Fehler eines nicht
gesperrten Artefakts oder ein bestandenes gesperrtes Artefakt lässt den Lauf
fehlschlagen; letzteres wird als Entsperrungskandidat ausgewiesen. Es existiert
keine Diagnosesignatur-Liste, keine Aggregat-Zerlegung und keine
Fortsetzungssemantik für diesen Lauf.

Für diesen Lauf gibt es keine aktive Ausnahme. Eine spätere Ausnahme für ein
unverzichtbares ausgeliefertes Artefakt wäre eine neue, ADR-pflichtige
Produktentscheidung; sie darf weder durch eine Diagnosesignatur noch durch eine
Änderung der Sperrsemantik dieses Korpuslaufs entstehen.

**Tree-Abwesenheit (ADR-7-Nachtrag, 2026-08-18):** Verschwindet der
registrierte Pfad eines gesperrten Artefakts vollständig aus dem gepinnten
BSI-Tree, statt nur schema-defekt zu bleiben, gilt das als dieselbe inverse
Erwartung wie ein Schemafehlschlag. `fetch-catalog.mjs`, der Catalog-Sync-Guard
und dieser Korpuslauf lassen das Artefakt dann aus, statt den Lauf
abzubrechen. `verifySnapshotFiles` prüft jede Sync-PR dabei gegen den
tatsächlichen BSI-Tree des gepinnten Snapshots nach, damit eine Sync-PR ein
dort noch vorhandenes Artefakt nicht stillschweigend auslassen kann. Für nicht
gesperrte Artefakte (`supported`, `preview`, `draft`) bleibt ein fehlender
Pfad weiterhin ein harter, fail-closed Abbruch — keine automatische
Pfadfreigabe.

`mapping-itgs2023-zu-gspp` ist nicht gesperrt. go-oscal 0.7.1 lehnt ein
standardkonformes Dokument mit Top-Level-`$schema` vor der Schemaauswertung ab,
weil sein Modelldetektor genau einen Top-Level-Key verlangt. Der Korpuslauf
entfernt deshalb ausschließlich eine stringförmige `$schema`-Direktive aus der
temporären Werkzeugkopie. Die verifizierten Upstream-Bytes und der
Schema-Schlüssel aus `metadata.oscal-version` bleiben unverändert. Fehlt danach
ein auswertbares Werkzeugergebnis, endet der Lauf als redigierter Werkzeugfehler
statt als Schemabefund.

## Belegte Orakel

Der CI-Korpuslauf verwendet ausschließlich checksum-geprüfte Artefakte des
gepinnten BSI-Snapshots; weder Upstream-Dokumente noch go-oscal-Binary oder
SBOM werden im Repository gehalten. Seine Zusammenfassung ist deterministisch
und enthält nur Registry-Schlüssel, Lifecycle, Erwartung, Schemaergebnis und
Versions-Zählung — keine Dokumentwerte, lokalen Pfade oder Stacktraces. Das
Catalog-Paar zu `metadata.props` belegt beide Aussagen der Landkarte zugleich:
die Prüftiefendifferenz und die Reichweite der namespace-gebundenen Constraints.

## Profile Resolution — Resolver-Vertrag, Phasen, Orakel

**Status:** Seit GSPP-291 (Commit B) ist die deterministische Profile
Resolution mit kontrolliertem Builder, verpflichtendem Bauzeitlauf und
zweigeteiltem Referenznachweis umgesetzt. Die Ausgabe ist ein Dokument
mit Root-Key `catalog`, das vollständig über den kontrollierten Builder
erschaffen wird; Rohobjekte fremder Herkunft gelangen nie in den
Ergebnisgraphen.

**Phasen (Import → Merge → Modify):**
1. **Import:** Selektion je Kante gegen das Quelldokument (Selektoren:
   `include-all`, `include-controls` mit `with-ids`/`matching`/`with-child-controls`,
   `exclude-controls`). `with-child-controls: yes` erweitert auf alle
   Nachfahren, sonst bleibt der Selbsttreffer. `matching` wertet Globs
   gegen die Control-ID aus.
2. **Merge:** `combine` (`use-first` behält erste Definition, `keep`
   beide) und Struktur (`flat`, `as-is`, `custom` mit `insert-controls`
   und `order` ascending/descending/keep). `custom`-Gruppen werden
   exakt kopiert (ohne `insert-controls`), `insert-controls` füllen
   Controls an Gruppenpositionen; nicht getroffene Selektionen tragen
   nichts bei.
3. **Modify:** `set-parameter` (Skalarfelder ersetzen, `props`/`links`
   anreichern) und `alters` (`adds`/`removes` mit `by-id`/`by-name`/…),
   danach kanonische Schlüsselordnung.

**Ergebnisvertrag (ADR-2 §10, ADR-8):**
- Eigene Dokument-UUID als UUIDv5 aus festem Projektnamensraum + UUID
  des steuernden Profils (deterministisch, Byte-identität beim Doppel-Lauf).
- Eigenes `last-modified` als Stempel `1970-01-01T00:00:00.000Z` (kein
  Wanduhrwert — Byte-Determinismus vor Verifikation).
- Provenienzträger `prop[name='resolution-tool']` und
  `link[rel='source-profile' href='urn:uuid:<Top-Profil-UUID>]`;
  `source-profile-uuid` wird nie gesetzt.
- Vertrauensklasse `class-2-local-user` auch bei Klasse-1-Eingaben
  (kein Manifest-/Hash-Indikator am Ergebnis).

**Draft-Status:** Die NIST-Spezifikation
(https://pages.nist.gov/OSCAL/learn/concepts/processing/profile-resolution/,
Stand 2026-07-29) trägt den Hinweis „work in progress and is subject to
change“ und wird nicht als endgültig normativ dargestellt. Sie bleibt
dennoch verbindlicher Umsetzungsmaßstab, weil keine konkurrierende
Norm existiert. Vollständige Konformität wird weder für hergeleitete
Fixtures noch insgesamt behauptet.

**Abdeckungsgrenzen:** Der BSI-Realkorpus (3 Profile am Snapshot 9008ca0)
deckt `include-all`, `include-controls`, `as-is` und `set-parameters`
ab. Nicht im Realkorpus und deshalb nur über synthetische Fixtures
belegt: `exclude-controls`, `with-child-controls`, `matching`,
`combine`, `flat`/`custom`, `alters`, Profilketten. Ein bestandener
Realkorpuslauf darf nie als Nachweis vollständiger Semantik ausgegeben
werden.

**Bekannte Differenzen (Werkzeugwiderspruch BSI ↔ NIST):**
- Interne Fragment-Links (`#<id>`) auf nicht aufgelöste Ziele bewahrt
  das NIST-Orakel (pm-9/pm-24 in LOW fehlen im resolved, Verweise
  bleiben), das BSI-Werkzeug entfernt sie (#SENS.8.6 u. a.). Kein
  Regelwerk erfüllt beide; der Resolver folgt NIST/ADR-2, die BSI-
  Differenzen sind im Korpus-Harniss als `reconcileBsiInternalLinks`
  transparent rekonstruiert und geloggt.
- `prose`-Leerzeichen (XML-Rest): NIST resolved trägt führende Leer-
  zeichen vor `{{ insert: param…` und nach `\n\n`; symmetrisch normalisiert.
- Back-matter-Provenienz: NIST verschmilzt Quellkatalog-Back-matter
  (140 Ressourcen), BSI führt nur Profil-Back-matter fort; für NIST
  gilt Back-matter als volatil im Vergleich.

**Orakel-Architektur (zweigeteilt):**
- **Realer Ausschnitt:** Vergleich gegen gepinnte, gehashte JSON-
  Ergebnisse von BSI (3 resolved_catalogs) und NIST (4 Baselines
  v1.5.0, Min-Variante, SHA-256-gepinnt unter
  `src/test/fixtures/oscal-content-v1.5.0/`). Volatile Felder
  (metadata uuid/last-modified, Dokument-UUID am Körper,
  resolution-tool/source-profile) symmetrisch entfernt; zusätzlich
  BSI-Link-Rekonziliation und NIST-Prose-Normalisierung.
- **Übrige Semantik:** Kleine synthetische Fixtures, deren Erwartungs-
  werte pro Fall aus Draft + XSpec (usnistgov/OSCAL Tag v1.1.3,
  src/utils/resolver-pipeline/testing/*.xspec) hergeleitet und mit
  konkreter Quelle dokumentiert sind — hergeleitete Spezifikations-
  tests, kein unabhängiges Orakel.
- **Bauzeitlauf:** Verpflichtend nach `npm run fetch-catalog`, schreibt
  verifizierte Rohbytes nach `.cache/upstream-corpus/` (gitignoriert,
  10 Dokumente), kein zweiter Fetch, keine Env-Variablen-Pfade, kein
  Überspringen. Workflows `ci.yml`/`deploy.yml` führen
  `npm run test:profile-resolution` (eigene Vitest-Lane
  `scripts/vitest.corpus.config.ts`) direkt nach dem Fetch aus.

| Fall | Erwarteter und beobachteter Befund |
| --- | --- |
| reales `catalog-gspp`, OSCAL 1.1.3 | Root-/Versionswahl und Schema-Prüfung bestehen. Eine abgeleitete Variante ohne Pflichtfeld `metadata.title` scheitert an der Schema-Stufe. |
| reales ISO→Grundschutz++-Mapping, OSCAL 1.2.2 | Das unveränderte Artefakt bleibt schema-invalid und ist als `blocked-by-upstream` ein erwarteter Sperrbefund. |
| reales ITGS→Grundschutz++-Mapping, OSCAL 1.2.1 | Das Artefakt ist schema-valide. Die temporäre Entfernung seiner zulässigen `$schema`-Direktive umgeht ausschließlich den Modelldetektor-Defekt von go-oscal 0.7.1; die gepinnten Quellbytes bleiben unverändert. |
| aus dem realen Mapping abgeleitet, `relationship: "maps-to"` | JSON-Schema besteht; die nicht verfügbare allgemeine Constraint-Stufe bleibt als Lücke sichtbar. |
| aus dem realen Mapping abgeleitet, `status: "veröffentlicht"` | JSON-Schema scheitert. |
| aus dem realen `catalog-gspp` abgeleitet, `metadata.props` um `{ "name": "erfundener-name" }` **ohne** `ns` ergänzt | JSON-Schema besteht, weil `prop/name` kein Enum trägt. Der Name verletzt den geschlossenen OSCAL-Wertebereich; die nicht verfügbare Constraint-Stufe bleibt als Lücke sichtbar. |
| dieselbe Variante mit `ns: "https://example.org/ns"` | JSON-Schema besteht ebenso. Ein Constraint-Verstoß liegt hier **nicht** vor: Der Fremd-Namespace ist regulär und vom `has-oscal-namespace(...)`-Prädikat nicht erfasst. Solange Stufe 4 `not-checked` ist, ist das am Metaschema belegt und nicht an einem Lauf beobachtet. |
| null, mehrere, unbekannte oder zusätzliche Root-Keys | Root-Erkennung scheitert. |
| doppelter Root-Key oder doppeltes `metadata.oscal-version` | Der Token-Scanner lehnt das Dokument auf der jeweiligen Objekttiefe vor `JSON.parse` mit `OSCAL_JSON_DUPLICATE_MEMBER` ab; Root-Erkennung und Schema-Auswahl laufen nicht. Escape-äquivalente Member-Namen gelten ebenfalls als Duplikat. |
| nicht vorhandenes Root×Version-Paar | Auswahl scheitert ohne Fallback. |
| Dokument über dem konfigurierten Byte-Limit | Ablehnung erfolgt vor Decoder und Parser. |
| Klasse-2-Validierung im Browser-Worker | Während Import und Stufe-3-Validierung geht kein Request an eine **fremde** Origin aus — insbesondere keiner an `github.com` (Release-Asset) oder `csrc.nist.gov` (die `$id` des Schemas). Belegt über das Egress-Orakel aus [GSPP-339](https://linear.app/grundschutz-plus-plus/issue/GSPP-339); Chunks derselben Origin sind kein Verstoß und auch der Weg, auf dem die gewählte Schemazelle geladen wird. |
| schemavalides Minimaldokument je Root-Modell, alle 30 Zellen | Stufe 3 besteht. Mindestens ein Fixture trägt die gewöhnliche `id` `ac-1` und belegt damit, dass die Engine `TokenDatatype` mit `u`-Flag auswertet. |
| dasselbe Dokument ohne `metadata.title` | Stufe 3 scheitert mit `OSCAL_SCHEMA_REQUIRED_PROPERTY_MISSING` auf `/<root>/metadata`. |
| Katalog mit einer charakteristischen Zeichenkette zugleich als Wert und als unbekanntem Property-Namen | Stufe 3 scheitert mit `OSCAL_SCHEMA_ADDITIONAL_PROPERTY`; die Zeichenkette erscheint weder in der Diagnose noch in der Konsole, und der Pfad trägt den Platzhalter statt des Namens. |
| Zelle nicht im Bundle | `OSCAL_SCHEMA_UNAVAILABLE`; kein Ergebnis weist Stufe 3 als bestanden aus. |
| Schemaladung des Chunks zurückgewiesen | Derselbe Code auf Stufe `json-schema`, obwohl das geprüfte Dokument schemavalide ist. Der lokale Pfad aus der Fehlermeldung erscheint nicht in der Diagnose. Ein Fehlversuch verbrennt die Zelle nicht: mit intaktem Loader besteht sie anschließend. |
| geladenes Schema nicht kompilierbar | Ebenso `OSCAL_SCHEMA_UNAVAILABLE`; der Schemaschlüssel aus Ajvs Kompilierfehler erscheint nicht in der Diagnose. Belegt getrennt vom Ladefehler, weil die Ladung hier gelingt. |
| Teilschema `false` im gewählten Schema | `OSCAL_SCHEMA_COMBINATOR_MISMATCH` statt eines Werkzeugfehlers. Ajv schreibt dieses Keyword als `false schema` mit Leerzeichen; die gepinnten Schemas setzen `false` ausschließlich an `additionalProperties`, weshalb der Beleg ein synthetisches Schema braucht. |

## Quellen

- [NIST: OSCAL-Validierungsbegriffe](https://pages.nist.gov/OSCAL/learn/concepts/validation/)
- [NIST: OSCAL-Layer und Modelle](https://pages.nist.gov/OSCAL/learn/concepts/layer/)
- [NIST: OSCAL 1.2.2 Release](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.2)
- [NIST: OSCAL 1.2.2 Model Reference](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/)
- [NIST: Metaschema-Spezifikation, Constraints](https://pages.nist.gov/metaschema/specification/syntax/constraints/)
- [NIST: Property-Namespaces und Extension-Modell](https://pages.nist.gov/OSCAL/learn/tutorials/general/extension/)
- [liboscal-java — Referenzbibliothek hinter der OSCAL CLI](https://github.com/usnistgov/liboscal-java)
- [metaschema-java — Referenzimplementierung der Constraint-Auswertung](https://github.com/usnistgov/metaschema-java)
- [go-oscal 0.7.1 Release](https://github.com/defenseunicorns/go-oscal/releases/tag/v0.7.1)
- [Metaschema OSCAL CLI 3.2.0 Release](https://github.com/metaschema-framework/oscal-cli/releases/tag/v3.2.0)
- [Compliance Trestle 4.2.0 Release](https://github.com/oscal-compass/compliance-trestle/releases/tag/v4.2.0)
