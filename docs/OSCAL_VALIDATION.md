# OSCAL-Validierungsvertrag

Dieser Vertrag legt die Prüfkette für OSCAL-JSON-Artefakte fest (Import,
Export, Build-Pipeline). YAML und XML sind nicht unterstützt.

## Status: Stufe 1 bis 3 für Klasse 2 und unabhängiger CI-Schema-Korpuslauf umgesetzt

Der Klasse-1-Katalog-Loader lädt in
[`catalogArtifacts.ts`](../src/state/catalogArtifacts.ts) den `ArrayBuffer`
über `fetchCatalogBuffer`, prüft dessen Hash und überträgt ihn an den
Modul-Worker `catalogParser.worker.ts`. Dort dekodiert ein nicht-fataler
`TextDecoder`, danach läuft `JSON.parse` mit Root-Dispatch und
Domain-Projektion. Dieser Pfad besitzt kein Byte-Limit, keinen
Duplicate-Member-Scanner und keine OSCAL-Schema-Prüfung.

**Stufe 1 (Klasse-2-Einstieg).**
[`importClass2OscalDocument()`](../src/adapters/oscalImportGate.ts) überträgt
`ArrayBuffer` oder `Uint8Array` nach einem 10-MiB-Bytelimit an einen
Modul-Worker. Dort dekodiert die Pipeline mit fatalem UTF-8-Decoder, erkennt
doppelte JSON-Member nach Escape-Auflösung und parst erst danach JSON. Das
unmittelbare Ergebnis des eigenen `JSON.parse` übergibt sie an die gemeinsame
objektorientierte Prüfkette
([`oscalObjectPipeline.ts`](../src/domain/oscalObjectPipeline.ts)); dort laufen
Ressourcenlimits (Tiefe 64, Knotenzahl 1 000 000, arithmetische Base64-Summe
4 MiB), die Strukturinvariante, `dispatchOscalDocument()` und die Schemastufe
in einer Einheit. `src/adapters/workspaceStore.ts` speichert eigene Dokumente nach diesem Eingang; Speicher- und Backup-Vertrag stehen in [PERSISTENCE.md](PERSISTENCE.md). Die Stationen Profile und SSP nehmen ihre jeweiligen Dateien über diesen Eingang auf (`src/features/workspace/WorkspaceFileImport.tsx`); der Bereich Informationsverbünde zeigt Klasse-2-Dokumente mit dem Label „Eigene Daten · kein Integritätsnachweis“.

**Stufe 2.**
`dispatchOscalDocument()` in
[`oscalRootDispatch.ts`](../src/domain/oscalRootDispatch.ts) ist der
Root-Dispatcher dieses Vertrags; `parseCatalogDocument()` läuft über ihn, eine
Katalog-Interpretation als Fallback gibt es nicht. Der Dispatcher wählt zugleich
den Schema-Pin aus; **angewandt** wird er in Stufe 3.

**Stufe 3 (Browser).**
`validateAgainstPinnedSchema()` in
[`oscalSchemaValidation.ts`](../src/domain/oscalSchemaValidation.ts) prüft das
Dokument im Modul-Worker gegen das gepinnte NIST-Schema der von Stufe 2
gewählten Zelle. Aktiviert sind atomar: `ajv` exakt 8.20.0 als direkte
Abhängigkeit mit Lockfile-Eintrag, die 30 Schemadateien unter `schemas/oscal/`,
das CI-Gate `npm run verify-oscal-schemas` und die Tests. Einzelheiten unter
[Umgesetzte Stufe 3](#umgesetzte-stufe-3-ajv-konfiguration-schemazugriff-und-codes).

**Unabhängige CI-Schema-Stufe.**
[`npm run verify-upstream-oscal`](../package.json) lädt ausschließlich
`go-oscal` 0.7.1 aus der statisch gepinnten Release-Tabelle, verifiziert
Release-Metadaten, API-Digest, `checksums.txt` und berechnete SHA-256-Werte und
prüft den vollständigen im gepinnten `upstream-manifest.json` registrierten
OSCAL-Korpus: 19 registrierte OSCAL-Artefakte über alle vier belegten
Versionen; die 13 `vocabulary`-Dateien tragen kein OSCAL-Root-Modell und werden
übersprungen. Ein als `blocked-by-upstream` registrierter, im Snapshot
fehlender Katalog wird als übersprungen gemeldet. Das Ergebnis ist ein
eigenständiges Schema-Orakel: Es aktiviert weder den Browser-Validator noch
behauptet es eine vollständige Validierung der Stufen 1, 2, 4 oder 5.

Ein geworfener Transportfehler oder ein HTTP-5xx beim CI-Abruf wird pro
einzelnem HTTP-Aufruf höchstens zweimal mit festen kurzen Delays wiederholt
(Release-Metadaten, jeder erlaubte Redirect-Hop, gepinnte BSI-Blob-Abrufe).
HTTP-4xx, Redirect-Verstöße, Größen- und Parsefehler sowie sämtliche API-,
Checksum-, SHA-256- und Blob-Pin-Abweichungen sind sofort fail-closed. Die
Wiederholung verbessert ausschließlich die Verfügbarkeit des bereits gepinnten
Abrufs; sie ist keine Lieferkettenausnahme. Die Wiederholungslogik liegt in
[`transientRetry.mjs`](../scripts/transientRetry.mjs) und ist mit
`fetch-catalog.mjs` geteilt: Wiederholt wird nur HTTP 500–599, ein von Undici
gemeldeter unerwarteter Redirect bricht ohne Wiederholung ab.

Scheitert ein Abruf endgültig, gibt der Lauf genau eine redigierte Zeile aus:
den Fehlercode, gefolgt von den Diagnosefeldern, die auf dem jeweiligen Pfad
existieren — `artifact=` nur beim BSI-Artefaktabruf, `httpStatus=` nur, wenn
eine HTTP-Antwort vorliegt, `attempt=` als 1-basierte Nummer des letzten
Versuchs und `url=` reduziert auf Origin und Pfad. Query und Fragment entfallen,
weil ein Redirect-Ziel aus dem `location`-Header der GitHub-Antwort stammt und
signierte Parameter tragen kann. Fehlertexte, Ursachenketten und lokale Pfade
erscheinen nie; Artefaktschlüssel außerhalb der Registergrammatik bleiben
redigiert.

Die Integritätsprüfung und `parseCatalog` ersetzen diese Gates
nicht. Ausgewiesen werden dürfen ausschließlich die für den Klasse-2-Einstieg
tatsächlich ausgeführten Stufen 1 bis 3, nie die vollständige Kette. Der
Klasse-1-Katalog-Loader ist durch diesen Vertrag nicht abgesichert.

Die Validierung ist von der
[Integritätsprüfung](INTEGRITY.md) getrennt: SHA-256 schützt die Übereinstimmung
eines ausgelieferten Artefakts mit seinen Build-Metadaten; die hier beschriebene
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
| 1. Größenlimit und JSON-Syntax | **Für Klasse 2 umgesetzt:** Plattformfunktionen (`Uint8Array`, fataler UTF-8-Decoder), projekteigener Token-Scanner und danach `JSON.parse` im isolierten Modul-Worker | Das Bytelimit von 10 MiB greift vor Worker-Erzeugung, Kopie, Decoder, Scanner und Parser. Nach erfolgreicher fataler Dekodierung lehnt der Scanner doppelte Member auf jeder erlaubten Objekttiefe ab und begrenzt seinen eigenen Abstieg auf Tiefe 64; nur dann wird `JSON.parse` aufgerufen. Ein vom Scanner als ungültig bewerteter Text endet ebenfalls vor `JSON.parse` fail-closed. Stufe 1 endet mit dem unmittelbaren `JSON.parse`-Ergebnis; die iterative Grenzprüfung (Tiefe 64, Knotenzahl 1 000 000, Base64-Summe 4 MiB ohne Dekodierung) gehört zur objektorientierten Kette (Stufe 2a). Der Adapter beendet einen antwortlosen Worker nach 30 Sekunden mit einer redigierten Fehlerdiagnose. Node-Tests verwenden dieselbe Worker-Logik; der Browsernachweis läuft in Chromium. |
| 2a. Objektgraph-Invariante | **Für Klasse 2 umgesetzt:** gemeinsame objektorientierte Prüfkette in [`oscalObjectGraph.ts`](../src/domain/oscalObjectGraph.ts) und [`oscalObjectPipeline.ts`](../src/domain/oscalObjectPipeline.ts); setzt keine Bytes voraus | Zwei bewusst getrennte terminierende Durchläufe: Der erste prüft vor jeder Wertreflexion die Herkunft aller Container sowie serialisierte Byte- und Knotenuntergrenze. Erst danach prüft der zweite Strukturform, Tiefe, exakte Knotenzahl und eingebettete Base64-Summe mit einer Identitätsmenge über seinen ganzen Lauf (Zyklen und geteilte Containeridentität fail-closed). Positivdefinition: null, Boolean, String, Number außer NaN (±Infinity zulässig), Arrays exakt `Array.prototype` mit dichten Indizes plus `length`, Objekte exakt `Object.prototype`; keine Symbol-Schlüssel; nur voll schreibbare, aufzählbare, konfigurierbare Data-Properties. Kein Serialisieren, kein Klonen; keine Proxy-Erkennungsbehauptung — der Ausschluss entsteht durch den Herkunftsnachweis (unmittelbares `JSON.parse`-Ergebnis oder Builder-Handle). Diagnosen tragen stabile Codes auf der eigenen Stufe `object-structure` und nennen weder Werte noch Property-Namen. Details unter [Die gemeinsame objektorientierte Prüfkette](#die-gemeinsame-objektorientierte-prüfkette). |
| 2. Root-Erkennung | **Umgesetzt:** `dispatchOscalDocument()` in [`oscalRootDispatch.ts`](../src/domain/oscalRootDispatch.ts), projekteigen und ohne externes Werkzeug | Das Top-Level-Objekt muss genau einen der acht bekannten Root-Keys besitzen. Null, Arrays, mehrere Root-Keys und unbekannte Keys werden abgelehnt. Die optionale Schema-Direktive `$schema` ist die einzige zusätzlich zulässige Top-Level-Property; sie ist kein zweiter Root und **niemals** Versionsautorität. Eine Katalog-Interpretation als Fallback ist verboten. |
| 3. JSON-Schema | **Für Klasse 2 umgesetzt:** `ajv` 8.20.0 im Modul-Worker, gegen die eingecheckten NIST-Schemas unter `schemas/oscal/`. **CI umgesetzt:** [`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs) nutzt `go-oscal` 0.7.1 als unabhängiges Schema- und Upgrade-Orakel | Auswahl über die [Versionsbindung der Matrix](OSCAL_VERSION_MATRIX.md#führendes-v-in-metadataoscal-version). Die Schemabytes kommen aus dem eigenen Bundle; der Chunk der ausgewählten Zelle wird zur Laufzeit von derselben Origin nachgeladen, nie von einer fremden. Ihre Integrität trägt der Bauzeitschritt `npm run verify-oscal-schemas`. Ist die Zelle nicht im Bundle oder lässt sich ihr Validator nicht bauen, endet der Import fail-closed mit `OSCAL_SCHEMA_UNAVAILABLE` — Stufe 3 wird weder übersprungen noch als bestanden ausgewiesen. Der CI-Korpuslauf bezieht Dokumente nur aus dem gepinnten BSI-Snapshot und führt weder Schema- noch Dokumentreferenz-Anfragen aus. Jedes nicht gesperrte Artefakt muss bestehen; ein gesperrtes Artefakt muss fehlschlagen. Fehlende oder nicht auswertbare Werkzeugergebnisse bleiben ein eigener fail-closed Werkzeugfehler. |
| 4. zusätzliche OSCAL-Constraints | **Kein zugelassener Validator** für OSCAL 1.2.2; im Browser und in CI als `not-checked` ausgewiesen | Diese Stufe darf weder übersprungen noch als bestanden dargestellt werden. Die zulässige Konformitätsaussage wird deshalb begrenzt. Das konkrete Mapping-Orakel ist als bekannte Lücke registriert. |
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

Der Schnitt der Prüfkette verläuft zwischen Stufe 1 und Stufe 2: **Stufe 1 gilt
für jedes Dokument, das als Bytes in die Anwendung gelangt; alles, was auf dem
geparsten Objekt arbeitet — Ressourcenlimits, Strukturinvariante, Stufe 2 und
3 — gilt für jedes Dokument unabhängig von seiner Entstehung** und läuft durch
genau eine exportierte Einheit:
[`processClass2OscalValue()`](../src/domain/oscalObjectPipeline.ts). Es gibt
keine zweite Root-, Versions-, Limit- oder Referenzlogik.

Zwei Herkunftsnachweise berechtigen zum Eintritt in diese Einheit:

| Weg | Herkunftsnachweis |
| --- | --- |
| Importweg (Bytes) | Das unmittelbare Ergebnis des eigenen `JSON.parse`-Aufrufs in [`parseClass2OscalInput()`](../src/domain/oscalImportProcessing.ts) — es gibt keinen öffentlichen Objekt-Eintrittspunkt, der ein beliebiges Ersatzobjekt als „geparst“ markieren könnte. |
| Ableitungsweg | Ein kontrollierter Builder erzeugt alle Container selbst und gibt nur ein über eine private `WeakMap` registriertes, opakes `DerivedJsonTree`-Handle aus; Rohobjekte und nachgebaute Handles scheitern vor jeder Reflexion. |

Die Strukturinvariante ist eine **Positivdefinition** — zulässig ist nur, was
hier steht; alles andere wird fail-closed abgelehnt:

| Form | Bedingung |
| --- | --- |
| `null`, Boolean, String | Primitiv |
| Number | Primitiv außer `NaN`; `±Infinity` bleibt zulässig, weil `JSON.parse("1e400")` es erzeugt |
| Array | Prototyp exakt `Array.prototype`; eigene Schlüssel genau die Indizes `0..length-1` plus `length`; keine Symbol-Schlüssel; jede Elementposition eine Data-Property mit `writable`, `enumerable`, `configurable` je `true` |
| Objekt | Prototyp exakt `Object.prototype`; keine Symbol-Schlüssel; jede eigene Property eine solche Data-Property |

Dazu die **Baumform**: Nach dem vorgelagerten Herkunfts- und Budgetdurchlauf
führt der Struktur- und Ressourcendurchlauf eine Identitätsmenge über seinen
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
| `not-checked` | nur dort, wo der Vertrag ihn ausdrücklich vorsieht (ausschließlich Stufe 4) |
| `not-run` | nein, sobald die Stufe für die getroffene Aussage erforderlich ist |


Für Klasse-2-Referenzen ist `https:` das einzige als extern klassifizierbare
Protokoll. `javascript:`, `data:`, `file:` sowie jedes andere Protokoll werden
von [`referenceResolution.ts`](../src/domain/referenceResolution.ts)
fail-closed als `unsafe-protocol` behandelt; die Klassifikation führt weder
Netzwerk- noch Dateizugriffe aus. Fehlende `rlink.hashes` ergeben
`integrity: 'missing'`, nicht Vertrauen.

### Klasse-2-Grenzwerte

Die Grenzen begrenzen ausschließlich den lokalen Klasse-2-Einstieg; der
Klasse-1-Loader ist davon getrennt. Sie stehen als
`CLASS_2_IMPORT_LIMITS` in
[`class2ImportLimits.mjs`](../src/domain/class2ImportLimits.mjs) und haben dort
genau einen Ort:
[`oscalImportContract.ts`](../src/domain/oscalImportContract.ts) reicht sie an
den Anwendungspfad weiter.

| Grenze | Wert | Was sie begrenzt | Prüfende Tests |
| --- | --- | --- | --- |
| Bytes vor Dekodierung | 10 MiB | Die Eingabe vor der UTF-8-Dekodierung. Ein größeres Dokument wird vor Worker-Erzeugung und Pufferkopie mit `OSCAL_BYTE_LIMIT_EXCEEDED` abgewiesen. | [`oscalImportProcessing.test.ts`](../src/domain/oscalImportProcessing.test.ts), [`oscalImportGate.test.ts`](../src/adapters/oscalImportGate.test.ts) |
| Verschachtelungstiefe | 64 | Den Stapel von Scanner und Objektkette. Der Scanner weist ein tieferes Dokument vor `JSON.parse` ab. | [`oscalImportProcessing.test.ts`](../src/domain/oscalImportProcessing.test.ts), [`oscalImportGate.browser.test.ts`](../src/test/browser/oscalImportGate.browser.test.ts) |
| Knoten | 1 000 000 | Die Zahl der JSON-Knoten und damit den Speicherbestand von Parse-Stufe und Objektkette. | [`oscalImportProcessing.test.ts`](../src/domain/oscalImportProcessing.test.ts), [`oscalObjectGraph.test.ts`](../src/domain/oscalObjectGraph.test.ts) |
| Summe dekodierter Base64-Größen | 4 MiB | Die arithmetisch bestimmte dekodierte Größe aller `base64`-Werte; siehe „Erreichbarkeit der Base64-Grenze“ unten. | [`class2ImportLimits.invariants.test.ts`](../src/domain/class2ImportLimits.invariants.test.ts) |

Diese vier Werte begrenzen **Größe**, keine Arbeit: Ein Dokument von wenigen
Kilobyte kann den Resolver lange beschäftigen, ohne eine von ihnen zu
berühren. Die fünfte Klasse-2-Grenze ist deshalb `WORK_UNIT_LIMIT` in
[`profileResolutionBudgetLimits.mjs`](../src/domain/profileResolutionBudgetLimits.mjs);
sie steht in einem eigenen Modul, weil sie nur für den Ableitungsweg gilt und
nicht für den Byte-Eingang. Wert und prüfende Tests unter
„`WORK_UNIT_LIMIT`“.

Der Wert von `maxBytes` stimmt mit `MAX_CATALOG_ARTIFACT_BYTES` in
[`fetch-catalog.mjs`](../scripts/fetch-catalog.mjs) überein, ohne an ihn
gebunden zu sein: Die eine Konstante sichert einen Build-Zeit-Abruf aus
vertrauter, versionsgepinnter Quelle, die andere die Laufzeitverarbeitung
eines potenziell feindlichen lokalen Dokuments.

Die Wartezeit eines Klasse-2-Imports deckelt
`CLASS_2_IMPORT_WORKER_TIMEOUT_MS` (30 s) in
[`oscalImportContract.ts`](../src/domain/oscalImportContract.ts).
[`oscalImportGate.test.ts`](../src/adapters/oscalImportGate.test.ts) und
[`oscalImportGate.browser.test.ts`](../src/test/browser/oscalImportGate.browser.test.ts)
prüfen, dass der Worker danach beendet wird.

#### Ergebnistransport aus dem Worker

Die Kette läuft im Worker
[`oscalImport.worker.ts`](../src/workers/oscalImport.worker.ts).
Im Main Thread entsteht Arbeit beim Übernehmen des zurückgegebenen
Ergebnisgraphen in [`oscalImportGate.ts`](../src/adapters/oscalImportGate.ts).
Eine Ablehnung überträgt nur die Diagnose. Bei angenommenen Dokumenten wächst
die Main-Thread-Arbeit mit der Knotenzahl des zurückgegebenen Graphen; der
quittierte Ergebnistransport verteilt sie auf Fragmente.

`importClass2OscalDocument(bytes, context)` liefert erst den vollständigen
validierten `source`-Baum mit Aufrufkontext, Root-Typ und OSCAL-Version zurück.
Die Byte-, Struktur-, Ressourcen-, Root- und Schemaprüfungen laufen vor jeder
erfolgreichen Datenübertragung im Worker. Eine fachliche Ablehnung
behält ihre vollständige redigierte Diagnose.

Der Worker traversiert das Ergebnis iterativ und erzeugt dabei flache Operationen
für Containeranfang, Schlüssel, primitive Werte und Containerende. Pro Fragment
gelten höchstens 256 Operationen und 32 768 UTF-16-Codeeinheiten. Lange Schlüssel
und Strings werden mit expliziten Fortsetzungen übertragen; dabei bleiben auch
ungepaarte Surrogate erhalten. Eine vollständige Operationsliste entsteht nicht.
Nach einem Fragment wartet der Worker auf dessen Sequenzquittung. Der Adapter
sendet sie erst nach vollständiger Verarbeitung dieses Fragments; so kann immer
nur ein unquittiertes Fragment unterwegs sein.

Der Decoder setzt Container direkt in den endgültigen Baum ein und verwendet
für Objekte eigene Datenproperties ohne Setterwirkung. Der Abschluss benötigt
weder eine Kopie noch einen weiteren Baumdurchlauf oder Main-Thread-JSON-Parsing.
Rahmenform, Sequenz, Fragmentgrenzen, Zielcontainer, Fortsetzungen und vollständiger
Abschluss werden geprüft. Ein Protokoll- oder Workerfehler führt zu
`OSCAL_IMPORT_WORKER_FAILURE`. Der absolute Timeout von 30 Sekunden wird durch
Quittungen nicht verlängert. Erfolg und Fehler teilen einen Abschlussweg, der
Worker, Listener, Timer sowie Transportzustand und Teilresultate freigibt.
Parallele Importe besitzen getrennte Worker und Decoder.
Der Transport bleibt innerhalb des Browsers, ohne Persistenz und ohne externe
Übertragungsziele. Das Browser-Egress-Orakel ist Teil der echten Browsertests.

[`oscalImportTransport.test.ts`](../src/domain/oscalImportTransport.test.ts)
prüft unbekannte Felder, Reihenfolge, `-0`, Unicode, die Fragmentgrenzen für
lange Schlüssel und Strings, kumulative Knoten-, Tiefen- und Textgrenzen sowie
einen Baum, dessen Blatt auf der größten zulässigen Tiefe liegt.
[`oscalImportGate.browser.test.ts`](../src/test/browser/oscalImportGate.browser.test.ts)
prüft im echten Modul-Worker fragmentierte Unicode-Werte, getrennte parallele
Importe, die Quittung nach jedem Datenfragment und den absoluten Timeout. Der
Transport erhält unbekannte Felder; ob ein Dokument mit ihnen zulässig ist,
entscheidet die Schemastufe vor der Übertragung.

#### Erreichbarkeit der Base64-Grenze

Ein `base64`-Wert steht als Text im Dokument und zählt vollständig gegen
`maxBytes`. Seine dekodierte Größe ist `floor((len - Polsterung) * 3 / 4)`, also
höchstens drei Viertel der kodierten Länge; die Restgruppe eines
ungepolsterten Werts zählt mit. Selbst ein
Dokument, das seine gesamten zugelassenen 10 MiB als base64-Text ausgibt,
erreicht damit nur **7 864 278 Byte** dekodierte Summe. Eine Grenze auf oder
über diesem Wert löst bei **keiner** Eingabe aus.

Der Wert 4 MiB erfüllt zwei Bedingungen:

- **Wirksamkeit.** Er liegt unter dem erreichbaren Deckel von 7 864 278 Byte;
  sonst löste die Grenze nie aus. Das ist die harte Bedingung.
- **Byteraum.** Eine dekodierte Nutzlast von 4 MiB verlangt 5,33 MiB kodierten
  Text im Dokument und lässt damit mehr Byteraum für das eigentliche
  OSCAL-Dokument übrig, als die Nutzlast selbst belegt. Bei 5 MiB kippt dieses
  Verhältnis.

[`class2ImportLimits.invariants.test.ts`](../src/domain/class2ImportLimits.invariants.test.ts)
hält die Erreichbarkeit als dauerhafte Invariante fest und weist ein Dokument
über der Grenze am echten Byte-Eintrittspunkt ab — nicht an einer
vorbeigeführten Stufe.

Import, Schemaprüfung und Größenprüfung dekodieren `base64` nicht. Einzige
Dekodierstelle ist `verifyResourceIntegrity()` in
[`evidenceIntegrity.ts`](../src/domain/evidenceIntegrity.ts); sie prüft vorher
dieselbe Grenze je Ressource und dekodiert einen Wert darüber nicht. Das
Kostenmodell der Grenze ist die Heap-Allokation einer Dekodierung.

#### `matching.pattern`: iterativer Abgleich

Der Abgleich von `matching`-Globs gegen Control-IDs läuft in
[`profileResolutionSelection.ts`](../src/domain/profileResolutionSelection.ts)
über `matchGlob` — einen iterativen Zwei-Zeiger-Abgleich mit genau einem
Rücksprungpunkt je Stern. Er hat keinen exponentiellen Fall, ist durch
Muster × Subjekt beschränkt und bucht **jeden besuchten Zustand** als
Arbeitseinheit der Kategorie `glob-state`. Damit ist der Abgleich von außen
abbrechbar. Byte-, Knoten- und Tiefengrenze beschränken Muster- und
Subjektlänge nicht wirksam; den Abgleich begrenzt `WORK_UNIT_LIMIT`.

Die Semantik: `*` trifft beliebig viele Zeichen einschließlich keiner, `?`
genau eines, der Abgleich ist vollständig verankert. Der Zeichenvergleich
behandelt jedes Zeichen gleich, auch einen Zeilenumbruch. Der Korpuslauf
vergleicht alle drei aufgelösten Kataloge byte-nah gegen die BSI-Referenz und
die vier SP-800-53-Baselines gegen die NIST-Referenz; beide Orakel sind grün.

#### `WORK_UNIT_LIMIT`

Die Arbeitsgrenze der Profile Resolution steht als `WORK_UNIT_LIMIT` in
[`profileResolutionBudgetLimits.mjs`](../src/domain/profileResolutionBudgetLimits.mjs)
und beträgt **16 763 456 Arbeitseinheiten**. Sie gilt für die Summe über die
sechs Work-Unit-Kategorien `import-edge`, `selector-compare`, `glob-state`,
`merge-step`, `alter-target-lookup` und `alter-candidate`, nicht je Kategorie.

**Warum Bytes die Arbeit nicht begrenzen.** Jeder Selektor läuft über jede
Control-ID des importierten Katalogs, jeder Import indiziert den Katalog
erneut; die Arbeit ist das **Produkt** aus beiden Zahlen, während die
Bytegrenze nur ihre Summe deckelt. Genau diese Lücke schließt die
Arbeitsgrenze; die Ausgabegrenzen können sie nicht schließen, weil die
Ausgabe in diesen Fällen **leer oder winzig** ist.

**Durchsetzung.**
[`profileResolutionBudget.enforcement.test.ts`](../src/domain/profileResolutionBudget.enforcement.test.ts)
prüft die Grenze am öffentlichen Resolver ohne Zeitmessung:

- Ein Profil mit 8 500 Glob-Ausschlussselektoren über 2 000 Controls und
  leerer Ausgabe bricht mit `OSCAL_RESOLUTION_WORK_BUDGET_EXCEEDED` im Stage
  `resource-limit` ab; weder ein Teilergebnis noch ein Builder-Handle verlässt
  den Lauf.
- Ein gleichnamiger Wert im Steuerdokument bleibt wirkungslos; der Resolver
  hat keinen Grenzwertparameter.
- Der Test „bucht jede der sechs Kategorien in einem echten Auflösungslauf“
  hält fest, dass der Produktionspfad jede Kategorie des geschlossenen Satzes
  bucht.

**Kopfraum über der legitimen Nutzung.** Der Korpuslauf
[`profileResolutionCorpus.test.ts`](../scripts/profileResolutionCorpus.test.ts)
löst die drei registrierten BSI-Profile auf, verlangt, dass jedes unter
Arbeits-, Knoten-, Tiefen- und base64-Grenze bleibt, und gibt die vier
laufenden Zähler als Tabelle aus.

| Profil | Arbeitseinheiten | erzeugte Knoten | maximale Tiefe | dekodierte base64-Bytes |
| --- | --- | --- | --- | --- |
| `profile-gspp` | 207 595 | 76 842 | 19 | 0 |
| `profile-lieferkette` | 31 092 | 8 884 | 17 | 0 |
| `profile-wlan` | 33 842 | 6 812 | 13 | 0 |

Das teuerste Profil liegt bei rund einem Achtzigstel der Arbeitsgrenze.

#### Laufendes Budget und abschließende Postcondition

Beide bestehen nebeneinander und prüfen dasselbe mit verschiedener Reichweite.

| Eigenschaft | laufendes Budget | Postcondition |
| --- | --- | --- |
| Ort | [`profileResolutionBudget.ts`](../src/domain/profileResolutionBudget.ts) | [`oscalObjectGraph.ts`](../src/domain/oscalObjectGraph.ts) |
| Zeitpunkt | **vor** jeder Operation und Allokation | nach dem fertigen Ergebnis |
| Umfang | kumulativ über den **ganzen** Auflösungslauf | ein Zwischen- oder Endergebnis |
| Arbeitsachse | ja (`WORK_UNIT_LIMIT`) | nein |
| Ausgabeachse | Knoten, Tiefe, base64 aus `CLASS_2_IMPORT_LIMITS` | dieselben Werte |

Die Ausgabegrenzen stehen als `CLASS_2_IMPORT_LIMITS` in
[`class2ImportLimits.mjs`](../src/domain/class2ImportLimits.mjs).
Budget und Postcondition beziehen sie über
[`oscalImportContract.ts`](../src/domain/oscalImportContract.ts).
Die gemeinsame `base64`-Arithmetik `decodedBase64ByteLength` steht in
[`oscalBackMatterBase64.ts`](../src/domain/oscalBackMatterBase64.ts).
Beide zählen mit derselben Semantik — Wurzel ist Tiefe 1, jeder primitive und
jeder Containerwert ist ein Knoten, Property-Namen zählen nicht, `base64` wird
arithmetisch aus der kodierten Länge bestimmt und nie dekodiert.

**Der Knotenzähler erfasst auch den Zwischenzustand.** Merge und Modify legen
je Control eine bereinigte Kopie an, bevor die Emission den ersten
Ausgabeknoten anmeldet. `admitWorkingNode()` bucht deshalb jeden neu
angelegten Container des Zwischenzustands gegen dieselbe Knotengrenze, ohne
die Ausgabetiefe zu berühren. In der Korpustabelle oben ist das der Grund,
warum die Knotenzahlen leicht über der Größe der fertigen Kataloge liegen.

**Container heißt Objekt UND Liste.** Gebucht werden auch die Listen, die
Modify und Merge beim Ergänzen und Entfernen anlegen (ergänzte `parts`-Liste,
gefilterte Liste, zusammengesetzte `controls`- und `groups`-Listen): Ein
Add/Remove-Zyklus kostet sieben Knoten. Der Regressionstest „bucht den
Add/Remove-Zyklus vollständig" in
[`profileResolutionBudget.enforcement.test.ts`](../src/domain/profileResolutionBudget.enforcement.test.ts)
hält den Zuwachs an einem echten `resolveProfile`-Lauf fest.

**Die Grenze verläuft am Zwischengraphen, nicht an jeder Allokation.**
Gebucht wird jeder Container, der im Zwischen- oder Ergebnisgraphen **stehen
bleibt**. Nicht gebucht werden die kurzlebigen Lesekopien, die
`ownArrayDataElements` je Traversierung anlegt und sofort wieder freigibt:
Sie stehen auf der ARBEITSACHSE, wo derselbe Aufruf bereits `length`
Arbeitseinheiten vorab bucht. Der Knotenzähler ist kumulativ und kennt kein
Zurück.

Die laufenden Zähler dürfen die fertigen Werte **übersteigen** — sie zählen
kumulativ über alle Zwischenergebnisse eines Plans und schreiben Entferntes
nicht gut. Verboten ist allein die andere Richtung: Ein Zähler unter dem
fertigen Wert hieße, dass die Grenze umgangen werden kann. Ein Regressionstest
hält das fest, indem er den fertigen Graphen unabhängig nachmisst.

Die Emission rechnet in absoluten Tiefen: `groups`, `controls` und
`back-matter` liegen absolut auf Tiefe 3 (Wurzel 1 → `catalog` 2 → Mitglied 3).

#### Vertrauensklasse des Steuerdokuments und des Ergebnisses

Der Ergebnisvertrag nennt beide getrennt. `trustClass` ist unveränderlich
`class-2-local-user` — ein lokal abgeleitetes Dokument ist nach
[ADR-8](https://linear.app/grundschutz-plus-plus/issue/ADR-8) nie
verifiziert-öffentlich, auch wenn jede Eingabe Klasse 1 war.
`controllingTrustClass` ist die Klasse des **steuernden** Profils.

Sie steuert **keinen Grenzwert**; das Budget läuft in jedem Lauf identisch und
ist nicht abschaltbar. Sie sagt, **was** das Budget in diesem Lauf ist: bei
ausschließlich Klasse-1-gesteuerten Eingaben ein Reliability-Hardstop, der
nicht als Abwehr gegen unvertrauenswürdige Eingaben ausgegeben wird; bei einem
lokalen Klasse-2-Steuerdokument dieselbe Mechanik als Sicherheitskontrolle.

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

Die klassenabhängige Versionsnormalisierung und der Versionskontext der
Diagnosen sind in der
[Versionsmatrix](OSCAL_VERSION_MATRIX.md#führendes-v-in-metadataoscal-version)
festgelegt.

### Umgesetzte Stufe 3: Ajv-Konfiguration, Schemazugriff und Codes

#### „Schema-valide" ist eine Strukturaussage, keine Vertrauensaussage

Am Modell belegt: OSCAL erzeugt für
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
Die verbindliche [Root×Version-Tabelle](OSCAL_VERSION_MATRIX.md#die-matrix)
samt Schema-Provenienz und Hash-Pins steht in `OSCAL_VERSION_MATRIX.md`
und ist als Daten in `src/domain/oscalVersionMatrix.mjs` verankert.
Die [Diagnosetabelle](OSCAL_VERSION_MATRIX.md#verhalten-bei-versionsabweichung)
unterscheidet fehlende Pins, unmögliche Modellversionen und abweichende
Schema-Hashes oder `$id`-Werte. Ein im Browser fehlendes oder nicht ladbares
Schema meldet die
[Schemastufe](#schemazugriff-ein-lazy-chunk-derselben-origin-kein-externer-bezug)
als `OSCAL_SCHEMA_UNAVAILABLE`.

Welche Root×Version-Paare produktiv freigegeben sind, bleibt zusätzlich durch
den Lifecycle des jeweiligen Artefakts im Quellregister begrenzt
([GSPP-283](https://linear.app/grundschutz-plus-plus/issue/GSPP-283)). Die
verlinkte Matrix beschreibt nur die technisch vorhandenen NIST-Schemas und
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

Ajv 8.20.0 ist exakte
direkte Abhängigkeit der App, mit `package-lock.json`-Eintrag samt
SRI-Integrität. Lizenz MIT; Transitivabhängigkeiten sind `fast-deep-equal`,
`fast-uri`, `json-schema-traverse` und `require-from-string`. Das ebenfalls
vorhandene transitive `ajv` 6.15.0 stammt ausschließlich aus dem
ESLint-Werkzeugpfad und ist ausdrücklich nicht der OSCAL-Validator dieses
Vertrags.

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
eingebetteter Nutzlasten. Den Assessment Layer deckt der Graph nicht ab.

### Dokumentgraph eines Informationsverbunds

`buildWorkspaceGraph()` in [`workspaceGraph.ts`](../src/domain/workspaceGraph.ts) verarbeitet einen Snapshot aus `members`, `bindings` und bereits geladenen, hashgeprüften `class1Artifacts`. Mitglieder sind lokale `catalog`, `profile`, `component-definition`, `system-security-plan`, `assessment-plan`, `assessment-results` und `plan-of-action-and-milestones`; `mapping-collection` ist ausgeschlossen. Gemischte `verbundId`-Werte werden mit `OSCAL_WORKSPACE_VERBUND_MISMATCH` abgelehnt. Jedes Mitglied behält `localId`, `metadata.oscal-version` und `trustClass: 'class-2-local-user'`.

`ReferenceGraphDocumentKey` in `src/domain/referenceGraphModel.ts` unterscheidet `{ kind: 'local', localId }` und `{ kind: 'class-1', artifactKey, lifecycle }`. Knoten und Kantenziele führen diese Dokumentidentität neben ihrer lokalen OSCAL-ID. `src/domain/workspaceEdges.ts` liest acht Dokumentkanten:

| Kantenart | Referenzfeld | Erlaubter Zielroot |
| --- | --- | --- |
| `profile-import` | `profile.imports[].href` | `catalog`, `profile` |
| `ssp-import-profile` | `system-security-plan.import-profile.href` | `profile`, `catalog` |
| `ssp-leveraged-authorization` | `system-implementation.leveraged-authorizations[].links[]` mit `rel="system-security-plan"`, Feld `href` | `system-security-plan` |
| `component-source` | `components[]` oder `capabilities[]`, jeweils `control-implementations[].source` | `catalog`, `profile` |
| `component-import` | `component-definition.import-component-definitions[].href` | `component-definition` |
| `ap-import-ssp` | `assessment-plan.import-ssp.href` | `system-security-plan` |
| `ar-import-ap` | `assessment-results.import-ap.href` | `assessment-plan` |
| `poam-import-ssp` | `plan-of-action-and-milestones.import-ssp.href`, falls vorhanden | `system-security-plan` |

Eine lokale Bindung gilt genau für `fromLocalId`, den JSON Pointer des Referenzfelds und dessen unveränderten `href`. Ohne Bindung bleibt die Kante `not-evaluable`. Besteht für den Pointer eine Bindung mit anderem gespeichertem `href`, endet die Kante als `error` mit `OSCAL_WORKSPACE_BINDING_STALE`. Fragment- und relative Importreferenzen erhalten ausschließlich durch diese Bindung ein Dokumentziel; `back-matter.resource.rlinks` eröffnen keinen Dokumentkontext. Absolute URIs bleiben auch mit Bindung `external`. `createOscalReferenceClassifier()` verwendet denselben Klassifikationskern wie `resolveOscalReference()` und hält Ressourcenindex und Ressourcenmetadaten für einen Graphaufbau im Arbeitsspeicher; `rlinks` werden dabei nicht ausgewertet. Dokumentinterne Control-Fragmente lokaler Kataloge verwenden einen dokumentgebundenen Identitätsindex ohne Registry-Schlüssel; doppelte Control-IDs ergeben `OSCAL_GRAPH_TARGET_AMBIGUOUS`. Graphaufbau und Resolution rufen keine Referenz-URLs oder fremden Origins ab und führen keine Datei-, Worker- oder Speicheroperationen aus. Die Schema-Prüfung lädt bei kaltem Cache die mit der Anwendung gebündelten, gepinnten JSON-Schemas über die literalen dynamischen Imports in `src/domain/oscalSchemaBundle.ts`; im Browser kann dies einen Abruf des zugehörigen Chunks vom eigenen Origin auslösen.

| Zustand einer Verbundkante | Bedeutung |
| --- | --- |
| `resolved` | Ziel im explizit gebundenen Kontext vorhanden |
| `resolved-empty` | Dokumentinterner Link auf eine Ressource ohne Inhalt |
| `missing-source` | Importobjekt ohne `href`, mit `OSCAL_GRAPH_IMPORT_SOURCE_MISSING` in der Stufe `oscal-constraint`; das Profile-Metaschema verlangt `href` an `import` in allen vier gepinnten Versionen |
| `not-evaluable` | Keine aktuelle Bindung oder kein auswertbarer Baseline-Kontext |
| `external` | Absolute URI, ohne Auflösung |
| `error` | Bindung veraltet, gebundenes Ziel fehlt, ist mehrdeutig, hat den falschen Root oder schließt einen Zyklus |

Profilimporte, Component-Importe und Leveraged Authorizations werden iterativ auf Zyklen geprüft; die schließende Kante trägt `OSCAL_GRAPH_IMPORT_CYCLE`. `workspaceSemanticEdges.ts` wertet SSP-Controls und Statements gegen die gebundene Baseline und Component-Anforderungen gegen ihre gebundene `source` aus. Gleichlautende Control-IDs verschiedener Kataloge bleiben getrennt. Statement-Ziele führen zusätzlich die `controlId`. Transiente Profile liefern abgeleitete Control- und Part-Knoten unter ihrer Profilidentität, mit `derived: true` und Vertrauensklasse `class-2-local-user`. `incorporates-components` verwendet nur eigene Komponenten und explizit gebundene Component-Importe.

`workspaceProfileResolution.ts` ruft `buildProfileResolutionPlan()` und `resolveProfile()` mit den gebundenen Importzielen auf. `ProfileResolutionEdge.importPath` adressiert ein Importobjekt; dadurch können gleiche `href`-Werte je Import unterschiedliche Ziele tragen. Jeder Graphaufbau berechnet die Resolution aus dem aktuellen Snapshot neu, einschließlich geänderter `savedAt`-Werte und Bindungen. Geparste Profilansichten und validierte Zwischenergebnisse gelten ausschließlich innerhalb dieses Aufrufs; jedes Profil wird höchstens einmal erfolgreich erzeugt und validiert. Ein Referenzfehler hat bei der Statusableitung Vorrang vor fehlendem Kontext in einem anderen Importzweig. Jede angeforderte Profilauflösung besitzt ein eigenes Budget für Arbeit, kumulativ erzeugte Knoten und übernommene base64-Bytes; unabhängige Profile verbrauchen ihre Grenzen getrennt. Bei Cache-Treffern rechnet das Budget die gemessenen eigenen Erzeugungskosten jedes Zwischenprofils einmal je eindeutigem Artefakt im Auflösungsplan an; die Aufnahmereihenfolge ändert den Budgetstatus nicht. Die Versionsbindung berücksichtigt die tatsächliche Vertrauensklasse; Klasse 2 erlaubt den dokumentierten führenden `v`-Präfix, ohne `source` zu ändern. Ergebnisse tragen `derived: true`, `transient: true` und `specificationStatus: 'work-in-progress'`; sie stehen ausschließlich unter `resolutions`, ohne Store-Operation. Die Engine erzeugt `resolution-tool` und `source-profile`; `source-profile` und `source-profile-uuid` bleiben Provenienz ohne Referenzkante. Gemischte Importversionen und Profilzyklen erscheinen mit `PROFILE_RESOLUTION_VERSION_MISMATCH` beziehungsweise `PROFILE_RESOLUTION_CYCLE`.

`checkWorkspaceMembership()` in `workspaceMembership.ts` prüft die Aufnahme über die Klasse-2-Prüfkette und lehnt `mapping-collection` ab. Bei gleicher Root-UUID im Verbund liefert es `OSCAL_WORKSPACE_ROOT_UUID_DUPLICATE` mit `existingLocalId` und `action: 'replace'` außerhalb der Diagnose. Eine explizite Ersetzung verwendet die bestehende `localId` und die Speicheroperation aus [PERSISTENCE.md §7](PERSISTENCE.md#7-referenzen-und-bindungen).

Die Verbundschicht erhält `source`, `href` und `link.resource-fragment` unverändert. Diagnosen entstehen über `createOscalDiagnostic()` mit strukturellen Pfaden und ohne Dokumentwerte oder lokale Dokumentschlüssel; ihre Codes stehen in `WORKSPACE_DIAGNOSTIC_CODES` (`src/domain/workspaceDiagnostics.ts`) und `REFERENCE_GRAPH_CODES`. `workspaceGraph.boundaries.test.ts` prüft den No-op-Round-trip aller sieben Root-Modelle; `workspaceGraph.test.ts` prüft den fehlenden Egress mit Spies auf `fetch`, `XMLHttpRequest` und `Worker`. Verbundmitgliedschaft und Bindung sind Projektregeln; das NIST-Orakel belegt die abgebildeten OSCAL-Eigenschaften, keine NIST-Dokumentsammlung.

### Vier Zustände, nicht drei

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

Der Graphlauf hängt an der Korpuslane
[`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs); es gibt
keine zweite CI-Lane. Er verarbeitet dieselben gepinnten, gegen Content- und
Blobpin geprüften Bytes wie Stufe 3 und lädt nichts erneut. Ein registriertes,
gesperrtes Artefakt, das vollständig aus dem BSI-Tree entfernt wurde, hat keinen
Manifesteintrag mehr, wird über `missingBlockedArtifacts` gemeldet und ist für
den Graphen schlicht nicht geladen — kein Knoten, kein Abbruch.

Ein Referenzfehler an einem `supported`-Artefakt lässt den Lauf
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
`9008ca0baecd958d175bbb994d6121865e266600`: Von 19 registrierten
OSCAL-Artefakten wird eines als `blocked-by-upstream` aus dem Snapshot fehlend
übersprungen. Zwei weitere gesperrte Artefakte scheitern erwartungsgemäß an
Stufe 3. **12** Artefakte gehen in den Graphen ein; die vier profilbasierten
Quellkataloge bleiben ohne App-`catalogKey` außerhalb des Graphen.

Ergebnis: 2742 Knoten, 344 aufgelöste Kanten, **0 Referenzfehler**, 2734 nicht
bewertbare Kanten, keine `no-relationship`-Aussage, kein blockierender Befund.

* Der ausgelieferte Grundschutz++-Katalog löst alle 278 dokumentinternen
  Verweise auf.
* Die 2374 `mapping-item`-Verweise des ITGS-Mappings sind nicht bewertbar, weil
  sämtliche Ressourcen-`href` relative Dateinamen sind — ausdrücklich keine
  Referenzfehler. Dasselbe gilt für die 96 `maps` des ISO-Mappings.
* Die drei `control-implementation.source` der AWS-Component-Definition tragen
  denselben externen Wert auf einem beweglichen Branch und erzeugen je einen
  Befund `OSCAL_GRAPH_EXTERNAL_CONTEXT_UNPINNED`; die 17
  `implemented-requirements` darunter bleiben nicht bewertbar.
* Die Profilimporte zeigen als `#uuid` auf eigene `back-matter`-Ressourcen. Sie
  lösen auf, eröffnen aber keinen Katalogkontext — die 195 `with-ids` darunter
  sind nicht bewertbar.

## Prüftiefen-Landkarte

Die Landkarte hält je Feldpfad fest, wo die Schemaprüfung endet und ab wo
ausschließlich ein Metaschema-Constraint greift. Erfasst sind das
Mapping-Modell und das Catalog-Modell; die übrigen sechs Root-Modelle erfasst
sie nicht.

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

Das Catalog-Modell ist das einzige, das der Navigator produktiv verarbeitet.
Beide `metadata`-Wertebereiche entstehen aus je **drei**
`allowed-values`-Constraints, die denselben Knoten treffen. Sie sitzen auf drei
verschiedenen Definitionsebenen:

| Ebene | Wirkt auf | `metadata`-`prop`-Name | `metadata`-`link`-`rel` |
| --- | --- | --- | --- |
| globale `property`- beziehungsweise `link`-Definition | jede Instanz im gesamten Dokument | `marking` | `reference` |
| `metadata`-Assembly | `metadata` jedes Modells | `keywords` | `canonical`, `alternate`, `latest-version`, `predecessor-version`, `successor-version` |
| `catalog`-Assembly | nur `catalog/metadata` | `resolution-tool`, `source-profile-uuid` | `source-profile`, `source-profile-uuid` |

Der Constraint der obersten Zeile ist auf der globalen `property`-Definition
mit dem Target `.[has-oscal-namespace(...)]/@name` verankert und gilt deshalb
für **jeden** `prop` im Dokument, auch für die in `catalog/metadata`.
`catalog/metadata/props` referenziert genau diese globale Definition
(`<assembly ref="property" group-as="props">`).

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
`link`-Constraints setzen es ausdrücklich auf `yes`. `@extensible` trägt die
Vereinigung nicht: Die NIST-Quellen nennen dafür widersprüchliche Defaults —
[Syntaxtabelle](https://pages.nist.gov/metaschema/specification/syntax/constraints/)
`no`,
[Metaschema-Modell](https://github.com/usnistgov/metaschema/blob/2673565db0d2dd937a8c2da013e3843b52c73d5c/schema/metaschema/metaschema-module-metaschema.xml#L1042)
und
[XSD](https://github.com/usnistgov/metaschema/blob/2673565db0d2dd937a8c2da013e3843b52c73d5c/schema/xml/metaschema.xsd#L902)
`external`,
[`IAllowedValuesConstraint`](https://github.com/usnistgov/metaschema-java/blob/030d102dcbf51564edb5bb9dd98286d684e06250/core/src/main/java/gov/nist/secauto/metaschema/core/model/constraint/IAllowedValuesConstraint.java#L39-L41)
je nach Branch `MODEL` oder `EXTERNAL`. Die oben belegte Auswertungslogik ist
in beiden Branches wortgleich, und `@extensible` wirkt dort nur als
Erweiterungs-Scope, nicht als Wertebereich.

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
Der Artefaktkontext kann zusätzlich Lifecycle und Snapshot tragen. Es entsteht
kein zweites Diagnosemodell. Nicht auflösbare Ziele liefern ausschließlich
Code, Stufe und strukturellen JSON Pointer — nie den `href`-Wert.

Das Format ist als Typ und Konstruktor in
[`oscalDiagnostics.ts`](../src/domain/oscalDiagnostics.ts) verankert.
`messageKey` und `signature` werden dort deterministisch aus Stufe, Code, Pfad
und Validatorpin abgeleitet. `artifact.key`, `artifact.rootType` und
`artifact.oscalVersion` sind `null`, solange sie nicht aus einer geschlossenen
Menge belegt sind — sie werden nie aus dem Dokument geraten.

### Projekt-Props-Diagnosen

Der Projekt-Props-Vertrag verwendet `stage: domain` und den Validatorpin
`gspp-project-props@1`. Dokumentgebundene Aufrufe liefern strukturelle
RFC-6901-Pfade mit den tatsächlichen Arrayindizes. Es gibt in diesen Pfaden
keine Wildcard-Literale; unbekannte Namen, Gruppen und Werte bleiben redigiert.

| Code | Bedeutung |
| --- | --- |
| `OSCAL_PROJECT_PROP_UNKNOWN` | Der Projekt-Namespace enthält einen nicht registrierten Namen; Schreiben ist gesperrt, die Quelle bleibt erhalten |
| `OSCAL_PROJECT_PROP_NAME_INVALID` | `name` verletzt die OSCAL-Token-/NCName-Regel oder ist kein String |
| `OSCAL_PROJECT_PROP_GROUP_INVALID` | Eine vorhandene `group` verletzt die OSCAL-Token-/NCName-Regel oder ist kein String |
| `OSCAL_PROJECT_PROP_CARRIER_INVALID` | Das Property oder der Reader-Aufruf verwendet einen nicht registrierten Träger |
| `OSCAL_PROJECT_PROP_CARDINALITY_INVALID` | Das registrierte Maximum ist in seinem Registry-Scope (`carrier` oder `group`) überschritten |
| `OSCAL_PROJECT_PROP_VALUE_INVALID` | Der Wert oder eine Collection-Grenze verletzt den registrierten Vertrag |
| `OSCAL_PROJECT_PROP_REMARKS_REQUIRED` | Ein Schutzbedarfswert besitzt keine nichtleere Begründung |
| `OSCAL_PROJECT_PROP_DUPLICATE_VALUE` | Ein `custom-tag` ist nach NFC-Normalisierung und Kleinschreibung doppelt |
| `OSCAL_PROJECT_PROP_MEASURE_CARRIER_CONFLICT` | Dieselbe Maßnahme trägt Planungs-Props zugleich am `poam-item` und an der zugeordneten `remediation` |
| `OSCAL_PROJECT_PROP_CATALOG_PAIR_INCOMPLETE` | Ein Katalogreferenzpartner fehlt oder eine Paarhälfte soll einzeln erzeugt werden |
| `OSCAL_PROJECT_PROP_CATALOG_PAIR_DUPLICATE` | Key oder Commit kommt in derselben `group` mehrfach vor |
| `OSCAL_PROJECT_PROP_CATALOG_GROUP_MISMATCH` | Key und Commit stehen in voneinander abweichenden Gruppen |
| `OSCAL_PROJECT_PROP_CATALOG_KEY_INVALID` | Key ist unbekannt oder stimmt nicht exakt mit `group` überein |
| `OSCAL_PROJECT_PROP_CATALOG_COMMIT_INVALID` | Commit ist kein vollständiger kleingeschriebener 40-stelliger Hex-SHA |

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

Ein roher Validatorbefund mit Dokumentwert, lokalem Dateipfad und Stacktrace
wird ausschließlich als Code, Stufe, sicherer Strukturpfad und Message-Key
ausgegeben. Kann ein Validatorbefund nicht sicher normalisiert werden,
entsteht stattdessen `OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED` und das Gate
schlägt fehl.

## Bekannte BSI-Schemaabweichungen

Ein Klasse-1-Artefakt mit reproduziertem, im Upstream-Artefakt liegendem und
upstream gemeldetem Schemadefekt wird als `blocked-by-upstream` im
Quellregister gesperrt. Die BSI-Meldung ist Pflichtreferenz des Eintrags. Die
Sperrung ist keine Validatorausnahme: Das Artefakt wird weiter geprüft und sein
Schema-Status bleibt sichtbar `failed`.

| Artefakt | Root / Version | Upstream-Meldung |
| --- | --- | --- |
| `component-ga-lotse-grundmodul` | `component-definition` / 1.1.2 | [BSI #70](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/70) |
| `component-lieferkette` | `component-definition` / 1.1.2 | [BSI #71](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/71) |
| `mapping-iso27001-annex-a-zu-gspp` | `mapping-collection` / 1.2.2 | [BSI #68](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/68) |

Der Korpuslauf erwartet für jedes nicht gesperrte Artefakt `schema=passed` und
für jedes gesperrte Artefakt `schema=failed`. Ein Fehler eines nicht gesperrten
Artefakts oder ein bestandenes gesperrtes Artefakt lässt den Lauf
fehlschlagen; letzteres wird als Entsperrungskandidat ausgewiesen. Es existiert
keine Diagnosesignatur-Liste, keine Aggregat-Zerlegung und keine
Fortsetzungssemantik für diesen Lauf.

Für diesen Lauf gibt es keine aktive Ausnahme. Eine spätere Ausnahme für ein
unverzichtbares ausgeliefertes Artefakt wäre eine neue, ADR-pflichtige
Produktentscheidung; sie darf weder durch eine Diagnosesignatur noch durch eine
Änderung der Sperrsemantik dieses Korpuslaufs entstehen.

**Tree-Abwesenheit:** Verschwindet der
registrierte Pfad eines gesperrten Artefakts vollständig aus dem gepinnten
BSI-Tree, statt nur schema-defekt zu bleiben, gilt das als dieselbe inverse
Erwartung wie ein Schemafehlschlag. `fetch-catalog.mjs`, der Catalog-Sync-Guard
und dieser Korpuslauf lassen das Artefakt dann aus, statt den Lauf
abzubrechen. `verifySnapshotFiles` prüft jede Sync-PR dabei gegen den
tatsächlichen BSI-Tree des gepinnten Snapshots nach, damit eine Sync-PR ein
dort noch vorhandenes Artefakt nicht stillschweigend auslassen kann. Für nicht
gesperrte Artefakte (`supported`, `preview`, `draft`) bleibt ein fehlender Pfad
ein harter, fail-closed Abbruch — keine automatische
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

**Status:** Deterministische Profile Resolution mit kontrolliertem Builder,
verpflichtendem Bauzeitlauf und zweigeteiltem Referenznachweis. Die Ausgabe ist
ein Dokument
mit Root-Key `catalog`, das vollständig über den kontrollierten Builder
erschaffen wird; Rohobjekte fremder Herkunft gelangen nie in den
Ergebnisgraphen.

**Phasen (Import → Merge → Modify):**
1. **Import:** Selektion je Kante gegen das Quelldokument (Selektoren:
   `include-all`, `include-controls` mit `with-ids`/`matching`/`with-child-controls`,
   `exclude-controls`). `with-child-controls: yes` erweitert auf alle
   Nachfahren, sonst bleibt der Selbsttreffer. Der Draft-Default
   `with-parent-controls: yes` wird bewusst nicht materialisiert: Nicht
   selektierte Vorfahren erscheinen nicht als leere Hüllen; selektierte
   Nachfahren werden bei `as-is` an deren Quellposition hochgestuft. Das
   entspricht den NIST-Baselines und ist die dokumentierte Abweichung vom
   Draft-Default. `matching` wertet Globs gegen die Control-ID aus.
2. **Merge:** `combine` (`use-first` behält erste Definition, `keep`
   beide) und Struktur (`flat`, `as-is`, `custom` mit `insert-controls`
   und `order` ascending/descending/keep). `custom`-Gruppen werden
   exakt kopiert (ohne `insert-controls`), `insert-controls` füllen
   Controls an Gruppenpositionen; nicht getroffene Selektionen tragen
   nichts bei.
3. **Modify:** `set-parameter` ersetzt Skalarfelder und reichert `props`/`links` an. `alters` wendet `removes` vor `adds` an und ordnet geänderte Controls kanonisch (`src/domain/profileResolutionModify.ts`). Ein `add` mit `by-id` sucht Parameter, Parts und Kind-Controls unterhalb der adressierten Control; die Control selbst ist kein explizites Ziel. Die Suche prüft `params`, danach `parts` tiefenfirst und danach `controls` tiefenfirst einschließlich ihrer Parameter und Parts. Der erste Treffer bestimmt den Zieltyp. Die Tiefengrenze `CLASS_2_IMPORT_LIMITS.maxDepth` gilt für den gesamten Suchbaum.

| Zieltyp | `starting` / `ending` im Ziel | `before` / `after` in der gleichnamigen Elternliste |
| --- | --- | --- |
| Parameter | `props`, `links` | `params` |
| Part | `props`, `links`, `parts` | `parts` |
| Kind-Control | `params`, `props`, `links`, `parts` | keine Platzierung |

Bei fehlender `position` gilt `ending`. `title` wird bei expliziter Bindung ignoriert. Jede nicht leere Kategorie außerhalb der Tabellenzelle führt zu `PROFILE_RESOLUTION_ADD_UNPLACEABLE`; `before` und `after` an einer Kind-Control führen ebenfalls zu diesem Code. Die redigierte Diagnose nennt die verursachende `add`-Anweisung unter `/profile/modify/alters/<index>/adds/<index>` im aktuellen Profil; die Auflösung gibt kein Teilergebnis aus. Eine unbekannte `by-id` bleibt wirkungslos und erhält die Referenz der Control.

**Ergebnisvertrag (ADR-2 §10, ADR-8):**
- Eigene Dokument-UUID als UUIDv5 aus festem Projektnamensraum + UUID
  des steuernden Profils an `catalog.uuid` (deterministisch, Byte-identität
  beim Doppel-Lauf; `metadata.uuid` wird nicht erzeugt).
- Eigenes `last-modified` als Stempel `1970-01-01T00:00:00.000Z` (kein
  Wanduhrwert — Byte-Determinismus vor Verifikation).
- Provenienzträger `prop[name='resolution-tool']` und
  `link[rel='source-profile' href='urn:uuid:<Top-Profil-UUID>]`;
  `source-profile-uuid` wird nie gesetzt.
- Vertrauensklasse `class-2-local-user` auch bei Klasse-1-Eingaben
  (kein Manifest-/Hash-Indikator am Ergebnis).
- Jedes aufgelöste Zwischenprofil und das Endergebnis muss die gemeinsame
  Objekt-, Root-, Versions- und Schema-Pipeline bestehen; ein ungültiger
  Builder-Output wird nicht zwischengespeichert und nicht ausgegeben.
- Fehlerdiagnosen aus Import, Selektion, Merge und Modify tragen das aktuelle
  Profil als Artefaktkontext, weil ihr strukturierter Pfad in genau diesem
  Profil liegt. Diagnosen der anschließenden Ergebnisvalidierung tragen das
  erzeugende Zwischen- oder Top-Profil als Schlüssel, den Ergebnis-Root
  `catalog` und die gebundene OSCAL-Version. Artefaktschlüssel und Pfad werden
  nie aus unterschiedlichen Dokumenten kombiniert.
- Back-matter startet mit UUID-Fragmenten aus den Ergebnisstrukturen und dem
  vollständigen unverbrauchten Profil-Back-matter. Referenzierte
  Quellressourcen werden dann bis zum Fixpunkt ergänzt: Jeder in einer neu
  übernommenen Quelle gefundene UUID-Fragmentverweis wird wiederum aufgelöst.
  Die Abschlussmenge steht in stabiler Import-/Quellreihenfolge vor den
  unverbrauchten Profilressourcen und übrigen Profilmitgliedern. Bei
  case-insensitiv gleichen Ressourcen-UUIDs gewinnt die erste Quelle; auch
  Verbrauch einer Importbindung wird case-insensitiv bestimmt.

**Draft-Status:** Die NIST-Spezifikation
(https://pages.nist.gov/OSCAL/learn/concepts/processing/profile-resolution/)
trägt den Hinweis „work in progress and is subject to change“. Sie bleibt
verbindlicher Umsetzungsmaßstab, weil keine konkurrierende Norm existiert.
Vollständige Konformität wird weder für hergeleitete Fixtures noch insgesamt
behauptet.

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
  Differenzen stehen im Korpus-Harniss in einer festen, reviewbaren Registry:
  21 konkrete Linkentfernungen und eine konkrete Positionsabweichung. Das
  erwartete BSI-Dokument steuert diese Rekonziliation nicht.
- NIST-Whitespace-Artefakte (XML-Rest) werden ausschließlich in `prose`,
  `params[].select.choice[]` und `citation.text` symmetrisch normalisiert.
  Titel, Hrefs, IDs und alle übrigen Stringmitglieder bleiben Vergleichssignal.
- Back-matter-Provenienz: NIST übernimmt ausschließlich die im Ergebnis
  referenzierten Quellressourcen; Ressourcenanzahl und eindeutige nicht
  auflösbare `href`-Fragmentziele sind pro Baseline fest gepinnt und Teil
  des Orakels. Back-matter ist nicht volatil und bleibt vollständig im
  Gleichheitsvergleich. Die Pins
  `Ressourcen/eindeutige tote Fragmente` lauten LOW `135/125`, MODERATE
  `147/90`, HIGH `147/81` und PRIVACY `82/117`.

**Orakel-Architektur (zweigeteilt):**

Der Wartungssync `scripts/sync-oscal-content-oracle.mjs` begrenzt jeden Download auf 10 MiB. Fehlende Manifeste erlauben den Erstlauf; ein vorhandenes `ORACLE_MANIFEST.json` verlangt `--force`. Vor dem ersten Download brechen ab: ein vorhandenes Manifest ohne `--force`, ungültiges JSON, ein ungültiger Commit-Pin sowie ungültige oder doppelte Dateipins. Bei unverändertem Commit-Pin muss der Dateisatz zusätzlich schon vor dem ersten Download genau die zwölf erwarteten Artefakte abdecken — Quellkatalog, vier Baseline-Profile und vier aufgelöste Kataloge aus SP 800-53 rev5 sowie die drei SSP-Beispiele aus `examples/ssp/json/`, die `src/adapters/oscalSspDocument.node.test.ts` als Positivorakel nutzt; fehlende oder zusätzliche Dateipins, auch formal gültige, brechen ab. Erst nach dem jeweiligen Download prüft der Sync, ob SHA-256 und Dateigröße mit dem Pin gleichen Dateinamens übereinstimmen. Alle zwölf Downloads werden vor dem ersten Schreiben geprüft; ein Download- oder Prüffehler lässt den vorhandenen Fixture-Satz einschließlich Manifest unverändert. Ein geänderter Commit-Pin ist ein bewusster Erstabgleich mit neu erzeugten Hashes; seine alten Dateipins durchlaufen nur die Strukturprüfung. Schreibfehler nach erfolgreicher Prüfung können einen teilweise geschriebenen Satz hinterlassen; der Wartungslauf bietet keine atomare Dateisystem-Transaktion.

- **Realer Ausschnitt:** Vergleich gegen gepinnte, gehashte JSON-
  Ergebnisse von BSI (3 resolved_catalogs) und NIST (4 Baselines
  v1.5.0, Min-Variante, SHA-256-gepinnt unter
  `src/test/fixtures/oscal-content-v1.5.0/`). Volatile Felder
  (`metadata.last-modified`, Dokument-UUID am Körper,
  resolution-tool/source-profile) symmetrisch entfernt; zusätzlich
  feste BSI-Differenzregistry (`src/test/fixtures/bsiProfileResolutionDifferences.ts`,
  snapshotgebunden) und symmetrische Normalisierung ausschließlich
  belegter NIST-XML-Whitespace-Artefakte in `prose`,
  `params[].select.choice[]` und `citation.text`.
- **Übrige Semantik:** Kleine synthetische Fixtures, deren Erwartungs-
  werte pro Fall aus Draft + XSpec (usnistgov/OSCAL Tag v1.1.3,
  src/utils/resolver-pipeline/testing/*.xspec) hergeleitet und mit
  konkreter Quelle dokumentiert sind — hergeleitete Spezifikations-
  tests, kein unabhängiges Orakel.
- **Bauzeitlauf:** Verpflichtend nach `npm run fetch-catalog`, schreibt
  verifizierte Rohbytes nach `.cache/upstream-corpus/` (gitignoriert,
  10 Dokumente), kein zweiter Fetch, keine Env-Variablen-Pfade, kein
  Überspringen. Workflows `validate.yml`/`deploy.yml` führen
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
