import { useMemo } from 'react';
import type { Control, SecurityLevel, EffortLevel, Modalverb, LinkRelation } from '@/domain/models';
import { getControlLinkSearchText } from '@/domain/controlRelationships';

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
  /** Free-text search within statement/title */
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

function matchesFilter(control: Control, filters: ControlFilters): boolean {
  // Practice filter
  if (
    filters.practiceIds.length > 0 &&
    !filters.practiceIds.includes(control.practiceId)
  ) {
    return false;
  }

  // Group/Topic filter
  if (
    filters.groupIds.length > 0 &&
    !filters.groupIds.includes(control.groupId)
  ) {
    return false;
  }

  // Security level filter
  if (
    filters.securityLevels.length > 0 &&
    (!control.securityLevel ||
      !filters.securityLevels.includes(control.securityLevel))
  ) {
    return false;
  }

  // Effort level filter
  if (
    filters.effortLevels.length > 0 &&
    (!control.effortLevel ||
      !filters.effortLevels.includes(control.effortLevel))
  ) {
    return false;
  }

  // Modalverb filter
  if (
    filters.modalverben.length > 0 &&
    (!control.modalverb || !filters.modalverben.includes(control.modalverb))
  ) {
    return false;
  }

  // Tags filter (OR — control must have at least one selected tag)
  if (filters.tags.length > 0) {
    const hasMatchingTag = control.tags.some((t) => filters.tags.includes(t));
    if (!hasMatchingTag) return false;
  }

  // Zielobjekt-Kategorien filter (OR)
  if (filters.zielobjektKategorien.length > 0) {
    const hasMatch = control.statementProps.zielobjektKategorien.some((k) =>
      filters.zielobjektKategorien.includes(k),
    );
    if (!hasMatch) return false;
  }

  // Action words filter (OR)
  if (filters.handlungsworte.length > 0) {
    const handlungswort = control.statementProps.handlungsworte;
    if (!handlungswort || !filters.handlungsworte.includes(handlungswort)) {
      return false;
    }
  }

  // Documentation filter (OR)
  if (filters.dokumentationstypen.length > 0) {
    const dokumentation = control.statementProps.dokumentation;
    if (!dokumentation || !filters.dokumentationstypen.includes(dokumentation)) {
      return false;
    }
  }

  // Link relation filter (OR)
  if (filters.linkRelationen.length > 0) {
    const relationen = new Set(control.links.map((link) => link.relation));
    const hasMatch = filters.linkRelationen.some((relation) => relationen.has(relation));
    if (!hasMatch) return false;
  }

  // Text search
  if (filters.searchTerm) {
    const term = filters.searchTerm.toLowerCase();
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
    if (c.securityLevel) {
      counts.securityLevels[c.securityLevel] =
        (counts.securityLevels[c.securityLevel] ?? 0) + 1;
    }
    if (c.effortLevel) {
      counts.effortLevels[c.effortLevel] =
        (counts.effortLevels[c.effortLevel] ?? 0) + 1;
    }
    if (c.modalverb) {
      counts.modalverben[c.modalverb] =
        (counts.modalverben[c.modalverb] ?? 0) + 1;
    }
    for (const tag of c.tags) {
      counts.tags[tag] = (counts.tags[tag] ?? 0) + 1;
    }
    for (const kat of c.statementProps.zielobjektKategorien) {
      counts.zielobjektKategorien[kat] = (counts.zielobjektKategorien[kat] ?? 0) + 1;
    }
    if (c.statementProps.handlungsworte) {
      counts.handlungsworte[c.statementProps.handlungsworte] =
        (counts.handlungsworte[c.statementProps.handlungsworte] ?? 0) + 1;
    }
    if (c.statementProps.dokumentation) {
      counts.dokumentationstypen[c.statementProps.dokumentation] =
        (counts.dokumentationstypen[c.statementProps.dokumentation] ?? 0) + 1;
    }
    const relations = new Set(c.links.map((link) => link.relation));
    for (const relation of relations) {
      counts.linkRelationen[relation] = (counts.linkRelationen[relation] ?? 0) + 1;
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
      filters.linkRelationen.length > 0 ||
      filters.searchTerm.length > 0,
    [filters],
  );

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
