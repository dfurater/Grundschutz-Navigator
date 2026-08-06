# Domänenmodelle — Grundschutz++ Navigator

Beschreibung der Zwei-Schichten-Architektur der Datentypen.

## Überblick

Die Anwendung verwendet ein **Zwei-Schichten-Modell** für die Datentypen:

1. **Raw OSCAL Types** — Spiegelt die JSON-Struktur des BSI Katalogs
2. **Enriched Domain Types** — Flach, typsicher, UI-bereit

Diese Trennung ermöglicht:
- Isolierung der externen Datenstruktur
- Typsichere interne Verarbeitung
- Einfache Aktualisierung bei OSCAL-Updates

Beide Schichten sind **Compile-Zeit-Konstrukte**. Zur Laufzeit filtern sie
nichts: Der Quellgraph bleibt vollständig erhalten und wird vom
Dokumentmodell neben dem angereicherten Katalog geführt — siehe
[Verlustfreies Dokumentmodell](#verlustfreies-dokumentmodell).

## Verlustfreies Dokumentmodell

Der Katalogpfad folgt dem verbindlichen Vertrag aus
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
[Root-Dispatch](#root-envelope-und-root-dispatch): Dass hier ein Katalog
vorliegt, wird geprüft und nicht angenommen. `parseCatalog()` bleibt die reine
Ableitungsfunktion und bekommt nur noch den **Katalogkörper**.

### Vertrauensklasse ist ein Ergebnis, keine Herkunftsangabe

Klasse 1 ist nach [ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2)
§10 über drei Eigenschaften definiert:
Quellregister-Herkunft, Manifest-v2-Provenienz **und bestandene
Laufzeit-Hashprüfung**. Ein Dokument darf sich deshalb erst dann
`class-1-verified-public` nennen, wenn diese Prüfung tatsächlich gelaufen und
erfolgreich war.

`CatalogProvider` baut das Dokument aus diesem Grund **nach** der
Integritätsprüfung, nicht davor. Fehlen die Metadaten oder weicht der Hash ab,
bleibt das Dokument nutzbar, trägt aber `class-1-unverified-public`. Ein
Konsument, der sich auf die Klasse verlässt, akzeptiert damit keinen
ungeprüften Katalog als geprüft.

Die Verifikationsdetails selbst bleiben unverändert in
`CatalogState.verification`; die Klasse dupliziert sie nicht, sondern fasst
nur ihr Ergebnis für die Dokumentebene zusammen.

### Warum

Ohne erhaltenen Quellgraphen ist jeder spätere Export zwangsläufig
verlustbehaftet — und zwar nicht nur für unbekannte Felder, sondern belegbar
auch für reguläre OSCAL-Strukturen, die das Domänenmodell nicht abbildet:

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
JSON-Informationsmodells**, nicht byteidentisch zur Quelldatei. Bewahrt wird
das Ergebnis von `JSON.parse`: alle Schlüssel, Werte, Verschachtelungen,
Array-Reihenfolgen und die Einfügereihenfolge nicht-numerischer Schlüssel.
Nicht bewahrt werden Formatierung, Einrückung und Zeilenenden.

`source` ist bewusst als `unknown` typisiert: `JSON.parse` liefert keine
geprüfte Struktur, und der Vertrag filtert den Quellgraphen ausdrücklich nicht
nach bekannten Feldern. Unbekannte Felder bleiben ausschließlich in `source`
— sie werden nie ins `view` gehoben, nie gerendert und nie interpretiert, aber
auch nie entfernt.

### Speicherstrategie: String-Sharing

Der Quellgraph kostet zusätzlichen Heap, aber weit weniger als die Dateigröße
vermuten lässt. Grund ist das **String-Sharing**: Das Domänenmodell übernimmt
Titel, Prosa und Prop-Werte per Referenz auf dieselben Quellstrings, statt sie
zu kopieren — in `src/adapters/oscalAdapter.ts` unter anderem
`title: raw.title`, `statementRaw` und `value: prop.value`.

Geteilt werden dabei ausschließlich **Strings** — sie sind unveränderlich, ihr
Teilen ist folgenlos. Objekte und Arrays werden nie geteilt: Der Adapter kopiert
auch `responsible-parties/party-uuids` und `rlinks/hashes` samt der einzelnen
Hash-Objekte, weil eine Mutation am Domänenmodell sonst auf den Quellgraphen
durchschlüge. `src/adapters/oscalDocument.test.ts` prüft die Trennung generisch
über Objektidentitäten, nicht an einzelnen Beispielpfaden.

Damit trägt der Quellgraph im Wesentlichen nur seine Container-Hüllen bei.
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
geholt. Deshalb prüfen die Tests gegen ihn ausschließlich **Erhaltung**
(Vergleich Original ↔ `source`), nie feste Inhaltszahlen. Die inhaltlich
festgenagelten Strukturprüfungen laufen gegen das eingefrorene Fixture, das
alle verlustkritischen Strukturen trägt — auch die, die der reale Katalog
derzeit nicht enthält.

## Raw OSCAL Types

Die Raw Types befinden sich in `src/domain/models.ts` und entsprechen 1:1 der OSCAL 1.1.3 JSON-Struktur:

### Grundstrukturen

```typescript
interface RawOscalProp {
  name: string;
  value: string;
  ns?: string;
  class?: string;
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

## Root-Envelope und Root-Dispatch

Bis
[GSPP-285](https://linear.app/grundschutz-plus-plus/issue/GSPP-285)
war die Typebene auf einen Root verdrahtet (`RawOscalDocument { catalog }`),
und der Adapter deutete zur Laufzeit jedes Dokument ohne `catalog`-Key
stillschweigend als Katalog. Beides ist ersetzt: Der Envelope kennt alle acht
OSCAL-Root-Keys, und genau **eine** Stelle bestimmt den Root-Typ.

### Envelope-Typen

```typescript
/** Gemeinsamer Anteil aller acht Roots: metadata ist überall Pflichtfeld. */
interface RawOscalRootBody {
  metadata: RawOscalMetadata;
}

/** Nur modellierte Roots tragen ihren eigenen Körpertyp. */
type RawOscalRootBodyFor<K extends OscalRootKey> =
  K extends 'catalog' ? RawOscalCatalog : RawOscalRootBody;

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
im Zweifel ablehnen, nie „bestmöglich“ interpretieren. Die Prüfreihenfolge ist
festgelegt, damit ein Dokument die inhaltlich engste Diagnose erhält.

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
durchgereicht; der Dispatch enthält weder eine eigene Versionskonstante noch
eine Kopie der Matrixlogik. Schritt 4 und 7 sind bewusst unterscheidbar:
„kenne ich nicht“ ist etwas anderes als „kenne ich, kann ich aber noch nicht
verarbeiten“.

`$schema` ist zulässig und zählt nicht als zweiter Root. Es ist aber niemals
Versionsautorität — allein `metadata.oscal-version` wählt die Matrixzelle,
`$schema` wird nur als Kreuzprobe ausgewertet.

Nicht Aufgabe des Dispatch: Stufe-1-Prüfungen wie Größenlimit oder doppelte
Member-Namen ([GSPP-289](https://linear.app/grundschutz-plus-plus/issue/GSPP-289)
— auf einem `JSON.parse`-Ergebnis grundsätzlich nicht mehr erkennbar) und die
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
Root-Modell erfordert genau zwei Schritte und keine Änderung an bestehenden
Adaptern:

1. Modelladapter als eigene Datei unter `src/adapters/` anlegen, mit eigenem
   Testvertrag. Er bekommt den **Root-Körper** und den Kontext — nicht das
   Gesamtdokument und keine Zuständigkeit für die Root-Bestimmung. Braucht das
   Modell eine Identität, die nicht im Dokument steht, löst er sie aus Kontext
   oder Quellregister auf und bricht sonst ab; ein Default würde sie erfinden.
2. Einen Eintrag in `OSCAL_ROOT_ADAPTERS` ergänzen und, falls der Körper
   modelliert wird, den Zweig in `RawOscalRootBodyFor` erweitern.

Modulgrenzen: Geteilt werden Envelope, Root-Erkennung, Versionsbindung und
Diagnosevertrag. Parsing und Read-Model-Ableitung bleiben je Root-Typ in
fokussierten Modulen — ein zentraler Universaladapter entsteht ausdrücklich
nicht, und `models.ts` wächst dafür nicht zu einer monolithischen Modellschicht.

| Root-Key | Layer | Adapter | Status |
| --- | --- | --- | --- |
| `catalog` | Control | `src/adapters/oscalAdapter.ts` | registriert |
| `profile` | Control | — | [GSPP-240](https://linear.app/grundschutz-plus-plus/issue/GSPP-240) |
| `mapping-collection` | Control | — | [GSPP-245](https://linear.app/grundschutz-plus-plus/issue/GSPP-245) |
| `component-definition` | Implementation | — | [GSPP-248](https://linear.app/grundschutz-plus-plus/issue/GSPP-248) |
| `system-security-plan` | Implementation | — | [GSPP-293](https://linear.app/grundschutz-plus-plus/issue/GSPP-293) |
| `assessment-plan` | Assessment | — | nicht erschlossen |
| `assessment-results` | Assessment | — | nicht erschlossen |
| `plan-of-action-and-milestones` | Assessment | — | nicht erschlossen |

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

### Modalverb

```typescript
type Modalverb = 'MUSS' | 'SOLLTE' | 'KANN';
```

### ControlLink

```typescript
type LinkRelation = 'related' | 'required';

interface ControlLink {
  targetId: string;
  relation: LinkRelation;
}
```

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

  groupId: string;               // e.g. "GC.1" (Topic)
  practiceId: string;            // e.g. "GC" (Practice)

  securityLevel?: SecurityLevel;
  securityLevelProp?: PropValue;
  effortLevel?: EffortLevel;
  effortLevelProp?: PropValue;
  modalverb?: Modalverb;
  modalverbProp?: PropValue;

  tags: string[];
  tagsProp?: PropValue;

  // Schutzziele (CIA + Authentizität), Relevanz 0–2
  confidentiality?: SecurityTargetRelevance;
  confidentialityProp?: PropValue;  // ns → security_targets_levels.csv
  integrity?: SecurityTargetRelevance;
  integrityProp?: PropValue;        // ns → security_targets_levels.csv
  availability?: SecurityTargetRelevance;
  availabilityProp?: PropValue;     // ns → security_targets_levels.csv
  authenticity?: SecurityTargetRelevance;
  authenticityProp?: PropValue;     // ns → security_targets_levels.csv

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
  params: Record<string, string>;  // Inline parameter values
}
```

Die `*Prop`-Felder behalten den OSCAL-Namespace (`ns`) der Quell-Prop und ermöglichen so die Auflösung gegen die offiziellen BSI-Vokabulare (siehe [VOCABULARY.md](./VOCABULARY.md)).

### Topic (Thema)

```typescript
interface Topic {
  id: string;              // e.g. "GC.1"
  title: string;
  label: string;           // e.g. "1"
  altIdentifier?: string;
  practiceId: string;
  controlCount: number;
  controlIds: string[];
}
```

### Practice (Praktik)

```typescript
interface Practice {
  id: string;              // e.g. "GC"
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

### ControlRef (interne Referenzidentität)

```typescript
interface ControlRef {
  catalogKey: CatalogKey;
  controlId: string;
}
```

`ControlRef` modelliert die kataloggescopte interne OSCAL-Referenzidentität und steht für katalogübergreifende Auflösung bereit. Der aktuelle aktive Katalog hält Parent-/Child- und Link-Ziele weiterhin als kataloginterne String-IDs. URLs verwenden bewusst nicht `controlId`, sondern `catalogKey + altIdentifier`.

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

  if (!catalog?.uuid || !catalog.metadata || !catalog.groups) {
    throw new Error(
      'Invalid OSCAL catalog: missing uuid, metadata, or groups',
    );
  }

  // ... parsePractice() je Gruppe, beide Control-Indizes, parseBackMatter()
}
```

Der `catalogKey` stammt aus dem Quellregister und ist **Pflicht**: Die Katalogidentität nach [ADR-1](https://linear.app/grundschutz-plus-plus/issue/ADR-1) steht nicht im Dokument, und ein Default würde sie erfinden — ein WLAN-Katalog käme sonst als `gspp` heraus, sobald ein Aufrufer sie vergisst. Der Katalogadapter löst sie über `resolveCatalogKey()` auf: erst aus dem Kontext, dann aus dem Quellregister über `upstreamPath`, sonst bricht er ab.

Beim Aufbau von `controlsByAltIdentifier` failt `parseCatalog` geschlossen, wenn ein Control keinen Alt-Identifier besitzt oder derselbe Wert innerhalb des Katalogs mehrfach vorkommt.

Der Envelope wird hier **nicht** ausgepackt: Welcher Root-Typ vorliegt,
entscheidet allein der [Root-Dispatch](#root-envelope-und-root-dispatch). Der
frühere Fallback `doc.catalog ? doc.catalog : doc` deutete jedes Dokument ohne
`catalog`-Key als Katalog und ist ersatzlos entfallen.

### Rekursives Steuerungs-Parsing

Nested Controls (Enhancements) werden rekursiv entpackt:

```typescript
export function parseControlRecursive(
  raw: RawOscalControl,
  groupId: string,
  practiceId: string,
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
  return resolved.replace(/\{\{([^}]*)\}\}/g, '$1');
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

Das Update-Contract mit dem BSI-Repository (Basis für `update-catalog.yml` und das Snapshot-Pinning):

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
interface CatalogState {
  catalogDocument: CatalogDocument | null;  // source + context + view
  catalog: Catalog | null;                  // === catalogDocument.view
  provenance: CatalogProvenance | null;
  verification: VerificationResult | null;
  vocabularyRegistry: VocabularyRegistry | null;
  vocabularyProvenance: VocabularyProvenance | null;
  vocabularyVerification: VerificationResult | null;
  loading: boolean;
  error: string | null;
}
```

`catalog` wird im Reducer immer aus `catalogDocument.view` gesetzt; beide
Felder können deshalb nicht auseinanderlaufen. Komponenten lesen weiterhin
`catalog`. Wer Zugriff auf Felder braucht, die das Domänenmodell nicht
abbildet, geht über `catalogDocument.source`.

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
