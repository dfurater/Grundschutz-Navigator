# Filter-System — Grundschutz++ Navigator

Beschreibung des Multi-Facet-Filter-Systems und der URL-Parameter-Synchronisation.

## Überblick

Das Filter-System ermöglicht das Filtern des Grundschutz-Katalogs nach mehreren Dimensionen gleichzeitig. Die Filter werden bidirektional mit URL-Suchparametern synchronisiert, sodass:
- Filter-Zustand in der URL gespeichert wird
- Filter per URL geteilt werden können
- Browser-Navigation (vor/zurück) funktioniert

Practice- und Topic-Auswahl laufen nicht über Query-Parameter, sondern über die kataloggescopte Route (`/katalog/:catalogKey/:groupId`). Control-Details verwenden die kanonische Route `/katalog/:catalogKey/kontrolle/:altIdentifier`. Der `CatalogBrowser` schränkt über die Gruppenauswahl die Eingabemenge des Hooks ein (`scopedControls`), bevor die Query-Parameter-Filter greifen. Die Felder `practiceIds`/`groupIds` in `ControlFilters` sind davon unabhängige Filterdimensionen des Hooks.

## Filter-Dimensionen

| Dimension | URL-Parameter | Mögliche Werte | Typ |
|-----------|--------------|---------------|-----|
| Sicherheitsniveau | `sl` | `normal-SdT`, `erhöht` | Mehrfachauswahl |
| Aufwandsstufe | `el` | `0`, `1`, `2`, `3`, `4`, `5` | Mehrfachauswahl |
| Verpflichtungsgrad | `mv` | `MUSS`, `SOLLTE`, `KANN` | Mehrfachauswahl |
| Tags | `tags` | Beliebige Tags | Mehrfachauswahl |
| Zielobjekt-Kategorien | `zk` | Kategorien (z.B. `Server`, `Client`) | Mehrfachauswahl |
| Handlungswort | `hw` | Handlungswörter | Mehrfachauswahl |
| Dokumentationstyp | `dt` | Dokumentationstypen | Mehrfachauswahl |
| Link-Beziehung | `lr` | `related`, `required` | Mehrfachauswahl |
| Sortierung | `sort` | `<feld>:<richtung>[,…]` | Einzelwert |

Der Linkfilter ist eine enge Kompatibilitätsprojektion für die beiden bereits
vorhandenen Projektwerte `related` und `required`. Andere offene OSCAL-Tokens,
der dokumentierte Wert `reference` und ein fehlendes `rel` werden nicht darauf
umgedeutet. Sie bleiben in Detailansicht, Suche und allgemeiner Linkspalte des
Exports nachvollziehbar, erzeugen aber keine zusätzliche Filtersemantik.

Mehrfachwerte werden kommasepariert in einem Parameter kodiert (z.B. `mv=MUSS,SOLLTE`).
Die Volltextsuche ist davon getrennt und läuft ausschließlich über `/suche?q=…`.
Ein `q`-Parameter auf einer Katalogroute ist kein Katalogfilter und wird ignoriert.

Die WLAN-Props `Taxonomy-L1` bis `Taxonomy-L4` sind keine zusätzliche
Filterdimension. Ihre exakten Namen und Werte fließen in den Volltextindex ein;
dadurch bleiben sie über `/suche?q=…` auffindbar, ohne aus dem derzeitigen
Placeholder-Namensraum eine fachliche Facette abzuleiten. Der CSV-Export führt
je Ebene eine Wert- und eine optionale Namespace-Spalte (`taxonomy_l1[_ns]`
bis `taxonomy_l4[_ns]`).

## Filter-Zustand

Der Filter-Zustand ist in `src/hooks/useFilteredControls.ts` definiert:

```typescript
export interface ControlFilters {
  practiceIds: string[];
  groupIds: string[];
  securityLevels: SecurityLevel[];
  effortLevels: EffortLevel[];
  modalverben: Modalverb[];
  tags: string[];
  zielobjektKategorien: string[];
  handlungsworte: string[];
  dokumentationstypen: string[];
  linkRelationen: LinkRelation[];
}

export const emptyFilters: ControlFilters = {
  practiceIds: [],
  groupIds: [],
  securityLevels: [],
  effortLevels: [],
  modalverben: [],
  tags: [],
  zielobjektKategorien: [],
  handlungsworte: [],
  dokumentationstypen: [],
  linkRelationen: [],
};
```

## Filter-Logik

Die Filter-Funktion in `src/hooks/useFilteredControls.ts` prüft jede Dimension:

```typescript
function matchesFilter(
  control: Control,
  filters: ControlFilters,
): boolean {
  // Practice filter
  if (filters.practiceIds.length > 0 &&
      !filters.practiceIds.includes(control.practiceId)) {
    return false;
  }

  // Group/Topic filter
  if (filters.groupIds.length > 0 &&
      !filters.groupIds.includes(control.groupId)) {
    return false;
  }

  // ... weitere Dimensionen

  return true;
}
```

### Logische Verknüpfung

- **Innerhalb einer Dimension**: ODER-Verknüpfung (Control muss mind. einen ausgewählten Wert haben)
- **Zwischen Dimensionen**: UND-Verknüpfung (alle aktiven Dimensionen müssen erfüllt sein)

Beispiel:
- `sl=normal-SdT,erhöht` → Normal ODER Erhöht
- `sl=normal-SdT&mv=MUSS` → Normal UND MUSS

## URL-Parameter-Sync

Die Synchronisation mit URL-Parametern erfolgt über `src/hooks/useFilterParams.ts` auf Basis von React Routers `useSearchParams`. Die URL ist die einzige Quelle der Wahrheit — Filter und Sortierung werden bei jedem Render aus ihr abgeleitet.

### Lesen aus URL (Deserialisierung)

Kommaseparierte Werte werden gesplittet und gegen Validator-Sets geprüft; unbekannte Werte werden verworfen statt übernommen:

```typescript
const VALID_MODAL: Set<string> = new Set<Modalverb>(['MUSS', 'SOLLTE', 'KANN']);

function deserializeFilters(params: URLSearchParams): ControlFilters {
  return {
    ...emptyFilters,
    modalverben: splitParam(params, 'mv').filter((v) => VALID_MODAL.has(v)) as Modalverb[],
    // ... analog für sl, el, tags, zk, hw, dt, lr
  };
}
```

### Schreiben in URL (Serialisierung)

Aktive Filter werden kommasepariert gesetzt, leere Dimensionen entfernt und sofort synchronisiert. Der Sync läuft über `setSearchParams(params, { replace: true })`, sodass Filter-Änderungen keine History-Einträge fluten.

```typescript
function setOrDelete(params: URLSearchParams, key: string, values: string[]) {
  if (values.length > 0) {
    params.set(key, values.join(','));
  } else {
    params.delete(key);
  }
}
```

Die Default-Sortierung (`id:asc`) wird nicht in die URL geschrieben.

## Facet-Zählung

Für jede Dimension werden die verfügbaren Werte mit ihrer Häufigkeit gezählt:

```typescript
export interface FacetCounts {
  securityLevels: Record<string, number>;
  effortLevels: Record<string, number>;
  modalverben: Record<string, number>;
  tags: Record<string, number>;
  zielobjektKategorien: Record<string, number>;
  handlungsworte: Record<string, number>;
  dokumentationstypen: Record<string, number>;
  linkRelationen: Record<string, number>;
}
```

### Two-Sets-Ansatz

- **Facets vom Gesamtkatalog** (`facetCounts`): Ungefilterte Anzahl — friert die Zähler für aktive Dimensionen ein
- **Facets vom gefilterten Set** (`filteredFacetCounts`): Gefilterte Anzahl — zeigt verfügbare Werte für inaktive Dimensionen

Die Differenz wird verwendet, um:
- Deaktivierte Facets anzuzeigen (keine Ergebnisse mehr)
- "Keine Ergebnisse"-Zustand zu erkennen

## Sortierung

Sortierung ist als mehrstufiges Array definiert:

```typescript
export type SortField = 'id' | 'title' | 'modalverb' | 'securityLevel' | 'effortLevel';
export type SortDirection = 'asc' | 'desc';

export interface SortEntry {
  field: SortField;
  direction: SortDirection;
}

export type SortConfig = SortEntry[];  // Erster Eintrag ist primäre Sortierung
```

### URL-Format

Sortierung in URL: `sort=id:asc` oder `sort=modalverb:asc,securityLevel:desc`

### Sort-Logik

```typescript
const modalverbOrder: Record<string, number> = { KANN: 0, SOLLTE: 1, MUSS: 2 };

function compareByField(a: Control, b: Control, field: SortField): number {
  switch (field) {
    case 'id':
      return a.id.localeCompare(b.id, 'de', { numeric: true });
    case 'title':
      return a.title.localeCompare(b.title, 'de');
    case 'modalverb': {
      const aVal = modalverbOrder[a.modalverb ?? ''] ?? 3;
      const bVal = modalverbOrder[b.modalverb ?? ''] ?? 3;
      return aVal - bVal;
    }
    case 'securityLevel':
      return (a.securityLevel ?? '').localeCompare(b.securityLevel ?? '');
    case 'effortLevel':
      return Number(a.effortLevel ?? 99) - Number(b.effortLevel ?? 99);
  }
}
```

## useFilteredControls Hook

Der Haupt-Hook kombiniert Facettenzählung, Filterung und Sortierung. Die globale
Volltextsuche verwendet stattdessen den separaten Hook `useSearch`:

```typescript
export function useFilteredControls(
  controls: Control[],
  filters: ControlFilters,
  sort: SortConfig = [{ field: 'id', direction: 'asc' }],
): UseFilteredControlsResult {
  const facetCounts = useMemo(() => computeFacetCounts(controls), [controls]);
  // hasActiveFilters aus allen Dimensionen ableiten
  // filtered = matchesFilter + compareControls
  // filteredFacetCounts = computeFacetCounts(filtered)

  return {
    filtered,
    totalCount: controls.length,
    facetCounts,
    filteredFacetCounts,
    hasActiveFilters,
  };
}
```

## FilterPanel-Komponente

Die UI-Komponente in `src/features/catalog/FilterPanel.tsx` zeigt:
- Aktive Filter als entfernbare Tags
- Facet-Liste mit Checkboxen und Zählern
- "Alle entfernen"-Schaltfläche
- "Ergebnisse anzeigen"-Bestätigung für Mobile

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- `src/hooks/useFilteredControls.ts` — Filter-Implementierung
- `src/hooks/useFilterParams.ts` — URL-Sync-Implementierung
- `src/features/catalog/FilterPanel.tsx` — Filter-UI
