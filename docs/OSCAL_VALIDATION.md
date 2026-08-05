# OSCAL-Validierungsvertrag

Dieser Vertrag gilt für OSCAL-JSON-Artefakte, die der Navigator künftig
importiert, exportiert oder in der Build-Pipeline prüft. Er definiert die
Prüfkette und ihre Lieferkette; er aktiviert noch keinen produktiven Import.
YAML und XML sind nicht unterstützt.

## Status: verbindlicher Zielzustand, noch nicht implementiert

Dieses Dokument legt den verbindlichen Zielzustand für den künftigen
OSCAL-Import- und -Prüfpfad fest. Die Schutzkette ist noch nicht in den
produktiven Katalog-Ladepfad integriert. Der aktuelle Katalog-Loader in
[`CatalogContext.tsx`](../src/state/CatalogContext.tsx) ruft
`fetchCatalogWithBuffer` auf; dessen Implementierung in
[`integrity.ts`](../src/domain/integrity.ts) dekodiert mit einem nicht-fatalen
`TextDecoder`. `CatalogContext` übergibt den zurückgegebenen Text anschließend
unmittelbar `JSON.parse`. Dieser Pfad besitzt derzeit kein Byte-Limit, keinen
Duplicate-Member-Scanner, keinen exakten OSCAL-Root-Dispatcher und keine
OSCAL-Schema-Prüfung.

Die bestehende Integritätsprüfung und `parseCatalog` ersetzen diese Gates
nicht. Bis die vollständige Kette samt Negativtests in Browser und CI
integriert ist, darf die App weder ihre Stufen als ausgeführt ausweisen noch
behaupten, dass der aktuelle Katalog-Loader durch diesen Vertrag abgesichert
ist. Eine Teilimplementierung aktiviert den Vertrag nicht.

Die Validierung ist von der bestehenden
[Integritätsprüfung](INTEGRITY.md) getrennt: SHA-256 schützt die Übereinstimmung
eines ausgelieferten Artefakts mit seinen Build-Metadaten. Die hier beschriebene
Kette prüft Syntax, Modellstruktur und fachliche Invarianten eines Dokuments.
Keine der beiden Prüfungen ist allein ein Herkunfts-, Vertrauens- oder
Compliance-Nachweis.

## Verbindliche Kette

Stufe 1 und 2 sind harte Eingangsgates: Schlagen sie fehl, erhalten alle
folgenden Stufen den terminalen Status `not-run`. Stufe 3 läuft nur nach
bestandener Stufe 2. Stufe 4 und die von ihr unabhängige Stufe 5 laufen nur,
wenn Stufe 3 `passed` ist oder eine ausschließlich additive, strukturell sicher
weiterverarbeitbare Schemaabweichung nach der unten definierten Policy
ausdrücklich `continuationAllowed: true` erhält. Stufe 5 läuft auch dann, wenn
Stufe 4 für eine dokumentierte versionsgebundene Lücke `not-checked` ist. Ein
Fehler oder eine technisch nicht verfügbare, aber für die jeweilige Aussage
erforderliche Stufe hält das Validierungsergebnis fail-closed negativ.
Unabhängig ausführbare Folgestufen werden trotzdem geprüft und mit einem
eigenen terminalen Status ausgewiesen. Diagnosen werden separat erzeugt und
verändern das Validierungsergebnis nicht.

„CI“ bezeichnet in diesem Dokument die Build- und Prüfzeit auf einem isolierten
GitHub-Actions-Runner; Browserprüfungen laufen ausschließlich im Modul-Worker.

| Stufe | Vorgeschriebener Zielzustand | Pinning und Fehlersemantik |
| --- | --- | --- |
| 1. Größenlimit und JSON-Syntax | Plattformfunktionen (`Uint8Array`, fataler UTF-8-Decoder), projekteigener Streaming-Token-Scanner und danach `JSON.parse` im isolierten Worker; dieselbe Reihenfolge in CI | Das Byte-Limit muss vor Decoder, Scanner und Parser gesetzt sein. Fehlt ein Limit oder wird es überschritten, wird nicht dekodiert. Nach erfolgreicher fataler Dekodierung lehnt der Scanner doppelte Member-Namen auf jeder Objekttiefe ab; nur dann wird `JSON.parse` aufgerufen. CI verwendet Node 22 gemäß Workflow und der Mindestversion in `package.json`; die Prüflogik einschließlich Scanner ist über den App-Commit gepinnt. |
| 2. Root-Erkennung | Projekteigener exakter Dispatcher im Worker und in CI | Das Top-Level-Objekt muss genau einen der acht bekannten Root-Keys besitzen. Null, Arrays, mehrere Root-Keys und unbekannte Keys werden abgelehnt. Die optionale Schema-Direktive `$schema` ist die einzige zusätzlich zulässige Top-Level-Property; sie ist kein zweiter Root und **niemals** Versionsautorität. Eine Katalog-Interpretation als Fallback ist verboten. |
| 3. JSON-Schema | Browser nach Aktivierung: `ajv` 8.20.0 im Modul-Worker. CI dann zusätzlich: `go-oscal` 0.7.1 als unabhängiges Schema- und Upgrade-Orakel | Auswahl ausschließlich über den exakten Root×`oscal-version`-Schlüssel. Fehlende Kombinationen werden abgelehnt. Nur exakt registrierte, additive `additionalProperties`-Abweichungen dürfen die Fortsetzung zu Stufe 4 und 5 erlauben; die Schema-Stufe bleibt `failed`. Ajv wird erst nach der OSS-Zulassung aus [ADR-5](https://linear.app/grundschutz-plus-plus/issue/ADR-5) produktiv aufgenommen. Bis direkte Abhängigkeit, Paket-Lock, Schema-Manifest und Hashprüfung vorhanden sind, bleibt der betreffende Importpfad deaktiviert. |
| 4. zusätzliche OSCAL-Constraints | Derzeit **kein zugelassener Validator** für OSCAL 1.2.2; im Browser und in CI als `not-checked` ausgewiesen | Diese Stufe darf weder übersprungen noch als bestanden dargestellt werden. Die zulässige Konformitätsaussage wird deshalb begrenzt. Das konkrete Mapping-Orakel ist als bekannte Lücke registriert. |
| 5. Referenzen und Projektregeln | Projekteigener, kataloggescopter Referenzgraph und explizit versionierte Regeln im Worker und in CI; Vertrag in [GSPP-251](https://linear.app/grundschutz-plus-plus/issue/GSPP-251) | Prüft UUID-/ID-Eindeutigkeit, interne und dokumentübergreifende Referenzen, URI- und Medientypregeln sowie ausdrücklich benannte GRC-Regeln. Externe `href`-Ziele werden klassifiziert, niemals während der Validierung abgerufen. Unbekannte Regeln gelten nicht als bestanden. |

Der Streaming-Token-Scanner führt für jedes geöffnete JSON-Objekt eine eigene
Menge bereits gelesener Member-Namen. Verglichen wird der logische Name nach
Auflösung von JSON-Escapes, sodass etwa `catalog` und eine escape-äquivalente
Schreibweise als Duplikat gelten. Ein Duplikat beendet Stufe 1 vor `JSON.parse`
mit `OSCAL_JSON_DUPLICATE_MEMBER`; Root-Dispatcher und alle späteren Stufen
erhalten `not-run`. Die Diagnose nennt weder den unvertrauenswürdigen
Member-Namen noch dessen Wert, sondern nur den stabilen Code und einen sicheren
strukturellen Containerpfad: Nur positiv gelistete Pfadsegmente werden genannt,
unbekannte Segmente werden als Platzhalter redigiert. Damit interpretieren
Browser, CI und nachgelagerte Werkzeuge dasselbe eindeutige Dokument, ohne eine
zusätzliche Abhängigkeit einzuführen.

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
| go-oscal, nach Aktivierung | Offizielles GitHub-Release `v0.7.1`, Apache-2.0 | Die künftige CI-Stufe lädt nur das Plattformartefakt des exakten Releases, prüft den von GitHub veröffentlichten Asset-Digest und `checksums.txt` und archiviert die zugehörige SBOM als Build-Nachweis. Die ausführbare Datei wird nicht in dieses Repository eingecheckt. |
| Eigene Regeln | App-Quellcode und Tests | Pinning durch Commit-SHA; jede Regel nennt betroffene Root×Version-Paare und stabile Diagnostic-Codes. |

Schema- und Toolupdates sind atomar: neue Datei beziehungsweise neue Version,
neuer Hash, Positiv- und Negativorakel und Review im selben Änderungssatz.
Ein Update, das die Constraint-Lücke oder Diagnostic-Signaturen verändert,
erfordert auch die Anpassung der Aussagegrenzen beziehungsweise der eng
gebundenen Policy-Einträge.

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
Der Artefaktkontext kann zusätzlich Lifecycle und Snapshot tragen. Dieses
Grundformat wird von der Referenzprüfung aus
[GSPP-251](https://linear.app/grundschutz-plus-plus/issue/GSPP-251)
wiederverwendet; es entsteht kein zweites Diagnosemodell.

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

Ausnahmen sind ausschließlich CI-Policy. Sie unterdrücken keine Diagnose und
ändern `validationValid: false` niemals in `true`. Ein Eintrag darf zusätzlich
`continuationEligible: true` tragen, aber nur für eine additive
`additionalProperties`-Abweichung, nach der das erwartete OSCAL-Modell sicher
weiter geprüft werden kann. Nur wenn jede Diagnose der Schema-Stufe einen
solchen Eintrag exakt trifft, wird `continuationAllowed: true` gesetzt. Diese
Fortsetzung ändert weder `validationValid: false` noch unterdrückt eine
Diagnose; sie erlaubt ausschließlich die Ausführung der Stufen 4 und 5.

Separat darf `policyAccepted: true` nur entstehen, wenn alle fünf Stufen einen
terminalen Status besitzen und zusätzlich sämtliche Bedingungen erfüllt sind:

- Stufe 1, 2 und 5 sind `passed`;
- Stufe 3 ist entweder `passed` oder ausschließlich wegen exakt gedeckter,
  fortsetzungsfähiger Diagnosen `failed`;
- Stufe 4 ist `passed` oder für die dokumentierte versionsgebundene
  Constraint-Lücke ausdrücklich `not-checked`; dieser Status bleibt sichtbar;
- keine Stufe ist `not-run`;
- **jede** Diagnose ist exakt durch einen Eintrag mit den folgenden fünf
  Matchfeldern gedeckt.

Eine zusätzliche Diagnose, ein fehlender terminaler Stufenstatus oder
`not-run` lässt das Policy-Gate fehlschlagen. Die fünf exakten Matchfelder sind:

1. Artefaktschlüssel,
2. Root-Typ,
3. `oscal-version`,
4. normalisierter Feldpfad,
5. Diagnosesignatur einschließlich Validatorpin und strukturellem Fehlermerkmal.

Begründung und Erfassungsdatum sind Pflichtmetadaten. Jede weitere Diagnose,
eine geänderte Signatur oder derselbe Pfad mit einer anderen Fehlerart lässt das
Policy-Gate fehlschlagen.

Der erste bekannte Befund stammt aus einem tatsächlichen go-oscal-0.7.1-Lauf.
Der Validator meldet die zusätzlichen Eigenschaften gemeinsam am
`provenance`-Objekt. Der Adapter zerlegt ausschließlich diese strukturelle
Eigenschaftsliste deterministisch in zwei weiterhin sichtbare Diagnosen:

| Artefakt | Root / Version | Feldpfad und Signatur | Fortsetzung | Begründung / erfasst |
| --- | --- | --- | --- | --- |
| `mapping-iso27001-annex-a-zu-gspp` | `mapping-collection` / 1.2.2 | `/mapping-collection/provenance/qa-reviewed` — `go-oscal@0.7.1\|additionalProperties\|/mapping-collection/provenance\|qa-reviewed` | `continuationEligible: true` | bekannte additive BSI-QA-Erweiterung / 2026-08-01 |
| `mapping-iso27001-annex-a-zu-gspp` | `mapping-collection` / 1.2.2 | `/mapping-collection/provenance/qa-note` — `go-oscal@0.7.1\|additionalProperties\|/mapping-collection/provenance\|qa-note` | `continuationEligible: true` | bekannte additive BSI-QA-Erweiterung / 2026-08-01 |

Wenn die Aggregatmeldung nicht exakt aus diesen beiden Eigenschaften besteht,
wird sie nicht zerlegt, erhält keine Fortsetzungserlaubnis und wird nicht von
der Policy akzeptiert. Die schemafremden Felder bleiben im verlustfreien
Dokument erhalten.

## Belegte Orakel

Der temporäre Prototyp verwendete ausschließlich checksum-geprüfte Artefakte
des gepinnten BSI-Snapshots; weder Artefakte noch Testharnisch werden im
Repository gehalten. Das Catalog-Paar zu `metadata.props` belegt beide Aussagen
der Landkarte zugleich: die Prüftiefendifferenz und die Reichweite der
namespace-gebundenen Constraints.

| Fall | Erwarteter und beobachteter Befund |
| --- | --- |
| reales `catalog-gspp`, OSCAL 1.1.3 | Root-/Versionswahl und Schema-Prüfung bestehen. Eine abgeleitete Variante ohne Pflichtfeld `metadata.title` scheitert an der Schema-Stufe. |
| reales ISO→Grundschutz++-Mapping, OSCAL 1.2.2 | Das unveränderte Artefakt bleibt wegen `qa-reviewed` und `qa-note` schema-invalid; die separate Policy kann nur diese exakten Diagnosen akzeptieren. |
| aus dem realen Mapping abgeleitet, `relationship: "maps-to"` | JSON-Schema besteht; die nicht verfügbare allgemeine Constraint-Stufe bleibt als Lücke sichtbar. |
| aus dem realen Mapping abgeleitet, `status: "veröffentlicht"` | JSON-Schema scheitert. |
| aus dem realen `catalog-gspp` abgeleitet, `metadata.props` um `{ "name": "erfundener-name" }` **ohne** `ns` ergänzt | JSON-Schema besteht, weil `prop/name` kein Enum trägt. Der Name verletzt den geschlossenen OSCAL-Wertebereich; die nicht verfügbare Constraint-Stufe bleibt als Lücke sichtbar. |
| dieselbe Variante mit `ns: "https://example.org/ns"` | JSON-Schema besteht ebenso. Ein Constraint-Verstoß liegt hier **nicht** vor: Der Fremd-Namespace ist regulär und vom `has-oscal-namespace(...)`-Prädikat nicht erfasst. Solange Stufe 4 `not-checked` ist, ist das am Metaschema belegt und nicht an einem Lauf beobachtet. |
| null, mehrere, unbekannte oder zusätzliche Root-Keys | Root-Erkennung scheitert. |
| doppelter Root-Key oder doppeltes `metadata.oscal-version` | Der Streaming-Token-Scanner lehnt das Dokument auf der jeweiligen Objekttiefe vor `JSON.parse` mit `OSCAL_JSON_DUPLICATE_MEMBER` ab; Root-Erkennung und Schema-Auswahl laufen nicht. Escape-äquivalente Member-Namen gelten ebenfalls als Duplikat. |
| nicht vorhandenes Root×Version-Paar | Auswahl scheitert ohne Fallback. |
| Dokument über dem konfigurierten Byte-Limit | Ablehnung erfolgt vor Decoder und Parser. |
| Validierung nach initialem Laden im Browser-Worker | Keine Schema- oder Dokumentanfrage wird ausgelöst. |

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
