# Vokabular-System — Grundschutz++ Navigator

Beschreibung der offiziellen BSI-Vokabular-Auflösung.

## Überblick

Das Vokabular-System ermöglicht die Anzeige der **offiziellen BSI-Definitionen** für Werte im Katalog. Der BSI Grundschutz++ referenziert standardisierte Begriffe, die in separaten CSV-Dateien (`Dokumentation/namespaces/` im BSI-Repository) definiert sind. Aktuell werden zehn Namespaces mitgeliefert:

| Vokabular | Datei |
|-----------|-------|
| Handlungswörter | `action_words.csv` |
| Elementare Gefährdungen | `basethreats.csv` |
| Dokumentationstypen | `documentation_guidelines.csv` |
| Aufwandsstufe (`0`–`5`) | `effort_level.csv` |
| Modalverb (`MUSS`, `SOLLTE`, `KANN`) | `modal_verbs.csv` |
| Ergebnis | `result.csv` |
| Sicherheitsniveau (`normal-SdT`, `erhöht`) | `security_level.csv` |
| Schutzziele (CIA + Authentizität) | `security_targets.csv` |
| Tags | `tags.csv` |
| Zielobjekt-Kategorien | `target_object_categories.csv` |

Die Anwendung lädt diese Vokabulare zur Build-Zeit von BSI und löst zur Laufzeit die Werte auf. Die Collection ist im `sourceRegistry` registriert; welche ihrer CSV-Dateien tatsächlich materialisiert und ausgeliefert werden, ergibt sich ausschließlich aus den `ns`-URLs des unterstützten Katalogs.

## Architektur

```
BSI Repository (Dokumentation/namespaces/*.csv)
        │
        ▼
scripts/fetch-catalog.mjs (+ vocabulary-utils.mjs)
• Extraktion der referenzierten Namespace-URLs aus dem Katalog
• Materialisierung nur der referenzierten CSV-Dateien aus der Registry-Collection
• Abruf und Prüfung am gepinnten Snapshot
• Konvertierung zu JSON
• Datei-Provenance + vollständiges Upstream-Manifest v2
        │
        ▼
public/data/
• vocabularies.json               (Alle Vokabulare)
• upstream-sources-metadata.json  (Provenance + Manifest)
        │
        ▼
VocabularyRegistry (Runtime)
• namespacesByUrl (Map)
• namespacesByRouteId (Map)
        │
        ▼
resolveVocabularyProp() / resolveControlVocabularies()
• PropValue → VocabularyEntry
```

## Vocabulary Types (`src/domain/models.ts`)

### VocabularyEntry

```typescript
interface VocabularyEntry {
  value: string;                    // Exact raw value
  definition?: string;              // Official definition
  columns: Record<string, string>;  // All columns
}
```

### VocabularyNamespaceSource

```typescript
interface VocabularyNamespaceSource {
  namespace: string;                // URL from OSCAL props
  repository: string;               // Upstream repository
  path: string;                     // Repository-relative path
  fileName: string;                 // e.g. "security_level.csv"
  routeId: string;                  // Stable route slug
  gitBlobSha: string;               // Git blob SHA
}
```

### VocabularyNamespaceData

```typescript
interface VocabularyNamespaceData {
  source: VocabularyNamespaceSource;
  columnOrder: string[];            // Preserved column order
  valueColumn: string;              // Header for exact lookup
  definitionColumn?: string;        // Header with definition
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

In `src/domain/vocabulary.ts`. Der Aufbau wirft bei doppelten Werten, Namespace-URLs oder Route-IDs, statt Einträge still zu überschreiben:

```typescript
export function buildVocabularyRegistry(
  data: VocabularyRegistryData,
): VocabularyRegistry {
  const namespaces = data.namespaces.map(createRuntimeNamespace);
  const namespacesByUrl = new Map<string, VocabularyNamespace>();
  const namespacesByRouteId = new Map<string, VocabularyNamespace>();

  for (const namespace of namespaces) {
    if (namespacesByUrl.has(namespace.source.namespace)) {
      throw new Error(/* duplicate namespace URL */);
    }
    if (namespacesByRouteId.has(namespace.source.routeId)) {
      throw new Error(/* duplicate route id */);
    }

    namespacesByUrl.set(namespace.source.namespace, namespace);
    namespacesByRouteId.set(namespace.source.routeId, namespace);
  }

  return { sourceCommitSha: data.sourceCommitSha, namespaces, namespacesByUrl, namespacesByRouteId };
}
```

## Vokabular-Auflösung

### resolveVocabularyEntry

Exakter Lookup über Namespace-URL und Wert:

```typescript
export function resolveVocabularyEntry(
  registry: VocabularyRegistry | null | undefined,
  namespaceUrl: string | undefined,
  value: string | undefined,
): VocabularyResolution | null;
```

### resolveVocabularyProp / resolveVocabularyValues

```typescript
// Einzelne Prop (nutzt prop.ns + prop.value)
export function resolveVocabularyProp(
  registry: VocabularyRegistry | null | undefined,
  prop: PropValue | undefined,
): VocabularyResolution | null;

// Mehrere Werte gegen denselben Namespace (z.B. Tags, Gefährdungen)
export function resolveVocabularyValues(
  registry: VocabularyRegistry | null | undefined,
  namespaceUrl: string | undefined,
  values: string[],
): VocabularyResolution[];
```

`resolvePropVocabularyEntry` und `resolveVocabularyEntries` sind gleichbedeutende Aliase (Rückgabetyp `ResolvedVocabularyEntry`).

### getVocabularyNamespaceByRouteId

Lookup für die Routing-Ebene (`/vokabular/:namespaceId`):

```typescript
export function getVocabularyNamespaceByRouteId(
  registry: VocabularyRegistry | null | undefined,
  routeId: string | undefined,
): VocabularyNamespace | null;
```

### resolveControlVocabularies

Löst alle Vokabular-Props einer Control auf einmal auf — inklusive Schutzziele und elementare Gefährdungen:

```typescript
export interface ResolvedControlVocabularies {
  modalverb: VocabularyResolution | null;
  securityLevel: VocabularyResolution | null;
  effortLevel: VocabularyResolution | null;
  tags: VocabularyResolution[];
  securityTargets: {
    confidentiality: VocabularyResolution | null;
    integrity: VocabularyResolution | null;
    availability: VocabularyResolution | null;
    authenticity: VocabularyResolution | null;
  };
  threats: VocabularyResolution[];
  statement: {
    ergebnis: VocabularyResolution | null;
    praezisierung: VocabularyResolution | null;
    handlungsworte: VocabularyResolution | null;
    dokumentation: VocabularyResolution | null;
    zielobjektKategorien: VocabularyResolution[];
  };
}
```

Besonderheit Schutzziele: Die Control-Props tragen als Wert die Relevanz (`0`–`2`), das Vokabular `security_targets.csv` ist aber nach Schutzziel-Namen indiziert. Die Auflösung erfolgt deshalb über feste Lookup-Werte (`'Vertraulichkeit (Confidentiality)'`, `'Integrität (Integrity)'`, `'Verfügbarkeit (Availability)'`, `'Authentizität (Authenticity)'`) gegen den Namespace der jeweiligen Prop.

### Such-Text-Sammlung

Für die globale Volltextsuche unter `/suche` werden alle Spaltenwerte der
aufgelösten Vokabular-Einträge eingesammelt:

```typescript
export function collectVocabularySearchTexts(
  resolutions: Array<VocabularyResolution | null>,
): string[];

export function collectControlVocabularySearchTexts(
  resolved: ResolvedControlVocabularies,
): string[];
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
  confidentialityProp?: PropValue;
  integrityProp?: PropValue;
  availabilityProp?: PropValue;
  authenticityProp?: PropValue;
  threatsProp?: PropValue;
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

Für die Quell-Links auf den exakten Upstream-Stand:

```typescript
export function buildVocabularySourceUrl(
  source: Pick<VocabularyNamespaceSource, 'namespace' | 'repository' | 'path'>,
  snapshotCommitSha: string | null | undefined,
): string {
  if (!source.repository || !source.path) {
    return source.namespace;
  }

  const repositoryUrl = source.repository.replace(/\/+$/, '');
  const encodedPath = encodeRepositoryPath(source.path);

  if (!encodedPath) {
    return source.namespace;
  }

  if (snapshotCommitSha) {
    return `${repositoryUrl}/blob/${encodeURIComponent(snapshotCommitSha)}/${encodedPath}`;
  }

  return `${repositoryUrl}/tree/main/${encodedPath}`;
}
```

## CatalogContext-Integration

`vocabularies.json` wird parallel zum Katalog als ArrayBuffer geladen und die Registry per `buildVocabularyRegistry` gebaut. Der Ladepfad gleicht das Artefakt per SHA-256 gegen den Integrity-Block in `upstream-sources-metadata.json` ab; das Ergebnis (`vocabularyVerification`) wird auf der Seite `/about` angezeigt (Details in [INTEGRITY.md](./INTEGRITY.md)). Fehlt `vocabularies.json`, läuft die App ohne Registry weiter. Fehlen nur die Metadaten, bleibt die aus dem vorhandenen Artefakt gebaute Registry nutzbar; Provenance und Verifikation bleiben dann leer und es wird eine Warnung in der Konsole protokolliert.

## Vocabulary-Seiten

### VocabularyOverviewPage (`/vokabular`)

Übersicht aller Vokabulare mit:

- Liste aller Namespaces
- Routen-Link zu jedem Namespace
- Anzahl der Einträge

### VocabularyNamespacePage (`/vokabular/:namespaceId`)

Detailseite für einen Namespace:

- Alle Einträge als auswählbare Link-Liste
- Einzelner Eintrag per Query-Parameter `?wert=` adressierbar (Deep-Link aus Control-Details)
- Definition und weitere nichtleere Spalten werden für den aktiven Eintrag mit `InlineVocabularyEntryDetails` direkt unter der Listenzeile eingeblendet
- Reihenfolge der Zusatzspalten folgt `columnOrder`

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- `src/domain/vocabulary.ts` — Vocabulary-Implementierung
- `src/domain/models.ts` — Vocabulary Types
- `src/state/CatalogContext.tsx` — Context-Integration
- `scripts/fetch-catalog.mjs` — Vocabulary-Abruf
- `scripts/vocabulary-utils.mjs` — Build-Hilfsfunktionen
