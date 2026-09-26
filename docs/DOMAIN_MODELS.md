# Domänenmodelle — Grundschutz++ Navigator

Zwei-Schichten-Architektur der Datentypen (`src/domain/models.ts`):

## Überblick

1. **Raw OSCAL Types** — Spiegelt die JSON-Struktur des BSI Katalogs
2. **Enriched Domain Types** — Flach, typsicher, UI-bereit

Zur Laufzeit filtern beide Schichten nichts: Der Quellgraph bleibt vollständig
erhalten und wird vom Dokumentmodell neben dem angereicherten Katalog geführt —
siehe [Verlustfreies Dokumentmodell](#verlustfreies-dokumentmodell).

## Verlustfreies Dokumentmodell

Der Katalogpfad folgt
[ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2): **Das
Originaldokument ist die Wahrheit, das Domänenmodell eine Projektion darauf.**

```typescript
type TrustClass =
  | 'class-1-verified-public'    // Quellregister-Artefakt, Hashprüfung bestanden
  | 'class-1-unverified-public'  // Quellregister-Artefakt, Prüfung fehlt oder schlug fehl
  | 'class-2-local-user';        // lokales Nutzerdokument

interface CatalogDocumentContext extends OscalDocumentContext {
  catalogKey: CatalogKey;   // Identität aus dem Quellregister (ADR-1)
}

interface CatalogDocument {
  readonly source: unknown;                  // §1 Originalknoten
  readonly context: CatalogDocumentContext;  // §2 expliziter Kontext
  readonly view: Catalog;                    // §2 view = derive(source, context)
}
```

`TrustClass`, `OscalDocumentContext` und `CatalogDocumentContext` stehen in
`src/domain/oscalDocumentContext.ts` und werden aus `@/domain/models`
weiterexportiert.

Einstiegspunkt ist `parseCatalogDocument()` in
`src/adapters/oscalDocument.ts`. Es führt das Dokument über den
[Root-Dispatch](#root-envelope-und-root-dispatch) und gibt `parseCatalog()` nur
den **Katalogkörper**.

### Vertrauensklasse ist ein Ergebnis, keine Herkunftsangabe

Klasse 1 verlangt nach [ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2)
§10 drei Eigenschaften: Quellregister-Herkunft, Manifest-v2-Provenienz **und
bestandene Laufzeit-Hashprüfung**. Erst dann gilt
`class-1-verified-public`.

`CatalogProvider` baut das Dokument **nach** der Integritätsprüfung. Fehlen die
Metadaten oder weicht der Hash ab, bleibt das Dokument nutzbar, trägt aber
`class-1-unverified-public`.

Die Verifikationsdetails stehen in `CatalogState.verification`; die Klasse fasst
nur ihr Ergebnis für die Dokumentebene zusammen.

### Warum

Reguläre OSCAL-Strukturen ohne Entsprechung im Domänenmodell:

| Struktur | Warum verlustkritisch |
| --- | --- |
| `prop.remarks`, `prop.class`, `prop.group`, `prop.uuid` | reguläre Felder ohne Entsprechung im Domänenmodell; `remarks` kommt im BSI-Katalog real vor |
| `link.resource-fragment`, `link.media-type` | `ControlLink` führt nur `targetId` und `relation` |
| `back-matter`-Ressourcen ohne Inhalt | `resource` verlangt nur `uuid`; Fragment-Referenzen lösen ausschließlich hierhin auf |
| `metadata.revisions`, `metadata.document-ids`, `metadata.locations` | Revisionshistorie und Dokument-IDs sind Teil des Dokuments; `document-ids` existiert im Katalog real |
| herstellerspezifische `props` mit eigenem `ns` | OSCAL erlaubt Extensions ausdrücklich |
| Array-Reihenfolgen | die Profile-Resolution-Spezifikation verlangt Erhalt der Quellreihenfolge |

### Reichweite des Begriffs

„Verlustfrei" heißt **strukturell und semantisch verlustfrei innerhalb des
JSON-Informationsmodells**: Bewahrt wird das Ergebnis von `JSON.parse` (alle
Schlüssel, Werte, Verschachtelungen, Array-Reihenfolgen, Einfügereihenfolge
nicht-numerischer Schlüssel). Formatierung, Einrückung und Zeilenenden werden
nicht bewahrt.

`source` ist als `unknown` typisiert: `JSON.parse` liefert keine geprüfte
Struktur, und der Vertrag filtert den Quellgraphen nicht nach bekannten
Feldern. Unbekannte Felder bleiben ausschließlich in `source` — sie werden nie
ins `view` gehoben, nie gerendert und nie interpretiert, aber auch nie
entfernt.

### Referenzauflösung auf dem Quellgraphen

[`referenceResolution.ts`](../src/domain/referenceResolution.ts) verarbeitet
`link`, `back-matter`, `resource`, `rlink`, `citation` und `base64` direkt aus
`CatalogDocument.source` mit explizitem Dokument- und Katalogkontext. Das `view`
trägt weder `resource-fragment` noch `media-type`, `citation` oder `base64` und
ist keine Eingabe dieser Schicht.

Der Klassifikator löst nur dokumentinterne Fragmente und explizit
bereitgestellte Cross-Dokument-Ziele auf. Relative Ziele erhalten keinen
Verzeichniskontext; externe Ziele werden ausschließlich für `https:` als
externe Navigation ausgewiesen, alle anderen Protokolle bleiben Text. Die
Schicht führt weder Netzwerk- noch Dateizugriffe aus und dekodiert keine
`base64`-Nutzlast. Ein fehlender `rlink`-Hash wird als fehlender
Integritätsnachweis angezeigt; vorhandene Upstream-Hashes sind keine
Projekt-SHA-256-Verifikation.

Die abgeleitete `Control.links`-Projektion enthält ausschließlich aufgelöste,
kataloggescopte Control-Ziele. Ressourcen, externe und nicht auflösbare
Referenzen bleiben im Quellgraphen.
[`catalogReferenceProjection.ts`](../src/domain/catalogReferenceProjection.ts)
wendet diese Projektion im `CatalogContext` genau einmal an, bevor die View
veröffentlicht wird; der Adapter klassifiziert keine Referenzen.

Ein `rlink` klassifiziert sein Ziel nur flach und expandiert die Zielressource
nicht erneut. Selbstreferenzen und Zyklen zwischen Ressourcen bleiben sichtbar,
ohne die Darstellung durch Rekursion zu blockieren.

### Speicherstrategie: String-Sharing

Der Quellgraph kostet zusätzlichen Heap. Das Domänenmodell übernimmt Titel,
Prosa und Prop-Werte per Referenz auf dieselben Quellstrings, statt sie zu
kopieren — in `src/adapters/oscalAdapter.ts` unter anderem `title: raw.title`,
`statementRaw` und `value: prop.value`.

Geteilt werden ausschließlich **Strings** (unveränderlich). Objekte und Arrays
werden kopiert — auch `responsible-parties/party-uuids` und `rlinks/hashes`
samt der einzelnen Hash-Objekte, weil eine Mutation am Domänenmodell sonst auf
den Quellgraphen durchschlüge. `src/adapters/oscalDocument.test.ts` prüft die
Trennung generisch über Objektidentitäten.

Gemessen am Grundschutz++-Katalog (~21.300 Container): rund **1,9 MB
zusätzlich, etwa 91 Byte je Container** unter Node 22.

> Diese Stellen dürfen **nicht** auf Kopien umgestellt werden. Geschieht es
> doch, wandert die gesamte Textmasse in den Zusatzspeicher.
> `src/adapters/oscalDocument.heap.node.test.ts` misst den Wert je Container
> und schlägt bei einem Bruch an.

### Nachweise

| Nachweis | Ort |
| --- | --- |
| Strukturerhalt, Extensions, No-op-Serialisierung, Nicht-Mutation | `src/adapters/oscalDocument.test.ts` gegen das eingefrorene Fixture `src/test/fixtures/losslessCatalog.ts` |
| Vollständige Erhaltung am realen Katalog | `src/adapters/oscalDocument.catalog.node.test.ts` |
| Zusatzspeicher je Container | `src/adapters/oscalDocument.heap.node.test.ts` |
| Zählregeln A und B als Strukturorakel | `src/test/oscalStructure.ts` |

Der reale Katalog wird nie committet, sondern bei jedem Build frisch von BSI
geholt. Tests gegen ihn prüfen ausschließlich **Erhaltung** (Vergleich Original
↔ `source`), nie feste Inhaltszahlen. Die festgenagelten Strukturprüfungen
laufen gegen das eingefrorene Fixture, das alle verlustkritischen Strukturen
trägt — auch die, die der reale Katalog derzeit nicht enthält.

## Raw OSCAL Types

Die Raw Types befinden sich in `src/domain/models.ts` und entsprechen 1:1 der OSCAL 1.1.3 JSON-Struktur:

### Grundstrukturen

```typescript
interface RawOscalProp {
  name: string;
  value: string;
  uuid?: string;
  ns?: string;
  class?: string;
  group?: string;
  remarks?: string;
}

interface RawOscalLink {
  href: string;
  rel?: string;
  text?: string;
}

interface RawOscalParam {
  id: string;
  props?: RawOscalProp[];
  label?: string;
  values?: string[];
}

interface RawOscalPart {
  id?: string;
  name: string;
  prose?: string;
  props?: RawOscalProp[];
  parts?: RawOscalPart[];
}
```

### Steuerungen

```typescript
interface RawOscalControl {
  id: string;
  class?: string;
  title: string;
  params?: RawOscalParam[];
  props?: RawOscalProp[];
  parts?: RawOscalPart[];
  links?: RawOscalLink[];
  controls?: RawOscalControl[];  // Nested sub-controls / enhancements
}
```

### Gruppen (Practice/Topic)

```typescript
interface RawOscalGroup {
  id: string;
  title: string;
  props?: RawOscalProp[];
  groups?: RawOscalGroup[];  // Topics
  controls?: RawOscalControl[];
}
```

### Katalog

```typescript
interface RawOscalMetadata {
  title: string;
  'last-modified': string;
  version: string;
  'oscal-version': string;
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  roles?: Array<{ id: string; title: string }>;
  parties?: Array<{
    uuid: string;
    type: string;
    name: string;
    'email-addresses'?: string[];
  }>;
  'responsible-parties'?: Array<{
    'role-id': string;
    'party-uuids': string[];
  }>;
  remarks?: string;
}

interface RawOscalCatalog {
  uuid: string;
  metadata: RawOscalMetadata;
  groups?: RawOscalGroup[];
  params?: RawOscalParam[];
  'back-matter'?: {
    resources?: RawOscalResource[];
  };
}

```

Der Root-Envelope steht nicht mehr hier, sondern in
`src/domain/oscalRootDocument.ts` — siehe
[Root-Envelope und Root-Dispatch](#root-envelope-und-root-dispatch).

## Projekteigene OSCAL-Properties

`src/domain/projectProps.ts` ist die einzige Runtime-Registry für den
Projektnamespace (sechs bekannte Namen, Träger, Kardinalitäten, Wertregeln).
Der öffentliche Vertrag steht in [`PROJECT_PROPS.md`](PROJECT_PROPS.md).

Der Lesepfad arbeitet auf `RawOscalProp` und mutiert weder Liste noch einzelne
Property-Objekte. Fremde Namespaces und unbekannte Namen bleiben im
Quellgraphen. Nur der semantische Schreibpfad wird bei unbekanntem Projektnamen
oder Vertragsverletzung gesperrt; Diagnosen enthalten keine Property-Werte oder
Freitexte.

`preservedProps` ist die einzige vollständige und geordnete Quelle für Export
und Backup und bleibt selbst bei ungültiger Collection referenzidentisch zur
Eingabe. `projectProps`, `foreignProps` und `unknownProjectProps` sind
getrennte semantische Sichten, aus denen der Quellgraph nicht rekonstruiert
wird. `collectionValid` kennzeichnet die strukturelle Listenform;
`writeAllowed` umfasst zusätzlich alle semantischen Diagnosen.
Dokumentgebundene Aufrufe tragen eine typisierte Position mit echten
Arrayindizes; Diagnosen erhalten dadurch RFC-6901-Pfade ohne
Wildcard-Literale.

Der paarübergreifende Validator für die Planungsproperties erhält die bereits
geprüften Reader-Ergebnisse eines `poam-item` und einer `remediation`. Er liest
die Rohlisten nicht erneut und erlegt dem Dokument keine globale Wahl zwischen
den beiden zulässigen Trägerarten auf. Katalog-Key und Commit entstehen im
Writer nur als atomares Paar; die generische Einzel-Property-API verweigert
beide Paarhälften.

## Root-Envelope und Root-Dispatch

Der Envelope kennt alle acht OSCAL-Root-Keys, und genau **eine** Stelle
bestimmt den Root-Typ (`dispatchOscalDocument()` in
`src/adapters/oscalRootDispatch.ts`).

### Envelope-Typen

```typescript
/** Gemeinsamer Anteil aller acht Roots: metadata ist überall Pflichtfeld. */
interface RawOscalRootBody {
  metadata: RawOscalMetadata;
}

/** Nur modellierte Roots tragen ihren eigenen Körpertyp. */
type RawOscalRootBodyFor<K extends OscalRootKey> =
  K extends 'catalog' ? RawOscalCatalog
    : K extends 'component-definition' ? RawOscalComponentDefinition
      : K extends 'profile' ? RawOscalProfile
        : K extends 'mapping-collection' ? RawOscalMappingCollection
          : RawOscalRootBody;

/** Genau ein Root-Key plus die zulässige Schema-Direktive. */
type RawOscalDocumentFor<K extends OscalRootKey> =
  { $schema?: string } & { [P in K]: RawOscalRootBodyFor<K> };

/** Diskriminierte Union über alle acht Root-Keys. */
type RawOscalDocument = { [K in OscalRootKey]: RawOscalDocumentFor<K> }[OscalRootKey];
```

`OscalRootKey` stammt aus der Versionsmatrix
(`src/domain/oscalVersionMatrix.mjs`, GSPP-283) und wird **nicht** dupliziert:
Eine zweite Liste der acht Root-Keys könnte von der Matrix abdriften.

Die strukturelle Regel dahinter steht in allen acht NIST-Schemas: `required`
enthält genau den Root-Key, `additionalProperties` ist `false`, und die
Top-Level-`properties` sind exakt `["$schema", "<root-key>"]`.

### Fehlerverhalten des Dispatch

`dispatchOscalDocument()` in `src/adapters/oscalRootDispatch.ts` implementiert
Stufe 2 des [Validierungsvertrags](OSCAL_VALIDATION.md). Er ist fail-closed:
im Zweifel ablehnen. Die Prüfreihenfolge ist festgelegt, damit ein Dokument
die inhaltlich engste Diagnose erhält.

| Reihenfolge | Fall | Code |
| --- | --- | --- |
| 1 | Top-Level ist kein JSON-Objekt (`null`, Array, String, Zahl) | `OSCAL_DOCUMENT_NOT_OBJECT` |
| 2 | kein Root-Key | `OSCAL_ROOT_KEY_MISSING` |
| 3 | mehrere Root-Keys, auch wenn einer `catalog` ist | `OSCAL_ROOT_KEY_AMBIGUOUS` |
| 4 | Root-Key gehört nicht zu den acht bekannten | `OSCAL_ROOT_TYPE_UNKNOWN` |
| 5 | Root widerspricht `getExpectedRootType()` des Quellregisters | `OSCAL_ROOT_TYPE_MISMATCH` |
| 6 | Root × Version über `resolveSchemaBinding()` | `OSCAL_VERSION_MISSING`, `OSCAL_VERSION_MALFORMED`, `OSCAL_ROOT_VERSION_IMPOSSIBLE`, `OSCAL_ROOT_VERSION_UNSUPPORTED`, `OSCAL_SCHEMA_DIRECTIVE_CONFLICT` |
| 7 | Root bekannt, aber kein Adapter registriert | `OSCAL_ROOT_TYPE_UNSUPPORTED` |

Die Codes aus Schritt 6 gehören der Versionsmatrix und werden unverändert
durchgereicht; der Dispatch enthält weder eigene Versionskonstante noch Kopie
der Matrixlogik. Schritt 4 und 7 sind unterscheidbar: „kenne ich nicht" ist
etwas anderes als „kenne ich, kann ich aber noch nicht verarbeiten".

`$schema` ist zulässig und zählt nicht als zweiter Root. Es ist niemals
Versionsautorität — allein `metadata.oscal-version` wählt die Matrixzelle,
`$schema` wird nur als Kreuzprobe ausgewertet.

Nicht Aufgabe des Dispatch: Stufe-1-Prüfungen wie Größenlimit oder doppelte
Member-Namen (auf einem `JSON.parse`-Ergebnis nicht mehr erkennbar) und die
Schema-Validierung selbst. Der Dispatch **wählt** den Schema-Pin aus,
**wendet** ihn nicht an.

### Kontext und Vertrauensklasse

```typescript
interface OscalDocumentContext {
  trustClass: TrustClass;    // ADR-2 §10 — entgegengenommen, nie vergeben
  upstreamPath?: string;     // Registry-Pfad: Root-Abgleich + Artefaktschlüssel
  catalogKey?: CatalogKey;   // ADR-1, nur für Katalogwurzeln
}
```

Der Dispatch führt die Vertrauensklasse unverändert mit und leitet sie **nie**
aus dem Dokument ab. Damit können nachgelagerte Stufen die Klasse-2-Gates nicht
umgehen.

### Diagnosen und Redaction

Jede Dispatch-Diagnose folgt dem Diagnostic-Vertrag aus
[OSCAL_VALIDATION.md](OSCAL_VALIDATION.md#diagnostic-vertrag), trägt
`stage: "root-dispatch"` und wird über `createOscalDiagnostic()` in
`src/domain/oscalDiagnostics.ts` aus einer Positivliste **konstruiert**, nicht
aus einem rohen Befund gefiltert.

Ein unbekannter Root-Key ist selbst unvertrauenswürdige Eingabe: Er erscheint
weder im Pfad noch im Artefaktkontext noch in den Parametern. Bei mehreren
Root-Keys wird nur ihre Anzahl genannt.

### Adapter-Registrierung: ein neues Modell erschließen

Die Registrierung steht in `src/adapters/oscalRootAdapters.ts`. Ein neues
Root-Modell erfordert zwei Schritte:

1. Modelladapter als eigene Datei unter `src/adapters/` anlegen, mit eigenem
   Testvertrag. Er bekommt den **Root-Körper** und den Kontext — nicht das
   Gesamtdokument und keine Zuständigkeit für die Root-Bestimmung. Braucht das
   Modell eine Identität, die nicht im Dokument steht, löst er sie aus Kontext
   oder Quellregister auf und bricht sonst ab.
2. Einen Eintrag in `OSCAL_ROOT_ADAPTERS` ergänzen und, falls der Körper
   modelliert wird, den Zweig in `RawOscalRootBodyFor` erweitern.

Modulgrenzen: Geteilt werden Envelope, Root-Erkennung, Versionsbindung und
Diagnosevertrag. Parsing und Read-Model-Ableitung bleiben je Root-Typ in
eigenen Modulen; `models.ts` wächst nicht zu einer monolithischen
Modellschicht.

| Root-Key | Layer | Adapter | Status |
| --- | --- | --- | --- |
| `catalog` | Control | `src/adapters/oscalAdapter.ts` | registriert |
| `profile` | Control | `src/adapters/oscalProfileAdapter.ts` | registriert |
| `mapping-collection` | Control | `src/adapters/oscalMappingAdapter.ts` | registriert |
| `component-definition` | Implementation | `src/adapters/oscalComponentAdapter.ts` | registriert |
| `system-security-plan` | Implementation | — | [GSPP-293](https://linear.app/grundschutz-plus-plus/issue/GSPP-293) |
| `assessment-plan` | Assessment | — | nicht erschlossen |
| `assessment-results` | Assessment | — | nicht erschlossen |
| `plan-of-action-and-milestones` | Assessment | — | nicht erschlossen |

## Profile (Control Layer)

| Datei | Rolle |
| --- | --- |
| `src/domain/oscalProfile.ts` | Raw-Typen, über `PinnedOscalVersion` parametrisiert |
| `src/domain/profileModel.ts` | Projektion (`Profile` und Teiltypen), ohne Logik |
| `src/adapters/oscalProfileReaders.ts` | Knotenleser und Diagnosesammler |
| `src/adapters/oscalProfileAdapter.ts` | Ableitung `deriveProfile(body, context)` |
| `src/adapters/oscalProfileDocument.ts` | Dokumenteinstieg mit Root-Dispatch und Übergang nach Stufe 3 |

### Ein Profile ist eine Anweisung, kein Katalog

Ein Profile importiert einen Catalog **oder ein weiteres Profile** und
beschreibt, welche Controls daraus ausgewählt, wie sie gruppiert und wie sie
geändert werden sollen. Erst die Profile Resolution macht daraus einen Catalog.

Dieser Slice liest die Anweisung und führt sie **nicht** aus. Kein Feld der
Projektion drückt ein aufgelöstes Control-Set aus; `Profile`,
`ProfileMerge` und `ProfileModify` tragen den eingefrorenen Marker
`PROFILE_RESOLUTION_STATE` mit `status: "not-resolved"` und dem Grund
`profile-resolution-out-of-scope`.

### Unterstützte Semantik

| Konstrukt | Abbildung |
| --- | --- |
| `imports[]` | `Profile.imports` in Quellreihenfolge, je Eintrag mit `href`, klassifizierter `reference`, `selection` und `excludeControls` |
| `include-all` | `selection.kind === 'include-all'` — die Anwesenheit des Schlüssels zählt, nicht sein Wert; das leere Objekt ist bedeutungstragend |
| `include-controls` | `selection.kind === 'include-controls'` mit den Selektoren |
| `exclude-controls` | `ProfileImport.excludeControls`, dieselbe Selektorform |
| `with-ids` | `ProfileControlSelector.withIds` |
| `matching` | `ProfileControlSelector.matching` — **getrennte** Liste, erhalten, aber nie ausgewertet |
| `with-child-controls` | `ProfileControlSelector.withChildControls`, beide Werte `yes` und `no` |
| `merge.flat` / `as-is` / `custom` | `ProfileMerge.structure` als diskriminierte Union; `as-is` trägt seinen Booleschen Wert mit |
| `merge.combine` | `ProfileMerge.combine.method`, unverändert übernommen |
| `custom.groups` / `insert-controls` | `ProfileCustomGrouping`, Gruppen rekursiv, `insert-controls.order` erhalten |
| `modify.set-parameters` | `ProfileModify.setParameters` |
| `modify.alters` | `ProfileModify.alters` als Liste plus `altersByControlId` als Gruppierung |
| `alters[].adds` | `ProfileAddition` mit allen vier Positionen `before`/`after`/`starting`/`ending` und rekursiven `parts` |
| `alters[].removes` | `ProfileRemoval` mit `by-name`, `by-class`, `by-id`, `by-item-name`, `by-ns` |

### Bewusst **nicht** unterstützt

* **Keine Profile Resolution.** Selektion, Merge und Modify werden erhalten und
  nicht angewandt; es entsteht kein aufgelöstes Control-Set
  ([GSPP-291](https://linear.app/grundschutz-plus-plus/issue/GSPP-291)).
* **Keine Auswertung von `matching`.** Glob-Muster werden erhalten, aber nicht
  gegen Control-IDs abgeglichen.
* **Keine Auflösung relativer oder externer Quellen.** Ein `import.href` wird
  klassifiziert, nicht geladen — kein Netz-, kein Dateizugriff.
* **Kein Profile Authoring und keine Persistenz**
  ([GSPP-292](https://linear.app/grundschutz-plus-plus/issue/GSPP-292)).
* **Keine UI** und keine Aussage über Vollständigkeit oder Konformität eines
  Profils jenseits des geprüften Umfangs.

### Zwei Kanten bis zur Quelldatei

Im BSI-Bestand ist **jedes** `import.href` ein dokumentinternes
`#uuid`-Fragment auf eine `back-matter`-Ressource. Der relative Pfad liegt eine
Kante weiter, in `back-matter.resources[].rlinks[].href`.

Die Referenz wird als `kind: 'resource'` aufgelöst, während ihr `rlink` das
Ergebnis `relative` behält.

Clientseitig gibt es keinen Verzeichniskontext: `../catalogs/…`, `foo.json`
und `../../etc/passwd` erhalten **dasselbe** Ergebnis `relative`. Es gibt keine
Pfadnormalisierung und keine Traversal-Sonderbehandlung, und der Adapter
verzweigt nirgends selbst auf die Form eines `href`
(`oscalProfileAdapter.boundaries.node.test.ts`).

### Versionsdrift ist beim Profile strukturell

Alle drei registrierten Profile deklarieren `1.1.3`. Eine
Profile-Versionskonstante gibt es nicht; die vendorierten Schemas unterscheiden
sich messbar:

| Konstrukt | 1.1.2 / 1.1.3 | 1.2.1 / 1.2.2 |
| --- | --- | --- |
| `import.href` | Pflichtfeld | optional |
| `import`-Selektion | `include-all` und `include-controls` dürfen koexistieren oder fehlen | `anyOf`: **genau eine** der beiden |
| `merge` | `combine`, `flat`, `as-is`, `custom` alle optional und koexistierbar | `anyOf`: genau eine Direktive, optional mit `combine` |
| `insert-controls` | gewöhnliches Objekt | `anyOf` wie bei `import` |
| `matching.remarks` | nicht deklariert | deklariert |

**Derselbe** `import` mit beiden Selektionsformen ist unter 1.1.3 schemavalide
und ab 1.2.1 ein Befund; ein `import` ohne `href` genau umgekehrt. Die
Feldprädikate in `src/domain/oscalProfile.ts` hängen über
`oscalProfile.versionDrift.test.ts` am Schema.

### Modellinterne Diagnosen

Stufe `domain`, Validator `gspp-profile-adapter`. Sie verwerfen ein Dokument
nie; verworfen wird ausschließlich vorher, im Root-Dispatch.

| Code | Anlass |
| --- | --- |
| `OSCAL_PROFILE_IMPORTS_MISSING` | `imports` fehlt oder ist leer |
| `OSCAL_PROFILE_IMPORT_HREF_MISSING` | `import` ohne `href` — die zu tailorende Quelle ist nicht benannt |
| `OSCAL_PROFILE_SELECTION_AMBIGUOUS` | `include-all` **und** `include-controls` am selben Knoten |
| `OSCAL_PROFILE_SELECTION_MISSING` | weder `include-all` noch `include-controls` am selben Knoten |
| `OSCAL_PROFILE_MERGE_STRUCTURE_AMBIGUOUS` | mehr als eine Strukturdirektive in `merge` |
| `OSCAL_PROFILE_MERGE_STRUCTURE_MISSING` | `merge` ohne `flat`, `as-is` oder `custom` |
| `OSCAL_PROFILE_ALTER_CONTROL_ID_MISSING` | `alter` ohne `control-id` |
| `OSCAL_PROFILE_STRUCTURE_UNEXPECTED` | Knoten hat nicht die erwartete Form, etwa Objekt statt Array |

Die vier mit `AMBIGUOUS`/`MISSING` benannten Befunde sind **Modell**aussagen:
Ob derselbe Knoten schemawidrig ist, hängt an der deklarierten Version und
entscheidet Stufe 3. Der Knoten bleibt in beiden Fällen verlustfrei in der
Projektion — ein mehrdeutiger `import` behält seine Selektoren, ein `alter`
ohne `control-id` bleibt in `alters` stehen und fehlt nur in der Gruppierung.

### Mehrfache `alter`-Einträge auf derselben `control-id`

Das WLAN-Profil trägt am Snapshot 290 `alters` über 58 eindeutige `control-id`,
bis zu fünf Einträge je Control. `ProfileModify.alters` ist eine Liste in
Quellreihenfolge, und `altersByControlId` bildet auf **Listen** ab; ein
`Map.set()` je `control-id` verlöre dort den Großteil der Anweisungen.

### Testkorpus

Die drei realen Profile liegen nicht im Repository: `npm run fetch-catalog`
materialisiert ausschließlich `supported`-Artefakte, und alle drei sind
`preview`. Verbindlich ist der eingefrorene Fixture-Korpus in
`src/test/fixtures/profiles.ts` mit den am Snapshot
`80694713a7a430d12eb2099893de23ad8bb6f780` gemessenen Strukturen. Die im
BSI-Bestand nicht vorkommenden, normativ vorhandenen Fälle — `matching`,
`merge: flat`, `combine`, `insert-controls.order`, die Positionen `before`,
`after` und `ending`, `exclude-controls`, `import` ohne `href` — stehen als
ergänzende synthetische Fixtures daneben.

Der Realkorpus ist optional: `oscalProfileDocument.node.test.ts` läuft nur, wenn
`GSPP_PROFILE_CORPUS_PATH` auf ein lokal geholtes Verzeichnis zeigt, und wird
sonst übersprungen. Er prüft Erhaltung und die Byte-Identität gegen
`contentSha256` aus `upstream-manifest.json`, nie feste Inhaltszahlen.

## Mapping Collections (Control Layer)

| Datei | Rolle |
| --- | --- |
| `src/domain/oscalMapping.ts` | Raw-Typen, bewusst **nicht** versionsparametrisiert |
| `src/domain/mappingModel.ts` | Projektion (`MappingCollection` und Teiltypen) plus Vokabulare |
| `src/adapters/oscalMappingReaders.ts` | Knotenleser, Vokabularbindung und Diagnosesammler |
| `src/adapters/oscalMappingAdapter.ts` | Ableitung `deriveMappingCollection(body, context)` |
| `src/adapters/oscalMappingDocument.ts` | Dokumenteinstieg mit Root-Dispatch und Übergang nach Stufe 3 |

### Ein Mapping ist ein Crosswalk, keine Aussage über Compliance

Eine Mapping Collection beschreibt Beziehungen zwischen Controls oder
Control-Statements **zweier autoritativer Quellen**. Sie ist kein Bestandteil
der Import-Kette Catalog → Profile → SSP: Kein anderes OSCAL-Modell importiert
sie. Sie benennt ihre beiden Seiten über `source-resource` und
`target-resource`.

Der Navigator liest diese Beziehungen und macht sie navigierbar. Aus einem
Mapping folgt keine Compliance-, Audit- oder Zertifizierungsaussage.

### Die Lücke ist eine Aussage, kein fehlender Eintrag

Grund für `MappingCoverageState`:

| Zustand | Bedeutung | Grundlage |
| --- | --- | --- |
| `mapped` | Es besteht eine Beziehung | mindestens ein `map` mit einem Beziehungstyp ungleich `no-relationship` |
| `explicit-gap` | Es besteht **ausdrücklich keine** Beziehung | `map` mit `relationship: "no-relationship"` **oder** namentliche Aufzählung in der Gap-Summary der Seite |
| `unknown` | Es wurde nichts ausgesagt | kein `map`-Eintrag zu dieser `id-ref` — oder nur einer mit unlesbarem Beziehungstyp |

Einen vierten Zustand „nicht abgedeckt" gibt es nicht. Abgefragt wird die
Abdeckung über `coverageForSourceIdRef(mapping, idRef)` und
`coverageForTargetIdRef(…)`; ein `map.get(id) ?? 'nicht-abgedeckt'` an der
Aufrufstelle entfällt damit. Ein Eintrag mit **unbekanntem** Beziehungstyp
zählt nicht als Abdeckung.

Die Lücke hat **zwei** Ausdrucksformen, und beide gehen in die Abfrage ein: der
`map` mit `no-relationship` und die Gap-Summary der jeweiligen Seite, die nach
Schema „all controls that were not mapped at all" aufzählt. Aus ihr zählen
ausschließlich die namentlich genannten `with-ids` (`sourceGapIdRefs`,
`targetGapIdRefs`); ein `matching`-Muster bleibt erhalten, verändert aber keine
Abdeckungsaussage, weil dieser Slice keinen Glob auswertet. Führt ein
Dokument dieselbe ID zugleich als abgebildet und als ungemappt, gewinnt die
konkrete Beziehung.

Die Indizes `mapsBySourceIdRef` und `mapsByTargetIdRef` hängen am einzelnen
Mapping Set, nicht an der Sammlung: Zwei Sets können verschiedene
Quellkataloge mit gleichlautenden IDs haben.

### Das vollständige Beziehungsvokabular

| Wert | Bedeutung | Umkehrung |
| --- | --- | --- |
| `equivalent-to` | inhaltlich gleichwertig, nicht wortgleich | symmetrisch |
| `equal-to` | gleich bis auf Schreibweise | symmetrisch |
| `subset-of` | Quelle ist Teilmenge des Ziels | `superset-of` |
| `superset-of` | Quelle ist Obermenge des Ziels | `subset-of` |
| `intersects-with` | teilweise Überschneidung | symmetrisch |
| `no-relationship` | ausdrücklich keine Beziehung | symmetrisch |

Keiner dieser Werte wird zu einem generischen `related` zusammengefasst.

### Feldweise unterschiedliche Prüftiefe

Das JSON-Schema prüft je Feld unterschiedlich viel. Dieser Adapter bringt als
einziger eine eigene Vokabularprüfung mit:

| Feld | JSON-Schema | Wer prüft |
| --- | --- | --- |
| `map/relationship` | `TokenDatatype`, **kein** Enum | **allein** der Adapter (`OSCAL_MAPPING_RELATIONSHIP_INVALID`) |
| `mapping-resource-reference/type` | `anyOf` mit freiem Datentyp (`allow-other="yes"`) | **allein** der Adapter (`OSCAL_MAPPING_RESOURCE_TYPE_INVALID`) |
| `mapping-item/type` | `allOf` mit Enum `control`/`statement` | Schema und Adapter |
| `method`, `status`, `matching-rationale` | `allOf` mit Enum | Schema und Adapter |
| `qualifier/subject`, `/predicate`, `/category` | `allOf` mit Enum | Schema und Adapter |

Der Grund steht im Metaschema: Die `allowed-values` von `relationship` tragen
das Ziel `.[has-oscal-namespace('…')]` und werden deshalb nicht in das
JSON-Schema übernommen. Ein erfundenes `relationship: "maps-to"` ist damit
schemavalide.

Dieselbe Namensraumbindung wird im Modell **positiv** abgebildet: Ein `ns`, der
einen fremden Namensraum benennt, hebt die Vokabularbindung auf. Der Wert wird
dann als `extension` geführt statt als Befund. Fehlt `ns`, gilt laut
Metaschema der OSCAL-Namensraum, und das Vokabular bindet. Bei
`mapping-resource-reference/type` ist der Adapter damit **strenger** als
`allow-other="yes"`: Ein unbekannter Typ ohne fremden `ns` ist hier fail-closed
ein Befund.

### Unterstützte Semantik

| Konstrukt | Abbildung |
| --- | --- |
| `mappings` als Objekt **oder** Liste | `MappingCollection.mappings` immer als Liste, die Quellform in `declaredMappingsForm` |
| `provenance` | `MappingCollection.provenance` — Pflichtfeld; fehlt es, steht das in `diagnostics` |
| `mapping` | `Mapping` je Set mit `method`, `matchingRationale`, `status`, beiden Ressourcen und `maps` |
| `source-resource` / `target-resource` | `MappingResourceReference` mit klassifizierter `reference` (GSPP-286) |
| `map` | `MappingEntry` mit Beziehungsbindung, `ns`, `sources`, `targets` in Quellreihenfolge |
| `mapping-item` | `MappingItem` mit `type`, `idRef`, `props`, `links`, `remarks` |
| `qualifiers` | `MappingQualifier` mit allen drei gebundenen Vokabularen und der Beschreibung |
| `confidence-score` | `MappingConfidenceScore` — Kategorie **oder** Prozentwert |
| `coverage` | `MappingCoverage` mit `generationMethod` und `targetCoverage` |
| `source-gap-summary` / `target-gap-summary` | `MappingGapSummary` mit den Selektoren der ungemappten Controls |

### Bewusst **nicht** unterstützt

* **Keine Auflösung der Ressourcenreferenzen gegen die Gegenseite.** Alle sechs
  `href` des Bestands sind relative Dateinamen. Relative Referenzen werden
  **nie** aufgelöst: kein Verzeichniskontext, keine Pfadnormalisierung, keine
  Traversal-Sonderbehandlung.
* **Keine Deutung einer `id-ref` ohne Ressourcenkontext.** Jedes Item trägt den
  Marker `MAPPING_ID_REF_UNRESOLVED`; je Mapping-Seite benennt eine Diagnose den
  Grund.
* **Keine Crosswalk-UI.**
* **Kein Erzeugen und kein Bearbeiten** von Mappings; rein lesend.
* **Keine Umkehrnavigation als Modelloperation.** Die Umkehrbarkeit der
  Beziehungstypen ist oben dokumentiert, wird aber nicht automatisch als
  zusätzliche Kante materialisiert.
* **Keine Auflösung der Geltungsbereiche.** `method`, `matching-rationale`,
  `status`, `confidence-score` und `coverage` sind gestuft: Die `provenance`
  setzt sie global, `mapping` und `map` überschreiben sie lokal. Alle Ebenen
  bleiben getrennt erhalten; das Modell rechnet daraus **keinen** effektiven
  Wert aus. Der einzige abgeleitete Wert dieses Modells ist die Abdeckung.

### Keine Versionsdrift — gemessen, nicht angenommen

`mapping-collection` existiert erst ab OSCAL 1.2.0; gepinnt sind genau
zwei Zellen. Deren vendorierte Schemas sind bis auf ihre `$id`
**definitionsgleich** — die Raw-Typen sind als einzige der drei
erschlossenen Modelle nicht über `PinnedOscalVersion` parametrisiert.

Das hängt an `oscalMapping.versionDrift.test.ts`: Er vergleicht alle
Definitionen beider gepinnter Schemas, prüft die Modellexistenz gegen
`isImpossibleCombination()` und misst die Prüftiefe je Feld. Eine
Mapping-Versionskonstante gibt es nicht — die beiden BSI-Artefakte deklarieren
**verschiedene** Versionen (1.2.2 und 1.2.1), und jedes wird gegen seine eigene
geprüft.

### Modellinterne Diagnosen

Stufe `domain`, Validator `gspp-mapping-adapter`. Sie verwerfen ein Dokument
nie; verworfen wird ausschließlich vorher, im Root-Dispatch.

| Code | Anlass |
| --- | --- |
| `OSCAL_MAPPING_MAPPINGS_MISSING` | `mappings` fehlt, ist leer oder hat weder Objekt- noch Arrayform |
| `OSCAL_MAPPING_PROVENANCE_MISSING` | `provenance` fehlt — sie ist Pflichtfeld, kein Extra |
| `OSCAL_MAPPING_MAPS_MISSING` | `mapping` ohne `maps` |
| `OSCAL_MAPPING_RESOURCE_MISSING` | eine Seite des Mappings ist unbenannt |
| `OSCAL_MAPPING_RESOURCE_HREF_MISSING` | Ressourcenreferenz ohne `href` |
| `OSCAL_MAPPING_RESOURCE_TYPE_INVALID` | Ressourcentyp fehlt oder liegt außerhalb von `catalog`/`profile` |
| `OSCAL_MAPPING_RELATIONSHIP_MISSING` | `map` ohne `relationship` |
| `OSCAL_MAPPING_RELATIONSHIP_INVALID` | Beziehungstyp außerhalb des Vokabulars im OSCAL-Namensraum |
| `OSCAL_MAPPING_ITEM_TYPE_INVALID` | `mapping-item/type` außerhalb von `control`/`statement` |
| `OSCAL_MAPPING_ITEM_ID_REF_MISSING` | `mapping-item` ohne `id-ref` |
| `OSCAL_MAPPING_ITEM_SET_EMPTY` | `sources` oder `targets` fehlt oder ist leer |
| `OSCAL_MAPPING_ID_REF_CONTEXT_UNRESOLVED` | Ressourcenkontext einer Seite nicht aufgelöst; ihre `id-ref` bleiben uninterpretiert |
| `OSCAL_MAPPING_METHOD_INVALID` | `method` außerhalb ihres Vokabulars |
| `OSCAL_MAPPING_STATUS_INVALID` | `status` außerhalb des fünfwertigen Dokumentstatus |
| `OSCAL_MAPPING_MATCHING_RATIONALE_INVALID` | `matching-rationale` außerhalb ihres Vokabulars |
| `OSCAL_MAPPING_QUALIFIER_VALUE_INVALID` | `qualifier`-Wert außerhalb seines Vokabulars; der Pfad nennt das Feld |
| `OSCAL_MAPPING_UUID_MISSING` | `mapping` oder `map` ohne `uuid` |
| `OSCAL_MAPPING_UUID_DUPLICATE` | dieselbe `uuid` an mehr als einer Stelle; der Befund hängt am **zweiten** Fundort |
| `OSCAL_MAPPING_STRUCTURE_UNEXPECTED` | Knoten hat nicht die erwartete Form, etwa Objekt statt Array |

`ID_REF_CONTEXT_UNRESOLVED` entsteht **je Mapping-Seite**, nicht je `id-ref`.
Der Zustand jeder einzelnen `id-ref` steht am Item.

### ADR-7 am realen Bestand

`mapping-iso27001-annex-a-zu-gspp` steht im Quellregister auf
`lifecycle: 'blocked-by-upstream'` und ist gegen sein gepinntes Schema
**invalide**: `provenance` trägt mit `qa-reviewed` und `qa-note` zwei Felder,
die `additionalProperties: false` verletzt.

Der Adapter parst es trotzdem verlustfrei und diagnostiziert die Verletzung
([ADR-7](https://linear.app/grundschutz-plus-plus/issue/ADR-7)); die Sperrung
betrifft die Auslieferung, nicht das Parsen.

### Testkorpus

Die beiden realen Mappings liegen nicht im Repository: `npm run fetch-catalog`
materialisiert ausschließlich `supported`-Artefakte, und die beiden sind
`preview` beziehungsweise `blocked-by-upstream`. Verbindlich ist der
eingefrorene Fixture-Korpus in `src/test/fixtures/mappings.ts` mit den am
Snapshot `80694713a7a430d12eb2099893de23ad8bb6f780` gemessenen Strukturen: 2
Mapping Sets je Artefakt, 96 beziehungsweise 1185 `maps`, die gemessene
Verteilung der fünf vorkommenden Beziehungstypen, bis zu zehn `targets` je
Eintrag, die sechs relativen `href`, das Top-Level-`$schema` des ITGS-Mappings
und die beiden schemafremden `provenance`-Felder des ISO-Mappings.

Die normativ vorhandenen, im Bestand fehlenden Fälle stehen als ergänzende
synthetische Fixtures daneben: `no-relationship`, `mapping-item.type:
"statement"`, echtes m:n mit mehreren `sources`, `qualifiers`,
`confidence-score`, `coverage`, beide Gap-Summaries, `matching-rationale` auf
`map`-Ebene, `mapping-resource-reference.type: "profile"` und die Einzelform
von `mappings`.

Der Realkorpus ist optional: `oscalMappingDocument.node.test.ts` läuft nur, wenn
`GSPP_MAPPING_CORPUS_PATH` auf ein lokal geholtes Verzeichnis zeigt, und wird
sonst übersprungen. Er prüft Erhaltung und die Byte-Identität gegen
`contentSha256` aus `upstream-manifest.json`, nie feste Inhaltszahlen.

## Component Definitions (Implementation Layer)

Das zweite erschlossene Root-Modell.

| Datei | Rolle |
| --- | --- |
| `src/domain/oscalComponentDefinition.ts` | Raw-Typen, über `PinnedOscalVersion` parametrisiert |
| `src/domain/componentDefinitionModel.ts` | Projektion (`ComponentDefinition` und Teiltypen), ohne Logik |
| `src/adapters/oscalComponentReaders.ts` | Knotenleser und Diagnosesammler |
| `src/adapters/oscalComponentAdapter.ts` | Ableitung `derive(body, context)` |
| `src/adapters/oscalComponentDocument.ts` | Dokumenteinstieg mit Root-Dispatch und Übergang nach Stufe 3 |

### Implementierungsbehauptung ≠ nachgewiesene Compliance

Eine `implemented-requirement` dokumentiert, dass eine Komponente eine
Kontrolle **nach Aussage der Definition** umsetzt. Sie ist kein geprüfter
Compliance-, Audit- oder Zertifizierungsstatus. Der Navigator liest diese
Aussagen und macht sie navigierbar — er bewertet sie nicht.

Der fachliche Nutzen ist Navigierbarkeit („welche Kontrollen adressiert
Komponente X", „welche Komponenten adressieren Kontrolle Y"). Nach NIST sind
Component Definitions dafür gedacht, dass ihre Inhalte in einen SSP übernommen
werden; eine Import-Kante SSP → Component Definition gibt es dabei **nicht** —
der SSP importiert ausschließlich ein Profile (`import-profile`, required).

### Versionsspreizung im Bestand

Die sechs registrierten BSI-Definitionen deklarieren **zwei** verschiedene
OSCAL-Versionen. Es gibt keine
Component-Definition-Versionskonstante: Die Zelle wählt allein
`metadata.oscal-version` über den Root-Dispatch.

| Deklarierte Version | Artefakte |
| --- | --- |
| 1.1.2 | `component-ga-lotse-grundmodul`, `component-lieferkette`, `component-passwortrichtlinie` |
| 1.2.2 | `component-aws-security-hub`, `component-keycloak`, `component-netzarchitektur` |

Zwischen den vier gepinnten Schemas unterscheiden sich drei parserrelevante
Felder. Sie sind als Feldprädikate in `oscalComponentDefinition.ts` abgebildet
und hängen über `oscalComponentDefinition.versionDrift.test.ts` am vendorierten
Schema:

| Feld | Unterschied |
| --- | --- |
| `import-component-definition.remarks` | erst ab 1.2.1 deklariert; in 1.1.2/1.1.3 verletzt es `additionalProperties: false` |
| `port-range.remarks` | erst ab 1.2.1 deklariert |
| `protocol.name` | nur in 1.1.2 Pflichtfeld |

Der erste Unterschied ist zugleich der Sperrgrund von
`component-ga-lotse-grundmodul` nach
[ADR-7](https://linear.app/grundschutz-plus-plus/issue/ADR-7)
([BSI #70](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/70)):
Dasselbe Feld ist je nach deklarierter Version gültig oder schemawidrig.

### Zwei Muster für `control-implementation.source`

`source` ist Pflichtfeld und die Kante des Implementation Layers in den
Control Layer. Sie hängt an **jeder** Implementierung. Im Bestand kommen zwei
Muster vor:

| Muster | Vorkommen | Klassifikation |
| --- | --- | --- |
| `#uuid` auf eine back-matter-Ressource desselben Dokuments | Keycloak, Lieferkette, Netzarchitektur, Passwortrichtlinie | `resource` |
| absolute HTTPS-URL | AWS Security Hub | `external`, wird nie aufgelöst |

Die AWS-URL zeigt auf den Branch `main` statt auf einen gepinnten
Commit und ist damit nicht versionsstabil. Klassifiziert wird sie ausschließlich
über `src/domain/referenceResolution.ts`; der Adapter verzweigt an keiner
Stelle selbst auf die Form eines `href` und lädt nichts nach.

**Ein Dokument kann mehrere Quellen führen.** `component-netzarchitektur` trägt
zwei verschiedene `#uuid`-Quellen. `ComponentDefinition.implementationsBySource`
hält sie getrennt.

`implemented-requirement.control-id` ist eine Control-ID **im Kontext ihrer**
`source`. Aufgelöst wird sie nur, wenn der Aufrufer über `catalogsBySource`
einen Zielkatalog zu genau diesem `source`-Wert bereitstellt. Ohne diese
Bindung bleibt sie `unresolved` mit einer Diagnose — die 17 `control-id`-
Referenzen der AWS-Definition zeigen auf einen nicht registrierten
Kernel-G0-Katalog und bleiben in diesem Zustand, ohne dass die Definition
verworfen wird.

### Verlustfreiheit gilt auch für schemawidrige Dokumente

Der Adapter repariert nichts: `component-lieferkette` schreibt an drei
Stellen `implemented-requirement.links` als **Einzelobjekt** statt als Array
([BSI #71](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/71)).
Das Objekt bleibt im Quellgraphen unverändert stehen; die Verletzung erscheint
als Diagnose — aus Stufe 3 als Schemabefund und aus dem Adapter als
struktureller Befund mit exaktem JSON Pointer.

Beide nach ADR-7 gesperrten Definitionen werden vollständig geparst: Die
Sperrung betrifft die **Auslieferung**, nicht das Parsen.

### Modellinterne Diagnosen

Stufe `domain`, Validator `gspp-component-adapter`. Sie verwerfen ein Dokument
nie; verworfen wird ausschließlich vorher, im Root-Dispatch.

| Code | Anlass |
| --- | --- |
| `OSCAL_COMPONENT_DUPLICATE_UUID` | Component-, Capability- oder implemented-requirement-`uuid` dokumentweit doppelt |
| `OSCAL_COMPONENT_IMPLEMENTATION_SOURCE_MISSING` | `control-implementation` ohne `source` |
| `OSCAL_COMPONENT_CONTROL_ID_MISSING` | `implemented-requirement` ohne `control-id` |
| `OSCAL_COMPONENT_CONTROL_REFERENCE_UNRESOLVED` | `control-id` im Kontext ihrer `source` nicht auflösbar |
| `OSCAL_COMPONENT_STRUCTURE_UNEXPECTED` | Knoten hat nicht die erwartete Form, etwa Objekt statt Array |

Die Leser diagnostizieren einen **vorhandenen** Wert der falschen Form, statt
ihn still zu `[]` zu machen.

### Testkorpus

Die sechs realen Definitionen liegen nicht im Repository: `npm run fetch-catalog`
materialisiert ausschließlich `supported`-Artefakte, und alle sechs sind
`preview` oder `blocked-by-upstream`. Verbindlich ist der eingefrorene
Fixture-Korpus in `src/test/fixtures/componentDefinitions.ts` mit den am
Snapshot `80694713a7a430d12eb2099893de23ad8bb6f780` gemessenen Strukturzahlen —
in Summe 35 Components, 10 Capabilities, 35 Control-Implementations und 307
implemented requirements.

Der Realkorpus ist optional: `oscalComponentDocument.node.test.ts` läuft nur,
wenn `GSPP_COMPONENT_CORPUS_PATH` auf ein lokal geholtes Verzeichnis zeigt, und
wird sonst übersprungen. Er prüft Erhaltung und die Byte-Identität gegen
`contentSha256` aus `upstream-manifest.json`, nie feste Inhaltszahlen.

## Enriched Domain Types

Die angereicherten Typen befinden sich ebenfalls in `src/domain/models.ts` und bieten eine flache, typsichere Repräsentation:

### Sicherheitsniveau

```typescript
type SecurityLevel = 'normal-SdT' | 'erhöht';
```

### Aufwandsstufe

```typescript
type EffortLevel = '0' | '1' | '2' | '3' | '4' | '5';
```

### Schutzziel-Relevanz

Relevanz einer Steuerung für ein Schutzziel (Vertraulichkeit, Integrität, Verfügbarkeit, Authentizität), Skala 0–2:

```typescript
type SecurityTargetRelevance = '0' | '1' | '2';
```

An den Schutzzielen hängen zwei getrennte BSI-Vokabulare. Der `ns` der vier `*Prop`-Felder zeigt auf `security_targets.csv`; dort steht, was Vertraulichkeit, Integrität, Verfügbarkeit und Authentizität bedeuten — das Vokabular ist nach Schutzziel-Namen indiziert und kennt die Werte `0`–`2` nicht. Deren Bedeutung steht in der separaten Datei `security_targets_levels.csv`, die über `prop.ns` nicht erreichbar ist; `resolveSecurityTargetLevel()` in `src/domain/vocabulary.ts` wählt sie deshalb selbst aus.

### Modalverb

```typescript
type Modalverb = 'MUSS' | 'SOLLTE' | 'KANN';
```

### ControlLink

```typescript
type LinkRelation = 'related' | 'required';

/** Klassifikation des vorgefundenen `rel`-Werts. */
type LinkRelationStatus = 'documented' | 'custom' | 'missing';

interface ControlLink {
  targetId: string;
  href: string;
  rel?: string;
  relStatus: LinkRelationStatus;
  resourceFragment?: string;
}
```

`rel` ist der unveränderte OSCAL-`rel`-Wert; `relStatus` klassifiziert ihn
(`classifyCatalogLinkRelation` in `src/domain/referenceResolution.ts`):
`reference` → `documented`, fehlendes `rel` → `missing`, jeder andere Wert →
`custom`. Filterbar sind nur `required` und `related`
(`toFilterableLinkRelation` in `src/domain/controlRelationships.ts`).
`Control.links` enthält ausschließlich aufgelöste, kataloggescopte
Control-Ziele; der Adapter setzt `links: []`, die Projektion in
`catalogReferenceProjection.ts` füllt sie vor Veröffentlichung.

### PropValue

```typescript
interface PropValue {
  name: string;
  value: string;
  ns?: string;
}
```

### Control (Haupttyp)

```typescript
interface Control {
  id: string;                    // e.g. "GC.1.1"
  parentId?: string;             // e.g. "GC.5.1" for "GC.5.1.1"
  title: string;
  altIdentifier?: string;        // kanonischer Control-Identifier für URLs
  controlClass?: string;         // OSCAL control.class, e.g. "BSI-Methodik-Grundschutz-plus-plus"

  groupId?: string;              // e.g. "GC.1" (Topic); fehlt ohne Gruppen-id
  practiceId?: string;           // e.g. "GC" (Practice); fehlt ohne Gruppen-id

  securityLevel?: SecurityLevel;
  securityLevelProp?: PropValue;
  effortLevel?: EffortLevel;
  effortLevelProp?: PropValue;
  modalverb?: Modalverb;
  modalverbProp?: PropValue;

  tags: string[];
  tagsProp?: PropValue;

  // Geordnete WLAN-Taxonomie-Props (Taxonomy-L1 bis Taxonomy-L4)
  taxonomy: PropValue[];

  // Schutzziele (CIA + Authentizität), Relevanz 0–2
  confidentiality?: SecurityTargetRelevance;
  confidentialityProp?: PropValue;  // ns → security_targets.csv
  integrity?: SecurityTargetRelevance;
  integrityProp?: PropValue;        // ns → security_targets.csv
  availability?: SecurityTargetRelevance;
  availabilityProp?: PropValue;     // ns → security_targets.csv
  authenticity?: SecurityTargetRelevance;
  authenticityProp?: PropValue;     // ns → security_targets.csv

  // Elementare Gefährdungen (z.B. "G 0.14"), aus kommaseparierter Prop geparst
  threats: string[];
  threatsProp?: PropValue;

  statement: string;             // Resolved prose
  statementRaw: string;          // With {{ insert: param }} placeholders
  guidance: string;

  statementProps: {
    ergebnis?: string;
    ergebnisProp?: PropValue;
    praezisierung?: string;
    praezisierungProp?: PropValue;
    handlungsworte?: string;
    handlungsworteProp?: PropValue;
    dokumentation?: string;
    dokumentationProp?: PropValue;
    zielobjektKategorien: string[];
    zielobjektKategorienProp?: PropValue;
  };

  links: ControlLink[];
  params: Record<string, ParamMeta>;  // Wert und Herkunft des Inline-Parameters
}
```

```typescript
interface ParamMeta {
  readonly value: string;      // Aufgelöster Wert oder Fallback aus label
  readonly hasValue: boolean;  // true nur bei einem gesetzten OSCAL-values[0]
}
```

`buildParamMap()` bewahrt diese Unterscheidung für die Darstellung von Platzhaltern. `paramValues()` liefert die bisherige String-Sicht an `resolveParams()`; der aufgelöste `statement`-Text bleibt dadurch derselbe und steht Suche und Export weiterhin zur Verfügung. `segmentStatement()` zerlegt `statementRaw` und `params` in geordnete Satzteile für die Detailansicht, ohne den gespeicherten oder exportierten Anforderungstext zu verändern. Fehlt ein Parameterwert, zeigt der Satz weiter den Label-Fallback und erklärt ihn am Platzhalter. Liegt der Wert eines Platzhalters ganz in Ergebnis oder Präzisierung, nennt `SentenceSegment.partOf` diesen Satzteil. Sonst bleibt `partOf` leer: Satzteile, die ganz im Wert liegen, erscheinen in `missing`, und bei nur teilweiser Überlappung bleibt der Textteil des Satzteils beschriftet, der Platzhalter nicht. `missing` enthält außerdem Anker, die ein früherer Satzteil verdeckt.

Die `*Prop`-Felder behalten den OSCAL-Namespace (`ns`) der Quell-Prop und ermöglichen so die Auflösung gegen die offiziellen BSI-Vokabulare (siehe [VOCABULARY.md](./VOCABULARY.md)).

### Optionale Gruppen-Identifikatoren

`group.id` ist in OSCAL 1.1.3 optional — `group` verlangt ausschließlich
`title`. `Topic.id`, `Practice.id`, `Control.groupId` und `Control.practiceId`
sind deshalb optional.

Eine Gruppe ohne `id` ist **nicht referenzierbar**. Sie bleibt vollständig
sichtbar, erzeugt aber weder Route noch Anker, und ein aktiver Gruppen- oder
Praktik-Filter trifft sie nie. Es wird kein Ersatzbezeichner erfunden; `label`
fällt auf die `id` und danach auf den `title` zurück. Die Controls einer
solchen Gruppe bleiben über ihren kanonischen `altIdentifier` adressierbar.

Zwei Fehlerbedingungen fängt der Code ausdrücklich ab: ein Lookup der Form
`practice.id === control.practiceId` erzeugte bei beidseitiger Abwesenheit über
`undefined === undefined` eine **falsche** Zuordnung
(`src/features/catalog/ControlDetail.tsx`), und ein React-`key` aus der
Gruppen-`id` wäre bei mehreren id-losen Geschwistern nicht eindeutig
(`src/components/TreeNav.tsx`).

Im ausgelieferten Bestand tritt der Fall derzeit nicht auf: alle 30 Gruppen des
Lieferkettenkatalogs und alle Gruppen des Grundschutz++-Katalogs tragen eine
`id`. Die Abdeckung liegt in synthetischen Fixtures
(`src/adapters/oscalDocument.catalogEdgeCases.test.ts`).

**Controls am Katalog-Root**: `catalog.controls` steht im Schema
gleichberechtigt neben `groups`; solche Controls gehören zu keiner Gruppe.
`parseCatalog` projiziert sie mit `groupId: undefined` und
`practiceId: undefined` in `catalog.controls`, `controlsById` und
`controlsByAltIdentifier`; die Referenzauflösung besucht sie über denselben
Zweig. Der Empty State greift nur, wenn `groups` **und** `controls` fehlen.

### Topic (Thema)

```typescript
interface Topic {
  id?: string;             // e.g. "GC.1"; fehlt, wenn die Quellgruppe keine id trägt
  title: string;
  label: string;           // e.g. "1"; fällt ohne label-Prop auf id, dann Titel zurück
  altIdentifier?: string;
  practiceId?: string;
  controlCount: number;
  controlIds: string[];
}
```

### Practice (Praktik)

```typescript
interface Practice {
  id?: string;             // e.g. "GC"; fehlt, wenn die Quellgruppe keine id trägt
  title: string;
  label: string;           // e.g. "GC"
  altIdentifier?: string;
  topics: Topic[];
  controlCount: number;
}
```

### Catalog (Haupttyp)

```typescript
interface Catalog {
  catalogKey: CatalogKey;                   // e.g. "gspp"
  uuid: string;
  metadata: CatalogMetadataInfo;
  practices: Practice[];
  controlsById: Map<string, Control>;       // interne OSCAL-Referenzen
  controlsByAltIdentifier: Map<string, Control>; // kanonische URL-Auflösung
  controls: Control[];
  backMatter: CatalogResource[];
  totalControls: number;
}
```

`controlsByAltIdentifier` ist katalogintern vollständig und eindeutig. Der Parser lehnt Kontrollen mit fehlendem oder im selben Katalog doppeltem Alt-Identifier als Integritätsfehler ab. Derselbe Alt-Identifier darf in verschiedenen Katalogen vorkommen, weil die kanonische URL-Identität immer aus `catalogKey + altIdentifier` besteht.

#### Warum jede Identität den `catalogKey` mitführt

Das OSCAL-Catalog-Metaschema legt die Eindeutigkeit der Identitäten unterschiedlich weit fest:

| Identität | `identifier-uniqueness` | Bedeutung |
| --- | --- | --- |
| `catalog/@uuid` | `global` | dokumentweit und global eindeutig |
| `group/@id` | `instance` | eindeutig innerhalb des Dokuments |
| `control/@id` | `local` | **nur lokal eindeutig — keine katalogübergreifende Garantie** |

Zwei Kataloge mit derselben `control/@id` sind der Normalfall. Eine Control-ID
ist ohne Katalogkontext bedeutungslos; Routen, Zustand, Suchtreffer und
Referenzen führen ausnahmslos den `catalogKey` mit. Die einzige global
eindeutige OSCAL-Identität ist die Dokument-UUID des Katalogs; sie ist der
Anker der Provenienz.

`catalogKey` selbst ist **kein OSCAL-Begriff**, sondern ein stabiler
Registerschlüssel für Routing und Zustand
([ADR-1](https://linear.app/grundschutz-plus-plus/issue/ADR-1)). Er ersetzt die
Dokument-UUID nicht.

#### Mehrere Kataloge gleichzeitig

Der Ladepfad hält eine Katalogsammlung (`CatalogState.catalogs`, siehe
[ARCHITECTURE.md](./ARCHITECTURE.md#catalogcontext-srcstatecatalogcontexttsx)).
Jeder Katalog trägt sein eigenes `controlsById`, sein eigenes
`controlsByAltIdentifier` und seine eigene Vertrauensklasse — identische
Control-IDs zweier Kataloge kollidieren weder in Routen noch im Zustand noch in
der Suche. `resolveControlRef(catalogsByKey, ref)` löst strikt innerhalb des
adressierten Katalogs auf.

Die deklarierte `metadata.oscal-version` ist eine Eigenschaft **jedes
einzelnen** Katalogs. Kataloge unterschiedlicher OSCAL-Versionen dürfen
gleichzeitig geladen sein; der Ladepfad trifft keine gemeinsame
Versionsannahme.

### ControlRef (interne Referenzidentität)

```typescript
interface ControlRef {
  catalogKey: CatalogKey;
  controlId: string;
}
```

`ControlRef` modelliert die kataloggescopte interne OSCAL-Referenzidentität.
Parent-/Child- und Link-Ziele bleiben kataloginterne String-IDs. URLs verwenden
nicht `controlId`, sondern `catalogKey + altIdentifier`.

## Transformation (oscalAdapter)

Die Transformation von Raw → Enriched erfolgt in `src/adapters/oscalAdapter.ts`:

### Hauptfunktion

```typescript
interface ParseCatalogOptions {
  catalogKey: CatalogKey;   // Pflicht (ADR-1) — kein Default
}

/** `raw` ist der Katalog**körper**, nicht das Gesamtdokument. */
export function parseCatalog(
  raw: unknown,
  options: ParseCatalogOptions,
): Catalog {
  const { catalogKey } = options;

  const catalog = raw as RawOscalCatalog;

  if (!catalog?.uuid || !catalog.metadata) {
    throw new Error(
      'Invalid OSCAL catalog: missing uuid or metadata',
    );
  }

  // ... Root-Controls ohne Gruppe, parsePractice() je Gruppe, beide
  // Control-Indizes, parseBackMatter()
}
```

Der `catalogKey` stammt aus dem Quellregister und ist **Pflicht**: Die Katalogidentität nach [ADR-1](https://linear.app/grundschutz-plus-plus/issue/ADR-1) steht nicht im Dokument, und ein Default würde sie erfinden.

Der Katalogadapter löst sie über `resolveCatalogKey()` auf und bricht in zwei Fällen ab, statt sich auf einen Wert zu einigen:

| Kontext-`catalogKey` | Registry über `upstreamPath` | Ergebnis |
| --- | --- | --- |
| gesetzt | nicht auflösbar | Kontextwert |
| nicht gesetzt | auflösbar | Registry-Wert |
| gesetzt | auflösbar, gleich | dieser Wert |
| gesetzt | auflösbar, **abweichend** | Abbruch — ein registriertes Artefakt darf nicht unter fremder Identität adressierbar sein |
| nicht gesetzt | nicht auflösbar | Abbruch — keine Identität wird erfunden |

Die vierte Zeile ist dieselbe Regel, die der Dispatch für den Root-Typ mit `OSCAL_ROOT_TYPE_MISMATCH` anwendet.

Beim Aufbau von `controlsByAltIdentifier` failt `parseCatalog` geschlossen, wenn ein Control keinen Alt-Identifier besitzt oder derselbe Wert innerhalb des Katalogs mehrfach vorkommt.

Der Envelope wird hier **nicht** ausgepackt: Welcher Root-Typ vorliegt,
entscheidet allein der [Root-Dispatch](#root-envelope-und-root-dispatch).

### Rekursives Steuerungs-Parsing

Nested Controls (Enhancements) werden rekursiv entpackt:

```typescript
export function parseControlRecursive(
  raw: RawOscalControl,
  groupId: string | undefined,
  practiceId: string | undefined,
  parentId?: string,
): Control[] {
  const control = parseControl(raw, groupId, practiceId, parentId);
  const nested = (raw.controls ?? []).flatMap((child) =>
    parseControlRecursive(child, groupId, practiceId, raw.id),
  );
  return [control, ...nested];
}
```

### Parameter-Auflösung

OSCAL-Parameter-Insertions werden aufgelöst:

```typescript
export function resolveParams(
  prose: string,
  paramMap: Record<string, string>,
): string {
  const resolved = prose.replace(
    /\{\{\s*insert:\s*param,\s*([^}\s]+)\s*\}\}/g,
    (_match, paramId: string) => {
      return paramMap[paramId] ?? `[${paramId}]`;
    },
  );
  // Strip remaining {{ content }} choice brackets (BSI notation, not OSCAL params)
  return resolved.replace(/{{([^{}]+)}}/g, '$1');
}
```

Neben `{{ insert: param, ... }}` entfernt die Funktion auch BSI-eigene `{{choice text}}`-Klammern, die in Prop-Werten (z.B. `result`) vorkommen.

## Typ-Validierung

String-Werte werden enger typisiert:

```typescript
export function toSecurityLevel(value: string | undefined): SecurityLevel | undefined {
  if (value === 'normal-SdT' || value === 'erhöht') return value;
  return undefined;
}

export function toEffortLevel(value: string | undefined): EffortLevel | undefined {
  if (value && ['0', '1', '2', '3', '4', '5'].includes(value)) {
    return value as EffortLevel;
  }
  return undefined;
}

export function toSecurityTargetRelevance(
  value: string | undefined,
): SecurityTargetRelevance | undefined {
  if (value === '0' || value === '1' || value === '2') return value;
  return undefined;
}

export function toModalverb(value: string | undefined): Modalverb | undefined {
  if (value === 'MUSS' || value === 'SOLLTE' || value === 'KANN') return value;
  return undefined;
}
```

## OSCAL-Versionsmatrix

Root-Typ und deklarierte `metadata.oscal-version` bilden gemeinsam den
Schema-Schlüssel. `src/domain/oscalVersionMatrix.mjs` führt alle acht
OSCAL-Root-Modelle über die vier gepinnten Versionen und ist die einzige
Quelle für Schema-Provenienz:

```typescript
export type OscalRootKey =
  | 'catalog' | 'profile' | 'mapping-collection' | 'component-definition'
  | 'system-security-plan' | 'assessment-plan' | 'assessment-results'
  | 'plan-of-action-and-milestones';

export type PinnedOscalVersion = '1.1.2' | '1.1.3' | '1.2.1' | '1.2.2';

export interface OscalSchemaPin {
  readonly rootKey: OscalRootKey;
  readonly oscalVersion: PinnedOscalVersion;
  readonly schemaFileName: string;   // Asset-Name im NIST-Release
  readonly releaseTag: string;       // Herkunft, z. B. `v1.2.2`
  readonly releaseUrl: string;
  readonly schemaId: string;         // Selbstnachweis des Schemas
  readonly vendorPath: string;       // reservierter Ablageort im Repo
  readonly sha256: string;
  readonly sizeBytes: number;
}
```

Root-Typ × Version ist **keine freie Kreuzmenge**: `mapping-collection`
existiert erst ab OSCAL 1.2.0, weshalb 30 der 32 Felder belegt sind.
`resolveSchemaBinding()` wählt fail-closed aus und gibt bei jeder Abweichung
einen stabilen Diagnosecode zurück, statt auf eine Nachbarversion auszuweichen.

Die vom konkreten BSI-Artefakt deklarierte Version steht dagegen als
`oscalVersion` am jeweiligen Eintrag im Quellregister;
`validateSourceRegistry()` kreuzt beide beim Import.

Details, Hash-Pins und Migrationspolitik:
[OSCAL_VERSION_MATRIX.md](./OSCAL_VERSION_MATRIX.md).

## Upstream-Manifest Types

Update-Contract mit dem BSI-Repository:

```typescript
interface UpstreamManifestFile {
  artifactKey: string;
  rootType: ManifestRootType;
  lifecycle: ArtifactLifecycle;
  path: string;
  gitBlobSha: string;
  contentSha256: string;
}

interface UpstreamManifest {
  schemaVersion: 2;
  repository: string;
  snapshotCommitSha: string;
  files: UpstreamManifestFile[];
  signatureSha256: string;
}
```

`ManifestRootType` umfasst die unterstützten OSCAL-Root-Typen sowie `vocabulary`; `ArtifactLifecycle` unterscheidet `supported`, `preview`, `draft` und `blocked-by-upstream`. Preview- und Draft-Dateien werden zur Provenance transient validiert, aber nicht als App-Daten ausgeliefert.

## Provenance/Integrity Types

Siehe [INTEGRITY.md](./INTEGRITY.md) für die Provenance-Metadaten-Typen.

## Vocabulary Types

Siehe [VOCABULARY.md](./VOCABULARY.md) für die Vocabulary-Typen.

## State Types

```typescript
interface LoadedCatalogState {
  readonly catalogKey: CatalogKey;
  readonly catalogDocument: CatalogDocument | null;  // source + context + view
  readonly catalog: Catalog | null;                  // === catalogDocument.view
  readonly provenance: CatalogProvenance | null;
  readonly verification: VerificationResult | null;
  readonly loading: boolean;
  readonly error: string | null;
}

interface CatalogState {
  catalogs: ReadonlyMap<CatalogKey, LoadedCatalogState>;
  entryCatalogKey: CatalogKey;
  activeCatalogKey: CatalogKey;
  selectCatalog: (catalogKey: CatalogKey) => void;

  // Projektionen des aktiven Katalogs
  catalogDocument: CatalogDocument | null;
  catalog: Catalog | null;
  provenance: CatalogProvenance | null;
  verification: VerificationResult | null;
  loading: boolean;
  error: string | null;

  vocabularyRegistry: VocabularyRegistry | null;
  vocabularyProvenance: VocabularyProvenance | null;
  vocabularyVerification: VerificationResult | null;
}
```

Jeder Katalog trägt Provenienz, Verifikationsergebnis und Fehlerzustand
isoliert; `selectCatalog` ignoriert nicht ausgelieferte Schlüssel (fail-closed
beim zuletzt gültigen Katalog). `catalog` ist `catalogDocument.view` des
aktiven Katalogs. Wer Felder braucht, die das Domänenmodell nicht abbildet,
geht über `catalogDocument.source`.

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- [OSCAL_VERSION_MATRIX.md](./OSCAL_VERSION_MATRIX.md) — Versionsmatrix, Schema-Provenienz, Migrationspolitik
- [OSCAL_VALIDATION.md](./OSCAL_VALIDATION.md) — Validierungsvertrag
- `src/domain/models.ts` — TypeScript Definitionen
- `src/adapters/oscalAdapter.ts` — Parser-Implementierung
- `src/adapters/oscalDocument.ts` — verlustfreier Dokumenteinstieg
