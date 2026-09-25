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
in einer Einheit. Es gibt keine Import-UI, keine Persistenz und keine
Klasse-2-Anzeige.

**Stufe 2.**
`dispatchOscalDocument()` in
[`oscalRootDispatch.ts`](../src/adapters/oscalRootDispatch.ts) ist der
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

Die bestehende Integritätsprüfung und `parseCatalog` ersetzen diese Gates
nicht. Ausgewiesen werden dürfen ausschließlich die für den Klasse-2-Einstieg
tatsächlich ausgeführten Stufen 1 und 2, nie die vollständige Kette. Der
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
| 2. Root-Erkennung | **Umgesetzt:** `dispatchOscalDocument()` in [`oscalRootDispatch.ts`](../src/adapters/oscalRootDispatch.ts), projekteigen und ohne externes Werkzeug | Das Top-Level-Objekt muss genau einen der acht bekannten Root-Keys besitzen. Null, Arrays, mehrere Root-Keys und unbekannte Keys werden abgelehnt. Die optionale Schema-Direktive `$schema` ist die einzige zusätzlich zulässige Top-Level-Property; sie ist kein zweiter Root und **niemals** Versionsautorität. Eine Katalog-Interpretation als Fallback ist verboten. |
| 3. JSON-Schema | **Für Klasse 2 umgesetzt:** `ajv` 8.20.0 im Modul-Worker, gegen die eingecheckten NIST-Schemas unter `schemas/oscal/`. **CI umgesetzt:** [`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs) nutzt `go-oscal` 0.7.1 als unabhängiges Schema- und Upgrade-Orakel | Auswahl ausschließlich über den exakten Root×`oscal-version`-Schlüssel (einzige Normalisierung: ein führendes kleines `v`); kein Fallback auf eine Nachbarversion. Die Schemabytes kommen aus dem eigenen Bundle; der Chunk der ausgewählten Zelle wird zur Laufzeit von derselben Origin nachgeladen, nie von einer fremden. Ihre Integrität trägt der Bauzeitschritt `npm run verify-oscal-schemas`. Ist die Zelle nicht im Bundle oder lässt sich ihr Validator nicht bauen, endet der Import fail-closed mit `OSCAL_SCHEMA_UNAVAILABLE` — Stufe 3 wird weder übersprungen noch als bestanden ausgewiesen. Der CI-Korpuslauf bezieht Dokumente nur aus dem gepinnten BSI-Snapshot und führt weder Schema- noch Dokumentreferenz-Anfragen aus. Jedes nicht gesperrte Artefakt muss bestehen; ein gesperrtes Artefakt muss fehlschlagen. Fehlende oder nicht auswertbare Werkzeugergebnisse bleiben ein eigener fail-closed Werkzeugfehler. |
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
| `not-checked` | nur dort, wo der Vertrag ihn ausdrücklich vorsieht (heute ausschließlich Stufe 4) |
| `not-run` | nein, sobald die Stufe für die getroffene Aussage erforderlich ist |


Für Klasse-2-Referenzen ist `https:` das einzige als extern klassifizierbare
Protokoll. `javascript:`, `data:`, `file:` sowie jedes andere Protokoll werden
von [`referenceResolution.ts`](../src/domain/referenceResolution.ts)
fail-closed als `unsafe-protocol` behandelt; die Klassifikation führt weder
Netzwerk- noch Dateizugriffe aus. Fehlende `rlink.hashes` ergeben
`integrity: 'missing'`, nicht Vertrauen.

### Klasse-2-Grenzwerte

Die Grenzen begrenzen ausschließlich den lokalen Klasse-2-Einstieg; der
bestehende Klasse-1-Loader bleibt davon getrennt. Sie stehen als
`CLASS_2_IMPORT_LIMITS` in
[`class2ImportLimits.mjs`](../src/domain/class2ImportLimits.mjs) und haben dort
genau einen Ort:
[`oscalImportContract.ts`](../src/domain/oscalImportContract.ts) reicht sie an
den Anwendungspfad weiter, der Messapparat unten liest dieselbe Datei. Reines
ESM, weil er sie in einer nackten Node-Laufzeit ohne Aliasauflösung und ohne
TypeScript braucht — dasselbe Muster wie `oscalVersionMatrix.mjs`.

| Grenze | Wert | Kostenbasierte Begründung |
| --- | --- | --- |
| Bytes vor Dekodierung | 10 MiB | Ein Dokument, das nur diese Grenze ausschöpft, kostet 33,35 MiB Speicher und 0,60 s Rechenzeit. Bytes für sich sind billig; teuer wird erst, was in ihnen steht — wie verschieden es ist und wie breit. |
| Verschachtelungstiefe | 64 | Rekursionstiefe ist für sich kostenlos; die Grenze schützt den Stapel, nicht das Budget. |
| Knoten | 1 000 000 | Bindende Grenze für den Speicher. Das teuerste Dokument darauf kostet 112,75 MiB — das Elffache seiner eigenen 10 MiB. Der Speicherabdruck wächst mit ihr, gemessen über fünf Stützpunkte. |
| Summe dekodierter Base64-Größen | 4 MiB | Auf 10 MiB war die Grenze arithmetisch unerreichbar und damit wirkungslos; siehe „Die Base64-Grenze war tot“ unten. |

Diese vier Werte begrenzen **Größe**, keine Arbeit: Ein Dokument von wenigen
Kilobyte kann den Resolver minutenlang beschäftigen, ohne eine von ihnen zu
berühren. Die fünfte Klasse-2-Grenze ist deshalb `WORK_UNIT_LIMIT` in
[`profileResolutionBudgetLimits.mjs`](../src/domain/profileResolutionBudgetLimits.mjs);
sie steht in einem eigenen Modul, weil sie nur für den Ableitungsweg gilt und
nicht für den Byte-Eingang. Herleitung unter „`WORK_UNIT_LIMIT`:
kostenbasiert hergeleitet, je Kategorie gemessen“.

Alle vier Grenzen halten das Speicherbudget: Gemessener ungünstigster Fall
112,75 MiB gegen 128 MiB (88 % ausgeschöpft).

#### Maßstab der Grenzwerte

Die Grenzwerte sind gegen die Kosten des ungünstigsten zulässigen Falls
begründet (Angreiferkosten), nicht gegen ein Vielfaches des realen Katalogs.
Der reale Bestand (`public/data/catalog.json`: 5 399 453 Bytes, Tiefe 18,
70 851 Knoten) dient nur als nachgelagerte Plausibilitätsprobe: Die Grenzen
liegen darüber, legitime Dokumente scheitern also nicht.

#### Ressourcenbudget des Klasse-2-Pfads

Verbindlich für jede Änderung dieser Grenzwerte:

| Budgetposten | Wert | Begründung |
| --- | --- | --- |
| Zusätzlicher Speicher im Tab je Import | **≤ 128 MiB** | 128 MiB ist ein spürbarer, aber tragbarer Anteil des Old-Space eines Renderer-Prozesses auf Bürohardware und lässt neben dem geladenen Klasse-1-Katalog und dem Suchindex Luft für die übrige Anwendung. **Gemessener ungünstigster Fall: 112,75 MiB, also 88 % ausgeschöpft.** |
| Blockierzeit des UI-Threads | **≤ 50 ms** | Oberhalb von 50 ms nimmt der Nutzer die Oberfläche als hängend wahr; es ist zugleich die Schwelle, ab der die Plattform einen Task als Long Task meldet, sodass eine Verletzung messbar ist. Der Nachweis unten hält das Budget in allen 66 Wiederholungen. |
| Sichtbare Wartezeit bis zum Ergebnis | **≤ 5 s** | Der Nutzer wartet auf Annahme oder Diagnose. Fünf Sekunden bleiben als bewusste Wartezeit erklärbar; darüber wirkt die Anwendung defekt. Hart gedeckelt ist die Wartezeit ohnehin durch `CLASS_2_IMPORT_WORKER_TIMEOUT_MS` (30 s). |

##### Wahl des Speicherbudgets

V8 beschreibt die Form eines Objekts in einer verborgenen Klasse, die sich
alle formgleichen Objekte teilen: Eine Million identischer leerer Objekte
(`depth-bound`) kostet eine einzige solche Beschreibung und ist damit der
**günstigste** Fall dieser Achse, nicht der teuerste. `heap-bound` gibt jedem
Container einen eigenen Schlüssel und kostet vollständig gemessen 112,75 MiB.
Das Budget von 128 MiB deckelt den Angriffsfall, ohne wachsende echte Dokumente
auszusperren (realer BSI-Katalog: 70 851 Knoten).

#### Messprotokoll

Reproduzierbar über das Wartungswerkzeug
[`measure-class2-budget.mjs`](../scripts/measure-class2-budget.mjs):

```bash
node scripts/measure-class2-budget.mjs --throttle 1,4 --repeat 3 --skip-glob \
  --scale 62500,125000,250000,500000,1000000
```

`--scale` misst die knotenskalierbaren Fixtures zusätzlich an mehreren
Knotenzahlen; daraus entsteht die Herleitungstabelle weiter unten. Ohne die
Option misst der Lauf nur die Grenzwerte selbst. `--skip-glob` lässt die
Glob-Reihe aus.

Das Skript hängt bewusst an keinem Anwendungspfad und ist weder in
`npm run build`/`test`/`dev` noch in einem CI-Gate eingebunden — dieselbe
Trennung wie [`sync-oscal-schemas.mjs`](../scripts/sync-oscal-schemas.mjs).
Es startet einen temporären Vite-Dev-Server, lädt einen Chromium über
Playwright und ruft darin die **produktiven** Einheiten der Prüfkette auf,
einschließlich der Glob-Übersetzung aus
[`profileResolutionSelection.ts`](../src/domain/profileResolutionSelection.ts).
Die reine Berichtslogik liegt in
[`measureClass2BudgetReport.mjs`](../scripts/measureClass2BudgetReport.mjs) und
ist dort kolokiert getestet.

Der Messserver läuft ohne HMR und ohne Dateiwächter über `.worktrees/`,
`node_modules/` und `dist/`: Der Server liest den gesamten Repository-Baum,
und ein Reload der Messseite zerstört den Ausführungskontext samt
festgehaltenem Bestand.

Die Dokumente erzeugt
[`class2WorstCaseFixtures.mjs`](../scripts/class2WorstCaseFixtures.mjs)
deterministisch. Dass jedes von ihnen exakt auf seiner Grenze liegt, eine
Einheit darüber abgewiesen wird und die Kette so weit durchläuft, wie es die
Tabelle behauptet, hält
[`class2WorstCaseFixtures.test.ts`](../scripts/class2WorstCaseFixtures.test.ts)
fest.

**Messbasis:** Apple MacBook Pro (Mac16,8), Apple M4 Pro, 14 Kerne, 24 GB RAM,
macOS 26.6.2 (25G83); Chromium 151.0.7922.34 headless über Playwright 1.62.1.

Der Lauf misst zusätzlich mit vierfacher CPU-Drosselung
(`Emulation.setCPUThrottlingRate`) als benannte Näherung an gängige
Bürohardware. Der Faktor 4 ist eine **gesetzte Annahme**, keine Messung an
einem zweiten Gerät; die Zeitwerte der 4×-Spalte sind entsprechend zu lesen.
Speicherwerte hängen an der Datenstruktur, nicht an der Taktrate, und werden
einmal im ungedrosselten Lauf erhoben und in den zweiten übernommen.

Zeiten sind Mediane aus drei Läufen, Blockierzeiten deren Maximum.

| Fixture | Grenze | Dokument | Kette 1× | Kette 4× | Ende-zu-Ende | Bestand Parse | Bestand Kette | Main Thread | Spitze | Schemastufe |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `byte-bound` | `maxBytes` | 10,00 MiB | 0,12 s | 0,63 s | 0,15 s | 21,68 MiB | 11,54 MiB | 1,67 MiB | 33,35 MiB | ja |
| `node-bound` | `maxNodes` | 6,68 MiB | 0,66 s | 2,91 s | 0,77 s | 31,68 MiB | 24,98 MiB | 15,27 MiB | 53,63 MiB | ja |
| `depth-bound` | `maxDepth` | 2,86 MiB | 0,93 s | 4,19 s | 0,90 s | 49,81 MiB | 46,94 MiB | 0,01 MiB | 52,68 MiB | nein |
| `heap-bound` | `maxNodes` + `maxBytes` | 10,00 MiB | 1,04 s | **5,93 s** | 1,05 s | 102,75 MiB | 92,73 MiB | 0,00 MiB | **112,75 MiB** | nein |
| `record-bound` | `maxBytes` | 10,00 MiB | 1,89 s | **8,68 s** | 1,94 s | 67,34 MiB | 91,64 MiB | 0,00 MiB | 101,64 MiB | nein |
| `base64-bound` | `maxDecodedBase64Bytes` | 5,33 MiB | 0,11 s | 0,50 s | 0,15 s | 10,70 MiB | 5,37 MiB | 5,34 MiB | 21,38 MiB | ja |
| `combined-bound` | `maxNodes` + `maxBytes` | 10,00 MiB | 0,74 s | 3,35 s | 0,82 s | 41,65 MiB | 31,63 MiB | 18,58 MiB | 70,23 MiB | ja |

„Kette“ ist Stufe 1 plus objektorientierte Kette, direkt im Tab gemessen —
also die Arbeit, die im Produktivpfad der Worker leistet. „Ende-zu-Ende“ ist
derselbe Vorgang über den produktiven Einstieg
[`importClass2OscalDocument`](../src/adapters/oscalImportGate.ts) mitsamt
Worker-Start und Nachrichtenübergabe. Was „Bestand Parse“, „Bestand Kette“ und
„Main Thread“ enthalten und wie die Spitze daraus entsteht, steht unter
„Woraus sich die Speicherspitze zusammensetzt“.

Die vier als schemafähig ausgewiesenen Fixtures sind gültige
OSCAL-Katalogwurzeln nach dem gepinnten Schema 1.1.3 und werden von der Kette
**angenommen** — ihre Werte schließen Schema-Chunk, Ajv-Kompilierung und
Ajv-Lauf ein. Damit die teuerste Stufe in der Messung enthalten ist, erreicht
jedes Fixture die Schemastufe oder weist aus, dass es sie nicht erreicht.

##### Blockierzeit des Main Threads

Der Worker rechnet nebenläufig, der Main Thread wartet. Die Blockierzeit wird
getrennt gemessen, über die Long-Task-Einträge der Plattform, die das
Importintervall überlappen. Deren Schwelle ist mit 50 ms genau das Budget — ein
leerer Eintragssatz ist der Nachweis der Einhaltung.

Der synchrone Hinweg — Pufferkopie, Worker-Erzeugung, ausgehendes
`postMessage` — kostet in allen Fällen unter 4 ms. Die Blockade lag auf dem
**Rückweg** (strukturierte Deserialisierung des vollständigen Ergebnisgraphen
im Main Thread); die Herleitung steht unter „Der Rückweg des Workers
blockiert“. Der Fragmenttransport unten beseitigt sie; der Nachweis hält das
50-ms-Budget in allen 66 Wiederholungen.

**Der Messweg belegt vor jeder Messreihe seine eigene Beobachtbarkeit:**
`assertLongTaskObservability` blockiert absichtlich 120 ms in einem regulären
Task und verlangt dafür einen Eintrag; bleibt er aus, bricht der Lauf ab,
statt ein Budget zu behaupten.

##### Grenzwertherleitung: Kosten über der Knotenzahl

Ein einzelner Messpunkt auf der heutigen Grenze sagt nicht, welche Grenze das
Budget halten würde. Die Reihe misst deshalb an fünf Stützpunkten, jeder mit
eigenem Dokument und ausgeschöpfter Bytegrenze — keine Hochrechnung.

| Knoten | `heap-bound` Spitze | `record-bound` Spitze | `node-bound` Blockierzeit 4× | `combined-bound` Blockierzeit 4× |
| --- | --- | --- | --- | --- |
| 62 500 | 44,08 MiB | 42,28 MiB | 0 ms | 0 ms |
| 125 000 | 49,07 MiB | 44,54 MiB | 0 ms | 0 ms |
| 250 000 | 58,14 MiB | 48,62 MiB | 0 ms | 0 ms |
| 500 000 | 77,27 MiB | 64,91 MiB | **107 ms** | 0 ms |
| 1 000 000 | 112,89 MiB | 101,67 MiB | **222 ms** | **224 ms** |

Der Speicher wächst in der Knotenzahl über einem Sockel von rund 35 MiB, den
die ausgeschöpfte Bytegrenze mitsamt ihrer beiden Pufferkopien und der
dekodierten Zeichenkette trägt. Die Blockierzeit wächst in der Knotenzahl des
**angenommenen** Ergebnisses, nicht in der Dokumentgröße: `heap-bound` und
`record-bound` sind mit 10,00 MiB die größten Dokumente des Satzes und
blockieren bei keiner Knotenzahl, weil sie abgewiesen werden und nur eine
Diagnose zurückwandert.

**Das Speicherbudget von 128 MiB trägt die volle Million** — 112,89 MiB im
ungünstigsten Fall. Gedeckelt wird die Reihe allein vom UI-Budget: Der größte
Stützpunkt, an dem jedes Fixture beide Posten hält, liegt bei 250 000 unter
vierfacher Drosselung (ungedrosselt bei 500 000). Bei 70 851 Knoten des realen
Katalogs bliebe damit Faktor 3,5 Kopfraum.

Die Herleitung selbst ist fail-closed und arbeitet über die Knotenzahl, nicht
über die Fixtures: Ein Stützpunkt zählt nur, wenn dort **jedes** Fixture der
Reihe gemessen wurde und **beide** Budgetposten hält, und die Reihe wird von
der kleinsten Knotenzahl an lückenlos abgelaufen. Ein gerissener Stützpunkt
beendet die Aussage; ein größerer, der zufällig wieder hält, hebt ihn nicht
auf. Browsermessungen sind nicht monoton, und ein Grenzwert, der auf einem
gemessen gerissenen Stützpunkt steht, ist falsch und nicht bloß ungenau.

##### Erhoben über den gesamten Agenten-Speicher

CDP `Runtime.getHeapUsage` deckt nur den V8-JS-Heap ab. Zwei Posten des
Klasse-2-Pfads liegen daneben: der Backing-Store eines
`ArrayBuffer`/`Uint8Array` (externer Speicher) und das Ergebnis von
`TextDecoder.decode` (in Blink ein externer String). Erhoben wird deshalb über
`performance.measureUserAgentSpecificMemory()`: Sie erfasst den gesamten
Agenten einschließlich externer Strings und Puffer, verlangt dafür eine
cross-origin isolierte Seite (der temporäre Messserver setzt COOP/COEP
entsprechend) und kostet rund zehn Sekunden je Aufruf. Der Speicher wird darum
einmal je Fixture erhoben und nicht je Wiederholung; der ungünstigste Fall lag
über drei unabhängige Läufe bei 112,75 / 112,89 / 112,93 MiB.

**Auch dieser Messweg belegt vor jeder Messreihe seine Beobachtbarkeit:**
`assertMemoryObservability` hält einen beschriebenen 16-MiB-Puffer fest und
verlangt, dass die Messung ihn sieht (gemeldet 15,99 bzw. 16,00 MiB). Bleibt
der Beleg aus, bricht der Lauf ab, und der Bericht verweigert sich.

##### Woraus sich die Speicherspitze zusammensetzt

Den Speicherverlauf *während* eines Imports abzutasten ist nicht möglich: Jede
CDP-Antwort und jede Speichermessung wird vom Inspektor des betroffenen Isolats
bedient und liegt in dessen Warteschlange, solange dort synchroner
JavaScript-Code läuft — und die Prüfkette ist von ihrem Eintritt bis zu ihrer
Rückkehr genau das.

Der Harnisch baut deshalb den gleichzeitig lebenden Bestand auf, hält ihn fest
und lässt messen. Jeder Posten ist dieselbe Datenstruktur über denselben
Graphen, mit derselben Sprachkonstruktion wie im Produktivcode. Die Kette hat
**zwei** Höchststände mit verschiedenem Bestand, und die Spitze ist der größere
von beiden, nicht ihre Summe:

| Höchststand | Gleichzeitig lebend |
| --- | --- |
| Parse-Stufe (`parseClass2OscalInput`) | Eingabebytes, die dekodierte Zeichenkette, das Parse-Produkt sowie `visited` und `pending` des Registrierungsdurchlaufs. |
| Objektkette (`processClass2OscalValue`) | Eingabebytes, das Parse-Produkt, die Identitätsmenge und den Arbeitsvorrat des Herkunftsdurchlaufs sowie das `Object.entries`-Paar-Array des gerade besuchten Records — **keine** Zeichenkette mehr: Stufe 1 ist zurückgekehrt, ihre lokale `text` ist unerreichbar. |

Die einzelnen Posten und ihre Herkunft im Produktivcode:

| Posten | Wo er entsteht |
| --- | --- |
| Zeichenkette | `new TextDecoder('utf-8', { fatal: true }).decode(bytes)` in Stufe 1 — dieselbe Zeile. |
| Identitätsmenge | Das `Set` über jeden Container: `seenContainers` in `enforceClass2ObjectGraphInvariants` und `visited` in `walkOwnContainers`. Nie lebt mehr als eines davon, deshalb zählt es einmal. |
| Arbeitsvorrat | `pending` in `walkOwnContainers`, aufgebaut bis zur Obergrenze aller Kind-Slots. Bei einem breiten Container steht der gesamte Bestand darin auf einmal. |
| Paar-Array | `Object.entries(record)` in `visitRecord`, gehalten über die ganze Mitgliederschleife. Genommen wird der breiteste Record des Graphen. Dieselbe Breite tragen die `Reflect.ownKeys`-Arrays in Formprüfung, Knotenuntergrenze und Bytebuchhaltung; sie leben dort kürzer. |

Dazu zwei Posten, die nicht im Kettenbestand stecken:

| Posten | Erhebung |
| --- | --- |
| Main Thread | Was der produktive Weg im Hauptkontext hinterlässt — im Wesentlichen der aus der Worker-Antwort strukturiert deserialisierte Ergebnisgraph. Gemessen um `importClass2OscalDocument` herum gegen eine eigene Basislinie. Er kommt **hinzu**, weil beides gleichzeitig besteht: Der Worker wird erst nach Eintreffen der Antwort beendet, sein Bestand lebt also noch, während der Hauptkontext den Klon aufbaut. |
| Zweiter Eingabepuffer | `copyForTransfer` in [`oscalImportGate.ts`](../src/adapters/oscalImportGate.ts) legt für die Übergabe eine vollständige Kopie an, die an den Worker übergeht, während der Aufrufer sein Original behält. Der Kettenbestand hält davon nur eine; die zweite wird arithmetisch zugeschlagen. |

Drei Messgrenzen bleiben bestehen und sind hier ausgewiesen, nicht behoben:

- Der Bestand des Worker-Isolats erscheint in der Messung des Hauptkontexts
  nicht. Die Kette wird darum zusätzlich direkt im Tab ausgeführt — dieselben
  Einheiten, dasselbe Dokument, dieselbe Datenstruktur.
- Die **transienten** Allokationen der Schemastufe sind nicht festgehalten:
  Sie entstehen innerhalb eines synchronen Ajv-Aufrufs und lassen sich von
  außen weder halten noch abtasten. Ihr Beitrag ist nach oben eingegrenzt,
  nicht durch eine Rechnung, sondern durch den Abstand: Der ungünstigste Fall
  des Satzes (`heap-bound`, 112,75 MiB) erreicht die Schemastufe gar nicht,
  und die vier Fixtures, die sie erreichen, liegen zwischen 21,38 und
  70,23 MiB — mit 58 MiB Abstand zum ungünstigsten Fall.
- `Emulation.setCPUThrottlingRate` wirkt auf den Seiten-Thread, nicht auf
  dedizierte Worker. Die Ende-zu-Ende-Spalte ist daher in beiden Läufen
  weitgehend ungedrosselt und nicht auf Bürohardware übertragbar. Die
  Blockierzeit ist davon nicht betroffen: Sie entsteht im Seiten-Thread und
  wird von der Drosselung erfasst — sichtbar daran, dass sie zwischen 1× und
  4× um etwa den Faktor 4 steigt.

#### Grenzwert-Befunde

- **`maxBytes` 10 MiB — bestätigt.** Ein Dokument, das nur diese Grenze
  ausschöpft, kostet 33,35 MiB und 0,63 s. Der Wert stimmt zufällig mit
  `MAX_CATALOG_ARTIFACT_BYTES` in
  [`fetch-catalog.mjs`](../scripts/fetch-catalog.mjs) überein; diese
  Übereinstimmung ist **keine** Begründung. Die eine Konstante sichert einen
  Build-Zeit-Abruf aus vertrauter, versionsgepinnter Quelle, die andere die
  Laufzeitverarbeitung eines potenziell feindlichen lokalen Dokuments. Die
  beiden dürfen sich unabhängig voneinander bewegen.
- **`maxNodes` 1 000 000 — gehalten.** Sie ist die bindende Grenze für den
  Speicher: Das teuerste Dokument darauf kostet 112,75 MiB gegen 128 MiB. Die
  Herleitung steht über fünf gemessenen Stützpunkten. Gedeckelt wird die Reihe
  nicht vom Speicher, sondern vom UI-Budget.
- **`maxDepth` 64 — bestätigt.** Rekursionstiefe ist für sich kein
  Kostentreiber; die Grenze schützt den Stapel.
- **`maxDecodedBase64Bytes` 4 MiB — korrigiert aus 10 MiB.** Begründung unten.

##### Befund: Der Rückweg des Workers blockierte

Die Kette läuft im Worker; auf dem UI-Thread verblieben nach der
Architekturannahme nur Pufferkopie und `postMessage`. Die Annahme ließ den
Rückweg aus: Der Worker in
[`oscalImport.worker.ts`](../src/workers/oscalImport.worker.ts) antwortete mit
`self.postMessage(response)` und schickte den vollständigen Ergebnisgraphen
mit; dessen strukturierte Deserialisierung lief im Main Thread, vor dem
`message`-Handler in
[`oscalImportGate.ts`](../src/adapters/oscalImportGate.ts).

Die Messung trennt Ursache und Nebenwirkung: `heap-bound` und `record-bound`
sind mit je 10,00 MiB die größten Dokumente des Satzes und blockieren bei
**keiner** Knotenzahl, weil sie abgewiesen werden und nur eine Diagnose
zurückwandert. Blockiert wird ausschließlich bei angenommenen Dokumenten,
proportional zur Knotenzahl des zurückgegebenen Graphen. Der folgende Nachweis
bewertet den geänderten Transport mit Fragmenten und Quittungen.

##### Quittierter Ergebnistransport

`importClass2OscalDocument(bytes, context)` liefert erst den vollständigen
validierten `source`-Baum mit Aufrufkontext, Root-Typ und OSCAL-Version zurück.
Die Byte-, Struktur-, Ressourcen-, Root- und Schemaprüfungen laufen unverändert
vor jeder erfolgreichen Datenübertragung im Worker. Eine fachliche Ablehnung
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
Der Transport bleibt innerhalb des Browsers; er ergänzt weder Persistenz noch
externe Übertragungsziele. Das bestehende Browser-Egress-Orakel bleibt Teil
der echten Browsertests.

Die Transporttests prüfen zusätzlich zum produktiven Schemaweg unbekannte Felder,
Arrayreihenfolge, leere Container, `-0`, Unicode, lange Schlüssel und Strings sowie
Tiefe und Breite. Unbekannte schemawidrige Felder werden dadurch nicht zulässig:
Das neue `key-bound`-Grenzfixture bleibt eine erwartete Schemaablehnung.
`string-bound` und `unicode-bound` sind dagegen gültige Dokumente an der
10-MiB-Bytegrenze; `valid-depth-bound` nutzt die tiefste hier konstruierte gültige
Kataloggruppenstruktur mit 63 Ebenen unter der Grenze von 64.

Der Messharnisch ergänzt einen gleichzeitig gehaltenen Transportbestand:
Quellbaum, vollständiger Decoderbaum als Obergrenze des Teilbaums, alle
Record-Schlüsselarrays als Obergrenze des aktiven Traversierungsstapels,
begrenzte Stacks und Fragmente beider Seiten sowie zwei UTF-16-Puffer für den
längsten Schlüssel oder String. Die Puffermessung erfasst auch externe
`ArrayBuffer`-Bestände. Ausgewiesen wird das Maximum aus diesem Bestand und
dem bisherigen Prüfkettenbestand plus Ergebnis, jeweils zuzüglich der beim
Aufrufer verbleibenden Eingabe. Das ist ein konservativ gehaltener Bestand,
keine zeitliche Abtastung des tatsächlichen Worker-Peaks. Die oben benannten
Grenzen der Messung in einem anderen Isolat und transienter Ajv-Allokationen
bleiben bestehen.

Der Nachweis bestand mit
`node scripts/measure-class2-budget.mjs --throttle 1,4 --repeat 3`.
Alle elf Grenzfixtures behielten in allen 66 Einzelwiederholungen ihr erwartetes
Ergebnis; es gab keinen Import-Long-Task. Das Messintervall umfasst Eingabekopie,
Workerstart, Validierung, Rücktransport und vollständige Ergebnisnutzbarkeit.
Die längste einzelne Wartezeit betrug 2 647,74 ms, der höchste Speicherwert
112,74 MiB bei `heap-bound`. Die Grenzen bleiben bei einer Million Knoten,
128 MiB Speicher und 50 ms UI-Blockierzeit.

Messumgebung: Apple M4 Pro (Mac16,8), 14 Kerne, 24 GiB RAM,
macOS 26.6.2 (25G83), Node 22.22.3, Playwright 1.62.1,
Chromium 151.0.7922.34. Die CPU-Drosselung betrifft den Main Thread;
sie simuliert keine langsamere Worker-CPU. Die 120-ms-Beobachtbarkeitsprobe
meldete bei beiden Drosselungen 120 ms; der 16-MiB-Speicherprüfpuffer wurde
als 15,98 MiB erfasst. Speicherwerte wurden einmal bei 1× erhoben.

Die [vollständigen Messdaten](measurements/gspp386-worker-transport.json)
enthalten jede Wiederholung, Pflichtmessfelder, Proben und beide Fingerprints.

| Fixture | E2E-Median 1× | E2E-Median 4× | Speicher | Ergebnis |
| --- | --- | --- | --- | --- |
| `byte-bound` | 158.3 ms | 177.3 ms | 33.36 MiB | angenommen |
| `node-bound` | 1202.3 ms | 2612.6 ms | 54.14 MiB | angenommen |
| `depth-bound` | 875.4 ms | 1001.8 ms | 53.11 MiB | OSCAL_DOCUMENT_NOT_OBJECT |
| `heap-bound` | 989.0 ms | 1265.7 ms | 112.74 MiB | OSCAL_DOCUMENT_NOT_OBJECT |
| `record-bound` | 1920.4 ms | 2382.2 ms | 101.67 MiB | OSCAL_ROOT_KEY_AMBIGUOUS |
| `base64-bound` | 153.6 ms | 192.9 ms | 37.51 MiB | angenommen |
| `combined-bound` | 1120.3 ms | 2640.9 ms | 80.76 MiB | angenommen |
| `string-bound` | 242.6 ms | 291.3 ms | 80.12 MiB | angenommen |
| `unicode-bound` | 191.8 ms | 228.5 ms | 46.14 MiB | angenommen |
| `key-bound` | 248.0 ms | 287.3 ms | 30.01 MiB | OSCAL_SCHEMA_ADDITIONAL_PROPERTY |
| `valid-depth-bound` | 49.0 ms | 55.6 ms | 0.16 MiB | angenommen |

Der Bericht führt neben dem Median den Höchstwert aller Einzelwiederholungen;
ein langsamer Einzelimport darf weder das UI-Urteil noch die
Knotengrenzherleitung bestehen. Die 66 Rohmessungen bestehen auch mit dieser
strengeren Auswertung. Zusätzlich prüfen direkte kolokierte Tests beide
Browserkontexte, binäre Routen mit und ohne Eingabe, Fehler-Cleanup,
`prepareBytes` und den gehaltenen Transportbestand.

##### Warum das teuerste Dokument kein gültiger Katalog ist

Der Speicher-Worst-Case ist `heap-bound`: eine halbe Million Objekte mit je
eigenem Schlüsselnamen, deren Werte leere Objekte sind. Nicht die
Containerzahl treibt hier den Heap, sondern die Zahl **verschiedener Formen**
(verborgene Klassen, internalisierte Schlüsselstrings). `depth-bound` trägt mit
einer Million leerer Objekte die **höchste** Containerzahl des Satzes und
kostet trotzdem nur 52,68 MiB; `heap-bound` trägt weniger Container und kostet
112,75 MiB.

##### Die zweite Achse: ein Container maximaler Breite

`heap-bound` reizt die Zahl verschiedener Objektformen aus, sagt aber nichts
über die **Breite** eines einzelnen Containers: `visitRecord` hält ein
`Object.entries`-Paar-Array über die ganze Mitgliederschleife; Formprüfung,
Knotenuntergrenze und Bytebuchhaltung legen je ein `Reflect.ownKeys`-Array
derselben Länge an.

`record-bound` schließt die Lücke: ein Wurzelobjekt mit 999 999 paarweise
verschiedenen Schlüsseln, Byte- und Knotengrenze beide ausgeschöpft. Der
Höchststand liegt hier in der Objektkette (91,64 MiB gegen 67,34 MiB in der
Parse-Stufe); insgesamt bleibt es mit 101,64 MiB unter `heap-bound`.

Ein Angreifer ist an die Schemagültigkeit nicht gebunden. Die Ablehnung im
Root-Dispatch erfolgt **erst**, nachdem Stufe 1 den Graphen aufgebaut und die
Strukturinvariante ihre Identitätsmenge über ihn gelegt hat. Das Budget muss
deshalb diesen Fall tragen und nicht den des gültigen Katalogs.

Umgekehrt ist eine Tiefe von exakt 64 mit einem schemagültigen Katalog nicht
konstruierbar: Gruppenobjekte liegen dort ausschließlich auf geraden Tiefen
und ihre Blätter deshalb ausschließlich auf ungeraden; erreichbar wäre nur 63.
Das `depth-bound`-Fixture belegt, dass die Tiefengrenze bindet, und sonst
nichts.

#### Die Base64-Grenze war tot

Ein `base64`-Wert steht als Text im Dokument und zählt vollständig gegen
`maxBytes`. Seine dekodierte Größe ist `floor(len / 4) * 3` abzüglich
Polsterung, also höchstens drei Viertel der kodierten Länge. Selbst ein
Dokument, das seine gesamten zugelassenen 10 MiB als base64-Text ausgibt,
erreicht damit nur **7 864 278 Byte** dekodierte Summe. Eine auf 10 MiB
gesetzte Grenze konnte deshalb durch **keine** Eingabe je auslösen.

Der neue Wert 4 MiB ist doppelt hergeleitet:

- **Wirksamkeit.** Er muss unter dem erreichbaren Deckel von 7 864 278 Byte
  liegen, sonst bleibt die Grenze tot. Das ist die harte Bedingung.
- **Kosten.** Eine dekodierte Nutzlast von 4 MiB verlangt 5,33 MiB kodierten
  Text im Dokument und lässt damit immer noch mehr Byteraum für das eigentliche
  OSCAL-Dokument übrig, als die Nutzlast selbst belegt. Bei 5 MiB kippt dieses
  Verhältnis. Gemessen kostet das Fixture auf der neuen Grenze 21,38 MiB — mit
  einer künftigen Dekodierung träte die dekodierte Nutzlast hinzu und bliebe
  mit rund 25 MiB weit im Budget.

[`class2ImportLimits.invariants.test.ts`](../src/domain/class2ImportLimits.invariants.test.ts)
hält die Erreichbarkeit als dauerhafte Invariante fest und weist ein Dokument
über der Grenze am echten Byte-Eintrittspunkt ab — nicht an einer
vorbeigeführten Stufe.

Die Anwendung dekodiert `base64` heute an keiner Stelle. Die Grenze wirkt
vorsorglich für den ersten Verbraucher; ihr Kostenmodell ist dessen
Heap-Allokation.

#### `matching.pattern`: iterativer Abgleich statt RegExp

Der Abgleich von `matching`-Globs gegen Control-IDs läuft in
[`profileResolutionSelection.ts`](../src/domain/profileResolutionSelection.ts)
über `matchGlob` — einen iterativen Zwei-Zeiger-Abgleich mit genau einem
Rücksprungpunkt je Stern. Er hat keinen exponentiellen Fall, ist durch
Muster × Subjekt beschränkt und bucht **jeden besuchten Zustand** als
Arbeitseinheit der Kategorie `glob-state`. Damit ist der Abgleich von außen
abbrechbar. Die Messwerte in
[`docs/measurements/gspp345-work-budget.json`](./measurements/gspp345-work-budget.json)
bleiben für jede Sternzahl unter einer Millisekunde; die Kosten hängen an der
Subjektlänge, nicht mehr an der Sternzahl. Keine der Ressourcengrenzen (Byte-,
Knoten-, Tiefengrenze) beschränkt Muster- oder Subjektlänge wirksam — ein
Muster dieser Größe verbraucht davon nichts Nennenswertes.

Die Semantik: `*` trifft beliebig viele Zeichen einschließlich keiner, `?`
genau eines, der Abgleich ist vollständig verankert. Eine Abweichung ist
ausgewiesen: `.` traf in einem regulären Ausdruck ohne `s`-Flag keinen
Zeilenumbruch; der Zeichenvergleich behandelt jedes Zeichen gleich. Für den
BSI-Korpus ist die Änderung wirkungslos — der Korpuslauf vergleicht alle drei
aufgelösten Kataloge byte-nah gegen die BSI-Referenz und die vier
SP-800-53-Baselines gegen die NIST-Referenz, und beide Orakel sind grün.

Der Messlauf ruft `matchGlob` selbst auf, statt den Abgleich nachzubilden. Die
Funktion ist dafür exportiert: Eine zweite Fassung im Messwerkzeug würde
unbemerkt driften und das Protokoll unwahr machen.

#### `WORK_UNIT_LIMIT`: kostenbasiert hergeleitet, je Kategorie gemessen

Die Arbeitsgrenze der Profile Resolution steht als `WORK_UNIT_LIMIT` in
[`profileResolutionBudgetLimits.mjs`](../src/domain/profileResolutionBudgetLimits.mjs)
und beträgt **16 763 456 Arbeitseinheiten**. Sie ist eine Klasse-2-Grenze wie
die vier oben und folgt derselben Herleitungsregel: Ein Grenzwert wird gegen
die Kosten seines eigenen ungünstigsten Falls begründet, nicht gegen ein
Vielfaches der Korpusgröße.

**Warum Bytes die Arbeit nicht begrenzen.** Jeder Selektor läuft über jede
Control-ID des importierten Katalogs, jeder Import indiziert den Katalog
erneut; die Arbeit ist das **Produkt** aus beiden Zahlen, während die
Bytegrenze nur ihre Summe deckelt. Gemessen: Ein Profil von **1,7 KB** über
einem Katalog von 78 KB verbraucht bereits über eine Million
Arbeitseinheiten. Genau diese Lücke schließt die Arbeitsgrenze; die
Ausgabegrenzen können sie nicht schließen, weil die Ausgabe in diesen Fällen
**leer oder winzig** ist.

**Eine Reihe je Kategorie, nicht eine Reihe für alle.** Alle sechs
Work-Unit-Kategorien verbrauchen denselben Zähler, aber eine Arbeitseinheit
kostet je nach Kategorie unterschiedlich viel Zeit (`merge-step` braucht für
dieselbe Einheitenzahl rund das Achtfache der Selektorkategorie). Jede
Kategorie hat deshalb ein eigenes, ausgabekleines Worst-Case-Profil in
[`profileResolutionWorstCaseFixtures.mjs`](../scripts/profileResolutionWorstCaseFixtures.mjs),
und der Grenzwert ist das **Minimum** über alle Reihen.

**Messprotokoll.**

```bash
node scripts/measure-class2-budget.mjs --calibrate          # Raten der Fixtures erheben
# Herleitung: WORK_UNIT_LIMIT vorher auf einen Kandidaten ÜBER dem erwarteten
# Wert setzen (hier 134 213 078), danach auf das Ergebnis des Laufs.
node scripts/measure-class2-budget.mjs --throttle 1,4 --repeat 3 --skip-fixtures \
  --search-work-limit --json docs/measurements/gspp345-work-budget.json
node scripts/measure-class2-budget.mjs --print-source-fingerprint   # gehört das Artefakt zu diesem Stand?
```

Der Lauf fährt je Kategorie eine Leiter von Stützpunkten und misst je
Stützpunkt die Wartezeit eines vollständigen `resolveProfile`-Laufs
einschließlich der abschließenden Objekt- und Schemakette — also das, was ein
Anwender tatsächlich wartet. Beurteilt wird das **Maximum** aller
Wiederholungen, nicht der Median: Eine Reihe, die im Mittel hält und in einem
Lauf reißt, hält das Budget nicht. Das Messartefakt liegt unter
[`docs/measurements/gspp345-work-budget.json`](./measurements/gspp345-work-budget.json);
es weist je Stützpunkt zusätzlich den Anteil der benannten Kategorie an der
Gesamtarbeit aus, damit jede Reihe belegt, dass sie die Kategorie wirklich
treibt, die sie behauptet.

Der Anteil unten ist am größten gehaltenen Stützpunkt gemessen.

| Kategorie | Anteil der Kategorie | größter gehaltener Stützpunkt (4×) | Wartezeit | erster gerissener Stützpunkt | Wartezeit |
| --- | --- | --- | --- | --- | --- |
| `import-edge` | 66,65 % | 16 774 778 | 3,26 s | 33 549 536 | 6,53 s |
| `selector-compare` | 99,99 % | 33 553 207 | 3,20 s | 67 104 387 | 6,40 s |
| `glob-state` | 99,95 % | 66 672 025 | 3,34 s | 133 776 025 | 6,51 s |
| **`merge-step`** | **70,00 %** | **16 763 456** | **2,63 s** | **33 546 920** | **5,26 s** |
| `alter-target-lookup` | 7,67 % | 4 194 153 | 1,00 s | nicht erreichbar | — |
| `alter-candidate` | 99,69 % | 16 774 687 | 3,70 s | 33 551 443 | 7,39 s |

Maßgeblich ist der Lauf bei vierfacher CPU-Drosselung als Näherung an
Bürohardware; ungedrosselt hält dieselbe langsamste Reihe bis 67 093 820
Einheiten (2,55 s) und reißt erst bei 134 207 648 (5,10 s). Der Grenzwert nimmt
den größten Stützpunkt, den die LANGSAMSTE Reihe bei 4× noch hält, und schöpft
den Budgetposten „Sichtbare Wartezeit bis zum Ergebnis" damit zu 53 % aus.
Keine Interpolation zwischen Stützpunkten: Der Wert steht auf einer Zahl, die
wirklich gemessen wurde.

**Zwei Kategorien treiben ihren Zähler nicht allein.** Bei `import-edge` und
`merge-step` entfällt der Rest auf die Selektion, die je Import unvermeidlich
mitläuft. Die Reihen messen die Kosten eines Laufs, den ihre Kategorie
dominiert — nicht die Kosten einer isolierten Arbeitseinheit.

**`alter-target-lookup` ist durch die Dokumentgrenzen gedeckelt.** Die
Zielsuche fällt je betrachteter Control einmal an und je auf sie zeigender
Alteration ein weiteres Mal. Beide Zahlen sind nach oben gedeckelt — die
Controls durch die Knotengrenze, die Alterationen durch die Byte- und
Knotengrenze des Steuerdokuments. Ein Steuerdokument, das beide Grenzen
ausschöpft, erreicht **6 232 007** Arbeitseinheiten; die Kategorie kann die
Arbeitsgrenze also nie treiben und geht deshalb nicht in das Minimum ein. Der
Messapparat meldet diese Stützpunkte als `NICHT ERREICHBAR (Dokumentgrenze)`
statt sie stillschweigend kleiner zu bauen — ein Stützpunkt, den das Dokument
nicht trägt, ist kein gehaltener Stützpunkt. Die Deckelrechnung prüft
[`profileResolutionWorstCaseFixtures.test.ts`](../scripts/profileResolutionWorstCaseFixtures.test.ts),
indem sie das Dokument an der maximalen Wiederholungszahl wirklich baut und
gegen Byte- und Knotengrenze misst.

**Eine Deckelung nimmt eine Kategorie nur dann aus der Herleitung, wenn sie
wirklich deckelt.** Drei Bedingungen, alle drei notwendig: Die Deckelzeile ist
**terminal** (kein gemessener Stützpunkt liegt dahinter), sie trägt eine
**endliche Erreichbarkeitszahl**, und diese Zahl liegt **unter** dem
schließlich gewählten Grenzwert. Die Reihe wird von unten nach oben gelesen:
Reißt ein Stützpunkt **vor** dem Deckel die sichtbare Wartezeit, endet die
Aussage dort. Liegt der Deckel **über** dem Grenzwert, geht die Reihe mit ihrem
gemessenen Wert in das Minimum ein wie jede andere — ungemessene Strecke trägt
keinen Grenzwert.

**Herleitung und Bestätigung sind zwei verschiedene Läufe.** Ein Lauf misst
nur bis zu seinem **eigenen** Kandidaten — jenseits davon bricht der Resolver
ab, und ein Abbruch liefert keine Wartezeit. Daraus folgt beides:

- **Herleitung** (`--search-work-limit`): Der einkompilierte Wert ist bewusst
  über den erwarteten Grenzwert gesetzt, damit die Reihen bis zu ihrem Riss
  gemessen werden können. Nur dieser Lauf **findet** einen Wert. Ein Riss ist
  hier das gesuchte Ergebnis, kein Fehler.
- **Bestätigung** (Vorgabe): Der einkompilierte Wert ist der gelieferte.
  Gefragt wird nicht, ob die Reihen den Kandidaten exakt treffen — das können
  sie nicht, weil eine Fixture nur in ganzen Wiederholungen wächst und ihren
  Stützpunkt von unten annähert. Gefragt wird, ob unterhalb des gelieferten
  Werts irgendetwas **reißt**. Reißt eine Reihe, bricht der Lauf ab, statt
  einen erfolgreichen Bericht mit zwei widersprüchlichen Zahlen auszugeben.

Der einkompilierte Wert ist an das committete Artefakt **gebunden**:
[`measureClass2BudgetReport.test.ts`](../scripts/measureClass2BudgetReport.test.ts)
leitet ihn bei jedem Testlauf aus dem Artefakt neu her und verlangt Gleichheit,
verlangt die sechs Kategoriereihen und verlangt, dass der Kandidat des
Artefakts **echt über** dem gelieferten Wert liegt — sonst wäre der Beleg
zirkulär. Eine **Anhebung** der Grenze setzt weiterhin voraus, dass ein Mensch
den Kandidaten erhöht und neu misst.

**Zwei Fingerprints, zwei Aufgaben.** Eine Messung gilt nur für den Code, an
dem sie erhoben wurde.

- Der **breite** Quellfingerprint (`sourceBefore.sha256`) deckt `src`,
  `scripts` und die Build-Konfiguration ab und belegt „dieser Baum wurde
  gemessen". Er bleibt **Protokoll**: Als Gate erzwänge jede Änderung an einer
  beliebigen UI-Komponente einen Browsermesslauf.
- Die **Messwegprovenienz** (`sourceBefore.workLimitProvenance`) deckt genau
  den Code ab, dessen Kosten mit den Arbeitseinheiten wachsen, und die
  Eingaben, an denen er gemessen wurde. Sie ist die **Testbedingung**
  ([`measureWorkLimitProvenance.mjs`](../scripts/measureWorkLimitProvenance.mjs)).

**Die Hülle kommt aus einer Ausführungszählung** (Verfahren
`skalierende-bereiche`). `WORK_UNIT_LIMIT` ist eine Aussage über die Zeit pro
Arbeitseinheit; maßgeblich ist deshalb nicht, was vom Auflösungspfad aus
importierbar ist, sondern was mit den Arbeitseinheiten skaliert.
[`measureWorkLimitCallCounts.mjs`](../scripts/measureWorkLimitCallCounts.mjs)
lässt für jede der sechs Kategorien den produktiven `resolveProfile` über die
Kalibrierfixture mit N = 4 und 2N = 8 Wiederholungen laufen und zählt mit
V8-Precise-Coverage auf Blockebene, wie oft jede Funktion und jeder Block darin
ausgeführt wird. Gezählt wird genau der Abschnitt, den der Harnisch zwischen
seinen beiden `nowMs()` misst; Plan und `parseProfileDocument` laufen vorher
und fallen heraus. Ein Test hält beide Abschnitte aneinander fest.

- **Skalierend** ist ein Bereich — eine Funktion oder ein Block darin, etwa ein
  Schleifenrumpf —, dessen Ausführungszahl bei 2N in mindestens einer
  Kategorie größer ist als bei N. Die Blockebene erfasst auch eine Funktion,
  die je Lauf einmal aufgerufen wird, deren Schleife aber je Arbeitseinheit
  läuft. Die Hülle besteht aus den Dateien mit mindestens einem skalierenden
  Bereich und steht unter `paths` im Artefakt. Liegt ein skalierender Bereich
  in einem externen Paket, geht dessen aufgelöste Version transitiv aus dem
  Lockfile ein (`runtime`). Nodes eigene Laufzeit geht nicht ein.
- **Selbstnachweis, fail-closed.** Vor jeder Verwendung muss jede Kategorie
  bei 2N mehr Arbeitseinheiten verbrauchen als bei N, und `spendWork` aus
  `profileResolutionBudget.ts` muss als skalierend erkannt sein. Sonst bricht
  die Berechnung mit einer benannten Meldung ab, statt eine leere oder zu
  kleine Hülle zu hashen. Vor jedem Lauf muss die Wiederholungszahl innerhalb
  von `maxRepetitions` der Kategorie liegen, also in einem Steuerdokument,
  das die Dokumentgrenzen zulassen; `buildWorkUnitCalibration` selbst prüft
  das nicht. Dieselbe Prüfung gilt für die Kalibrierfälle von `--calibrate`.
- **Normalisierter Inhalt.** Gehasht werden Pfad und Quelltext jeder
  Hüllendatei nach `ts.transpileModule` mit `removeComments`. Die Ausgabe wird
  aus dem Syntaxbaum neu gedruckt: Kommentare, Formatierung und Typannotationen
  verschieben den Hash nicht, jede Änderung am ausgeführten Code schon. Die
  Pfade sind wie beim breiten Fingerprint mit `byCodeUnit` sortiert.
- **Die Worst-Case-Fixture ist mitgebunden.** Die Zählung sieht nur, was
  während `resolveProfile` läuft; die Eingaben baut
  [`profileResolutionWorstCaseFixtures.mjs`](../scripts/profileResolutionWorstCaseFixtures.mjs)
  davor. Ohne eigene Bindung belegten die alten Zeitreihen den Grenzwert auch
  nach einer Änderung der Fixture, etwa mehr Controls im Quellkatalog. Ein
  eigener Fingerprint (`fixture.sha256`) umfasst deshalb ihren wie oben
  normalisierten Quelltext und ihre beobachteten Eingaben aus den importierten
  Modulen: je Kategorie den Wiederholungsdeckel, den die Dokumentgrenzen aus
  `class2ImportLimits.mjs` setzen, und die Dokumente eines Kalibrierfalls mit
  der OSCAL-Version aus `sourceRegistry.mjs`. Die beiden Module gehen nicht als
  Dateien ein: Die Registry ändert sich mit jedem neuen BSI-Artefakt, ohne die
  gemessenen Eingaben zu berühren. Die Beobachtung ist nur für diese beiden
  Importe begründet; bekommt die Fixture einen weiteren, bricht die Berechnung
  ab. Im Artefakt stehen `hullSha256` und `fixture.sha256` einzeln, geprüft
  wird der daraus kombinierte `sha256`.
- **Eigener Node-Prozess.** Precise-Coverage ist ein Zustand des ganzen
  Isolates, und jede Abfrage setzt die Zähler zurück. Unter
  `npm run test:coverage` misst Vitest seine Abdeckung über denselben
  Mechanismus; die Zählung läuft deshalb in einem Kindprozess, der
  `src/domain` über Nodes Typ-Stripping und den Aliashook aus
  [`oscal-domain-bridge.mjs`](../scripts/oscal-domain-bridge.mjs) lädt. Die
  Berechnung braucht keinen Browser, dauert rund eine Sekunde und läuft in
  `npm run test` mit.

**Bekannte Grenzen.**

- Code, dessen Bereiche bei N und 2N gleich oft laufen, kann trotzdem langsamer
  werden — etwa die Ajv-Schemastufe der Abschlusskette, die je Profil einmal
  läuft. Eine solche Änderung löst keine Neumessung der Arbeitsgrenze aus. Ihre
  Kosten hängen an der Ausgabegröße, die die Ausgabegrenzen begrenzen; deren
  Messreihen aus GSPP-382 haben keinen Provenienz-Gate.
- `processClass2OscalValue` läuft einmal je Profil in `plan.order`. Jede
  Worst-Case-Fixture besteht aus genau einem Katalog und einem Profil; weder
  die Messung noch die Hülle decken deshalb Kosten ab, die mit der Länge einer
  Profilkette wachsen. Das ist eine Frage der Messabdeckung, nicht des
  Fingerprints.

**Übertragene Bindung.** Das Artefakt führt unter
`workLimitProvenanceRestamps` die Nachweisschritte, mit denen sein Fingerprint
ohne Browserlauf an das geltende Verfahren gebunden ist; jeder Eintrag nennt
Basiscommit, Verfahren und Hash vorher und nachher sowie seine Nachweise. Die
Einträge sind keine Messergebnisse und belegen nichts über die Kosten.
`renderReport` verweigert einen Bericht, dessen Provenienz vor und nach der
Messung kein oder ein unterschiedliches Verfahren nennt, und der Bindungstest
verlangt Verfahren und Hash des aktuellen Stands.

Die **Auswertung** (`measureClass2BudgetReport.mjs`) steht nicht in der Hülle
der Messwegprovenienz: Sie läuft im Browser nie mit und erzeugt keine
Rohdaten. Der Bindungstest leitet den Grenzwert bei jedem Testlauf mit der
aktuellen Auswertung aus dem Artefakt neu her — eine Änderung an ihr wird
sofort geprüft, ohne einen Browsermesslauf zu erzwingen.

Beide lassen `profileResolutionBudgetLimits.mjs` aus — genau diese Datei muss
sich zwischen Mess- und Lieferstand unterscheiden, sonst wäre die Frage „gehört
dieses Artefakt zu diesem Head?" gar nicht erst stellbar. Das Artefakt weist
die Ausnahme unter `excludes` aus, und der Kandidat jedes Laufs steht als
`workUnitLimit` daneben. `--print-source-fingerprint` druckt beide Fingerprints
des aktuellen Baums ohne Messlauf.

**Kopfraum über der legitimen Nutzung.** Der Korpuslauf
[`profileResolutionCorpus.test.ts`](../scripts/profileResolutionCorpus.test.ts)
löst die drei registrierten BSI-Profile auf und protokolliert die vier
laufenden Zähler. Er ist **Nachweis, nicht Begründung** — die Reihenfolge ist
wichtig, weil eine Grenze, die nur den Kopfraum über der legitimen Nutzung
belegt, über den Angriffsfall nichts sagt.

| Profil | Arbeitseinheiten | erzeugte Knoten | maximale Tiefe | dekodierte base64-Bytes |
| --- | --- | --- | --- | --- |
| `profile-gspp` | 207 595 | 76 842 | 19 | 0 |
| `profile-lieferkette` | 31 092 | 8 884 | 17 | 0 |
| `profile-wlan` | 33 842 | 6 812 | 13 | 0 |

Das teuerste Profil liegt bei rund einem Achtzigstel der Arbeitsgrenze.

#### Laufendes Budget und abschließende Postcondition

Beide bestehen nebeneinander und prüfen dasselbe mit verschiedener Reichweite.

| | laufendes Budget | Postcondition |
| --- | --- | --- |
| Ort | [`profileResolutionBudget.ts`](../src/domain/profileResolutionBudget.ts) | [`oscalObjectGraph.ts`](../src/domain/oscalObjectGraph.ts) |
| Zeitpunkt | **vor** jeder Operation und Allokation | nach dem fertigen Ergebnis |
| Umfang | kumulativ über den **ganzen** Auflösungslauf | ein Zwischen- oder Endergebnis |
| Arbeitsachse | ja (`WORK_UNIT_LIMIT`) | nein |
| Ausgabeachse | Knoten, Tiefe, base64 aus `CLASS_2_IMPORT_LIMITS` | dieselben Werte |

Die Ausgabegrenzen sind **dieselben Konstanten**, nicht zwei Zahlen für
dieselbe Grenze: Das Budget importiert `CLASS_2_IMPORT_LIMITS` und die
`base64`-Arithmetik (`decodedBase64ByteLength`) aus der Postcondition-Seite.
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

Für Klasse 2 entfernt die Matrix vor der Formprüfung genau ein führendes
kleines `v`: `v1.2.2` bindet die Zelle `1.2.2`, `V1.2.2`, `vv1.2.2` und `v1.2` bleiben
`OSCAL_VERSION_MALFORMED`, `v1.2.3` bleibt `OSCAL_ROOT_VERSION_UNSUPPORTED`.
Das Dokument selbst wird dabei nicht verändert; Stufe 3 validiert den
unveränderten Wert gegen das Schema der gewählten Zelle. `artifact.oscalVersion`
trägt die gebundene Version, bei einer Ablehnung nur ein Mitglied der gepinnten
Menge oder `null`. Klasse 1 bindet in Fetch und Browser weiterhin exakt,
dort bleibt `v1.2.2` `OSCAL_VERSION_MALFORMED`. Herleitung und Belege:
[OSCAL_VERSION_MATRIX.md](OSCAL_VERSION_MATRIX.md#führendes-v-in-metadataoscal-version).

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

Ajv 8.20.0 ist exakte
direkte Abhängigkeit der App, mit `package-lock.json`-Eintrag samt
SRI-Integrität. Lizenz MIT; Transitivabhängigkeiten sind `fast-deep-equal`,
`fast-uri`, `json-schema-traverse` und `require-from-string`. Das ebenfalls
vorhandene transitive `ajv` 6.15.0 stammt ausschließlich aus dem
ESLint-Werkzeugpfad und ist ausdrücklich nicht der OSCAL-Validator dieses
Vertrags. Validator, Paket-Lock, Schemabytes, Hashprüfung und Implementierung
samt Tests sind atomar eingeführt.

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
Mapping-Modell und das Catalog-Modell; die übrigen sechs Root-Modelle folgen
mit ihrer jeweiligen Erschließung.

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
für jedes gesperrte Artefakt `schema=failed`. Ein neuer Fehler eines nicht
gesperrten Artefakts oder ein bestandenes gesperrtes Artefakt lässt den Lauf
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
3. **Modify:** `set-parameter` (Skalarfelder ersetzen, `props`/`links`
   anreichern) und `alters` (`adds`/`removes` mit `by-id`/`by-name`/…),
   danach kanonische Schlüsselordnung.

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
