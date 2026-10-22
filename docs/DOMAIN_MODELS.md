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
bereitgestellte Cross-Dokument-Ziele auf. Ein Fragment trifft zuerst die
`back-matter`-Ressource mit exakt gleicher `uuid`, danach ein exakt gleiches
Control-Ziel (Katalog oder `localControlLookup` des Klassifikators); erst dann
die einzige Ressource, deren `uuid` sich nur in der Groß-/Kleinschreibung der
Hexziffern unterscheidet. Tragen mehrere Ressourcen diese UUID in verschiedenen
Schreibweisen, bleibt das Fragment unaufgelöst. Relative Ziele erhalten keinen
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

Der Root-Envelope steht in
`src/domain/oscalRootDocument.ts` — siehe
[Root-Envelope und Root-Dispatch](#root-envelope-und-root-dispatch).

## Projekteigene OSCAL-Properties

`src/domain/projectProps.ts` enthält die Runtime-Registry und die Reader-/Writer-API
für `RawOscalProp`. Namen, Träger, Kardinalitäten, Wertregeln, verlustfreie
Lesesichten, Schreibfreigabe und Diagnosen sind im öffentlichen
[Projekt-Property-Vertrag](PROJECT_PROPS.md) festgelegt.

## Root-Envelope und Root-Dispatch

Der Envelope kennt alle acht OSCAL-Root-Keys, und genau **eine** Stelle
bestimmt den Root-Typ (`dispatchOscalDocument()` in
`src/domain/oscalRootDispatch.ts`).

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
          : K extends 'system-security-plan' ? RawOscalSystemSecurityPlan
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

`dispatchOscalDocument()` in `src/domain/oscalRootDispatch.ts` implementiert
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

Modulgrenzen: Geteilt werden Envelope, Root-Erkennung mit Root-Typ-Schranke
und der Ableitungsauftakt `openRootDerive`
(`src/adapters/oscalRootDocumentParse.ts`), die Stufe-3-Prüfung
`validateParsedSchema` (`src/adapters/oscalRootDocumentSchema.ts`, getrennt,
damit der Katalogpfad den Schema-Validator nicht lädt), Versionsbindung,
Diagnosevertrag,
die JSON-Typwächter (`src/domain/jsonGuards.ts`) sowie die Struktur- und
Elementleser aus `src/adapters/oscalReaders.ts` — Arrayfelder, `props`,
`links`, `set-parameters`, `responsible-roles` und `responsible-parties` —, die
jeder Adapter an seine eigene Diagnosefunktion bindet. Modellspezifische Leser und Read-Model-Ableitung
bleiben je Root-Typ in eigenen Modulen; `models.ts` wächst nicht zu einer
monolithischen Modellschicht.

| Root-Key | Layer | Adapter | Status |
| --- | --- | --- | --- |
| `catalog` | Control | `src/adapters/oscalAdapter.ts` | registriert |
| `profile` | Control | `src/adapters/oscalProfileAdapter.ts` | registriert |
| `mapping-collection` | Control | `src/adapters/oscalMappingAdapter.ts` | registriert |
| `component-definition` | Implementation | `src/adapters/oscalComponentAdapter.ts` | registriert |
| `system-security-plan` | Implementation | `src/adapters/oscalSspAdapter.ts` | registriert |
| `assessment-plan` | Assessment | `src/adapters/oscalAssessmentPlanAdapter.ts` | registriert |
| `assessment-results` | Assessment | `src/adapters/oscalAssessmentResultsAdapter.ts` | registriert |
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

Der Profile-Adapter liest die Anweisung und führt sie **nicht** aus. Kein Feld
der Projektion drückt ein aufgelöstes Control-Set aus; `Profile`,
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

* **Keine Profile Resolution im Adapter.** Selektion, Merge und Modify werden
  erhalten und nicht angewandt; es entsteht kein aufgelöstes Control-Set. Die
  Auflösung liegt in `src/domain/profileResolutionEngine.ts`.
* **Keine Auswertung von `matching` im Adapter.** Glob-Muster werden erhalten,
  aber nicht gegen Control-IDs abgeglichen.
* **Keine Auflösung relativer oder externer Quellen.** Ein `import.href` wird
  klassifiziert, nicht geladen — kein Netz-, kein Dateizugriff.
* **Keine Aussage** über Vollständigkeit oder Konformität eines Profils
  jenseits des geprüften Umfangs.

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

### Profile Authoring (Vertrauensklasse 2)

Lokale Profile entstehen und ändern sich ausschließlich über gezielte Patches
auf eine Kopie der gespeicherten Quelle; die Projektion dieses Abschnitts ist
dafür nicht beteiligt.

| Datei | Rolle |
| --- | --- |
| `src/domain/profileImportList.ts` | `createProfileSource()`, `addImport()`, `removeImport()`, `importHrefPointer()` |
| `src/domain/profileAuthoring.ts` | Lesemodell `readProfileImports()` und Patches der Selektion |
| `src/domain/profileHints.ts` | Hinweise auf schemagültige Konstrukte ohne Wirkung |
| `src/domain/profileSave.ts` | `commitExplicitSave()` und `respectsChangeOnWrite()` |
| `src/domain/profileTargetControls.ts` | Anforderungen eines Importziels nach Praktik und Gruppe |
| `src/domain/profileExport.ts` | Validierter Export aus dem Builder-Graphen |

**Neuanlage.** Ein Profile verlangt `uuid`, `metadata` mit `oscal-version`
und mindestens einen `import`; ein leeres Profil gibt es nicht. Die
Neuanlage beginnt deshalb mit dem Importziel. `createProfileSource()` erzeugt
`metadata` mit Titel, `last-modified`, `version` `1.0` und der
`oscal-version` des Ziels, einen Import `{ "href": "#<uuid>", "include-all":
{} }` und eine `back-matter.resource` mit dieser `uuid` und dem Titel des
Ziels. `addDocument()` nimmt das Profil im Zustand `draft` auf und bindet in
derselben Transaktion `/profile/imports/0/href` an das Ziel (`class-1` mit
`artifactKey` oder `local` mit `localId` desselben Verbunds); eine ungültige
Bindung speichert nichts.

**Importe.** Jeder Import, den die Anwendung schreibt, trägt ein `href` der
Form `#<uuid>` auf eine eigene `back-matter.resource`; das Metaschema verlangt
`href` in allen gepinnten Versionen, das JSON-Schema 1.2.x nicht. Ein
importiertes Profil mit Import ohne `href` bleibt unverändert; der
Dokumentgraph meldet `OSCAL_GRAPH_IMPORT_SOURCE_MISSING`. Die Zweigwahl setzt
genau eines von `include-controls` und `include-all` und entfernt das andere;
ein 1.1.x-Import ohne beide bleibt gültig, bis der Nutzer einen Zweig wählt.
`with-child-controls` nimmt nur `yes` und `no` an; der Schalter schreibt den
Wert in jeden Selektor des Bereichs und zeigt einen gemischten Zustand, wenn
die Selektoren sich unterscheiden. Leere Listen entfallen,
weil `with-ids`, `matching` und `exclude-controls` `minItems: 1` tragen; ein
leerer Einschlussselektor `{}` bleibt stehen und ist ein Hinweis. Ein neues
`matching` beginnt ohne `pattern`. Die Trefferzahl eines `pattern` zählt
`countGlobMatches()` als Glob gegen die `control/@id` genau eines
Importziels. Kein Patch ändert `metadata.oscal-version`; „Import hinzufügen“
bietet nur Ziele derselben Version an. Eine Import-Bindung gilt für genau den
Pointer ihres Imports: `shiftImportBindings()` verwirft beim Entfernen die
Bindung des entfernten Imports und rückt die folgenden nach; während eines
expliziten Speicherns ist Entfernen gesperrt. `alignImportBindings()` richtet
beim Öffnen eines Entwurfs die gespeicherten Bindungen an dessen Importen aus:
Gemeinsamer Anfang und gemeinsames Ende der `href`-Folgen behalten ihre
Bindungen an der neuen Position; eine Überlappung beider und jeder Randwert,
der auch dazwischen vorkommt, gelten als mehrdeutig.
Dazwischen folgt ein `href` seiner Bindung nur, wenn er im Entwurf und im
gespeicherten Dokument eindeutig ist; sonst bleibt der Import ungebunden.

**Hinweise.** `collectProfileHints()` meldet Selektoren ohne `with-ids` und
`matching`, `matching` ohne `pattern`, ein leeres `modify`, `alter` ohne
`adds` und `removes` und `remove` ohne `by-*`-Kriterium mit Code und JSON
Pointer. Ein Hinweis verhindert weder Aufnahme noch Speichern.

**UUID und `last-modified`.** Autosave schreibt den Arbeitsstand als Entwurf
und lässt beide Felder unverändert. Explizites Speichern vergibt über
`commitExplicitSave()` eine neue Dokument-UUID und setzt `last-modified`, wenn
sich der Inhalt ohne diese beiden Felder und unabhängig von der
Schlüsselreihenfolge geändert hat; sonst bleiben beide unverändert.
`respectsChangeOnWrite()` prüft beide Richtungen.

**Export.** `exportProfileDocument()` nimmt nur `export-ready` an, baut die
gespeicherte Quelle über `createOscalDerivedGraph()` nach, prüft sie mit
`processClass2OscalValue()` gegen das gepinnte Schema ihrer `oscal-version`
und jedes `#`-Fragment eines `import.href` über `resolveOscalReference()` auf
eine `back-matter.resource`. Die Constraint-Stufe ist `not-checked`. Die
Ausgabe ist reines OSCAL-JSON ohne Envelope-Feld und ohne Bindung. Ein Graph
ohne Builder-Herkunft scheitert mit `OSCAL_OBJECT_UNPROVENANCED`.

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
`coverageForTargetIdRef(…)`. Ein Eintrag mit **unbekanntem** Beziehungstyp
zählt nicht als Abdeckung.

Die Lücke hat **zwei** Ausdrucksformen, und beide gehen in die Abfrage ein: der
`map` mit `no-relationship` und die Gap-Summary der jeweiligen Seite, die nach
Schema „all controls that were not mapped at all" aufzählt. Aus ihr zählen
ausschließlich die namentlich genannten `with-ids` (`sourceGapIdRefs`,
`targetGapIdRefs`); ein `matching`-Muster bleibt erhalten, verändert aber keine
Abdeckungsaussage, weil der Mapping-Adapter keinen Glob auswertet. Führt ein
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

Keine Struktur des Modells trägt ein Status-, Reifegrad- oder Umsetzungsfeld:
weder `component-definition` noch `defined-component`, `capability`,
`control-implementation`, `implemented-requirement` oder `statement`.
`implementation-status` existiert nur im SSP. Die `description` einer
`implemented-requirement` ist laut Schema ein Vorschlag des Anbieters, wie die
Anforderung umgesetzt werden kann, sobald die Komponente in einem SSP
eingesetzt wird; die Projektion übernimmt sie als Text. Ob eine Anforderung
umgesetzt, wirksam oder abgedeckt ist, steht in keinem Feld des Modells, und
die Projektion leitet es nicht ab.

Der fachliche Nutzen ist Navigierbarkeit („welche Kontrollen adressiert
Komponente X", „welche Komponenten adressieren Kontrolle Y"). Nach NIST sind
Component Definitions dafür gedacht, dass ihre Inhalte in einen SSP übernommen
werden; eine Import-Kante SSP → Component Definition gibt es dabei **nicht** —
der SSP verweist über `import-profile` (required) auf genau eine Baseline, im
Regelfall ein Profile.

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

### Lokale Component Definitions (Vertrauensklasse 2)

Eine lokale Datei erreicht die Projektion über die Klasse-2-Importgrenze:
`importClass2OscalDocument()` prüft im Worker Bytes, Root, Version und Schema
der deklarierten `metadata.oscal-version` (Stufen 1–3); `source` und `context`
des Erfolgsergebnisses gehen an `parseComponentDefinitionDocument()`. Das
Dokument behält `trustClass: 'class-2-local-user'` und erhält keine
Manifest-Provenienz.

Ein Dokument aus `uuid` und `metadata` ist in allen vier gepinnten Versionen
schemavalide; `components`, `capabilities` und `import-component-definitions`
sind optional. Das Schema verlangt `description` an `incorporates-component`
und an `statement`; ein `statement` im SSP kommt ohne `description` aus.

### Offenes Vokabular `defined-component.type`

Das Schema führt `type` als `anyOf` aus `StringDatatype` und den elf Werten
in `COMPONENT_TYPE_VALUES` (`src/domain/componentDefinitionModel.ts`); das
Metaschema deklariert `allow-other="yes"`. Ein anderer Wert ist schemavalide.
`DefinedComponent.type` trägt den Quellwert unverändert,
`DefinedComponent.typeVocabulary` die Einordnung `documented` oder `unknown`.
Ein unbekannter Wert erzeugt keine Diagnose. Fehlt `type`, fehlt auch
`typeVocabulary`.

### Import-Kante `import-component-definitions`

`import-component-definitions[].href` verbindet zwei Component Definitions.
Im Informationsverbund verbinden drei Kantenarten Dokumente desselben
Root-Typs und können deshalb Zykel bilden: `profile-import`,
`component-import` und `ssp-leveraged-authorization`
(`leveraged-authorizations/*/links` mit `rel: 'system-security-plan'`).
`markWorkspaceCycles()` prüft genau diese drei. Der Adapter klassifiziert
jeden `href` über `src/domain/referenceResolution.ts` und lädt nichts nach. Im
Informationsverbund wird die Kante zu `component-import`
(`src/domain/workspaceEdges.ts`): Ein absoluter `href` ist `external`, auch mit
Bindung; ein relativer ohne Bindung ist `not-evaluable`; eine Bindung auf ein
Dokument, das über `component-import` zurückführt, auch auf sich selbst,
markiert `markWorkspaceCycles()` (`src/domain/workspaceGraphContext.ts`) mit
`OSCAL_GRAPH_IMPORT_CYCLE`. Die Markierung läuft als iterative Tiefensuche und
terminiert auch bei Zykeln.

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

Den Klasse-2-Lesepfad prüft `oscalComponentDocument.class2.node.test.ts` mit
synthetischen Fixtures aus derselben Fixture-Datei
(`makeComponentDefinitionWithoutComponents()`,
`makeCapabilityOnlyComponentDefinition()`, `makeLocalComponentDefinition()`).

## System Security Plans (Implementation Layer)

| Datei | Rolle |
| --- | --- |
| `src/domain/oscalSystemSecurityPlan.ts` | Raw-Typen, über `PinnedOscalVersion` parametrisiert |
| `src/domain/systemSecurityPlanModel.ts` | Projektion (`SystemSecurityPlan`, Baseline, Referenzen, `control-implementation`), ohne Logik |
| `src/domain/systemSecurityPlanSystemModel.ts` | Projektion von `system-characteristics` und `system-implementation` |
| `src/adapters/oscalSspReaders.ts` | Knotenleser, Referenzprüfungen und Diagnosesammler |
| `src/adapters/oscalSspSystem.ts` | Ableitung von `system-characteristics` und `system-implementation` |
| `src/adapters/oscalSspControl.ts` | Ableitung von `control-implementation` |
| `src/adapters/oscalSspAdapter.ts` | Ableitung `deriveSystemSecurityPlan(body, context, options)` |
| `src/adapters/oscalSspDocument.ts` | Dokumenteinstieg `parseSspDocument()` mit Root-Dispatch und Übergang nach Stufe 3 |

In `system-characteristics`, `system-implementation` und
`control-implementation` führt jeder Knoten, für den das Schema `props` und
`links` deklariert, beide in der Projektion (`SspElements`). Ausgenommen sind
Rollenzuweisungen (`responsible-roles`, `responsible-parties`): Ihre `props`
und `links` bleiben im Quellgraphen, ebenso die `protocols` einer Komponente.

`props` gehen nur im OSCAL-Namespace in die Projektion: `ns` fehlt oder ist
exakt `http://csrc.nist.gov/ns/oscal` (`OSCAL_NAMESPACE` in
`src/domain/mappingModel.ts`, der Default des Flags `ns` im
OSCAL-Metadata-Metaschema). Ein `prop` mit jedem anderen `ns`, auch mit dem
Projektnamespace aus [PROJECT_PROPS.md](PROJECT_PROPS.md) oder einem
Nicht-String, bleibt ausschließlich im Quellgraphen und erzeugt keine
Diagnose. Der SSP-Adapter übergibt diese Prüfung als `includeProp` an
`createElementReaders()`; Component-, Profil- und Mapping-Adapter übergeben
keine und projizieren jedes `prop` mit `name` und `value`.

### Eingang ausschließlich als Vertrauensklasse 2

Das Quellregister führt kein SSP-Artefakt. `deriveSystemSecurityPlan()` nimmt
ausschließlich den Kontext `trustClass: 'class-2-local-user'` an; jeder andere
Kontext endet mit `SspTrustClassError` und der Diagnose
`OSCAL_SSP_TRUST_CLASS_REJECTED`, ohne Dokument. Das gilt für
`parseSspDocument()` und für den generischen Einstieg `parseOscalDocument()`.

Der Weg eines SSP in die Anwendung ist die Klasse-2-Importgrenze:
`importClass2OscalDocument()` prüft im Worker Bytes, Root, Version und Schema
(Stufen 1–3); `source` und `context` ihres Erfolgsergebnisses gehen an
`parseSspDocument()`. Stufe 4 bleibt `not-checked`; die Referenzprüfungen
unten sind Modelldiagnosen des Adapters.

Die SSP-Station (`src/features/workspace/ssp/`) nimmt ausschließlich schema-geprüfte SSP-JSON-Dateien auf oder legt ein SSP über `createSspSource()` als `draft` an. `SspDocumentContent` lädt das ausgewählte Dokument über den Workspace-Port und zeigt die Projektion von `parseSspDocument()` mit Modelldiagnosen. `SspFields` beschränkt den lesenden Feldbaum auf fachliche Projektionsfelder; aufgelöste Referenzobjekte und strukturelle Diagnosepfade stehen außerhalb dieses Baums. Fremde `props` und nicht projizierte Inhalte bleiben in `source` erhalten. Der Import und die Anzeige ändern weder Root-UUID noch `metadata.last-modified`.

Bearbeitet wird ausschließlich `source`, nie die Projektion. Die Patches in `src/domain/sspAuthoring.ts` (`setSspValue()`, `addSspItem()`, `removeSspItem()`, `moveSspItem()`, `removeSspComponent()`, `setBaselineTitle()`) klonen die Quelle und ändern genau den adressierten Wert; unbekannte Felder, fremde `props`, `links`, `remarks` und `back-matter` bleiben unverändert. Ein Wert aus Leerraum entfernt den Schlüssel, eine geleerte Liste entfällt. `missingSspStructure()` in `src/domain/sspRequirements.ts` liefert die offene Pflichtstruktur je `oscal-version` als JSON Pointer. `commitSspSave()` in `src/domain/sspSave.ts` lässt die Root-UUID unverändert und setzt `last-modified` nur bei Inhaltsänderung. `sspSaveBlocker()` und `sspReadinessBlocker()` lesen die Referenzdiagnosen des Adapters: Eine `component-uuid` ohne Komponente verhindert das Speichern, eine unauflösbare `component-uuid`, `role-id` oder Party-UUID oder eine mehrfach vergebene Rollen-`id` oder Party-`uuid` den Zustand `export-ready`. `exportSspDocument()` in `src/domain/sspExport.ts` baut den Graphen über `createOscalDerivedGraph()`, prüft ihn mit `processClass2OscalValue()` gegen das gepinnte Schema der deklarierten Version und mit derselben Referenzprüfung; die Constraint-Stufe ist `not-checked`.

### Umsetzungsstatus je Komponente

`implementation-status` sitzt in OSCAL an `by-component` — pro Komponente je
Anforderung. `SspByComponent.implementationStatus` ist deshalb das einzige
Statusfeld; `SspImplementedRequirement` und `SspStatement` tragen keines, und
kein Typ fasst die Komponentenstatus zu einem Control-Status zusammen.
`state` ist ein String: Das Schema bindet ihn per `anyOf` an Token oder Enum
(`implemented`, `partial`, `planned`, `alternative`, `not-applicable`), ein
unbekanntes Token wird unverändert gelesen. `export` (mit `provided` und
`responsibilities`), `inherited`, `satisfied` und `responsible-roles` sitzen
ebenfalls an `by-component`.

Ein SSP dokumentiert Implementierungsbehauptungen eines
Systemverantwortlichen. Kein Feld der Projektion ist ein geprüfter
Compliance-, Audit- oder Wirksamkeitsstatus.

### Baseline und Control-Bezug

`import-profile.href` wird über `resolveOscalReference()` klassifiziert und
nie geladen:

| Form | Klassifikation |
| --- | --- |
| `#uuid` auf eine `back-matter.resource` desselben Dokuments | `resource`; eine eingebettete `base64`-Ressource erscheint nur mit `filename` und `mediaType` |
| relative URI | `unresolved`, Grund `relative` |
| absolute HTTPS-URL | `external` |

`SspImportProfile.baseline` ist `bound`, wenn der Aufrufer über
`SystemSecurityPlanDeriveOptions.baseline` einen Katalog übergibt, und sonst
`not-resolvable-in-context`. Eine `control-id` wird nur gegen diese Bindung
aufgelöst:

| Lage | `SspControlReference` | Diagnose |
| --- | --- | --- |
| keine Bindung | `not-resolvable-in-context`, Grund `catalog-not-supplied` | keine |
| Bindung, ID bekannt | `resolved` mit `catalogKey` und `control` | keine |
| Transiente Bindung, ID bekannt | `resolved` mit `kind: 'transient'` und `control` aus `WorkspaceCatalog` | keine |
| Bindung, ID unbekannt | `unresolved`, Grund `control-not-in-catalog` | `OSCAL_SSP_CONTROL_REFERENCE_UNRESOLVED` |
| `control-id` fehlt | `unresolved`, Grund `control-id-missing` | `OSCAL_SSP_CONTROL_ID_MISSING` |

`SspBaselineBinding` akzeptiert einen Registry-Katalog mit `catalogKey` oder `{ kind: 'transient', catalog: WorkspaceCatalog }`. `buildWorkspaceCatalog()` in `src/domain/workspaceCatalog.ts` projiziert lokale und aufgelöste Kataloge auf Control-IDs und die Part-IDs je Control. Die Projektion verlangt keinen Registry-Schlüssel und keine BSI-Anzeigefelder; doppelte Control- oder Part-IDs ergeben strukturelle Diagnosen.

`statement-id` steht als gelesener Wert im SSP-Modell; `src/domain/workspaceSemanticEdges.ts` löst ihn im Verbundgraphen gegen die gebundene Baseline und das jeweilige Control auf. `inherited[].provided-uuid`
und `satisfied[].responsibility-uuid` zeigen in das `export` eines anderen SSP
und stehen als `not-resolvable-in-context` im Modell, ohne Diagnose.

### Dokumentinterne Referenzen

`system-implementation.components` wird vor Inventar und
`control-implementation` gelesen; `by-component.component-uuid` und
`inventory-items[].implemented-components[].component-uuid` werden dagegen
aufgelöst. Weder das JSON-Schema noch ein Metaschema-Constraint prüft diese
Referenz; die Diagnose bei fehlendem Ziel ist eine Projektregel. Trägt die UUID
mehr als eine Komponente, bleibt die Referenz mit Grund `component-ambiguous`
unaufgelöst.

Rollen- und Parteibezüge werden gegen `metadata` geprüft:

| Quelle | Ziel | Verankerung |
| --- | --- | --- |
| `role-id` einer `responsible-role` in `control-implementation` (Anforderung, Statement, `by-component` samt `provided`, `responsibilities`, `inherited`, `satisfied`) | `metadata.roles[].id` | `oscal-implemented-requirement-index-metadata-role-id` |
| `role-id` einer `responsible-role` an einer Komponente | `metadata.roles[].id` | Projektregel |
| `role-id` einer `responsible-party` an `system-characteristics`, Inventareintrag oder `implemented-component` | `metadata.roles[].id` | `oscal-metadata-responsible-party-index-metadata-role-id` |
| `users[].role-ids[]` | `metadata.roles[].id` | `oscal-index-metadata-role-id` |
| jede `party-uuids`-Angabe dieser Rollenzuweisungen | `metadata.parties[].uuid` | `oscal-index-metadata-party-uuid` |
| `party-uuid` einer `leveraged-authorization` in `system-implementation` | `metadata.parties[].uuid` | Projektregel |

UUIDs vergleicht der Adapter ohne Unterschied der Schreibweise
(`uuidKey()` in `src/adapters/oscalSspReaders.ts`): `component-uuid`, die
Eindeutigkeit der Komponenten-UUIDs und der `by-components` sowie
Party-UUIDs. Modell und `source` behalten den gelesenen Wert. Eine `role-id`
ist ein Token und wird exakt verglichen.

### Versionsdrift

Zwischen den vier gepinnten `oscal_ssp_schema.json` unterscheiden sich drei
vom SSP-Root erreichbare Definitionen. `oscalSystemSecurityPlan.versionDrift.test.ts`
weist die vollständige Menge am vendorierten Schema nach:

| Feld | Unterschied |
| --- | --- |
| `system-implementation.users` | Pflichtfeld (`minItems: 1`) nur in 1.1.2 und 1.1.3 |
| `protocol.name` | Pflichtfeld nur in 1.1.2 |
| `port-range.remarks` | erst ab 1.2.1 deklariert |

`users` ist das einzige Feldprädikat der SSP-Raw-Typen
(`OscalVersionsWithRequiredSystemUsers`); `protocol` und `port-range` kommen
mit ihren Prädikaten aus `oscalComponentDefinition.ts`.

### Modellinterne Diagnosen

Stufe `domain`, Validator `gspp-ssp-adapter`. Pfade sind strukturelle JSON
Pointer aus Schlüsseln und Indizes; ein Referenzwert aus dem Dokument steht in
keiner Diagnose. Modelldiagnosen verwerfen ein Dokument nie.

| Code | Anlass |
| --- | --- |
| `OSCAL_SSP_STRUCTURE_UNEXPECTED` | Pflichtobjekt fehlt, Knoten hat nicht die erwartete Form, oder einem Eintrag fehlt das Feld, ohne das die Projektion ihn nicht führt (`href`, `state`, `id`, `name`/`value`, `param-id`, `role-id`) |
| `OSCAL_SSP_COMPONENT_UUID_DUPLICATE` | zwei Komponenten mit derselben `uuid` |
| `OSCAL_SSP_COMPONENT_REFERENCE_UNRESOLVED` | `component-uuid` trifft keine oder mehr als eine Komponente |
| `OSCAL_SSP_BY_COMPONENT_DUPLICATE` | dieselbe `component-uuid` zweimal in den `by-components` einer Anforderung oder eines Statements |
| `OSCAL_SSP_ROLE_REFERENCE_UNRESOLVED` | `role-id` ohne Rolle in `metadata.roles` |
| `OSCAL_SSP_PARTY_REFERENCE_UNRESOLVED` | Party-UUID ohne Partei in `metadata.parties` |
| `OSCAL_SSP_ROLE_ID_DUPLICATE` | zwei Rollen in `metadata.roles` mit derselben `id` |
| `OSCAL_SSP_PARTY_UUID_DUPLICATE` | zwei Parteien in `metadata.parties` mit derselben `uuid` |
| `OSCAL_SSP_CONTROL_ID_MISSING` | `implemented-requirement` ohne `control-id` |
| `OSCAL_SSP_CONTROL_REFERENCE_UNRESOLVED` | gebundene Baseline kennt die `control-id` nicht |

Pflichtobjekte sind `import-profile`, `system-characteristics` mit
`system-information`, `status` und `authorization-boundary`,
`system-implementation` mit dem `status` jeder Komponente und
`control-implementation`. Ein fehlendes Pflicht-Array liest der Adapter als
leere Liste ohne Befund; Pflicht-Arrays, Mindestanzahlen und die übrigen
Pflichtwerte prüft Stufe 3.

### Testkorpus

Der synthetische Korpus liegt in `src/test/fixtures/systemSecurityPlans.ts`:
ein gegen das 1.2.2-Schema gültiges Vollfixture mit jeder projizierten
Struktur und je Version das Minimaldokument aus
`src/test/fixtures/oscalSchemaFixtures.ts`. Als NIST-Orakel liegen
`ssp-example.json`, `ssp-leveraged-example.json` und
`ssp-leveraging-example.json` aus `usnistgov/oscal-content` am Commit
`78650f02ad9321bb7b817846f8fbd4f2bcd620de` (Tag v1.5.0) unter
`src/test/fixtures/oscal-content-v1.5.0/`, SHA-256-gepinnt im
`ORACLE_MANIFEST.json`. Alle drei deklarieren `oscal-version` 1.2.2, setzen
`import-profile.href` als Fragment, bestehen Stufe 3 und werden ohne
Modelldiagnose projiziert.

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

Die Zuordnung der `*Prop`-Felder zu Schutzziel-Namen und Relevanzdefinitionen steht unter [Schutzziel-Auflösung](VOCABULARY.md#schutzziel-auflösung).

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
`custom`. Die Filtersemantik steht in [FILTERING.md](FILTERING.md#filter-dimensionen).
Die Befüllung von `Control.links` beschreibt
[Referenzauflösung auf dem Quellgraphen](#referenzauflösung-auf-dem-quellgraphen).

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

`buildParamMap()` bewahrt diese Unterscheidung für die Darstellung von Platzhaltern. `paramValues()` reicht `resolveParams()` je Parameter nur den Wert als String (`ParamMeta.value`); daraus entsteht der aufgelöste `statement`-Text für Suche und Export. `segmentStatement()` zerlegt `statementRaw` und `params` in geordnete Satzteile für die Detailansicht, ohne den gespeicherten oder exportierten Anforderungstext zu verändern. Fehlt ein Parameterwert, zeigt der Satz den Label-Fallback und erklärt ihn am Platzhalter. Liegt der Wert eines Platzhalters ganz in Ergebnis oder Präzisierung, nennt `SentenceSegment.partOf` diesen Satzteil. Sonst bleibt `partOf` leer. Verankert wird ein Satzteil nur an einer Fundstelle, die die Segmente vollständig tragen: Jedes berührte Stück ist ein Textstück oder, bei Ergebnis und Präzisierung, ein Parameterwert ganz im Satzteil, und keine Stückgrenze teilt ein Wort. Übersprungen werden deshalb Fundstellen im Parameterwert, Fundstellen, die einen Wert nur anschneiden, und solche, in denen ein Wert ein Wort teilt; das gilt auch für Handlungswort, Modalverb und Praktik, die keinen Parameterwert tragen können. Die Suche nimmt dann die nächste Fundstelle im Text; fehlt eine solche, landen Handlungswort, Ergebnis und Präzisierung in `missing` und erscheinen mit dem vollständigen Begriff als Restzeile. Verdeckt ein früherer Satzteil einen Anker, etwa ein Handlungswort im Ergebnis, sucht der Anker hinter diesem Satzteil weiter; `missing` enthält ihn nur, wenn es dahinter keine erreichbare Fundstelle gibt.

Die `*Prop`-Felder tragen den OSCAL-Namespace (`ns`) der Quell-Prop und
ermöglichen so die Auflösung gegen die offiziellen BSI-Vokabulare (siehe
[VOCABULARY.md](./VOCABULARY.md)).

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

`controlsById` und `controlsByAltIdentifier` sind katalogintern vollständig und eindeutig. Der Parser lehnt Kontrollen mit im selben Katalog doppelter Control-ID sowie mit fehlendem oder im selben Katalog doppeltem Alt-Identifier als Integritätsfehler ab; die Eindeutigkeit der Control-ID verlangt der Index `catalog-controls` im OSCAL-Katalog-Metaschema. Derselbe Alt-Identifier darf in verschiedenen Katalogen vorkommen, weil die kanonische URL-Identität immer aus `catalogKey + altIdentifier` besteht.

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

`parseCatalog` failt geschlossen, wenn eine Control-ID im Quellkatalog mehrfach vorkommt — geprüft über alle `controls` und `groups` in beliebiger Tiefe, auch unterhalb der projizierten Themenebene — oder wenn beim Aufbau von `controlsByAltIdentifier` ein Control keinen Alt-Identifier besitzt oder derselbe Alt-Identifier innerhalb des Katalogs mehrfach vorkommt.

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
  requestCatalog?: (catalogKey: CatalogKey) => void;
  retryCatalog?: (catalogKey: CatalogKey) => void;

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
beim zuletzt gültigen Katalog). `requestCatalog` lädt einen ausgelieferten
Katalog, ohne die Auswahl zu ändern, je Katalog höchstens einmal. `retryCatalog` wiederholt einen Katalog mit Fehlerzustand und startet dabei genau einen neuen Request. `catalog` ist `catalogDocument.view` des
aktiven Katalogs. Wer Felder braucht, die das Domänenmodell nicht abbildet,
geht über `catalogDocument.source`.

## Dokumentgraph eines Informationsverbunds

`src/domain/workspaceGraphModel.ts` definiert den Eingabesnapshot `WorkspaceGraphInput` und den Rückgabewert `WorkspaceGraph`. `buildWorkspaceGraph()` in `src/domain/workspaceGraph.ts` liest lokale `WorkspaceEnvelope`-Mitglieder mit einer gemeinsamen `verbundId`; zulässig sind `catalog`, `profile`, `component-definition`, `system-security-plan`, `assessment-plan`, `assessment-results` und `plan-of-action-and-milestones`. `mapping-collection` ergibt `OSCAL_WORKSPACE_ROOT_NOT_ALLOWED`. Die Mitgliederübersicht führt `localId`, Root-Typ, deklarierte Version, Vertrauensklasse und `savedAt`.

Knoten und Kantenziele besitzen einen `ReferenceGraphDocumentKey` aus `src/domain/referenceGraphModel.ts`: `{ kind: 'local', localId }` oder `{ kind: 'class-1', artifactKey, lifecycle }`. Lokale OSCAL-IDs bleiben im jeweiligen Dokumentkontext. Klasse-1-Ziele stammen aus den übergebenen, bereits hashgeprüften `class1Artifacts`; sie werden nicht zu Mitgliedern oder Store-Inhalten.

`src/domain/workspaceEdges.ts` liest die Dokumentkanten `profile-import`, `ssp-import-profile`, `ssp-leveraged-authorization`, `component-source`, `component-import`, `ap-import-ssp`, `ar-import-ap` und `poam-import-ssp`. Feldpfade und erlaubte Zielroots stehen in [OSCAL_VALIDATION.md](OSCAL_VALIDATION.md#dokumentgraph-eines-informationsverbunds). `workspaceSemanticEdges.ts` ergänzt Control- und Statement-Referenzen je gebundener Baseline sowie Component-UUIDs aus explizit gebundenen Importketten. Ein POA&M ohne `import-ssp` erzeugt keine SSP-Kante.

Eine lokale Bindung adressiert `fromLocalId`, den Referenz-Pointer und den unveränderten `href`. Fragment- und relative Referenzen benötigen ein explizites Ziel; absolute URIs bleiben `external`. Die Zustände sind `resolved`, `resolved-empty`, `missing-source`, `not-evaluable`, `external` und `error`. Ein internes Ressourcenziel mit ausschließlich `uuid` ist `resolved-empty`; ein Profilimport ohne `href` erhält `missing-source` mit `OSCAL_GRAPH_IMPORT_SOURCE_MISSING` in der Stufe `oscal-constraint`. Eine ungebundene Referenz erzeugt keinen Ziel-Fehlt-Befund; eine Bindung, deren gespeicherter `href` vom aktuellen Wert abweicht, ergibt `error` mit `OSCAL_WORKSPACE_BINDING_STALE`. Bindungen werden weder aus Root-UUIDs noch aus `rlinks` abgeleitet.

`src/domain/workspaceProfileResolution.ts` berechnet für jeden Graphaufbau die Profile mit den aktuellen gebundenen Importzielen neu. Ein aufgelöstes Ergebnis enthält `derived: true`, `transient: true`, `specificationStatus: 'work-in-progress'` und den abgeleiteten OSCAL-Katalog unter `source`; es enthält keinen Speicherauftrag. `workspaceCatalog.ts` projiziert die Baseline auf Control-IDs und Part-IDs je Control. SSP- und Component-Referenzen verwenden ausschließlich den Katalog hinter der eigenen Bindung, einschließlich transient aufgelöster Profile.

`src/domain/workspaceMembership.ts` prüft aufnehmbare Klasse-2-Dokumente über die bestehende Eingangsprüfkette. Gleiche Root-UUIDs im selben Verbund ergeben `OSCAL_WORKSPACE_ROOT_UUID_DUPLICATE`; `existingLocalId` und `action: 'replace'` stehen als Entscheidungsdaten neben der redigierten Diagnose. Die explizite Ersetzung verwendet `WorkspaceStore.replaceDocument()` mit der vorhandenen `localId`. Graphaufbau und Resolution verändern kein Mitglieds-`source`; `href` und `link.resource-fragment` bleiben erhalten.

## Assessment Plans (Assessment Layer)

`src/domain/oscalAssessmentPlan.ts` beschreibt den Raw-Körper über `PinnedOscalVersion`. `src/domain/assessmentPlanModel.ts` definiert das Read-Model `AssessmentPlan`: Metadaten, `importSsp`, `reviewedControls`, lokale Definitionen, Bedingungen, Prüfsubjekte, Prüfplattformen und rekursive Aufgaben. Die Aufgaben stehen in Quellreihenfolge. Der Prüfplan führt Planungsdaten; Prüfergebnisse werden im eigenen OSCAL-Root `assessment-results` geführt.

`parseAssessmentPlanDocument(source, context, options)` in `src/adapters/oscalAssessmentPlanDocument.ts` bindet Root und Version über `parseRootDocument()`. `source` und `context` bleiben unverändert neben `view` erhalten. `validateAssessmentPlanSchema()` prüft die Schemazelle aus `metadata.oscal-version`. Die erlaubten Versionen sind 1.1.2, 1.1.3, 1.2.1 und 1.2.2; `$schema` wählt keine Version. Der Adapter akzeptiert ausschließlich `class-2-local-user`; andere Trust-Klassen werfen `AssessmentPlanTrustClassError` mit `OSCAL_AP_TRUST_CLASS_REJECTED`.

Abwesende optionale Listen ergeben leere Arrays. Abwesende Objektbereiche `assessmentAssets` und `timing` ergeben `null`; `localDefinitions` enthält auch ohne Quellknoten seine leeren Listen. `oscalAssessmentPlanReaders.ts` bindet die gemeinsamen Strukturleser an Modelldiagnosen. Vorhandene Felder falscher Form werden diagnostiziert, ohne die Quelle zu reparieren. `oscalAssessmentPlanSelections.ts` liest Control- und Objective-Auswahlen, Prüfsubjekte und Teile. `oscalAssessmentPlanTasks.ts` liest Aktivitäten, Schritte und Aufgaben mit Zeitvorgaben, Abhängigkeiten und Rollenzuweisungen.

### Versionen und Referenzen

`oscalAssessmentPlan.versionDrift.test.ts` entfaltet die vom Root erreichbaren Objektpfade einschließlich Inline-Strukturen und `anyOf`-Zweigen. Sein Snapshot hält Eigenschaften, Pflichtfelder und `additionalProperties` je Zweig fest. Der Test prüft die sieben Driftgruppen ausdrücklich: Subjekt-, Control- und Objective-Auswahl, Timing, neue `remarks`-Felder, den Pflichtstatus von `protocol.name` und Metadaten-Parteien. Ab 1.2.1 erzwingen die JSON-Schemas exklusive Auswahlzweige; `assessment-subject.type` ist dort im JSON-Schema optional. Der Adapter meldet einen fehlenden Subjekttyp als `OSCAL_AP_SUBJECT_TYPE_MISSING`. Die Schemaformen von 1.2.1 und 1.2.2 stimmen in diesen Objektmerkmalen überein.

`importSsp.reference` klassifiziert `href` über `resolveOscalReference()`: Fragmente können Back-matter-Ressourcen treffen, relative Verweise bleiben unaufgelöst, absolute sichere URIs sind extern. Die Klassifikation lädt kein SSP. `importSsp.ssp.status` lautet ohne explizite Bindung `not-resolvable-in-context`.

`options.ssp` nimmt das vollständige Ergebnis von `parseSspDocument()` an (`source`, `view`, `context`). Der Aufrufer ordnet diese Bindung ausdrücklich dem `import-ssp` zu. Der AP-Adapter liest Rollen, Parteien und Orte aus den Metadaten dieses Quellgraphs sowie Komponenten, Inventar, Benutzer und Ressourcen aus dessen SSP-Bereichen. Er akzeptiert für die Bindung ausschließlich `class-2-local-user`. Die Identitätsindizes enthalten strukturelle Pfade. UUID-Vergleiche ignorieren die Groß-/Kleinschreibung der Hexziffern; Rollen-IDs werden exakt verglichen.

Subjekte lösen zuerst gegen lokale Definitionen und danach gegen das explizit gebundene SSP auf. Fehlende externe Ziele bleiben ohne SSP-Bindung `not-resolvable-in-context`; ein bereitgestelltes SSP mit fehlendem Ziel erzeugt eine Modelldiagnose. Offene, vom Adapter nicht erschlossene Subjektarten bleiben mit `subject-type-not-supported` unaufgelöst. Aufgabenabhängigkeiten und Activity-Referenzen lösen ausschließlich im AP auf. Mehrdeutige lokale UUIDs liefern `identity-ambiguous`; der Adapter wählt keinen ersten Treffer. Doppelte Komponenten-, Benutzer-, Inventar-, Activity- und Aufgaben-UUIDs sowie fehlende Aufgaben- und Activity-Ziele erzeugen eigene `OSCAL_AP_*`-Diagnosen.

`assessment-assets.components` besitzt einen eigenen Identitätsindex mit eigener Duplikatprüfung. Prüfsubjekte verwenden diesen Index nicht. `uses-components[].component-uuid` sucht zuerst in diesem Prüfwerkzeugindex, danach in den lokalen Systemkomponenten und im explizit gebundenen SSP. Mehrdeutige Prüfwerkzeug-UUIDs bleiben `identity-ambiguous`, auch wenn eine Systemkomponente dieselbe UUID trägt.

`options.catalog` hat die Form von `ComponentSourceCatalogBinding`. Control-IDs in Control-Auswahlen und lokalen Objectives lösen ausschließlich gegen diese Bindung auf. Ohne Bindung lautet der Grund `catalog-not-supplied`, bei fehlendem Control in einem gebundenen Katalog `control-not-in-catalog`. Objective- und Statement-IDs bleiben als gelesene IDs erhalten.

Rollen einer Aufgabe lösen gegen lokale `metadata.roles` oder das gebundene SSP auf. `party-uuids` der Rollenzuweisungen und `role-ids` lokaler Benutzer werden gegen dieselben lokalen und ausdrücklich gebundenen SSP-Indizes geprüft; fehlende Ziele werden am ursprünglichen Arrayindex diagnostiziert. Ohne SSP erzeugt eine nicht lokal definierte Rolle oder Partei keine Fehlerdiagnose. Mit SSP und fehlender Rolle meldet der Adapter `OSCAL_AP_ROLE_REFERENCE_UNRESOLVED`. Direkte Teile unter `terms-and-conditions` im OSCAL-Namespace werden gegen die Namen `rules-of-engagement`, `disclosures`, `assessment-inclusions`, `assessment-exclusions`, `results-delivery`, `assumptions` und `methodology` geprüft. Verschachtelte Assessment-Teile führen ein offenes Namensvokabular, etwa `item` unter `disclosures` oder `assumptions`; ihre `uuid` bleibt auf jeder Ebene erhalten.

### Quelle, Datenschutz und Testkorpus

Die Ableitung liest ausschließlich die übergebenen Graphen. Sie führt weder Netzwerk-, Datei- noch Storagezugriffe aus. Der vorgesehene Einstieg ist `processClass2OscalBytes()` beziehungsweise die darauf aufbauende Klasse-2-Importgrenze mit Byte-, Tiefen-, Knoten-, Root-, Versions- und Schemaprüfung. Modellinterne Diagnosen verwerfen den Plan nicht und enthalten keine Dokumentwerte; Stufe 4 bleibt `not-checked`.

`props` erscheinen im Read-Model nur ohne `ns` oder mit exakt `OSCAL_NAMESPACE`. Unbekannte Felder und fremde Props bleiben in `source`. Markup wird als Rohstring geführt. Back-matter-Nutzlasten werden weder dekodiert noch in die Projektion übernommen; die Referenzklassifikation führt nur Ressourcenmetadaten. Root- und Aufgaben-UUIDs bleiben unverändert. Bearbeitung und Serialisierung liegen außerhalb des Adapters.

`src/test/fixtures/assessmentPlans.ts` enthält synthetische Minimal- und Vollpläne. Vier originale NIST-AP-Beispiele aus `usnistgov/oscal-content` am Commit `78650f02ad9321bb7b817846f8fbd4f2bcd620de` stehen mit SHA-256 und Größe im `ORACLE_MANIFEST.json` unter `src/test/fixtures/oscal-content-v1.5.0/`. `scripts/sync-oscal-content-oracle.mjs` ist ihr Wartungs-Netzpfad. Alle vier bestehen Stufe 3 gegen die deklarierte Version. Jede Datei enthält eine nicht definierte Activity-UUID in `tasks[0].associated-activities[0]`; der Offline-Test erwartet genau `OSCAL_AP_ACTIVITY_REFERENCE_UNRESOLVED` an diesem strukturellen Pfad. Der No-op-Round-trip-Korpus prüft zusätzlich Assessment Plans in allen vier Matrixzellen.

## Assessment Results (Assessment Layer)

`src/domain/assessmentResultsModel.ts` definiert das Read-Model `AssessmentResults`: Metadaten, `importAp`, dokumentweite lokale Definitionen (`objectivesAndMethods`, `activities`), die Ergebnisse `results[]`, das Evidenz-Read-Model `evidence` und die Diagnosen. Ein `AssessmentResult` führt Beginn und Ende, lokale Definitionen (Komponenten, Inventar, Benutzer, `assessmentAssets`, Aufgaben), `reviewedControls`, Bestätigungen, Prüfprotokoll, Beobachtungen, Risiken und Findings in Quellreihenfolge.

`parseAssessmentResultsDocument(source, context, options)` in `src/adapters/oscalAssessmentResultsDocument.ts` bindet Root und Version über `parseRootDocument()`; `validateAssessmentResultsSchema()` prüft die Schemazelle aus `metadata.oscal-version` (1.1.2, 1.1.3, 1.2.1, 1.2.2). `parseOscalDocument()` erreicht denselben Adapter über `OSCAL_ROOT_ADAPTERS`. Der Adapter akzeptiert ausschließlich `class-2-local-user`, auch für die Bindungen in `options`; andere Trust-Klassen werfen `AssessmentResultsTrustClassError` mit `OSCAL_AR_TRUST_CLASS_REJECTED`.

`src/adapters/oscalAssessmentResultsAdapter.ts` verwendet die Strukturleser, Auswahl-, Teil- und Aufgabenleser des Assessment-Plan-Slices. `ApDeriveState.scope` bestimmt, ob deren Diagnosen als `OSCAL_AP_*` oder `OSCAL_AR_*` mit dem passenden Validator erscheinen. `oscalAssessmentResultsFindings.ts` liest Findings, Risiken und Maßnahmen; `oscalAssessmentResultsReaders.ts` enthält Referenzauflösung, Herkünfte und die Zyklusprüfung der Aufgabenabhängigkeiten.

### Optionale Bereiche und Befundkette

Fehlen in einem `result` die Schlüssel `observations`, `risks` oder `findings`, liefert das Read-Model leere Listen ohne Diagnose. Ein leeres Array in diesen Schlüsseln, ein leeres `results` sowie fehlendes `import-ap` oder `results` lehnt Stufe 3 ab; der Adapter selbst meldet fehlendes `import-ap` und `results` als `OSCAL_AR_STRUCTURE_UNEXPECTED`.

Ein Finding führt sein Pflichtziel `target` mit `type`, `targetId`, `status` und optionalem `implementationStatus`. `hasLinkedEvidence` ist `false`, wenn weder `related-observations` noch `related-risks` vorhanden sind. `risk.status`, `response.lifecycle` und `risk-log.entries[].status-change` stehen unverändert als Strings im Read-Model. `threat-ids[].href` bleibt ein ungeladener String.

### Referenzen und Kontext

`importAp.reference` klassifiziert `href` über `resolveOscalReference()`; `importAp.status` lautet `bound`, wenn `options.assessmentPlan` ein Dokument mit Root `assessment-plan` trägt, sonst `not-resolvable-in-context`. Der Aufrufer ordnet `options.assessmentPlan` (Ergebnis von `parseAssessmentPlanDocument()`) und `options.ssp` (Ergebnis von `parseSspDocument()`) ausdrücklich zu; der Adapter lädt kein Dokument.

`ArReference` hat die Zustände `resolved` (mit `origin` `local`, `assessment-plan` oder `ssp`), `not-resolvable-in-context` und `unresolved`. Jede Referenzart sucht in einer festen Reihenfolge von Identitätsbereichen. Ist ein Bereich nicht gebunden und das Ziel in keinem gebundenen Bereich vorhanden, lautet der Zustand `not-resolvable-in-context` mit `assessment-plan-not-supplied` oder `ssp-not-supplied` (`…-binding-invalid` bei einer Bindung ohne passenden Root); es entsteht keine Diagnose. Sind alle Bereiche gebunden und fehlt das Ziel, oder ist es mehrdeutig, entsteht eine `OSCAL_AR_*`-Diagnose.

| Referenz | Identitätsbereiche in Suchreihenfolge | Diagnose |
| --- | --- | --- |
| `origins[].actors[]` mit `type: tool` | Prüfwerkzeuge des `result`, lokale Komponenten, Assessment Plan, SSP | `OSCAL_AR_ACTOR_REFERENCE_UNRESOLVED` |
| `origins[].actors[]` mit `type: assessment-platform` | Prüfplattformen des `result`, Assessment Plan | `OSCAL_AR_ACTOR_REFERENCE_UNRESOLVED` |
| `origins[].actors[]` mit `type: party` | `metadata.parties`, Assessment Plan, SSP | `OSCAL_AR_ACTOR_REFERENCE_UNRESOLVED` |
| `origins[].related-tasks[].task-uuid` | Aufgaben des `result` einschließlich Maßnahmenaufgaben, Assessment Plan | `OSCAL_AR_TASK_REFERENCE_UNRESOLVED` |
| `finding.implementation-statement-uuid` | `control-implementation.implemented-requirements[].statements[]` des SSP | `OSCAL_AR_IMPLEMENTATION_STATEMENT_UNRESOLVED` |
| `finding.related-risks[].risk-uuid` | Risiken aller `results` | `OSCAL_AR_RISK_REFERENCE_UNRESOLVED` |
| `risk-log.entries[].related-responses[].response-uuid` | Maßnahmen aller `results` | `OSCAL_AR_RESPONSE_REFERENCE_UNRESOLVED` |

Ein Ziel einer anderen Art liegt in keinem dieser Bereiche und bleibt unaufgelöst, etwa eine Observation-UUID in `related-risks`. Lokale Identitäten gelten je `result` zuzüglich der dokumentweiten Metadaten, Aktivitäten und Back-matter-Ressourcen. Doppelte Komponenten-, Benutzer-, Inventar-, Plattform-, Aufgaben- und Aktivitäts-UUIDs sowie doppelte UUIDs von Beobachtungen, Risiken, Findings und Maßnahmen im Dokument erzeugen `OSCAL_AR_*_UUID_DUPLICATE`. Eine Aufgabenabhängigkeit, die einen Zyklus schließt, erzeugt `OSCAL_AR_TASK_DEPENDENCY_CYCLE` an ihrem `task-uuid`-Pfad. Aufgaben, Aktivitäten, Subjekte und Rollen innerhalb lokaler Aufgaben lösen über die Leser des Assessment-Plan-Slices auf.

### Evidenz und Gültigkeit

Der Adapter ruft `deriveEvidenceReadModel()` mit Root `assessment-results`, der gebundenen Version und `options.at` auf; ohne `options.at` ist der Bewertungszeitpunkt der Ableitungszeitpunkt. `contextUuids` enthält die Komponenten-, Inventar-, Benutzer-, Partei- und Ort-UUIDs der lokalen Definitionen, des Assessment Plans und des SSP. Jede `AssessmentObservation` trägt in `evidence` das Objekt aus `EvidenceReadModel.observations` mit demselben Pfad; dessen `validity` ist die einzige Gültigkeitsangabe. `relatedObservations[].reference` ist der Eintrag aus `EvidenceReadModel.observationReferences`; ein fehlendes Ziel meldet das Evidenz-Read-Model als `OSCAL_EVIDENCE_OBSERVATION_NOT_FOUND`. `diagnostics` enthält die Adapter- und die Evidenzdiagnosen.

### Quelle, Datenschutz und Testkorpus

Die Ableitung liest ausschließlich die übergebenen Graphen und führt weder Netzwerk-, Datei- noch Storagezugriffe aus; `oscalAssessmentResultsAdapter.boundaries.node.test.ts` prüft das am Quelltext. Der vorgesehene Einstieg ist `processClass2OscalBytes()` mit Byte-, Tiefen-, Knoten-, Root-, Versions- und Schemaprüfung. Markup bleibt Rohstring, `base64`-Nutzlasten werden weder dekodiert noch projiziert, deklarierte `media-type`-Werte erscheinen nur als Ressourcenmetadaten. Diagnosen tragen Code und strukturellen Pfad, keine Dokumentwerte. Root-, Beobachtungs-, Risiko- und Finding-UUIDs bleiben unverändert; `rootUuidPolicy('assessment-results')` ist `keep`.

`src/test/fixtures/assessmentResults.ts` enthält synthetische Minimal- und Vollfälle. Vier originale NIST-AR-Beispiele aus `usnistgov/oscal-content` am Commit `78650f02ad9321bb7b817846f8fbd4f2bcd620de` stehen mit SHA-256 und Größe im `ORACLE_MANIFEST.json` unter `src/test/fixtures/oscal-content-v1.5.0/`; `scripts/sync-oscal-content-oracle.mjs` ist ihr Wartungs-Netzpfad. Alle vier bestehen Stufe 3 gegen die deklarierte Version und erzeugen keine Modelldiagnose. `oscalAssessmentResultsDocument.node.test.ts` führt den No-op-Round-trip in allen vier Matrixzellen mit dem Adapter im Exportpfad aus.

## Evidenz (Assessment Layer)

`deriveEvidenceReadModel({ source, rootType, oscalVersion, at, contextUuids })` in `src/domain/evidenceReadModel.ts` leitet die Evidenz eines Dokuments mit Root `assessment-results` oder `plan-of-action-and-milestones` ab. Die Funktion ist rein: Sie liest ausschließlich ihre Eingaben `source`, `rootType`, `oscalVersion`, `at` und `contextUuids`, führt keinen Netzwerk-, Datei- oder Storagezugriff aus, hält keinen Zustand und verändert `source` nicht. Evidenzinhalte liegen ausschließlich als `back-matter.resources[].base64` im Dokument; einen eigenen Evidenzspeicher gibt es nicht.

Beobachtungen stammen in Assessment Results aus `results[].observations[]`, im POA&M aus `observations[]`. Je Beobachtung führt das Modell `methods` und `types` als Werte mit Status `documented` oder `undocumented`. Das dokumentierte Spektrum ist `EXAMINE`, `INTERVIEW`, `TEST` und `UNKNOWN` für `methods` sowie `ssp-statement-issue`, `control-objective`, `mitigation`, `finding`, `discovery` und `historic` für `types`; das Schema akzeptiert daneben jeden String, das Modell übernimmt ihn unverändert.

Die Gültigkeit stammt ausschließlich aus `collected` und `expires`, bewertet gegen den Zeitpunkt `at`:

| Zustand | Bedingung |
| --- | --- |
| `current` | `expires` liegt nach `at` |
| `expired` | `expires` liegt nicht nach `at` |
| `no-expiry-declared` | `expires` fehlt; das ist kein unbegrenzt gültiger Zustand |
| `not-evaluable` | `collected` fehlt, oder `collected` oder ein vorhandenes `expires` ist kein gültiger Zeitstempel mit Zeitzone, auch wenn `expires` `null`, eine Zahl oder ein Objekt ist, oder `expires` liegt vor und `at` ist kein gültiges Datum |

Bewertbar ist nur ein Zeitstempel der Form `YYYY-MM-DDThh:mm:ss` mit optionalen Sekundenbruchteilen und Pflicht-Offset `Z` oder `±hh:mm`, wie es der OSCAL-Datentyp `dateTime-with-timezone` verlangt. Das Datum muss im Kalender existieren (Schaltjahrregel eingeschlossen), die Uhrzeit liegt zwischen `00:00:00` und `23:59:59`, der Offset ist `Z` oder einer der Werte, die `DateTimeWithTimezoneDatatype` in den Schemas v1.1.2 bis v1.2.2 aufzählt: `-12:00` bis `-00:00` in vollen Stunden, `-09:30`, `-03:30`, `+00:00` bis `+14:00` in vollen Stunden, `+03:30`, `+04:30`, `+05:30`, `+06:30`, `+09:30`, `+10:30`, `+05:45`, `+08:45` und `+12:45`. Ein Wert ohne Offset, mit einem anderen Offset wie `+14:45` oder `-14:00` oder mit unmöglichem Datum wie `2026-02-30` ergibt `not-evaluable`. Der Vergleich mit `at` läuft auf Millisekunden seit der Epoche und ist damit zeitzonenunabhängig; liegt `expires` in derselben Millisekunde wie `at`, ist die Beobachtung `current`, wenn Sekundenbruchteile unterhalb der Millisekunde ungleich null sind.

`blocksPositiveFinding(validity)` liefert `true` für `expired` und `not-evaluable`.

Ein `relevant-evidence`-Eintrag ohne `href` ist `descriptive` und gültig. `href` und `relevant-evidence[].links[]` klassifiziert `createOscalReferenceClassifier()` aus `src/domain/referenceResolution.ts`; `resource-fragment` bleibt in der Klassifikation erhalten. Die Ressourcen liefert `resolveCatalogResources()`: `content` ist `empty`, wenn eine Ressource weder `description`, `citation`, `rlinks` noch `base64` trägt; je `rlink` stehen `media-type`, `hashes` und `integrity` (`declared` oder `missing`); für `base64` stehen nur `filename` und `media-type`, die Nutzlast wird nicht gelesen.

UUID-Referenzen haben vier Zustände: `resolved` (Ziel im Dokument), `resolved-in-context` (Ziel in `contextUuids`), `not-resolvable-in-context` und `missing-in-document`. Vergleiche ignorieren die Groß-/Kleinschreibung der Hexziffern. `subjects[]` mit `type: resource` lösen nur gegen `back-matter.resources` auf; ein fehlendes Ziel ergibt `missing-in-document` und `OSCAL_EVIDENCE_RESOURCE_NOT_FOUND`. Andere Subjekttypen lösen nur gegen `contextUuids` auf. `related-observations[].observation-uuid` liest das Modell in Assessment Results aus `results[].findings[]` und `results[].risks[]`, im POA&M aus `poam-items[]`, `findings[]` und `risks[]`. In Assessment Results löst `observation-uuid` nur gegen das eigene Dokument auf; ein fehlendes Ziel ist `missing-in-document` mit `OSCAL_EVIDENCE_OBSERVATION_NOT_FOUND`, auch wenn die UUID in `contextUuids` steht. Im POA&M löst sie zusätzlich gegen `contextUuids` auf; ein fehlendes Ziel ist `not-resolvable-in-context` ohne Diagnose, weil das POA&M kein `import-ar` besitzt und Beobachtungen per UUID übernimmt. Diagnosen tragen nur Code und strukturellen Pfad.

OSCAL garantiert für Evidenz weder eine Ressource (`relevant-evidence.href` ist optional), noch Ressourceninhalt (`back-matter.resource` verlangt nur `uuid`), noch einen Hash (`rlinks[].hashes` ist optional), noch eine Medienart oder einen Dateinamen (`media-type` und `base64.filename` sind optional), noch ein Ablaufdatum (`expires` ist optional), noch ein geschlossenes Vokabular für `methods`, `types` und `hash.algorithm`.

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
