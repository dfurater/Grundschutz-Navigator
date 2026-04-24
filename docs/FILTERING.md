# Filter-System — Grundschutz++ Navigator

Beschreibung des Multi-Facet-Filter-Systems und der URL-Parameter-Synchronisation.

## Überblick

Das Filter-System ermöglicht das Filtern des Grundschutz-Katalogs nach mehreren Dimensionen gleichzeitig. Die Filter werden bidirektional mit URL-Suchparametern synchronisiert, sodass:
- Filter-Zustand in der URL gespeichert wird
- Filter per URL geteilt werden können
- Browser-Navigation (vor/zurück) funktioniert

## Filter-Dimensionen

| Dimension | URL-Parameter | Mögliche Werte | Typ |
|-----------|--------------|---------------|-----|
| Practice | `practice` | Practice-IDs (z.B. `GC`, `ARCH`) | Einzel-/Mehrfachauswahl |
| Topic | `topic` | Topic-IDs (z.B. `GC.1`, `ARCH.2`) | Einzel-/Mehrfachauswahl |
| Sicherheitsniveau | `sec_level` | `normal-SdT`, `erhöht` | Mehrfachauswahl |
| Aufwandsstufe | `effort` | `0`, `1`, `2`, `3`, `4`, `5` | Mehrfachauswahl |
| Verpflichtungsgrad | `modalverb` | `MUSS`, `SOLLTE`, `KANN` | Mehrfachauswahl |
| Tags | `tags` | Beliebige Tags | Mehrfachauswahl |
| Zielobjekt-Kategorien | `zielobjekt` | Kategorien (z.B. `Server`, `Client`) | Mehrfachauswahl |
| Handlungswort | `handlungswort` | Handlungswörter | Mehrfachauswahl |
| Dokumentationstyp | `dokumentation` | Dokumentationstypen | Mehrfachauswahl |
| Link-Beziehung | `link` | `related`, `required` | Mehrfachauswahl |
| Freitextsuche | `q` | Beliebiger Text | Einzelwert |
| Sortierung | `sort` | `<feld>:<richtung>` | Einzelwert |

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
  searchTerm: string;
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
  searchTerm: '',
};
```

## Filter-Logik

Die Filter-Funktion in `src/hooks/useFilteredControls.ts` prüft jede Dimension:

```typescript
function matchesFilter(control: Control, filters: ControlFilters): boolean {
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

  // Security level filter
  if (filters.securityLevels.length > 0 &&
      (!control.securityLevel ||
       !filters.securityLevels.includes(control.securityLevel))) {
    return false;
  }

  // ... weitere Filter
}
```

### Logische Verknüpfung

- **Innerhalb einer Dimension**: ODER-Verknüpfung (Control muss mind. einen ausgewählten Wert haben)
- **Zwischen Dimensionen**: UND-Verknüpfung (alle aktiven Dimensionen müssen erfüllt sein)

Beispiel:
- `sec_level=normal-SdT,erhöht` → Normal ODER Erhöht
- `sec_level=normal-SdT&modalverb=MUSS` → Normal UND MUSS

## URL-Parameter-Sync

Die Synchronisation mit URL-Parametern erfolgt über `src/hooks/useFilterParams.ts`:

### Lesen aus URL

Filter werden aus `URLSearchParams` gelesen und in den Filter-Zustand überführt:

```typescript
const searchParams = new URLSearchParams(location.search);

const practiceIds = searchParams.getAll('practice');
const groupIds = searchParams.getAll('topic');
const securityLevels = searchParams.getAll('sec_level') as SecurityLevel[];
const effortLevels = searchParams.getAll('effort') as EffortLevel[];
const modalverben = searchParams.getAll('modalverb') as Modalverb[];
const tags = searchParams.getAll('tags');
// ...
```

### Schreiben in URL

Bei Filter-Änderung werden die Parameter aktualisiert:

```typescript
const url = new URL(window.location.href);

if (filters.practiceIds.length > 0) {
  url.searchParams.set('practice', filters.practiceIds.join(','));
} else {
  url.searchParams.delete('practice');
}

// ... weitere Filter

history.pushState(null, '', url.toString());
```

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

- **Facets vom Gesamtkatalog** (`facetCounts`): Ungefilterte Anzahl — zeigt alle möglichen Werte
- **Facets vom gefilterten Set** (`filteredFacetCounts`): Gefilterte Anzahl — zeigt verfügbare Werte im当前lichen Kontext

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

Der Haupt-Hook kombiniert alle Funktionen:

```typescript
export function useFilteredControls(
  controls: Control[],
  filters: ControlFilters,
  sort: SortConfig = [{ field: 'id', direction: 'asc' }],
): UseFilteredControlsResult {
  const facetCounts = useMemo(() => computeFacetCounts(controls), [controls]);
  const hasActiveFilters = useMemo(/* ... */, [filters]);
  const filtered = useMemo(() => {
    const matched = hasActiveFilters
      ? controls.filter((c) => matchesFilter(c, filters))
      : [...controls];
    matched.sort((a, b) => compareControls(a, b, sort));
    return matched;
  }, [controls, filters, sort, hasActiveFilters]);
  const filteredFacetCounts = useMemo(
    () => computeFacetCounts(filtered),
    [filtered],
  );

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
- Facet-Liste mitCheckboxen und Zähler
- "Alle entfernen"-Schaltfläche
- "Ergebnisse anzeigen"-Bestätigung fürMobile

## Freitextsuche

Die Freitextsuche durchsucht mehrere Felder:

```typescript
if (filters.searchTerm) {
  const searchable = [
    control.id,
    control.title,
    control.statement,
    control.statementProps.ergebnis ?? '',
    control.statementProps.praezisierung ?? '',
    control.statementProps.handlungsworte ?? '',
    control.statementProps.dokumentation ?? '',
    getControlLinkSearchText(control.links),
  ].join(' ').toLowerCase();
  if (!searchable.includes(term)) return false;
}
```

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- `src/hooks/useFilteredControls.ts` — Filter-Implementierung
- `src/hooks/useFilterParams.ts` — URL-Sync-Implementierung
- `src/features/catalog/FilterPanel.tsx` — Filter-UI