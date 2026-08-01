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

/** Root wrapper — OSCAL-Dateien wrappen den Katalog in { catalog: ... } */
interface RawOscalDocument {
  catalog: RawOscalCatalog;
}
```

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
  catalogKey?: CatalogKey;
}

export function parseCatalog(
  raw: unknown,
  options: ParseCatalogOptions = {},
): Catalog {
  const catalogKey = options.catalogKey ?? SUPPORTED_CATALOG_KEY;

  // Accept both { catalog: ... } wrapper and direct catalog object
  const doc = raw as Record<string, unknown>;
  const catalog: RawOscalCatalog = (
    doc.catalog ? doc.catalog : doc
  ) as RawOscalCatalog;

  if (!catalog.uuid || !catalog.metadata || !catalog.groups) {
    throw new Error(
      'Invalid OSCAL catalog: missing uuid, metadata, or groups',
    );
  }

  // ... parsePractice() je Gruppe, beide Control-Indizes, parseBackMatter()
}
```

Der optionale `catalogKey` stammt aus dem Quellregister. Beim Aufbau von `controlsByAltIdentifier` failt `parseCatalog` geschlossen, wenn ein Control keinen Alt-Identifier besitzt oder derselbe Wert innerhalb des Katalogs mehrfach vorkommt.

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
  catalog: Catalog | null;
  provenance: CatalogProvenance | null;
  verification: VerificationResult | null;
  vocabularyRegistry: VocabularyRegistry | null;
  vocabularyProvenance: VocabularyProvenance | null;
  vocabularyVerification: VerificationResult | null;
  loading: boolean;
  error: string | null;
}
```

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- [OSCAL_VERSION_MATRIX.md](./OSCAL_VERSION_MATRIX.md) — Versionsmatrix, Schema-Provenienz, Migrationspolitik
- [OSCAL_VALIDATION.md](./OSCAL_VALIDATION.md) — Validierungsvertrag
- `src/domain/models.ts` — TypeScript Definitionen
- `src/adapters/oscalAdapter.ts` — Parser-Implementierung
