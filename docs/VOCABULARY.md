# Vokabular-System — Grundschutz++ Navigator

Beschreibung der offiziellen BSI-Vokabular-Auflösung.

## Überblick

Das Vokabular-System ermöglicht die Anzeige der **offiziellen BSI-Definitionen** für Werte im Katalog. Der BSI Grundschutz++ enthält zahlreichestandardisierte Begriffe, die in separaten CSV-Dateien definiert sind:

- Sicherheitsniveau (`normal-SdT`, `erhöht`)
- Aufwandsstufe (`0`–`5`)
- Modalverb (`MUSS`, `SOLLTE`, `KANN`)
- Tags
- Zielobjekt-Kategorien
- Handlungswörter
- Dokumentationstypen

Die Anwendung lädt diese Vokabulare zur Build-Zeit von BSI und löst zur Laufzeit die Werte auf.

## Architektur

```
BSI Repository (Vocabulary files)
        │
        ▼
scripts/fetch-catalog.sh
• Abruf aller Vocabulary-CSV-Dateien
• Konvertierung zu JSON
• Generierung Metadata
        │
        ▼
public/data/
• vocabularies.json           (Alle Vokabulare)
• vocabularies-metadata.json (Provenance)
• upstream-sources-metadata.json
        │
        ▼
VocabularyRegistry (Runtime)
• namespacesByUrl (Map)
• namespacesByRouteId (Map)
        │
        ▼
resolveVocabularyProp()
• PropValue → VocabularyEntry
```

## Vocabulary Types (`src/domain/models.ts`)

### VocabularyEntry

```typescript
interface VocabularyEntry {
  value: string;                    // Exact raw value
  definition?: string;               // Official definition
  columns: Record<string, string>;  // All columns
}
```

### VocabularyNamespaceSource

```typescript
interface VocabularyNamespaceSource {
  namespace: string;                 // URL from OSCAL props
  repository: string;                // Upstream repository
  path: string;                     // Repository-relative path
  fileName: string;                  // e.g. "security_level.csv"
  routeId: string;                  // Stable route slug
  gitBlobSha: string;               // Git blob SHA
}
```

### VocabularyNamespaceData

```typescript
interface VocabularyNamespaceData {
  source: VocabularyNamespaceSource;
  columnOrder: string[];              // Preserved column order
  valueColumn: string;              // Header for exact lookup
  definitionColumn?: string;          // Header with definition
  entries: VocabularyEntry[];
}
```

### VocabularyNamespace (Runtime)

```typescript
interface VocabularyNamespace extends VocabularyNamespaceData {
  entriesByValue: Map<string, VocabularyEntry>;
}
```

### VocabularyRegistryData (Build)

```typescript
interface VocabularyRegistryData {
  sourceCommitSha: string;
  namespaces: VocabularyNamespaceData[];
}
```

### VocabularyRegistry (Runtime)

```typescript
interface VocabularyRegistry {
  sourceCommitSha: string;
  namespaces: VocabularyNamespace[];
  namespacesByUrl: Map<string, VocabularyNamespace>;
  namespacesByRouteId: Map<string, VocabularyNamespace>;
}
```

### VocabularyResolution

```typescript
interface VocabularyResolution {
  namespace: VocabularyNamespace;
  entry: VocabularyEntry;
}
```

## Vocabulary Registry Aufbau

In `src/domain/vocabulary.ts`:

```typescript
export function buildVocabularyRegistry(
  data: VocabularyRegistryData,
): VocabularyRegistry {
  const namespaces = data.namespaces.map<VocabularyNamespace>((namespace) => ({
    ...namespace,
    entriesByValue: new Map(
      namespace.entries.map((entry) => [entry.value, entry]),
    ),
  }));

  return {
    sourceCommitSha: data.sourceCommitSha,
    namespaces,
    namespacesByUrl: new Map(
      namespaces.map((namespace) => [namespace.source.namespace, namespace]),
    ),
    namespacesByRouteId: new Map(
      namespaces.map((namespace) => [namespace.source.routeId, namespace]),
    ),
  };
}
```

## Vokabular-Auflösung

### resolveVocabularyEntry

```typescript
export function resolveVocabularyEntry(
  registry: VocabularyRegistry | null | undefined,
  namespaceUrl: string | undefined,
  value: string | undefined,
): VocabularyResolution | null {
  if (!registry || !namespaceUrl || !value) {
    return null;
  }

  const namespace = registry.namespacesByUrl.get(namespaceUrl);
  if (!namespace) {
    return null;
  }

  const entry = namespace.entriesByValue.get(value);
  if (!entry) {
    return null;
  }

  return { namespace, entry };
}
```

### resolveVocabularyProp

```typescript
export function resolveVocabularyProp(
  registry: VocabularyRegistry | null | undefined,
  prop: PropValue | undefined,
): VocabularyResolution | null {
  return resolveVocabularyEntry(registry, prop?.ns, prop?.value);
}
```

### resolveControlVocabularies

```typescript
export function resolveControlVocabularies(
  registry: VocabularyRegistry | null | undefined,
  control: Control,
): ResolvedControlVocabularies {
  return {
    modalverb: resolveVocabularyProp(registry, control.modalverbProp),
    securityLevel: resolveVocabularyProp(registry, control.securityLevelProp),
    effortLevel: resolveVocabularyProp(registry, control.effortLevelProp),
    tags: resolveVocabularyValues(registry, control.tagsProp?.ns, control.tags),
    statement: {
      ergebnis: resolveVocabularyProp(registry, control.statementProps.ergebnisProp),
      praezisierung: resolveVocabularyProp(
        registry,
        control.statementProps.praezisierungProp,
      ),
      handlungsworte: resolveVocabularyProp(
        registry,
        control.statementProps.handlungsworteProp,
      ),
      dokumentation: resolveVocabularyProp(
        registry,
        control.statementProps.dokumentationProp,
      ),
      zielobjektKategorien: resolveVocabularyValues(
        registry,
        control.statementProps.zielobjektKategorienProp?.ns,
        control.statementProps.zielobjektKategorien,
      ),
    },
  };
}
```

## PropValue Struktur

Die PropValue-Typen enthalten die Namespace-Information für die Auflösung:

```typescript
interface PropValue {
  name: string;
  value: string;
  ns?: string;  // Vocabulary namespace URL
}
```

Im Control:

```typescript
interface Control {
  // ...
  modalverbProp?: PropValue;        // ns = vocabulary namespace URL
  securityLevelProp?: PropValue;
  effortLevelProp?: PropValue;
  tagsProp?: PropValue;
  // ...
  statementProps: {
    ergebnisProp?: PropValue;
    praezisierungProp?: PropValue;
    handlungsworteProp?: PropValue;
    dokumentationProp?: PropValue;
    zielobjektKategorienProp?: PropValue;
  };
}
```

## URL-Aufbau

Vokabular-Namensräume haben stabilen Routing-Slugs:

```typescript
export function buildVocabularySourceUrl(
  source: Pick<VocabularyNamespaceSource, 'namespace' | 'repository' | 'path'>,
  snapshotCommitSha: string | null | undefined,
): string {
  const repositoryUrl = source.repository.replace(/\/+$/, '');
  const encodedPath = encodeRepositoryPath(source.path);

  if (snapshotCommitSha) {
    return `${repositoryUrl}/blob/${encodeURIComponent(snapshotCommitSha)}/${encodedPath}`;
  }

  return `${repositoryUrl}/tree/main/${encodedPath}`;
}
```

## VocabularyContext

In `CatalogContext` integriert:

```typescript
// Fetch vocabulary as ArrayBuffer for integrity check + text for parsing
const { buffer: vocabularyBuffer, text: vocabularyText } =
  await fetchCatalogWithBuffer(vocabulariesUrl);

// Build runtime registry
vocabularyRegistry = buildVocabularyRegistry(
  JSON.parse(vocabularyText) as VocabularyRegistryData,
);

// Verify integrity
vocabularyVerification = await verifyArtifactIntegrity(
  vocabularyBuffer,
  vocabularyProvenance,
);
```

## VocabularyPages

### VocabularyOverviewPage

Übersicht aller Vokabulare mit:

- Liste aller Namespaces
- Routen-Link zu jedem Namespace
- Anzahl der Einträge

### VocabularyNamespacePage

Detailseite für einen Namespace:

- Alle Einträge als Tabelle
- Durchsuchbar
- Nach Wert sortierbar
- Spalten-Konfiguration aus `columnOrder`

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- `src/domain/vocabulary.ts` — Vocabulary-Implementierung
- `src/domain/models.ts` — Vocabulary Types
- `src/state/CatalogContext.tsx` — Context-Integration
- `scripts/fetch-catalog.sh` — Vocabulary-Abruf
- `scripts/vocabulary-utils.mjs` — Build-Hilfsfunktionen