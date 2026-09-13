import { FilterSection } from '@/components/FilterSection';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import type { ControlFilters, FacetCounts } from '@/hooks/useFilteredControls';
import {
  SECURITY_TARGET_DIMENSIONS,
  SECURITY_TARGET_FILTER_VALUES,
  type SecurityTargetDimension,
  type SecurityTargetFilterValue,
} from '@/domain/securityTargets';
import {
  getSecurityTargetFilterLabel,
  getSecurityTargetFilterTooltip,
} from '@/features/vocabulary/display';
import { useCatalog } from '@/hooks/useCatalog';

export interface SecurityTargetFilterSectionsProps {
  readonly filters: ControlFilters;
  readonly facetCounts: FacetCounts;
  readonly filteredFacetCounts: FacetCounts;
  readonly onFiltersChange: (filters: ControlFilters) => void;
}

/**
 * Gleiche Einfrier-Regel wie bei den übrigen Facetten: Sobald eine Dimension
 * selbst gefiltert ist, bleiben ihre Zahlen auf der ungefilterten Menge stehen,
 * damit die nicht gewählten Optionen ihre Größe behalten.
 */
function resolveCounts(
  filters: ControlFilters,
  dimension: SecurityTargetDimension,
  facetCounts: FacetCounts,
  filteredFacetCounts: FacetCounts,
): Record<string, number> {
  return filters.securityTargets[dimension].length > 0
    ? facetCounts.securityTargets[dimension]
    : filteredFacetCounts.securityTargets[dimension];
}

function toggleValue(
  selected: readonly SecurityTargetFilterValue[],
  value: SecurityTargetFilterValue,
): SecurityTargetFilterValue[] {
  return selected.includes(value)
    ? selected.filter((entry) => entry !== value)
    : [...selected, value];
}

/**
 * Eine Facette je Schutzziel — ODER innerhalb einer Dimension, UND über die
 * vier. Die Stufen sind exakt: Wer `1` wählt, sieht genau die Stufe `1`.
 * Mehrere Stufen zusammen ergeben die Obermenge über das ODER. Die Facette
 * erzeugt an keiner Stelle eine Abdeckungs-, Compliance- oder
 * Erfüllungsaussage.
 *
 * Auswählbar sind nur die drei Stufen der Skala: Unbewertete Anforderungen und
 * skalenfremde Werte fallen bei aktiver Facette heraus, weil eine Facette zu
 * den Anforderungen führt, die ein Schutzziel betreffen. Die Stufe `0` trifft
 * dabei ausschließlich Anforderungen, die tatsächlich mit `0` bewertet sind —
 * nie solche ohne Angabe. Eine Stufe ohne Treffer wird ausgeblendet, solange
 * sie nicht gewählt ist; dieselbe Regel wie bei allen Facetten.
 */
export function SecurityTargetFilterSections({
  filters,
  facetCounts,
  filteredFacetCounts,
  onFiltersChange,
}: SecurityTargetFilterSectionsProps) {
  const { vocabularyRegistry } = useCatalog();

  return (
    <>
      {SECURITY_TARGET_DIMENSIONS.map(({ dimension, label }) => {
        const selected = filters.securityTargets[dimension];
        const counts = resolveCounts(filters, dimension, facetCounts, filteredFacetCounts);

        return (
          <FilterSection
            key={dimension}
            title={`Schutzziel ${label}`}
            activeCount={selected.length}
            defaultExpanded={selected.length > 0}
          >
            {SECURITY_TARGET_FILTER_VALUES.map((filterValue) => {
              const count = counts[filterValue] ?? 0;
              const isSelected = selected.includes(filterValue);
              if (!isSelected && count === 0) return null;
              const optionLabel = getSecurityTargetFilterLabel(filterValue);

              return (
                <CheckboxLabel
                  key={filterValue}
                  label={optionLabel}
                  // Ohne das Schutzziel im Namen wären die vier Facetten für
                  // Screenreader ununterscheidbar — sie bieten dieselben
                  // Optionsnamen an, und die Facettenüberschrift ist mit der
                  // Checkbox nicht programmatisch verbunden.
                  ariaLabel={`${label}: ${optionLabel}`}
                  title={getSecurityTargetFilterTooltip(vocabularyRegistry, filterValue)}
                  count={count}
                  checked={isSelected}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      securityTargets: {
                        ...filters.securityTargets,
                        [dimension]: toggleValue(selected, filterValue),
                      },
                    })
                  }
                />
              );
            })}
          </FilterSection>
        );
      })}
    </>
  );
}
