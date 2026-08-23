import { useMemo } from 'react';
import type {
  Control,
  SecurityLevel,
  EffortLevel,
  Modalverb,
  LinkRelation,
} from '@/domain/models';
import { toFilterableLinkRelation } from '@/domain/controlRelationships';

/* ------------------------------------------------------------------ */
/*  Filter State                                                       */
/* ------------------------------------------------------------------ */

export interface ControlFilters {
  /** Filter by practice IDs (e.g. ["GC", "ARCH"]) */
  practiceIds: string[];
  /** Filter by topic/group IDs (e.g. ["GC.1", "ARCH.2"]) */
  groupIds: string[];
  /** Filter by security levels */
  securityLevels: SecurityLevel[];
  /** Filter by effort levels */
  effortLevels: EffortLevel[];
  /** Filter by modalverb */
  modalverben: Modalverb[];
  /** Filter by tags */
  tags: string[];
  /** Filter by target_object_categories */
  zielobjektKategorien: string[];
  /** Filter by action_word values */
  handlungsworte: string[];
  /** Filter by documentation values */
  dokumentationstypen: string[];
  /** Filter by link relation values */
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

export type SortField = 'id' | 'title' | 'modalverb' | 'securityLevel' | 'effortLevel';
export type SortDirection = 'asc' | 'desc';

export interface SortEntry {
  field: SortField;
  direction: SortDirection;
}

/** Ordered array of sort criteria — first entry is primary sort */
export type SortConfig = SortEntry[];

/* ------------------------------------------------------------------ */
/*  Filter Logic                                                       */
/* ------------------------------------------------------------------ */

function passesSelectionFilter<T>(value: T | undefined, selected: readonly T[]): boolean {
  return selected.length === 0 || (value !== undefined && selected.includes(value));
}

function passesTruthySelectionFilter<T>(value: T | undefined, selected: readonly T[]): boolean {
  return selected.length === 0 || (!!value && selected.includes(value));
}

function passesOverlapFilter(values: readonly string[], selected: readonly string[]): boolean {
  return selected.length === 0 || values.some((value) => selected.includes(value));
}

function passesLinkRelationFilter(control: Control, selected: readonly LinkRelation[]): boolean {
  if (selected.length === 0) return true;
  const relationen = new Set(
    control.links
      .map((link) => toFilterableLinkRelation(link.rel))
      .filter((relation): relation is LinkRelation => relation !== undefined),
  );
  return selected.some((relation) => relationen.has(relation));
}

function matchesFilter(
  control: Control,
  filters: ControlFilters,
): boolean {
  // Practice filter — ein Control aus einer Gruppe ohne `id` ist über keine
  // Praktik-Facette auswählbar und fällt bei aktivem Filter heraus (GSPP-242).
  if (!passesSelectionFilter(control.practiceId, filters.practiceIds)) return false;
  if (!passesSelectionFilter(control.groupId, filters.groupIds)) return false;
  if (!passesTruthySelectionFilter(control.securityLevel, filters.securityLevels)) return false;
  if (!passesTruthySelectionFilter(control.effortLevel, filters.effortLevels)) return false;
  if (!passesTruthySelectionFilter(control.modalverb, filters.modalverben)) return false;
  if (!passesOverlapFilter(control.tags, filters.tags)) return false;
  if (
    !passesOverlapFilter(
      control.statementProps.zielobjektKategorien,
      filters.zielobjektKategorien,
    )
  ) {
    return false;
  }
  if (!passesTruthySelectionFilter(control.statementProps.handlungsworte, filters.handlungsworte)) {
    return false;
  }
  if (
    !passesTruthySelectionFilter(
      control.statementProps.dokumentation,
      filters.dokumentationstypen,
    )
  ) {
    return false;
  }
  if (!passesLinkRelationFilter(control, filters.linkRelationen)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Sort Logic                                                         */
/* ------------------------------------------------------------------ */

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

function compareControls(a: Control, b: Control, sorts: SortConfig): number {
  for (const entry of sorts) {
    const cmp = compareByField(a, b, entry.field);
    if (cmp !== 0) return entry.direction === 'desc' ? -cmp : cmp;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/*  Facet Counting                                                     */
/* ------------------------------------------------------------------ */

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

function incrementCount(map: Record<string, number>, key: string | undefined): void {
  if (key) {
    map[key] = (map[key] ?? 0) + 1;
  }
}

function computeFacetCounts(controls: Control[]): FacetCounts {
  const counts: FacetCounts = {
    securityLevels: {},
    effortLevels: {},
    modalverben: {},
    tags: {},
    zielobjektKategorien: {},
    handlungsworte: {},
    dokumentationstypen: {},
    linkRelationen: {},
  };

  for (const c of controls) {
    incrementCount(counts.securityLevels, c.securityLevel);
    incrementCount(counts.effortLevels, c.effortLevel);
    incrementCount(counts.modalverben, c.modalverb);
    for (const tag of c.tags) {
      incrementCount(counts.tags, tag);
    }
    for (const kat of c.statementProps.zielobjektKategorien) {
      incrementCount(counts.zielobjektKategorien, kat);
    }
    incrementCount(counts.handlungsworte, c.statementProps.handlungsworte);
    incrementCount(counts.dokumentationstypen, c.statementProps.dokumentation);
    const relations = new Set(
      c.links
        .map((link) => toFilterableLinkRelation(link.rel))
        .filter((relation): relation is LinkRelation => relation !== undefined),
    );
    for (const relation of relations) {
      incrementCount(counts.linkRelationen, relation);
    }
  }

  return counts;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseFilteredControlsResult {
  /** Filtered and sorted controls */
  filtered: Control[];
  /** Total count before filtering */
  totalCount: number;
  /** Facet counts from the full (unfiltered) source — used to freeze counts for active dimensions */
  facetCounts: FacetCounts;
  /** Facet counts from the currently filtered set — used for inactive dimensions */
  filteredFacetCounts: FacetCounts;
  /** Whether any filter is active */
  hasActiveFilters: boolean;
}

export function useFilteredControls(
  controls: Control[],
  filters: ControlFilters,
  sort: SortConfig = [{ field: 'id', direction: 'asc' }],
): UseFilteredControlsResult {
  const facetCounts = useMemo(() => computeFacetCounts(controls), [controls]);

  const hasActiveFilters = useMemo(
    () =>
      filters.practiceIds.length > 0 ||
      filters.groupIds.length > 0 ||
      filters.securityLevels.length > 0 ||
      filters.effortLevels.length > 0 ||
      filters.modalverben.length > 0 ||
      filters.tags.length > 0 ||
      filters.zielobjektKategorien.length > 0 ||
      filters.handlungsworte.length > 0 ||
      filters.dokumentationstypen.length > 0 ||
      filters.linkRelationen.length > 0,
    [filters],
  );

  const filtered = useMemo(() => {
    const matched = hasActiveFilters
      ? controls.filter((control) => matchesFilter(control, filters))
      : [...controls];

    matched.sort((a, b) => compareControls(a, b, sort));
    return matched;
  }, [controls, filters, sort, hasActiveFilters]);

  const filteredFacetCounts = useMemo(
    () => hasActiveFilters ? computeFacetCounts(filtered) : facetCounts,
    [facetCounts, filtered, hasActiveFilters],
  );

  return {
    filtered,
    totalCount: controls.length,
    facetCounts,
    filteredFacetCounts,
    hasActiveFilters,
  };
}
