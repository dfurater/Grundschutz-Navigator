# Vokabular-System — Grundschutz++ Navigator

Offizielle BSI-Vokabular-Auflösung: Anzeige der BSI-Definitionen für Werte im Katalog.

## Überblick

Die Anwendung liefert alle 13 CSV-Dateien aus `documentation/namespaces/` im gepinnten BSI-Snapshot aus. Welche Vokabulare einzelne OSCAL-Props auflösen, bestimmen die katalogseitigen `ns`-Referenzen (`resolveVocabularyProp` nutzt `prop.ns` + `prop.value`); die Auslieferungs-Membership leitet sich unabhängig davon aus dem registrierten Verzeichnis ab (`materializeVocabularyCollectionMembers` in `scripts/vocabulary-utils.mjs`).

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

Die Anwendung lädt diese Vokabulare zur Build-Zeit von BSI (`scripts/fetch-catalog.mjs`). Die Collection ist im `sourceRegistry` (`src/domain/sourceRegistry.mjs`) als Vokabularsammlung mit dem Suffix `.csv` registriert. Materialisiert werden ausschließlich reguläre CSV-Dateien direkt in diesem Verzeichnis; Unterverzeichnisse, `.txt`, `readme.md` und andere Pfade bleiben ausgeschlossen (`matchesVocabularyCollection`, `scripts/security-guards.mjs`). Jede ausgelieferte Datei wird einzeln per Git-Blob-SHA und Content-Hash an den gepinnten Snapshot gebunden.

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
  identifierColumns?: string[];     // Headers carrying a row's own identifier
  identifierReferenceColumns?: string[];  // Headers referencing another row's identifier
  entries: VocabularyEntry[];
}
```

### VocabularyNamespace (Runtime)

```typescript
interface VocabularyNamespace extends VocabularyNamespaceData {
  entriesByValue: Map<string, VocabularyEntry>;
  entriesByIdentifier: Map<string, VocabularyEntry>;
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

### VocabularyResolution (`src/domain/vocabulary.ts`)

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

Lookup für die Routing-Ebene (`/vokabular/:namespaceId`, Route in `src/app/AppShell.tsx`):

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

Besonderheit Schutzziele: Die Control-Props tragen als Wert die Relevanz (`0`–`2`), das über ihren `ns` referenzierte Vokabular `security_targets.csv` ist aber nach Schutzziel-Namen indiziert und kennt diese Werte nicht. Ihre Bedeutung steht in der separaten Datei `security_targets_levels.csv`, die über `prop.ns` nicht erreichbar ist. Der Adapter erhält den vorgefundenen `ns` unverändert; `resolveSecurityTargetLevel()` benennt `security_targets_levels.csv` selbst — symmetrisch zu `resolveSecurityTarget()`, das den Targets-Namespace ebenfalls explizit nennt.

Die Zuordnung der vier Relevanz-Props läuft über `name` und `ns`: Ein gleichnamiges `prop` ohne oder mit fremdem `ns` wird nicht als Schutzziel-Relevanz übernommen. Ein gesetztes `class` oder `group` schließt ebenfalls aus (`getSecurityTargetRelevanceProp` in `src/adapters/oscalAdapter.ts`). Das ist eine Projektentscheidung: Das gepinnte Schema führt beide Felder nur als optional und definiert keinen Identitätsschlüssel für Properties (geprüft in `src/domain/securityTargets.catalog.node.test.ts`).

Die Typdefinitionen bleiben davon getrennt: `securityTargets` verwendet feste Lookup-Werte (`'Vertraulichkeit (Confidentiality)'`, `'Integrität (Integrity)'`, `'Verfügbarkeit (Availability)'`, `'Authentizität (Authenticity)'`) gegen den Namespace von `security_targets.csv`. Die Detailansicht (`src/features/catalog/ControlSecurityTargets.tsx`) bietet für Typ und Relevanz zwei unabhängige Definitionen an. Ein unbekannter Wert oder eine fehlende Registry wird nicht ausgeblendet, sondern mit dem Rohwert und einer sichtbaren Diagnose dargestellt (`Keine offizielle Definition für diese Relevanzstufe verfügbar.`).

### Taxonomie-Auflösung per UUID

`resolvePracticeVocabulary()` in `src/domain/taxonomyVocabulary.ts` verbindet eine Katalog-Praktik ausschließlich über `Practice.altIdentifier` mit der Spalte `UUID` aus `practices.csv`. Titel, Kürzel und Nummerierung sind keine Fallback-Schlüssel. Fehlt die UUID oder existiert kein exakter Treffer, liefert der Resolver `null`. Doppelte Treffer werfen statt aufzulösen. Fetch (`scripts/fetch-catalog.mjs`) und Catalog-Sync-Guard (`scripts/catalog-sync-guard.mjs`) lehnen fehlende oder doppelte UUIDs sowie nicht zugeordnete Katalog-Praktiken oder CSV-Einträge vor der Artefaktausgabe ab (`assertPracticeVocabularyIntegrity` / `assertTopicVocabularyCoverage` in `scripts/taxonomy-coverage.mjs`); `practices.csv` ist dabei verpflichtend.

Im ControlDetail-Breadcrumb (`src/features/catalog/ControlTaxonomyBreadcrumb.tsx`) werden Definition, `Schwerpunkt`, `auch bekannt als` und die Kennung `UUID` aus dem aufgelösten Eintrag angeboten; verborgen bleibt dort immer `Nummerierung`, und `Begriff` nur bei exakter Übereinstimmung mit dem angezeigten Praktik-Namen. Alle Originalspalten sind zusätzlich auf `/vokabular` einsehbar. Nur der Aliastext wird in den FlexSearch-Metadatenindex der zugehörigen Kontrollen übernommen (`auch bekannt als` in `src/features/search/useSearch.ts`) — Kennungsspalten sind davon ausgenommen und werden stattdessen exakt aufgelöst (siehe [FILTERING.md](FILTERING.md)).

`resolveTopicVocabulary()` verwendet denselben strikten UUID-Join für `Topic.altIdentifier` und `topics.csv`. Mehrere Katalog-Untergruppen dürfen dieselbe fachliche Themen-UUID teilen und lösen dann auf denselben Eintrag auf. Fehlt die UUID oder der CSV-Treffer, bleibt das Thema im ControlDetail-Breadcrumb sichtbar und erhält den Hinweis „keine offizielle Definition“. Umgekehrt bleiben CSV-Einträge ohne Katalogtreffer vollständig auf `/vokabular` auffindbar.

Fetch und Catalog-Sync-Guard behandeln jede Abweichung — fehlende oder doppelte UUIDs, nicht zugeordnete Katalog- oder CSV-Seiten — für jeden Snapshot als Integritätsfehler. Beidseitig zugeordnetes Wachstum — neue Praktik oder neues Thema auf Katalog- und CSV-Seite zugleich — passiert Fetch und Catalog-Sync-Guard; nur nicht zuordenbare Seiten (fehlende oder doppelte UUIDs, Orphans jenseits der EXMP-Ausnahme) lassen den Guard fehlschlagen. Die gemessenen Zählwerte stehen unter `taxonomyCoverage` in `upstream-sources-metadata.json` als Provenienz des Fetch-Laufs.

Für `practices.csv` gilt eine namentlich begrenzte Ausnahme: Das BSI liefert die Beispielpraktik „EXMP“ ohne zugehörige Katalog-Gruppe mit aus. Genau diese UUID ist in `TOLERATED_ORPHAN_PRACTICE_UUIDS` (`scripts/taxonomy-coverage.mjs`) geduldet und wird separat als `toleratedOrphanCsvEntryCount` ausgewiesen; jede andere verwaiste CSV-Zeile lässt den Guard weiterhin hart fehlschlagen. Die gemessene Practice-Deckung steht unter `taxonomyCoverage.practices` in `upstream-sources-metadata.json`.

### Such-Text-Sammlung

Für die globale Volltextsuche unter `/suche` werden alle Spaltenwerte der aufgelösten Vokabular-Einträge eingesammelt (Kennungsspalten ausgenommen, siehe [FILTERING.md](FILTERING.md)):

```typescript
export function collectVocabularySearchTexts(
  resolutions: Array<VocabularyResolution | null>,
): string[];

export function collectControlVocabularySearchTexts(
  resolved: ResolvedControlVocabularies,
): string[];
```

## PropValue Struktur

Die PropValue-Typen enthalten die Namespace-Information für die Auflösung (`src/domain/models.ts`):

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

Für die Quell-Links auf den exakten Upstream-Stand (`buildVocabularySourceUrl` in `src/domain/vocabulary.ts`): Ohne `repository` oder `path` sowie ohne kodierbaren Pfad wird der `namespace` zurückgegeben; mit Snapshot-SHA zeigt der Link auf `blob/<sha>/<pfad>`, ohne auf `tree/main/<pfad>`. Der Pfad wird segmentweise kodiert, angehängte Schrägstriche der Repository-URL werden entfernt.

## CatalogContext-Integration

`vocabularies.json` wird parallel zum Katalog als ArrayBuffer geladen und die Registry per `buildVocabularyRegistry` gebaut (`src/state/CatalogContext.tsx`). Der Ladepfad gleicht das Artefakt per SHA-256 gegen den Integrity-Block in `upstream-sources-metadata.json` ab; das Ergebnis (`vocabularyVerification`) wird auf der Seite `/about` angezeigt (Details in [INTEGRITY.md](./INTEGRITY.md)). Fehlt `vocabularies.json`, läuft die App ohne Registry weiter. Fehlen nur die Metadaten, bleibt die aus dem vorhandenen Artefakt gebaute Registry nutzbar; Provenance und Verifikation bleiben dann leer und es wird eine Warnung in der Konsole protokolliert.

## Vocabulary-Seiten

### VocabularyOverviewPage (`/vokabular`)

Übersicht aller Vokabulare (`src/features/vocabularies/VocabularyOverviewPage.tsx`) mit:

- Liste aller Namespaces
- Routen-Link zu jedem Namespace
- Anzahl der Einträge

### VocabularyNamespacePage (`/vokabular/:namespaceId`)

Detailseite für einen Namespace (`src/features/vocabularies/VocabularyNamespacePage.tsx`):

- Alle Einträge als auswählbare Link-Liste
- Listeneintrag zeigt `entry.value`; ist `valueColumn` nicht selbst `Begriff` (z. B. `basethreats.csv` mit `valueColumn: "ID"`), wird zusätzlich der Wert der Spalte `Begriff` mit Abstand angehängt (z. B. „G 0.1 Feuer"), sofern vorhanden und von `entry.value` verschieden
- Einzelner Eintrag per Query-Parameter `?wert=` adressierbar (Deep-Link aus Control-Details)
- Definition und weitere nichtleere Spalten werden für den aktiven Eintrag mit `InlineVocabularyEntryDetails` direkt unter der Listenzeile eingeblendet, ohne Breitenbeschränkung (nutzt die volle Kartenbreite)
- Reihenfolge der Zusatzspalten folgt `columnOrder`

## Darstellungskonventionen im Vergleich

Für Namespaces mit eigener `Begriff`-Spalte neben der ID (`basethreats.csv`) gelten zwei unterschiedliche Konventionen:

| Ort | Darstellung |
|---|---|
| Vokabular-Listenansicht (`/vokabular/:namespaceId`) | `G 0.1 Feuer` — ID zuerst, Sortier- und Nachschlageschlüssel |
| Control-Detailansicht (`ControlSecurityContext`) | `Feuer` — nur der Begriff; die Kennung steht in der zugänglichen Beschriftung, im Hover-Tooltip und als erste Zeile der geöffneten Karte |

In der Control-Detailansicht öffnet der unterstrichene Gefährdungsbegriff die Vokabelkarte. Die Karte zeigt die Kennung vor der Definition und blendet über `hiddenColumns` die dort redundante Spalte `Begriff` aus (`src/features/catalog/ControlSecurityContext.tsx`, `src/features/vocabularies/VocabularyEntryCard.tsx`). Ohne auflösbaren Begriff bleibt die Kennung direkt in der Merkmale-Liste sichtbar. Dasselbe kontextbezogene Ausblenden der Spalte `Begriff` gilt für das Praktik-Vokabular im Breadcrumb: Sie wird nur ausgeblendet, wenn der Wert exakt dem angezeigten Praktik-Namen entspricht (`src/features/catalog/ControlTaxonomyBreadcrumb.tsx`).

Die Kontrollansicht erklärt aufgelöste Vokabularbegriffe direkt an ihrem Vorkommen mit gepunkteter Unterstreichung und aufklappbarer Karte. Im Kurzprofil bleiben Modalverb, Sicherheitsniveau und Aufwand als Badges; ein Link „Legende“ erläutert die vorkommenden Stufen. Der Anforderungssatz markiert darin erkannte Praktik-, Modalverb-, Handlungswort-, Ergebnis- und Präzisierungsabschnitte. Ein Parameter ohne gesetzten Wert erhält am Platzhalter eine per Hover oder Antippen erreichbare Erklärung. In „Merkmale“ stehen Schutzziele mit Relevanz in einem Raster, Gefährdungen sowie zwei getrennte, jeweils beschriftete Gruppen „Tags“ und „Zielobjekte“. Die Begriffe dort haben kein vorangestelltes Info-Symbol.

Verweisspalten sind davon ausgenommen. Ein `ChildOfUUID`-Wert erscheint als Link auf den Eintrag, dessen eigene Kennung dem Verweis entspricht (Anzeigetext: dessen `entry.value`, Label `Übergeordneter Eintrag`); lässt sich der Verweis nicht auflösen, entfällt die Zeile (`src/features/vocabularies/VocabularyEntryCard.tsx`).

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
