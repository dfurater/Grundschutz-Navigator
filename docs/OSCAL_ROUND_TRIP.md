# OSCAL-Round-trip-Harnisch (GSPP-298)

Der modellübergreifende No-op-Round-trip-Harnisch ist die Testinfrastruktur
hinter [ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2): Er beweist
je OSCAL-Dokument, dass ein Round-trip **ohne fachlichen Schreibvorgang nichts
verändert** — weder auf der Serialisierung noch auf dem geparsten Graphen. Er
ist das Freigabegate für jeden späteren Import-, Authoring- und Export-Slice.

* Implementierung: [`src/test/oscalRoundTrip.ts`](../src/test/oscalRoundTrip.ts)
* Graphvergleich: [`src/test/oscalGraphCompare.ts`](../src/test/oscalGraphCompare.ts)
* Korpus: [`src/test/fixtures/oscalRoundTripCorpus.ts`](../src/test/fixtures/oscalRoundTripCorpus.ts)
* Stufenbegriffe und Vertragskette: [OSCAL_VALIDATION.md](OSCAL_VALIDATION.md)

## Die No-op-Laufart

`runNoOpRoundTrip()` nimmt den Fixture als JSON-Quelltext und optional einen
eingespeisten Export, einen Registry-Pfad (`upstreamPath`) sowie eine
Katalogidentität entgegen und liefert ein eingefrorenes, deterministisches
Ergebnis:

1. **Stufe 1** — Byte-Eingangsgrenze vor dem Parsen, strukturelle Limits
   (Tiefe, Knoten, Base64-Summe) nach dem Parsen; beides aus
   [`oscalResourceLimits.ts`](../src/domain/oscalResourceLimits.ts) bzw. dem
   Importvertrag.
2. **Stufe 2** — Root-Erkennung und Versionsbindung über
   `dispatchOscalDocument()`. Der Harnisch führt **keine eigene Versionsliste**
   und baut keine Diagnose der Matrix nach; ein statischer Test im Guard-File
   belegt die Delegation. Es gibt keine `rootType`-Eingabe: Der gemeldete
   Root-Typ ist ausschließlich der **abgeleitete** aus dem Dokument. Ein
   optionaler `upstreamPath` erzwingt die artefaktscharfe Registry-Erwartung
   (`OSCAL_ROOT_TYPE_MISMATCH`) und ordnet Diagnosen dem Artefaktschlüssel zu.
3. **Export und Reimport** — Vorgabe ist die Identität (heute existiert kein
   Exportpfad). Künftige Serializer reichen `exportDocument` ein, ohne den
   No-op-Pfad zu ändern. Anschließend liegen beide Seiten fest: das Original
   (geparste Eingabe) und das **reimportierte Exportartefakt**.
4. **Vergleichsebenen** (siehe unten) und **Identitätsprüfung** zwischen
   Original und reimportiertem Export.
5. **Validierungsstufen 3–5** mit terminalem Status je Stufe — geprüft wird
   das **reimportierte Exportartefakt**, nie die Eingabe: Nur so certifieren
   die Status das Dokument, das den Prozess tatsächlich verlässt.

Die Edit-Laufart (`change-on-write`: neue Dokument-`uuid`, neuer
`last-modified`-Zeitstempel) ist ausdrücklich **nicht** Teil dieses Moduls;
sie wartet auf den ersten Schreibpfad und wird additiv ergänzt.

## Zwei Vergleichsebenen

Beide Ebenen sind verbindlich; sie beantworten unterschiedliche Fragen.

| Ebene | Kriterium | Was sie beweist |
| --- | --- | --- |
| Serialisierung | `JSON.stringify(export) === JSON.stringify(original)` — byte-identisch einschließlich Schlüsselreihenfolge, Array-Reihenfolge, unbekannter Felder, leerer Objekte/Arrays | Das Ausgabeartefakt ist bytegleich zur Eingabe. |
| Geparster Graph | `compareJsonGraphs()` mit `Object.is`-Blattsemantik | Der Wert im Artefakt ist derselbe Wert. |

Warum die zweite Ebene kein Komfort ist: `JSON.parse` kann zwei Werte
erzeugen, die `JSON.stringify` nicht darstellen kann — `Infinity`/`-Infinity`
(aus Quelltexten wie `1e400`) und `-0`. Die Serialisierung schreibt daraus
`null` beziehungsweise `0`; **beide Vergleichsseiten erleiden denselben
Verlust**, der Serialisierungsvergleich bleibt grün, und wer exportiert und
wieder importiert, erhält ein anderes Dokument. Nur der Graphvergleich
unterscheidet diese Fälle. Negativtests im Guard-File belegen die Erkennung.

Bewusst **kein** Verlust sind Textabweichungen ohne Wertänderung
(`1E2 → 100`, `1.0 → 1`, `"\/" → "/"`, Exponentenschreibweise): ADR-2 bewahrt
das Ergebnis von `JSON.parse`, nicht die Quellbytes. Dasselbe gilt für die
Umsortierung numerischer Objektschlüssel — sie geschieht in `JSON.parse`
selbst; der Graphvergleich ordnet Integer-artige Schlüssel deshalb kanonisch.

## Identitätsregeln

Getrennt vom Inhaltsvergleich prüft der Harnisch:

* Dokument-`uuid` und `metadata.last-modified` bleiben beim No-op unverändert
  (`identifier-persistence="change-on-write"` bzw. Speicherzeitpunkt — genau
  die Felder, die ein fachlicher Schreibvorgang ändern **muss**).
* `control/@id` ist nur lokal eindeutig: Controls werden ausschließlich als
  Paar `(catalogKey, controlId)` adressiert. `collectScopedIdentities()` und
  `buildScopedIdentityIndex()` erzwingen das; ein Negativtest mit kollidierender
  Control-ID in zwei Katalogen belegt die Trennung.
* `group/@id` folgt der Instanzregel: Gruppenzuordnung ist instanzlokal,
  Kollisionen über Instanzen hinweg sind zulässig.

## Statusmodell je Validierungsstufe

Die Begriffe stammen aus [OSCAL_VALIDATION.md](OSCAL_VALIDATION.md),
Abschnitt „Verbindliche Kette“; es entsteht kein zweites Stufenmodell.

| Stufe | Mögliche Status | Anmerkung |
| --- | --- | --- |
| 3. JSON-Schema | `passed` · `failed` · `not-run` | Gegen die von `resolveSchemaBinding()` gebundene Zelle via `validateAgainstPinnedSchema()`; kein Nachbarversions-Fallback. |
| 4. Constraints | **`not-checked`** (terminal) · `not-run` | Es gibt keinen zugelassenen Constraint-Validator ([GSPP-282], [ADR-5]). Die Lücke ist mit `documentedGap: true` sichtbar geführt; `assertConstraintGapDocumented()` lässt Ergebnisse, die „geprüft“ melden, hart fehlschlagen. `pendingCases` benennt Dokumentfälle, deren Prüfung ausschließlich dieser Stufe obläge — etwa einen schema-validen, aber vokabularfremden `map/relationship`-Token (`maps-to`). |
| 5. Referenzen | `passed` · `failed` · `not-available` · `not-run` | Nur am Katalogpfad umgesetzt; andere Roots erhalten `not-available` (`catalog-only-implementation`). Fail-closed-Kriterium: unsichere Protokolle (`javascript:` usw.) werden klassifiziert, nie adressiert. |

Kettenregel: Fehlen Stufe 1 oder 2, bleiben alle Folgestufen `not-run`.
Stufe 5 läuft nach bestandener Stufe 3 unabhängig vom `not-checked` in Stufe 4.

## Versionsbindung

Unterstützte Quell- und Zielversionen kommen ausschließlich aus der
[Versionsmatrix](OSCAL_VERSION_MATRIX.md). Die drei Zustände werden bezogen,
nicht nachgebaut:

| Zustand | Diagnosecode |
| --- | --- |
| gepinnt | `{ ok: true, pin }` |
| Version existiert, nicht gepinnt | `OSCAL_ROOT_VERSION_UNSUPPORTED` |
| Root-Typ existiert in dieser Version nicht (z. B. `mapping-collection` vor 1.2.0) | `OSCAL_ROOT_VERSION_IMPOSSIBLE` |

Dazu fail-closed: `OSCAL_VERSION_MISSING`, `OSCAL_VERSION_MALFORMED` (auch für
ein führendes `v` — die offene Produktentscheidung dazu liegt in [GSPP-357]
und wird hier nicht vorweggenommen) sowie `OSCAL_SCHEMA_DIRECTIVE_CONFLICT`,
wenn `$schema` der über `metadata.oscal-version` gewählten Zelle widerspricht.
`$schema` wählt niemals die Version aus.

## Der Fixture-Korpus

* Alle **acht** Root-Modelle sind geführt. Der No-op-Lauf benötigt **keinen**
  Root-Adapter — er vergleicht geparsten Graphen und Serialisierung; deshalb
  sind auch die vier ohne registrierten Adapter (`system-security-plan`,
  `assessment-plan`, `assessment-results`, `plan-of-action-and-milestones`)
  vollständig abdeckbar. Für sie läuft Stufe 5 nicht (`not-available`).
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
  Matrixzellen mit Maximaldokumenten. Die Lane liegt **im regulären Lauf**;
  der Ausschluss wäre eine Abschwächung gewesen.
* Zur Laufzeit gibt es keinen Netzwerkzugriff: Ein Spy-Test belegt, dass weder
  `fetch` noch XHR bei einem Lauf mit externen `href`s erreicht wird.

## Adapter-Freigaberegel

Ein Root-Modell-Adapter gilt erst dann als „Import unterstützt“ beziehungsweise
„Export unterstützt“, wenn er im Harnisch mit dem No-op-Lauf grün ist. Die
Edit-Bedingung tritt mit dem Folge-Issue „Edit-Laufart“ hinzu. Die CI erzwingt
das, indem der Harnisch regulär läuft — ein neuer Adapter ohne grünen
No-op-Lauf fällt in der nächsten Korpusänderung auf.

## Normative Verankerung

Alle normativen OSCAL-Aussagen dieses Dokuments sind an gepinnte
`usnistgov`-Quellen gebunden; keine Aussage stützt sich auf ungepinnte
Netzabrufe:

| Aussage | Gepinnte Quelle |
| --- | --- |
| Root-Typen, Pflicht-/Optionalitätsverhältnisse, `required` + `additionalProperties: false` an der Wurzel, Identitätsregeln (`control/@id` lokal, `group/@id` instanzweit, Dokument-`uuid` global/change-on-write), `minItems: 1` bei `revisions`, `anyOf`-Muster ungebundener Vokabulare, geschlossene Ausnahme `origin-actor.type` | Die eingecheckten NIST-Release-Assets unter `schemas/oscal/v1.1.2`, `v1.1.3`, `v1.2.1`, `v1.2.2` — SHA-256-gepinnt über die [Versionsmatrix](OSCAL_VERSION_MATRIX.md), Reproduktion via `npm run verify-oscal-schemas`; Release-Tags [v1.1.2](https://github.com/usnistgov/OSCAL/releases/tag/v1.1.2), [v1.1.3](https://github.com/usnistgov/OSCAL/releases/tag/v1.1.3), [v1.2.1](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.1), [v1.2.2](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.2) |
| Existenz der acht Root-Modelle je Version; `mapping-collection` erst ab 1.2.0 | Versionsmatrix ([GSPP-283]) aus denselben Release-Assets (7 Schemadateien unter 1.1.x, 8 unter 1.2.x); [Release v1.2.0](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.0) |
| Zwei Validierungsstufen (Wohlgeformtheit, Validität) | [NIST — OSCAL Validation Concepts](https://pages.nist.gov/OSCAL/learn/concepts/validation/) |
| Modellsemantik je Feld | [Model Reference v1.2.2](https://pages.nist.gov/OSCAL-Reference/models/v1.2.2/), [v1.1.3](https://pages.nist.gov/OSCAL-Reference/models/v1.1.3/) |
| Verlustfreiheitsvertrag (bewahrt das `JSON.parse`-Ergebnis, nicht die Quellbytes) | [ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2); die `Infinity`/`-0`-Blindstelle ist am V8-Verhalten von `JSON.stringify` gemessen (Befund 7 im [Issue GSPP-298](https://linear.app/grundschutz-plus-plus/issue/GSPP-298)) |

Alles darüber hinaus — byte-identische No-op-Gleichheit, zweite Vergleichsebene,
Korpuszuschnitt, QA-Lane, Adapter-Freigaberegel und der `not-checked`-Status
der Constraint-Stufe — bleibt ausdrücklich **Projektentscheidung** (siehe unten).

## Projektentscheidung vs. NIST-Vorgabe

OSCAL trifft keine Aussage über Serialisierung oder Formatierung. Die
byte-identische No-op-Gleichheit über `JSON.stringify` ist eine bewusste
**Projektentscheidung**, die über den Standard hinausgeht: Sie macht
Verlustfreiheit beweisbar und nimmt jedem Export-Slice den
Auslegungsspielraum. Sie ist keine NIST-Vorgabe und darf nicht als solche
zitiert werden. Ebenfalls Projektentscheidungen: die zweite Vergleichsebene,
Umfang und Zuschnitt des Korpus, die Aufteilung in Kernfälle und QA-Lane, die
Adapter-Freigaberegel sowie der `not-checked`-Status der Constraint-Stufe.
