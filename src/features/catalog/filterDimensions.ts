import type { ControlFilters, FacetCounts } from '@/hooks/useFilteredControls';
import type {
  EffortLevel,
  LinkRelation,
  Modalverb,
  SecurityLevel,
  VocabularyRegistry,
} from '@/domain/models';
import {
  OFFICIAL_EFFORT_LEVELS,
  OFFICIAL_SECURITY_LEVELS,
  getOfficialEffortLevelLabel,
  getOfficialEffortLevelTooltip,
  getOfficialSecurityLevelLabel,
  getOfficialSecurityLevelTooltip,
} from '@/features/vocabulary/display';
import { compareGermanText } from '@/domain/germanCollation';

/**
 * Facetten mit flacher Wertezählung. Die Schutzziele fallen heraus, weil sie
 * je Dimension eine eigene Zählung tragen und über `resolveSecurityTargetCounts`
 * laufen.
 */
export type FlatFacetDimension = Exclude<keyof FacetCounts, 'securityTargets'>;

export interface FilterDimensionOption {
  readonly value: string;
  readonly label: string;
  readonly tooltip?: string;
  readonly count: number;
  readonly checked: boolean;
}

export interface FilterDimensionConfig {
  readonly field: FlatFacetDimension;
  readonly title: string;
  readonly activeCount: number;
  readonly visible: boolean;
  readonly defaultExpanded: boolean;
  /** Angebotene Optionen in Anzeigereihenfolge; unausgewählte Optionen ohne Treffer fehlen. */
  readonly options: readonly FilterDimensionOption[];
}

export interface FilterDimensionInput {
  readonly filters: ControlFilters;
  readonly facetCounts: FacetCounts;
  readonly filteredFacetCounts: FacetCounts;
  readonly vocabularyRegistry: VocabularyRegistry | null;
}

/** Die Schutzziel-Facetten stehen im Panel direkt nach dieser Dimension. */
export const SECURITY_TARGETS_AFTER: FlatFacetDimension = 'zielobjektKategorien';

const MODALVERB_LABELS: Record<Modalverb, string> = {
  MUSS: 'MUSS',
  SOLLTE: 'SOLLTE',
  KANN: 'KANN',
};

const LINK_RELATION_LABELS: Record<LinkRelation, string> = {
  required: 'Erforderlich',
  related: 'Verwandt',
};

interface FilterDimensionSpec {
  readonly field: FlatFacetDimension;
  readonly title: string;
  /** Aufgabenbezogene Sektionen starten nur mit aktiver Auswahl aufgeklappt. */
  readonly collapsedWithoutSelection: boolean;
  /** Kandidatenwerte in Anzeigereihenfolge. */
  readonly values: (input: FilterDimensionInput) => readonly string[];
  /**
   * Zahl der angebotenen Werte, aus der die Sichtbarkeit der Sektion folgt.
   * Ohne diese Funktion ist die Sektion immer sichtbar.
   */
  readonly offeredCount?: (input: FilterDimensionInput, values: readonly string[]) => number;
  readonly label?: (value: string) => string;
  readonly tooltip?: (registry: VocabularyRegistry | null, value: string) => string | undefined;
}

export function toggleArrayItem(arr: readonly string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

/** Returns true if the given filter dimension has an active selection. */
function hasDimensionFilter(filters: ControlFilters, dimension: FlatFacetDimension): boolean {
  return filters[dimension].length > 0;
}

/**
 * Eine Dimension mit aktiver Auswahl zählt global, damit ihre Optionen beim
 * Auswählen stehen bleiben; ohne Auswahl zählt sie in der aktuellen Treffermenge.
 */
function resolveDimensionCounts(
  { filters, facetCounts, filteredFacetCounts }: FilterDimensionInput,
  dimension: FlatFacetDimension,
): Record<string, number> {
  return hasDimensionFilter(filters, dimension)
    ? facetCounts[dimension]
    : filteredFacetCounts[dimension];
}

/**
 * Sorted entries of a dimension; when the dimension is filtered, selected
 * values missing from the current result set are appended with count 0.
 */
function visibleEntries(
  { filters, filteredFacetCounts }: FilterDimensionInput,
  dimension: FlatFacetDimension,
  sortedEntries: [string, number][],
): [string, number][] {
  if (!hasDimensionFilter(filters, dimension)) return sortedEntries;
  const selectedValues: readonly string[] = filters[dimension];
  const filteredCounts = filteredFacetCounts[dimension];
  const missingSelected = selectedValues
    .filter((value) => !filteredCounts[value])
    .map((value) => [value, 0] as [string, number]);
  return [...sortedEntries, ...missingSelected];
}

/** A filter section renders when it offers options or carries an active selection. */
function isSectionVisible(visibleCount: number, activeCount: number): boolean {
  return visibleCount > 0 || activeCount > 0;
}

function byGermanText([a]: [string, number], [b]: [string, number]): number {
  return compareGermanText(a, b);
}

function entryValues(entries: [string, number][]): string[] {
  return entries.map(([value]) => value);
}

/** Textfacette: deutsch alphabetisch, ausgewählte Werte ohne Treffer am Ende. */
function alphabeticalThenMissing(dimension: FlatFacetDimension) {
  return (input: FilterDimensionInput): string[] => entryValues(visibleEntries(
    input,
    dimension,
    Object.entries(input.filteredFacetCounts[dimension]).sort(byGermanText),
  ));
}

function countVisibleValues(_input: FilterDimensionInput, values: readonly string[]): number {
  return values.length;
}

const FILTER_DIMENSIONS: readonly FilterDimensionSpec[] = [
  {
    field: 'securityLevels',
    title: 'Sicherheitsniveau',
    collapsedWithoutSelection: false,
    values: () => OFFICIAL_SECURITY_LEVELS,
    label: (value) => getOfficialSecurityLevelLabel(value as SecurityLevel),
    tooltip: (registry, value) => getOfficialSecurityLevelTooltip(registry, value as SecurityLevel),
  },
  {
    field: 'modalverben',
    title: 'Modalverben',
    collapsedWithoutSelection: false,
    values: () => Object.keys(MODALVERB_LABELS),
    label: (value) => MODALVERB_LABELS[value as Modalverb],
  },
  {
    field: 'effortLevels',
    title: 'Aufwandsstufen',
    collapsedWithoutSelection: false,
    values: () => OFFICIAL_EFFORT_LEVELS,
    label: (value) => getOfficialEffortLevelLabel(value as EffortLevel),
    tooltip: (registry, value) => getOfficialEffortLevelTooltip(registry, value as EffortLevel),
  },
  {
    field: 'zielobjektKategorien',
    title: 'Zielobjekt-Kategorien',
    collapsedWithoutSelection: false,
    // Zielobjekte nach Trefferzahl sortieren.
    values: (input) => entryValues(visibleEntries(
      input,
      'zielobjektKategorien',
      Object.entries(input.filteredFacetCounts.zielobjektKategorien).sort((a, b) => b[1] - a[1]),
    )),
    offeredCount: countVisibleValues,
  },
  {
    field: 'dokumentationstypen',
    title: 'Dokumentationsvorgaben',
    collapsedWithoutSelection: true,
    values: alphabeticalThenMissing('dokumentationstypen'),
    offeredCount: countVisibleValues,
  },
  {
    field: 'handlungsworte',
    title: 'Handlungsworte',
    collapsedWithoutSelection: true,
    values: alphabeticalThenMissing('handlungsworte'),
    offeredCount: countVisibleValues,
  },
  {
    field: 'tags',
    title: 'Tags',
    collapsedWithoutSelection: true,
    // Ausgewählte Tags ohne Treffer stehen an ihrer alphabetischen Position.
    values: (input) => entryValues(visibleEntries(
      input,
      'tags',
      Object.entries(input.filteredFacetCounts.tags),
    ).sort(byGermanText)),
    offeredCount: countVisibleValues,
  },
  {
    field: 'linkRelationen',
    title: 'Link-Relationen',
    collapsedWithoutSelection: true,
    values: () => Object.keys(LINK_RELATION_LABELS),
    label: (value) => LINK_RELATION_LABELS[value as LinkRelation],
    offeredCount: (input) => Object.keys(input.filteredFacetCounts.linkRelationen).length,
  },
];

/** Liefert die flachen Filterdimensionen des Panels in Anzeigereihenfolge. */
export function buildFilterDimensions(input: FilterDimensionInput): FilterDimensionConfig[] {
  const { filters, vocabularyRegistry } = input;
  return FILTER_DIMENSIONS.map((spec) => {
    const selectedValues: readonly string[] = filters[spec.field];
    const activeCount = selectedValues.length;
    const counts = resolveDimensionCounts(input, spec.field);
    const values = spec.values(input);
    const options: FilterDimensionOption[] = [];
    for (const value of values) {
      const count = counts[value] ?? 0;
      const checked = selectedValues.includes(value);
      if (!checked && count === 0) continue;
      options.push({
        value,
        label: spec.label ? spec.label(value) : value,
        tooltip: spec.tooltip?.(vocabularyRegistry, value),
        count,
        checked,
      });
    }
    return {
      field: spec.field,
      title: spec.title,
      activeCount,
      visible: spec.offeredCount
        ? isSectionVisible(spec.offeredCount(input, values), activeCount)
        : true,
      defaultExpanded: spec.collapsedWithoutSelection ? activeCount > 0 : true,
      options,
    };
  });
}
