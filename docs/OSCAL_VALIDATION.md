# OSCAL-Validierungsvertrag

Dieser Vertrag gilt für OSCAL-JSON-Artefakte, die der Navigator künftig
importiert, exportiert oder in der Build-Pipeline prüft. Er definiert die
Prüfkette und ihre Lieferkette; er aktiviert noch keinen produktiven Import.
YAML und XML sind nicht unterstützt.

## Status: Stufe 1 für Klasse 2, Stufe 2 und unabhängiger CI-Schema-Korpuslauf umgesetzt

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
JSON-Member nach Escape-Auflösung, parst erst danach JSON und prüft iterative
Grenzen für Tiefe (64), Knotenzahl (1 000 000) und die arithmetische Summe
eingebetteter Base64-Größen (10 MiB). Danach übergibt sie ausschließlich an
`dispatchOscalDocument()`. Es gibt noch keine Import-UI, Persistenz oder
Klasse-2-Anzeige.

**Stufe 2 ist seit
[GSPP-285](https://linear.app/grundschutz-plus-plus/issue/GSPP-285) umgesetzt
und im Katalogpfad aktiv.** `dispatchOscalDocument()` in
[`oscalRootDispatch.ts`](../src/adapters/oscalRootDispatch.ts) ist der exakte
Root-Dispatcher dieses Vertrags; `parseCatalogDocument()` läuft über ihn, und
die Katalog-Interpretation als Fallback existiert nicht mehr. Der Dispatcher
wählt zugleich den Schema-Pin aus, **wendet** ihn aber nicht an — das bleibt
Stufe 3.

**GSPP-336 führt zusätzlich die unabhängige CI-Schema-Stufe ein.**
[`npm run verify-upstream-oscal`](../package.json) lädt ausschließlich
`go-oscal` 0.7.1 aus der statisch gepinnten Release-Tabelle,
verifiziert Release-Metadaten, API-Digest, `checksums.txt` und berechnete
SHA-256-Werte und prüft den vollständigen im gepinnten
`upstream-manifest.json` registrierten OSCAL-Korpus. Der Lauf verarbeitet die
16 OSCAL-Artefakte über alle vier belegten Versionen und überspringt die 13
`vocabulary`-Dateien, weil sie kein OSCAL-Root-Modell tragen. Sein Ergebnis ist
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

| Stufe | Vorgeschriebener Zielzustand | Pinning und Fehlersemantik |
| --- | --- | --- |
| 1. Größenlimit und JSON-Syntax | **Für Klasse 2 umgesetzt:** Plattformfunktionen (`Uint8Array`, fataler UTF-8-Decoder), projekteigener Token-Scanner und danach `JSON.parse` im isolierten Modul-Worker | Das Bytelimit von 10 MiB greift vor Worker-Erzeugung, Kopie, Decoder, Scanner und Parser. Nach erfolgreicher fataler Dekodierung lehnt der Scanner doppelte Member auf jeder erlaubten Objekttiefe ab und begrenzt seinen eigenen Abstieg auf Tiefe 64; nur dann wird `JSON.parse` aufgerufen. Ein vom Scanner als ungültig bewerteter Text endet ebenfalls vor `JSON.parse` fail-closed. Die nachfolgende, iterative Prüfung prüft die Tiefe erneut und begrenzt Knotenzahl auf 1 000 000 sowie die arithmetische Summe dekodierter Base64-Größen auf 10 MiB, ohne Base64 zu dekodieren. Der Adapter beendet einen antwortlosen Worker nach 30 Sekunden mit einer redigierten Fehlerdiagnose. Node-Tests verwenden dieselbe Worker-Logik; der Browsernachweis läuft in Chromium. |
| 2. Root-Erkennung | **Umgesetzt:** `dispatchOscalDocument()` in [`oscalRootDispatch.ts`](../src/adapters/oscalRootDispatch.ts), projekteigen und ohne externes Werkzeug | Das Top-Level-Objekt muss genau einen der acht bekannten Root-Keys besitzen. Null, Arrays, mehrere Root-Keys und unbekannte Keys werden abgelehnt. Die optionale Schema-Direktive `$schema` ist die einzige zusätzlich zulässige Top-Level-Property; sie ist kein zweiter Root und **niemals** Versionsautorität. Eine Katalog-Interpretation als Fallback ist verboten. |
| 3. JSON-Schema | Browser nach Aktivierung: `ajv` 8.20.0 im Modul-Worker. **CI umgesetzt:** [`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs) nutzt `go-oscal` 0.7.1 als unabhängiges Schema- und Upgrade-Orakel | Auswahl ausschließlich über den exakten Root×`oscal-version`-Schlüssel. Der Korpuslauf bezieht Dokumente nur aus dem gepinnten BSI-Snapshot und führt weder Schema- noch Dokumentreferenz-Anfragen aus. Jedes nicht gesperrte Artefakt muss bestehen; ein gesperrtes Artefakt muss fehlschlagen. Fehlende oder nicht auswertbare Werkzeugergebnisse bleiben ein eigener fail-closed Werkzeugfehler. Ajv wird erst nach der OSS-Zulassung aus [ADR-5](https://linear.app/grundschutz-plus-plus/issue/ADR-5) produktiv aufgenommen. Bis direkte Abhängigkeit, Paket-Lock, Schema-Manifest und Hashprüfung vorhanden sind, bleibt der betreffende Importpfad deaktiviert. |
| 4. zusätzliche OSCAL-Constraints | Derzeit **kein zugelassener Validator** für OSCAL 1.2.2; im Browser und in CI als `not-checked` ausgewiesen | Diese Stufe darf weder übersprungen noch als bestanden dargestellt werden. Die zulässige Konformitätsaussage wird deshalb begrenzt. Das konkrete Mapping-Orakel ist als bekannte Lücke registriert. |
| 5. Referenzen und Projektregeln | [`referenceResolution.ts`](../src/domain/referenceResolution.ts) ist der gemeinsame, fail-closed Klassifikator; der vollständige Referenzgraph bleibt Vertrag von [GSPP-251](https://linear.app/grundschutz-plus-plus/issue/GSPP-251) | Prüft UUID-/ID-Eindeutigkeit, interne und dokumentübergreifende Referenzen, URI- und Medientypregeln sowie ausdrücklich benannte GRC-Regeln. Die Schicht klassifiziert externe `https:`-Ziele, relative Ziele und abgelehnte Protokolle ohne sie abzurufen; Stufe 5 konsumiert sie statt eine zweite Klassifikation einzuführen. Unbekannte Regeln gelten nicht als bestanden. |

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

Ajv wurde als künftiger Validator gegenüber `@hyperjump/json-schema` 1.17.7
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

Für die aktivierte Zielkette ist kein Laufzeit-Netzbezug für Schema, Validator,
Constraint-Datei oder Dokumentreferenz zulässig.

Ajv 8.20.0 ist aktuell keine direkte Abhängigkeit der App. Das vorhandene
transitive `ajv` 6.15.0 stammt ausschließlich aus dem ESLint-Werkzeugpfad und
ist ausdrücklich nicht der OSCAL-Validator dieses Vertrags. Die spätere
Aktivierung muss Ajv als exakte direkte Abhängigkeit, den zugehörigen
`package-lock.json`-Eintrag mit SRI, das Schema-Manifest, die Hashprüfung und die
Implementierung samt Tests atomar einführen. Vorher existiert kein produktiver
Ajv-8.20.0-Pin.

| Artefakt | Verbindliche Herkunft und Pinning | Verifikation |
| --- | --- | --- |
| NIST-JSON-Schemas | Offizielle Releases `v1.1.2`, `v1.1.3`, `v1.2.1` und `v1.2.2`; root-spezifische JSON-Schemadatei | Eine maschinenlesbare Allowlist bindet Release, Root, Version, Dateiname und SHA-256. Download ist nur in einem expliziten Wartungslauf erlaubt. Fehlender oder abweichender Hash blockiert Build und Import. |
| Ajv, nach Aktivierung | npm-Paket `ajv` exakt 8.20.0, MIT | Der dann atomar aktualisierte `package-lock.json` bindet Tarball und SRI-Integrität. Die OSS-Zulassung prüft Lizenz, Herkunft, Wartung, Transitivabhängigkeiten, Sicherheitslage, Bundle-/Worker-Eignung und Updateweg, bevor das Paket produktiv wird. |
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
  "path": "/mapping-collection/provenance/qa-reviewed",
  "validator": {
    "name": "go-oscal",
    "version": "0.7.1"
  },
  "signature": "go-oscal@0.7.1|additionalProperties|/mapping-collection/provenance|qa-reviewed",
  "messageKey": "oscal.schema.additionalProperty",
  "params": {
    "keyword": "additionalProperties",
    "propertyName": "qa-reviewed"
  }
}
```

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
| Klasse-2-Validierung im Browser-Worker | Keine Schema-, Dokument- oder Referenzanfrage wird ausgelöst. |

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
