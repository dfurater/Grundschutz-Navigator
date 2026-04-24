import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SecurityLevel, EffortLevel, Modalverb, LinkRelation } from '@/domain/models';
import {
  emptyFilters,
  type ControlFilters,
  type SortConfig,
  type SortField,
  type SortDirection,
} from '@/hooks/useFilteredControls';

/* ------------------------------------------------------------------ */
/*  Param Keys                                                         */
/* ------------------------------------------------------------------ */

const P = {
  mv: 'mv',
  sl: 'sl',
  el: 'el',
  tags: 'tags',
  zk: 'zk',
  hw: 'hw',
  dt: 'dt',
  lr: 'lr',
  q: 'q',
  sort: 'sort',
} as const;

const DEFAULT_SORT: SortConfig = [{ field: 'id', direction: 'asc' }];

/* ------------------------------------------------------------------ */
/*  Validators                                                         */
/* ------------------------------------------------------------------ */

const VALID_SECURITY: Set<string> = new Set<SecurityLevel>(['normal-SdT', 'erhöht']);
const VALID_EFFORT: Set<string> = new Set<EffortLevel>(['0', '1', '2', '3', '4', '5']);
const VALID_MODAL: Set<string> = new Set<Modalverb>(['MUSS', 'SOLLTE', 'KANN']);
const VALID_LINK_RELATION: Set<string> = new Set<LinkRelation>(['required', 'related']);
const VALID_SORT_FIELDS: Set<string> = new Set<SortField>([
  'id', 'title', 'modalverb', 'securityLevel', 'effortLevel',
]);
const VALID_SORT_DIR: Set<string> = new Set<SortDirection>(['asc', 'desc']);

function splitParam(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  Deserializers                                                      */
/* ------------------------------------------------------------------ */

function deserializeFilters(params: URLSearchParams): ControlFilters {
  return {
    ...emptyFilters,
    modalverben: splitParam(params, P.mv).filter((v) => VALID_MODAL.has(v)) as Modalverb[],
    securityLevels: splitParam(params, P.sl).filter((v) => VALID_SECURITY.has(v)) as SecurityLevel[],
    effortLevels: splitParam(params, P.el).filter((v) => VALID_EFFORT.has(v)) as EffortLevel[],
    tags: splitParam(params, P.tags),
    zielobjektKategorien: splitParam(params, P.zk),
    handlungsworte: splitParam(params, P.hw),
    dokumentationstypen: splitParam(params, P.dt),
    linkRelationen: splitParam(params, P.lr).filter((v) => VALID_LINK_RELATION.has(v)) as LinkRelation[],
    searchTerm: params.get(P.q) ?? '',
  };
}

function deserializeSort(params: URLSearchParams): SortConfig {
  const raw = params.get(P.sort);
  if (!raw) return DEFAULT_SORT;

  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const result: SortConfig = [];

  for (const entry of entries) {
    const [field, dir] = entry.split(':');
    if (VALID_SORT_FIELDS.has(field) && VALID_SORT_DIR.has(dir)) {
      result.push({ field: field as SortField, direction: dir as SortDirection });
    }
  }

  return result.length > 0 ? result : DEFAULT_SORT;
}

/* ------------------------------------------------------------------ */
/*  Serializers                                                        */
/* ------------------------------------------------------------------ */

function setOrDelete(params: URLSearchParams, key: string, values: string[]) {
  if (values.length > 0) {
    params.set(key, values.join(','));
  } else {
    params.delete(key);
  }
}

function isDefaultSort(sort: SortConfig): boolean {
  return (
    sort.length === 1 &&
    sort[0].field === 'id' &&
    sort[0].direction === 'asc'
  );
}

function serializeAll(filters: ControlFilters, sort: SortConfig): URLSearchParams {
  const params = new URLSearchParams();

  setOrDelete(params, P.mv, filters.modalverben);
  setOrDelete(params, P.sl, filters.securityLevels);
  setOrDelete(params, P.el, filters.effortLevels);
  setOrDelete(params, P.tags, filters.tags);
  setOrDelete(params, P.zk, filters.zielobjektKategorien);
  setOrDelete(params, P.hw, filters.handlungsworte);
  setOrDelete(params, P.dt, filters.dokumentationstypen);
  setOrDelete(params, P.lr, filters.linkRelationen);

  if (filters.searchTerm) {
    params.set(P.q, filters.searchTerm);
  }

  if (!isDefaultSort(sort)) {
    params.set(P.sort, sort.map((e) => `${e.field}:${e.direction}`).join(','));
  }

  return params;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseFilterParamsResult {
  filters: ControlFilters;
  setFilters: (next: ControlFilters | ((prev: ControlFilters) => ControlFilters)) => void;
  sort: SortConfig;
  setSort: (next: SortConfig) => void;
  /** Current query string (without '?') for use in navigate() calls */
  searchString: string;
}

export function useFilterParams(): UseFilterParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Derive state from URL (single source of truth)
  const filters = useMemo(() => deserializeFilters(searchParams), [searchParams]);
  const sort = useMemo(() => deserializeSort(searchParams), [searchParams]);
  const searchString = useMemo(() => searchParams.toString(), [searchParams]);

  // Keep a ref to current sort for use in setFilters
  const sortRef = useRef(sort);

  // Keep a ref to current filters for use in setSort
  const filtersRef = useRef(filters);

  useLayoutEffect(() => {
    sortRef.current = sort;
    filtersRef.current = filters;
  }, [filters, sort]);

  // Flush filters + sort to URL
  const flush = useCallback(
    (nextFilters: ControlFilters, nextSort: SortConfig) => {
      const params = serializeAll(nextFilters, nextSort);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const setFilters = useCallback(
    (nextOrUpdater: ControlFilters | ((prev: ControlFilters) => ControlFilters)) => {
      const current = filtersRef.current;
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;

      // Check if only searchTerm changed → debounce
      const onlySearchChanged =
        next.searchTerm !== current.searchTerm &&
        next.modalverben === current.modalverben &&
        next.securityLevels === current.securityLevels &&
        next.effortLevels === current.effortLevels &&
        next.tags === current.tags &&
        next.zielobjektKategorien === current.zielobjektKategorien &&
        next.handlungsworte === current.handlungsworte &&
        next.dokumentationstypen === current.dokumentationstypen &&
        next.linkRelationen === current.linkRelationen;

      if (onlySearchChanged) {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          flush(next, sortRef.current);
        }, 300);
      } else {
        clearTimeout(debounceRef.current);
        flush(next, sortRef.current);
      }
    },
    [flush],
  );

  const setSort = useCallback(
    (next: SortConfig) => {
      flush(filtersRef.current, next);
    },
    [flush],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return { filters, setFilters, sort, setSort, searchString };
}
