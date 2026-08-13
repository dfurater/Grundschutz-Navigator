# Vokabular-System — Grundschutz++ Navigator

Beschreibung der offiziellen BSI-Vokabular-Auflösung.

## Überblick

Das Vokabular-System ermöglicht die Anzeige der **offiziellen BSI-Definitionen** für Werte im Katalog. Die Anwendung liefert alle 13 CSV-Dateien direkt aus `documentation/namespaces/` im gepinnten BSI-Snapshot aus. Katalogseitige `ns`-Referenzen bestimmen weiterhin, welche Vokabulare einzelne OSCAL-Props kontextuell auflösen; sie begrenzen nicht mehr die Auslieferungs-Membership.

| Vokabular | Datei |
|-----------|-------|
| Handlungswörter | `action_words.csv` |
| Elementare Gefährdungen | `basethreats.csv` |
| Dokumentationstypen | `documentation_guidelines.csv` |
| Aufwandsstufe (`0`–`5`) | `effort_level.csv` |
| Modalverb (`MUSS`, `SOLLTE`, `KANN`) | `modal_verbs.csv` |
| Praktiken | `practices.csv` |
| Ergebnis | `result.csv` |
| Sicherheitsniveau (`normal-SdT`, `erhöht`) | `security_level.csv` |
| Schutzziele (CIA + Authentizität) | `security_targets.csv` |
| Schutzziel-Relevanz (`0`–`2`) | `security_targets_levels.csv` |
| Tags | `tags.csv` |
| Themen | `topics.csv` |
| Zielobjekt-Kategorien | `target_object_categories.csv` |

Die Anwendung lädt diese Vokabulare zur Build-Zeit von BSI. Die Collection ist im `sourceRegistry` als freigegebenes Verzeichnis mit dem Suffix `.csv` registriert. Materialisiert werden ausschließlich reguläre CSV-Dateien direkt in diesem Verzeichnis; Unterverzeichnisse, `.txt`, `readme.md` und andere Pfade bleiben ausgeschlossen. Jede ausgelieferte Datei wird einzeln per Git-Blob-SHA und Content-Hash an den gepinnten Snapshot gebunden.

## Architektur

```
BSI Repository (documentation/namespaces/*.csv)
        │
        ▼
scripts/fetch-catalog.mjs (+ vocabulary-utils.mjs)
• Validierung der referenzierten Namespace-URLs aus dem Katalog
• Materialisierung aller direkten .csv-Mitglieder der Registry-Collection
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
  securityTargetLevels: {
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

Besonderheit Schutzziele: Die Control-Props tragen als Wert die Relevanz (`0`–`2`), das Vokabular `security_targets.csv` ist aber nach Schutzziel-Namen indiziert. Der Adapter setzt deshalb für die vier Relevanz-Props den kanonischen synthetischen Namespace von `security_targets_levels.csv`. `securityTargetLevels` löst die Prop anschließend generisch über diesen Namespace auf.

Die Typdefinitionen bleiben davon getrennt: `securityTargets` verwendet feste Lookup-Werte (`'Vertraulichkeit (Confidentiality)'`, `'Integrität (Integrity)'`, `'Verfügbarkeit (Availability)'`, `'Authentizität (Authenticity)'`) gegen den kanonischen Namespace von `security_targets.csv`. Die Detailansicht bietet für Typ und Relevanz zwei unabhängige Definitionen an. Ein unbekannter Wert oder eine fehlende Registry wird nicht ausgeblendet, sondern mit dem Rohwert und einer sichtbaren Diagnose dargestellt.

### Taxonomie-Auflösung per UUID

`resolvePracticeVocabulary()` in `src/domain/taxonomyVocabulary.ts` verbindet eine
Katalog-Praktik ausschließlich über `Practice.altIdentifier` mit der Spalte
`UUID` aus `practices.csv`. Titel, Kürzel und Nummerierung sind ausdrücklich
keine Fallback-Schlüssel. Fehlt die UUID oder existiert kein exakter Treffer,
liefert der Resolver `null`. Fetch und Catalog-Sync-Guard lehnen fehlende oder
doppelte UUIDs sowie nicht zugeordnete Katalog-Praktiken oder CSV-Einträge vor
der Artefaktausgabe ab; `practices.csv` ist dabei verpflichtend. Die
Laufzeitauflösung behält die Duplikatprüfung als zusätzliche
Integritätssicherung bei.

Im ControlDetail-Breadcrumb werden Definition, `Schwerpunkt` und
`auch bekannt als` aus dem aufgelösten Eintrag angeboten. Die technischen
Spalten `UUID` und `Nummerierung` bleiben dort verborgen, sind aber zusammen mit
allen anderen Originalspalten weiterhin auf `/vokabular` einsehbar. Nur der
Aliastext wird zusätzlich in den FlexSearch-Metadatenindex der zugehörigen
Kontrollen übernommen.

`resolveTopicVocabulary()` verwendet denselben strikten UUID-Join für
`Topic.altIdentifier` und `topics.csv`. Mehrere Katalog-Untergruppen dürfen
dieselbe fachliche Themen-UUID teilen und lösen dann auf denselben Eintrag auf.
Fehlt die UUID oder der CSV-Treffer, bleibt das Thema im
ControlDetail-Breadcrumb sichtbar und erhält den dezenten Hinweis
„keine offizielle Definition“. Umgekehrt bleiben CSV-Einträge ohne
Katalogtreffer vollständig auf `/vokabular` auffindbar; Definitionen werden
nicht auf Übersichtsseiten dupliziert.

Für den am 2026-08-13 im Manifest gepinnten BSI-Snapshot
`80694713a7a430d12eb2099893de23ad8bb6f780` wurde die Deckung gemessen:
140 Katalog-Untergruppen verwenden 120
verschiedene UUIDs und lösen vollständig auf die 120 CSV-Einträge auf. Es gibt
kein Katalogthema ohne Treffer und keinen verwaisten CSV-Eintrag.
Die UI-Tests halten dennoch beide Abweichungsrichtungen für künftige Snapshots
sichtbar. Fetch und Catalog-Sync-Guard behandeln solche Abweichungen zugleich
für jeden Snapshot als Integritätsfehler. Die Zählwerte bleiben in der
Provenienz sichtbar, blockieren aber keine konsistente Mengenänderung des BSI.

Für `practices.csv` gilt eine namentlich begrenzte Ausnahme: Das BSI liefert
die Beispielpraktik „EXMP“ ohne zugehörige Katalog-Gruppe
mit aus. Genau diese UUID ist in `TOLERATED_ORPHAN_PRACTICE_UUIDS` geduldet und
wird separat als `toleratedOrphanCsvEntryCount` ausgewiesen; jede andere
verwaiste CSV-Zeile lässt den Guard weiterhin hart fehlschlagen. Die gemessene
Practice-Deckung wird unter `taxonomyCoverage.practices` in
`upstream-sources-metadata.json` als Provenienz des Fetch-Laufs festgehalten.

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
- Listeneintrag zeigt `entry.value`; ist `valueColumn` nicht selbst `Begriff` (z. B. `basethreats.csv` mit `valueColumn: "ID"`), wird zusätzlich der Wert der Spalte `Begriff` mit Abstand angehängt (z. B. „G 0.1 Feuer"), sofern vorhanden und von `entry.value` verschieden
- Einzelner Eintrag per Query-Parameter `?wert=` adressierbar (Deep-Link aus Control-Details)
- Definition und weitere nichtleere Spalten werden für den aktiven Eintrag mit `InlineVocabularyEntryDetails` direkt unter der Listenzeile eingeblendet, ohne Breitenbeschränkung (nutzt die volle Kartenbreite)
- Reihenfolge der Zusatzspalten folgt `columnOrder`

## Darstellungskonventionen im Vergleich

Für Namespaces mit eigener `Begriff`-Spalte neben der ID (`basethreats.csv`) gelten bewusst zwei unterschiedliche Konventionen:

| Ort | Darstellung | Begründung |
|---|---|---|
| Vokabular-Listenansicht (`/vokabular/:namespaceId`) | `G 0.1 Feuer` — ID zuerst | Die ID ist dort Sortier- und Nachschlageschlüssel |
| Control-Detailansicht (`ControlSecurityContext`) | `Feuer (G 0.1)` — Begriff zuerst | Dort zählt die inhaltliche Aussage; aus der ID allein ist die Gefährdung nicht erkennbar |

Die Divergenz ist gewollt und wird nicht angeglichen. In der Control-Detailansicht blendet die aufgeklappte Vokabelkarte die dort redundante Spalte `Begriff` sowie die technische Spalte `uuid` über `hiddenColumns` aus; die Vokabularseiten zeigen weiterhin alle Originalspalten. Dasselbe kontextbezogene Muster gilt für das Praktik-Vokabular im Breadcrumb: `Begriff` wird nur ausgeblendet, wenn der Wert exakt dem angezeigten Praktik-Namen entspricht.

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- `src/domain/vocabulary.ts` — Vocabulary-Implementierung
- `src/domain/taxonomyVocabulary.ts` — UUID-basierte Praktik- und Themen-Auflösung
- `src/domain/vocabularyNamespaces.ts` — kanonische BSI-Namespace-URLs für synthetische Lookups
- `src/domain/models.ts` — Vocabulary Types
- `src/state/CatalogContext.tsx` — Context-Integration
- `src/features/catalog/ControlTaxonomyBreadcrumb.tsx` — kontextuelle Taxonomie-Definitionen
- `scripts/fetch-catalog.mjs` — Vocabulary-Abruf
- `scripts/vocabulary-utils.mjs` — Build-Hilfsfunktionen
