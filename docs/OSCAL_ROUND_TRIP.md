# OSCAL-Round-trip-Harnisch

Der modellübergreifende Round-trip-Harnisch kennt zwei Laufarten. Der
No-op-Lauf beweist je OSCAL-Dokument, dass ein Round-trip **ohne fachlichen
Schreibvorgang nichts verändert** — weder auf der Serialisierung noch auf dem
geparsten Graphen. Der Edit-Lauf beweist, dass ein Schreibvorgang **genau**
die Edit-Operation, `metadata.last-modified` und — je nach Root — die
Dokument-`uuid` ändert. Der Harnisch ist das Freigabegate für jeden Import-,
Authoring- und Export-Slice.

* Implementierung: [`src/test/oscalRoundTrip.ts`](../src/test/oscalRoundTrip.ts)
* Graphvergleich: [`src/test/oscalGraphCompare.ts`](../src/test/oscalGraphCompare.ts)
* Korpus: [`src/test/fixtures/oscalRoundTripCorpus.ts`](../src/test/fixtures/oscalRoundTripCorpus.ts)
* Edit-Lauf-Tests: [`src/test/oscalRoundTripEdit.test.ts`](../src/test/oscalRoundTripEdit.test.ts)
* Stufenbegriffe und Vertragskette: [OSCAL_VALIDATION.md](OSCAL_VALIDATION.md)

## Die No-op-Laufart

`runNoOpRoundTrip()` nimmt den Fixture als JSON-Quelltext und optional einen
eingespeisten Export, einen Registry-Pfad (`upstreamPath`) sowie eine
Katalogidentität entgegen und liefert ein eingefrorenes, deterministisches
Ergebnis:

1. **Stufe 1** — Byte-Eingangsgrenze vor dem Parsen; Strukturinvariante samt
   struktureller Limits (Tiefe, Knoten, Base64-Summe) nach dem Parsen aus der
   gemeinsamen objektorientierten Einheit
   [`oscalObjectPipeline.ts`](../src/domain/oscalObjectPipeline.ts).
2. **Stufe 2** — Root-Erkennung und Versionsbindung über
   `dispatchOscalDocument()`. Der Harnisch führt **keine eigene Versionsliste**;
   ein statischer Test im Guard-File belegt die Delegation. Es gibt keine
   `rootType`-Eingabe: Der gemeldete Root-Typ ist ausschließlich der
   **abgeleitete** aus dem Dokument. Ein optionaler `upstreamPath` erzwingt
   die artefaktscharfe Registry-Erwartung (`OSCAL_ROOT_TYPE_MISMATCH`) und
   ordnet Diagnosen dem Artefaktschlüssel zu.
3. **Export und Reimport** — Ohne `exportDocument` ist der Export die
   Identität. Ein Serializer wird als `exportDocument` eingereicht, der
   No-op-Pfad bleibt dabei unverändert; `src/domain/profileExport.test.ts`
   reicht so den Profil-Export (`toDerivedProfileTree()` aus
   `src/domain/profileExport.ts`) ein.
   Geprüft wird das **reimportierte Exportartefakt**.
   Ein Exportergebnis ohne JSON-Darstellung — `JSON.stringify` liefert kein
   Textergebnis (`undefined`, Funktion, Symbol), wirft (BigInt, zirkuläre
   Struktur) oder der Callback fällt mit einer Ausnahme aus — wird als
   `serialization: failed` mit Diagnose (`OSCAL_EXPORT_NOT_SERIALIZABLE`,
   Bindungsgrund `export-not-serializable`) berichtet, nicht als Ausnahme
   geworfen; entlang der Kettenregel bleiben Vergleich und Stufen aus. Der Callback erhält eine private Kopie des
   geparsten Originals; eine In-place-Mutation kann die Vergleichsbasen
   nicht verschieben.
4. **Vergleichsebenen** (siehe unten) und **Identitätsprüfung** zwischen
   Original und reimportiertem Export.
5. **Validierungsstufen 3–5** mit terminalem Status je Stufe — geprüft wird
   das **reimportierte Exportartefakt**, nie die Eingabe: Nur so gelten die
   Status für das Dokument, das den Prozess tatsächlich verlässt.

## Die Edit-Laufart

`runEditRoundTrip()` nimmt den Fixture als JSON-Quelltext, eine Edit-Operation,
einen injizierten Stempel und den Schreibpfad unter Test entgegen und liefert
ein eingefrorenes, deterministisches Ergebnis mit `mode: 'edit'` und einem
Gesamtstatus `passed` oder `failed`.

* **Edit-Operation** (`OscalEditOperation`): Pfad als Segmentliste ab dem
  Root-Schlüssel, `replace` eines vorhandenen Blattwerts oder `add` eines
  Elements am Ende eines vorhandenen Arrays, dazu der Wert. Der Harnisch wendet
  die Operation nicht selbst an; sie beschreibt, was der Schreibpfad ändern
  muss. Eine Operation, die nicht zum Fixture passt, wirft einen `TypeError`.
* **Injizierter Stempel** `{ uuid, lastModified }` im Format von
  `ExplicitSaveStamp` aus [`src/domain/profileSave.ts`](../src/domain/profileSave.ts).
  Der Harnisch hat keine eigene Zeit- oder UUID-Quelle; ein statischer Test im
  Guard-File belegt das.
* **Schreibpfad** `exportDocument(parsed, stamp)`: erhält private Kopien des
  geparsten Originals und des Stempels; Stempel und Edit-Operation (Pfad und
  Wert) für den Vergleich sichert der Harnisch vor dem Aufruf. Ein Ergebnis ohne JSON-Darstellung oder eine
  Ausnahme im Callback ergibt den Bindungsgrund `export-not-serializable`.
* **Stufen 1–2** laufen wie im No-op-Lauf, **Stufen 3–5** gegen das
  reimportierte Exportartefakt über dieselbe `evaluateStages()`.
* **Versionsgrenze**: Das reimportierte Exportartefakt muss an dieselbe
  OSCAL-Version gebunden werden wie die Eingabe. Eine abweichende Version
  ergibt den Bindungsgrund `export-rebinding-failed` mit
  `OSCAL_EXPORT_VERSION_CHANGED`, auch wenn die Edit-Operation den Wechsel
  beschreibt.
* **Exportgrenzen**: Exportbytes und reimportierter Graph durchlaufen dieselbe
  Byte-Grenze und dieselben Objektgraphgrenzen wie die Eingabe. Ein Verstoß
  ergibt `exportLimit: failed`; Vergleich und Stufen laufen dann nicht.
* **Gesamtstatus** `passed` verlangt bestandene Exportgrenzen, Graph,
  Identitäten und Stufe 3; Stufe 5 darf nicht `failed` sein.

**Erwartete Differenzmenge.** `compareJsonGraphs()` zwischen Original und
reimportiertem Export muss genau diese Einträge liefern:

* den Eintrag der Edit-Operation (`value-changed` bei `replace`, `item-added`
  bei `add`), wobei der Export am Zielpfad den Edit-Wert tragen muss,
* `value-changed` an `metadata.last-modified`,
* `value-changed` an der Dokument-`uuid` bei den `reassign`-Roots.

Differenzen außerhalb dieser Menge meldet `graph.unexpected`, fehlende
erwartete Einträge `graph.missing`. Umsortierte, entfernte oder zusätzliche
Array-Elemente erscheinen über die Indexpfade außerhalb der erwarteten Menge.
Die byte-identische Serialisierungsgleichheit gilt im Edit-Lauf nicht.

**Root-UUID-Politik.** `OSCAL_ROOT_UUID_POLICY` in `src/test/oscalRoundTrip.ts`
bildet die [Root-UUID-Politik in PERSISTENCE.md §5](PERSISTENCE.md#root-uuid-politik-je-root-modell) ab; sie ist die einzige Stelle, an
der der Harnisch Wissen über Roots führt.

| Lauf | Dokument-`uuid` | `metadata.last-modified` |
| --- | --- | --- |
| No-op | unverändert | unverändert |
| Edit, `reassign`: `catalog`, `profile`, `component-definition`, `mapping-collection` | gleich Stempel-`uuid`, verschieden vom Original | gleich Stempel, verschieden vom Original |
| Edit, `keep`: `system-security-plan`, `assessment-plan`, `assessment-results`, `plan-of-action-and-milestones` | unverändert | gleich Stempel, verschieden vom Original |

**Schreibpfade im Test.** Der `profile`-Lauf bindet `commitExplicitSave()` aus
`src/domain/profileSave.ts` als echten Schreibpfad ein. Für alle Roots prüft
ein testeigener Referenz-Editor in `src/test/oscalRoundTripEdit.test.ts` den
Harnisch am Maximaldokument @ 1.2.2; er belegt den Harnisch, nicht den Export
eines Adapters.

## Zwei Vergleichsebenen

Beide Ebenen sind verbindlich; sie beantworten unterschiedliche Fragen.

| Ebene | Kriterium | Was sie beweist |
| --- | --- | --- |
| Serialisierung | `JSON.stringify(export) === JSON.stringify(original)` — byte-identisch einschließlich Schlüsselreihenfolge, Array-Reihenfolge, unbekannter Felder, leerer Objekte/Arrays | Das Ausgabeartefakt ist bytegleich zur Eingabe. |
| Geparster Graph | `compareJsonGraphs()` mit `Object.is`-Blattsemantik | Der Wert im Artefakt ist derselbe Wert. |

Die zweite Ebene fängt Werte ab, die `JSON.parse` erzeugen, aber
`JSON.stringify` nicht darstellen kann — `Infinity`/`-Infinity` (aus
Quelltexten wie `1e400`) und `-0`. Die Serialisierung schreibt daraus `null`
beziehungsweise `0`; **beide Vergleichsseiten erleiden denselben Verlust**,
der Serialisierungsvergleich bleibt grün, und wer exportiert und wieder
importiert, erhält ein anderes Dokument. Nur der Graphvergleich unterscheidet
diese Fälle. Negativtests im Guard-File belegen die Erkennung.

**Kein** Verlust sind Textabweichungen ohne Wertänderung
(`1E2 → 100`, `1.0 → 1`, `"\/" → "/"`, Exponentenschreibweise): Bewahrt wird
das Ergebnis von `JSON.parse`, nicht die Quellbytes. Dasselbe gilt für die
Umsortierung numerischer Objektschlüssel — sie geschieht in `JSON.parse`
selbst; der Graphvergleich ordnet Integer-artige Schlüssel deshalb kanonisch.

## Identitätsregeln

Getrennt vom Inhaltsvergleich prüft der Harnisch:

* Dokument-`uuid` und `metadata.last-modified` bleiben beim No-op unverändert
  (Befunde `document-uuid-changed`, `last-modified-changed`).
* Im Edit-Lauf folgt die Dokument-`uuid` der Root-UUID-Politik (Befunde
  `document-uuid-not-reassigned`, `document-uuid-not-stamp` bei `reassign`,
  `document-uuid-changed` bei `keep`), und `metadata.last-modified` ist gleich
  dem Stempel und verschieden vom Original (`last-modified-not-updated`,
  `last-modified-not-stamp`).
* Im Edit-Lauf bleibt die Menge der Paare (Pfad, Wert) aller `uuid`-Felder
  unterhalb der Root-Ebene gleich; ausgenommen ist nur das Element, das eine
  `add`-Operation anhängt (Befund `subobject-uuid-changed`). Ein `replace` auf
  ein bestehendes Unterobjekt-`uuid`-Feld ist eine Neuvergabe und schlägt mit
  diesem Befund fehl. Das schützt fachliche
  Unterobjekte wie `implemented-requirement`, `by-component`, `risk`,
  `observation`, `finding`, `metadata.actions` und `back-matter`-Ressourcen,
  auf deren UUIDs `#<uuid>`-Fragmente zeigen.
* `control/@id` ist nur lokal eindeutig: Controls werden ausschließlich als
  Paar `(catalogKey, controlId)` adressiert. `collectScopedIdentities()` und
  `buildScopedIdentityIndex()` erzwingen das; ein Negativtest mit kollidierender
  Control-ID in zwei Katalogen belegt die Trennung.
* `group/@id` folgt der Instanzregel: Gruppenzuordnung ist instanzlokal,
  Kollisionen über Instanzen hinweg sind zulässig.

## Statusmodell je Validierungsstufe

Stufen, Statusbedeutung und Kettenregel stehen im
[Validierungsvertrag](OSCAL_VALIDATION.md#verbindliche-kette).
`evaluateStages()` in `src/test/oscalRoundTrip.ts` erstellt die
harnischspezifischen Berichte:

| Bericht | Umsetzung im Harnisch |
| --- | --- |
| `schemaValidation` | Prüft das reimportierte Exportartefakt via `validateAgainstPinnedSchema()` gegen die gebundene Zelle. |
| `constraints` | Führt die dokumentierte Lücke mit `documentedGap: true` und `reference`. `assertConstraintGapDocumented()` verwirft die Behauptung einer ausgeführten Constraint-Prüfung. `pendingCases` benennt betroffene Dokumentfälle wie den schema-validen, aber vokabularfremden `map/relationship`-Token `maps-to`. |
| `references` | `evaluateCatalogReferences()` ist nur für Kataloge angebunden; andere Roots erhalten `not-available` mit Grund `catalog-only-implementation`. |

## Versionsbindung

Unterstützte Quell- und Zielversionen kommen ausschließlich aus der
[Versionsmatrix](OSCAL_VERSION_MATRIX.md). Die drei Zustände werden bezogen,
nicht nachgebaut:

| Zustand | Diagnosecode |
| --- | --- |
| gepinnt | `{ ok: true, pin }` |
| Version existiert, nicht gepinnt | `OSCAL_ROOT_VERSION_UNSUPPORTED` |
| Root-Typ existiert in dieser Version nicht (z. B. `mapping-collection` vor 1.2.0) | `OSCAL_ROOT_VERSION_IMPOSSIBLE` |

Dazu fail-closed: `OSCAL_VERSION_MISSING`, `OSCAL_VERSION_MALFORMED` sowie
`OSCAL_SCHEMA_DIRECTIVE_CONFLICT`, wenn `$schema` der über
`metadata.oscal-version` gewählten Zelle widerspricht. `$schema` wählt
niemals die Version aus. Der Harnisch verwendet `class-2-local-user`; für
seine Versionsbindung gilt die
[Klassenregel der Matrix](OSCAL_VERSION_MATRIX.md#führendes-v-in-metadataoscal-version).

## Der Fixture-Korpus

* Alle **acht** Root-Modelle sind geführt. Der No-op-Lauf benötigt **keinen**
  Root-Adapter — er vergleicht geparsten Graphen und Serialisierung; deshalb
  sind auch die zwei ohne registrierten Adapter (`assessment-results`,
  `plan-of-action-and-milestones`) abgedeckt. Stufe 5
  läuft im Harnisch ausschließlich für `catalog`; für alle übrigen Roots meldet
  sie nach bestandener Stufe 3 `not-available`.
* Je Modell ein Maximaldokument mit den verlustkritischen Strukturen:
  `prop`-Nebenfelder inklusive fremdem `ns`, `link.resource-fragment`/`rel`/
  `media-type`/`text`, inhaltsleere Back-matter-Ressourcen (nur `uuid`),
  `rlinks` ohne `hashes`/`media-type`, `base64` ohne `filename`/`media-type`,
  Citation-Minimalform, `document-ids` ohne `scheme`, `export` ohne
  Unterelemente, `inherited`/`satisfied` ohne Verkettungsfeld, `set-parameters`
  auf allen Ebenen des SSP, ungebundene anyOf-Token, leere `remarks`-Strings.
* `metadata.revisions` ist nie leer (`minItems: 1`) und wird nie umsortiert —
  die Reihenfolge ist Konvention, kein Constraint.
* Ein Dokument **mit** passendem `$schema` behält es, eines **ohne** erhält
  keinen.
* Der Korpus deckt alle vier Bestandsversionen ab; die QA-Lane validiert jede
  der 30 existierenden Matrixzellen (`mapping-collection` erst ab 1.2.x).
* Provenienz je Modell in `MAXIMAL_CORPUS_PROVENANCE`: NIST-abgeleitete
  Struktur oder ausdrücklich `synthetic-bsi-nah`. Der BSI-Upstream liefert
  **keine** produktiven SSP-, Assessment- oder POA&M-Artefakte; die
  entsprechenden Modelle werden nicht als reale BSI-Fälle ausgegeben. Keine
  realen Organisations-, Evidenz- oder Personendaten.
* Dokumentierter Hash je Maximaldokument: `MAXIMAL_CORPUS_HASHES` trägt den
  SHA-256 über die kanonische Serialisierung (`JSON.stringify` des gebauten
  Dokuments) für jede der 30 Matrixzellen. Der Korpus wird programmatisch
  erzeugt, nicht als Datei eingecheckt; der Korpus-Test gleicht jede Zelle
  gegen die Tabelle ab und deckt damit stille Korpusdrift auf. Eine
  beabsichtigte Änderung aktualisiert die Hashes bewusst im selben Commit.
  Welche Zellen existieren, entscheidet ausschließlich die Versionsmatrix —
  die Vollständigkeit beider Seiten wird gegeneinander geprüft.

## Redaction

Fehlerausgaben folgen dem Diagnosevertrag: Pfade und Wertarten ja, Dokumentwerte
nein. `formatRoundTripDifferences()` gibt Zeilen der Form
`<Pfad>: <Art> (<Wertart links> → <Wertart rechts>)` aus; ein Marker-Wert aus
dem Dokument kann in einer CI-Ausgabe nicht erscheinen (Negativtest im
Guard-File).

## Betrieb: schnelle Kernfälle und QA-Lane

* `npm run test` — schnelle Kernfälle (Positivläufe je Root @ 1.2.2,
  Katalog über alle vier Versionen, vollständiger Negativkorpus).
* `npm run test:qa` — gezielter Einzellauf der QA-Lane
  (`oscalRoundTripCorpus.qa.test.ts`): vollständiger Sweep aller 30
  Matrixzellen mit Maximaldokumenten. Die Lane läuft **im regulären Lauf** mit.
* Zur Laufzeit gibt es keinen Netzwerkzugriff: Ein Spy-Test belegt, dass weder
  `fetch` noch XHR bei einem Lauf mit externen `href`s erreicht wird.

## Adapter-Freigaberegel

Ein Root-Modell-Adapter gilt erst dann als „Import unterstützt“, wenn er im
Harnisch mit dem No-op-Lauf grün ist, und erst dann als „Export unterstützt“,
wenn er mit dem No-op-Lauf und dem Edit-Lauf grün ist. Die CI erzwingt das,
indem der Harnisch regulär läuft — ein neuer Adapter ohne grüne Läufe fällt in
der nächsten Korpusänderung auf.

## Normative Verankerung

Alle normativen OSCAL-Aussagen dieses Dokuments sind an gepinnte
`usnistgov`-Quellen gebunden:

| Aussage | Gepinnte Quelle |
| --- | --- |
| Root-Typen, Pflicht-/Optionalitätsverhältnisse, `required` + `additionalProperties: false` an der Wurzel, Identitätsregeln (`control/@id` lokal, `group/@id` instanzweit, Dokument-`uuid` global/change-on-write), `minItems: 1` bei `revisions`, `anyOf`-Muster ungebundener Vokabulare, geschlossene Ausnahme `origin-actor.type` | Die eingecheckten NIST-Release-Assets unter `schemas/oscal/v1.1.2`, `v1.1.3`, `v1.2.1`, `v1.2.2` — SHA-256-gepinnt über die [Versionsmatrix](OSCAL_VERSION_MATRIX.md), Reproduktion via `npm run verify-oscal-schemas`; Release-Tags [v1.1.2](https://github.com/usnistgov/OSCAL/releases/tag/v1.1.2), [v1.1.3](https://github.com/usnistgov/OSCAL/releases/tag/v1.1.3), [v1.2.1](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.1), [v1.2.2](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.2) |
| Existenz der acht Root-Modelle je Version; `mapping-collection` erst ab 1.2.0 | Versionsmatrix aus denselben Release-Assets (7 Schemadateien unter 1.1.x, 8 unter 1.2.x); [Release v1.2.0](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.0) |
| Zwei Validierungsstufen (Wohlgeformtheit, Validität) | [NIST — OSCAL Validation Concepts](https://pages.nist.gov/OSCAL/learn/concepts/validation/) |
| Modellsemantik je Feld | [Model Reference v1.2.2](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/), [v1.1.3](https://pages.nist.gov/OSCAL-Reference/models/v1.1.3/) |
| Verlustfreiheitsvertrag (bewahrt das `JSON.parse`-Ergebnis, nicht die Quellbytes) | [ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2); die `Infinity`/`-0`-Blindstelle ist am V8-Verhalten von `JSON.stringify` gemessen |

## Projektentscheidung vs. NIST-Vorgabe

OSCAL trifft keine Aussage über Serialisierung oder Formatierung. Die
byte-identische No-op-Gleichheit über `JSON.stringify` geht über den Standard
hinaus: Sie macht Verlustfreiheit beweisbar und nimmt jedem Export-Slice den
Auslegungsspielraum. Sie ist keine NIST-Vorgabe und darf nicht als solche
zitiert werden. Ebenfalls Projektentscheidungen: die zweite Vergleichsebene,
Umfang und Zuschnitt des Korpus, die Aufteilung in Kernfälle und QA-Lane, die
Form der Edit-Operation, die Adapter-Freigaberegel sowie der
`not-checked`-Status der Constraint-Stufe.
