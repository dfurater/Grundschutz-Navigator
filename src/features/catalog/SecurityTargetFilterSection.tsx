import { Fragment } from 'react';
import { FilterSection } from '@/components/FilterSection';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import type { ControlFilters, FacetCounts } from '@/hooks/useFilteredControls';
import {
  SECURITY_TARGET_DIMENSIONS,
  SECURITY_TARGET_FILTER_VALUES,
  securityTargetSelectionState,
  sumSecurityTargetCounts,
  type SecurityTargetDimension,
  type SecurityTargetFilterValue,
} from '@/domain/securityTargets';
import {
  getSecurityTargetFilterLabel,
  getSecurityTargetFilterTooltip,
} from '@/features/vocabulary/display';
import { useCatalog } from '@/hooks/useCatalog';

export interface SecurityTargetFilterSectionProps {
  readonly filters: ControlFilters;
  readonly facetCounts: FacetCounts;
  readonly filteredFacetCounts: FacetCounts;
  readonly onFiltersChange: (filters: ControlFilters) => void;
}

/**
 * Kurzfassung der Stufendefinitionen für die Legende.
 *
 * Die vollständigen Definitionen aus `security_targets_levels.csv` stehen
 * weiter im `title` der Stufenzeilen; die Legende kürzt sie auf die Länge, die
 * im 288 px breiten Panel ohne Umbruchsalat lesbar bleibt — vor allem bei der
 * Stufe `2`, deren Definition zwei Sätze umfasst. Eine gekürzte Fassung ist
 * damit redaktioneller Text dieser App und keine Vokabularauflösung: Ändert das
 * BSI die Definitionen, ist diese Tabelle mit nachzuziehen.
 */
const STUFEN_LEGENDE: Record<SecurityTargetFilterValue, string> = {
  '1': 'wirkt auf das Schutzziel hin',
  '2': 'steht im Zentrum der Anforderung',
};

/**
 * Gleiche Einfrier-Regel wie bei den übrigen Facetten: Sobald eine Dimension
 * selbst gefiltert ist, bleiben ihre Zahlen auf der ungefilterten Menge stehen,
 * damit die nicht gewählten Optionen ihre Größe behalten. Die Regel gilt je
 * Dimension, nicht für die Sektion als Ganzes.
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

/**
 * Schaltet eine Stufe um und hält die Auswahl in der Ordnung der Skala — so
 * bleibt der URL-Parameter unabhängig von der Klickreihenfolge derselbe.
 */
function toggleValue(
  selected: readonly SecurityTargetFilterValue[],
  value: SecurityTargetFilterValue,
): SecurityTargetFilterValue[] {
  const next = new Set(selected);
  if (!next.delete(value)) next.add(value);
  return SECURITY_TARGET_FILTER_VALUES.filter((filterValue) => next.has(filterValue));
}

/**
 * Eine Sektion mit den vier Schutzzielen — ODER innerhalb einer Dimension, UND
 * über die vier. Die Facette erzeugt an keiner Stelle eine Abdeckungs-,
 * Compliance- oder Erfüllungsaussage.
 *
 * Die Auswahl ist zweistufig: Die Zeile eines Schutzziels wählt beide Stufen
 * und trägt deren gemeinsame Trefferzahl; erst dann erscheinen die Stufen
 * einzeln darunter und lassen sich abwählen. Ist genau eine Stufe gewählt,
 * steht die Zeile im dritten Kontrollzustand — ohne ihn bedeutete ein gesetzter
 * Haken wahlweise „beide Stufen" oder „eine Stufe".
 *
 * Auswählbar sind nur die Stufen `1` und `2`. Die Stufe `0`, unbewertete
 * Anforderungen und skalenfremde Werte fallen bei aktiver Facette heraus, weil
 * eine Facette zu den Anforderungen führt, die ein Schutzziel betreffen. Ein
 * Schutzziel ohne Treffer wird ausgeblendet, solange es nicht gewählt ist;
 * dieselbe Regel wie bei allen Facetten. Die beiden Stufen einer gewählten
 * Dimension bleiben dagegen immer sichtbar — sie sind der einzige Weg, die
 * Auswahl wieder zu verfeinern.
 */
export function SecurityTargetFilterSection({
  filters,
  facetCounts,
  filteredFacetCounts,
  onFiltersChange,
}: SecurityTargetFilterSectionProps) {
  const { vocabularyRegistry } = useCatalog();

  function selectDimension(
    dimension: SecurityTargetDimension,
    values: SecurityTargetFilterValue[],
  ) {
    onFiltersChange({
      ...filters,
      securityTargets: { ...filters.securityTargets, [dimension]: values },
    });
  }

  const zeilen = SECURITY_TARGET_DIMENSIONS.map(({ dimension, label }) => {
    const selected = filters.securityTargets[dimension];
    const counts = resolveCounts(filters, dimension, facetCounts, filteredFacetCounts);
    return {
      dimension,
      label,
      selected,
      counts,
      total: sumSecurityTargetCounts(counts),
      state: securityTargetSelectionState(selected),
    };
  }).filter((zeile) => zeile.state !== 'none' || zeile.total > 0);

  if (zeilen.length === 0) return null;

  const activeCount = zeilen.filter((zeile) => zeile.state !== 'none').length;

  return (
    <FilterSection title="Schutzziele" activeCount={activeCount}>
      {/*
        Eine Legende je Sektion statt eines Tooltips je Stufenzeile: Der
        `title`-Tooltip ist auf Touch nicht erreichbar, und die Stufen tragen im
        Vokabular keine Bezeichnung, aus der sich ihre Bedeutung ablesen ließe.
      */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-b border-[var(--color-border-subtle)] pb-2 mb-1 text-xs text-[var(--color-text-muted)]">
        {SECURITY_TARGET_FILTER_VALUES.map((filterValue) => (
          <Fragment key={filterValue}>
            <dt className="whitespace-nowrap">
              {getSecurityTargetFilterLabel(filterValue)}
            </dt>
            <dd>{STUFEN_LEGENDE[filterValue]}</dd>
          </Fragment>
        ))}
      </dl>

      {zeilen.map(({ dimension, label, selected, counts, total, state }) => (
        <div key={dimension} className="space-y-0.5">
          <CheckboxLabel
            label={label}
            count={total}
            checked={state === 'all'}
            indeterminate={state === 'partial'}
            onChange={(checked) =>
              selectDimension(dimension, checked ? [...SECURITY_TARGET_FILTER_VALUES] : [])
            }
          />
          {state !== 'none' && (
            <div className="ml-5 space-y-0.5">
              {SECURITY_TARGET_FILTER_VALUES.map((filterValue) => {
                const stufenLabel = getSecurityTargetFilterLabel(filterValue);

                return (
                  <CheckboxLabel
                    key={filterValue}
                    label={stufenLabel}
                    // Ohne das Schutzziel im Namen wären die Stufenzeilen der
                    // vier Dimensionen für Screenreader ununterscheidbar — sie
                    // tragen dieselben Beschriftungen, und die Elternzeile ist
                    // mit ihnen nicht programmatisch verbunden.
                    ariaLabel={`${label}: ${stufenLabel}`}
                    title={getSecurityTargetFilterTooltip(vocabularyRegistry, filterValue)}
                    count={counts[filterValue] ?? 0}
                    checked={selected.includes(filterValue)}
                    onChange={() => selectDimension(dimension, toggleValue(selected, filterValue))}
                  />
                );
              })}
            </div>
          )}
        </div>
      ))}
    </FilterSection>
  );
}
