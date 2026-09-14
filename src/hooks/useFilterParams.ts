import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import type { SecurityLevel, EffortLevel, Modalverb, LinkRelation } from '@/domain/models';
import {
  emptyFilters,
  emptySecurityTargetFilters,
  type ControlFilters,
  type SecurityTargetFilters,
  type SortConfig,
  type SortField,
  type SortDirection,
} from '@/hooks/useFilteredControls';
import {
  SECURITY_TARGET_DIMENSIONS,
  isSecurityTargetFilterValue,
  type SecurityTargetDimension,
} from '@/domain/securityTargets';

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
  sort: 'sort',
} as const;

/**
 * Ein eigener Parameter je Schutzziel — die vier Dimensionen sind vier
 * Facetten, keine gemeinsame. Die Kürzel sind eindeutig gehalten, weil
 * `availability` und `authenticity` denselben Anfangsbuchstaben teilen.
 *
 * Der Filterzustand betrifft ausschließlich Klasse-1-Daten aus dem
 * verifizierten BSI-Bestand. Der URL-Sync ist hier deshalb richtig und
 * erwünscht — er ist ausdrücklich **kein** Muster für Klasse-2-Ansichten.
 */
const SECURITY_TARGET_PARAMS: Record<SecurityTargetDimension, string> = {
  confidentiality: 'stc',
  integrity: 'sti',
  availability: 'stav',
  authenticity: 'stau',
};

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

/**
 * Liest die vier Schutzziel-Facetten aus der URL.
 *
 * Unbekannte Werte werden verworfen, Duplikate entfernt: Ein Facettenwert
 * beschreibt den Zustand einer Checkbox und kann nicht mehrfach gewählt sein.
 */
function deserializeSecurityTargets(params: URLSearchParams): SecurityTargetFilters {
  const result = emptySecurityTargetFilters();

  for (const { dimension } of SECURITY_TARGET_DIMENSIONS) {
    const values = splitParam(params, SECURITY_TARGET_PARAMS[dimension])
      .filter(isSecurityTargetFilterValue);
    result[dimension] = [...new Set(values)];
  }

  return result;
}

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
    securityTargets: deserializeSecurityTargets(params),
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

  for (const { dimension } of SECURITY_TARGET_DIMENSIONS) {
    setOrDelete(
      params,
      SECURITY_TARGET_PARAMS[dimension],
      filters.securityTargets[dimension],
    );
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
      flush(next, sortRef.current);
    },
    [flush],
  );

  const setSort = useCallback(
    (next: SortConfig) => {
      flush(filtersRef.current, next);
    },
    [flush],
  );

  return { filters, setFilters, sort, setSort, searchString };
}
