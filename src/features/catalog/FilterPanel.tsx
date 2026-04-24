import { FilterSection } from '@/components/FilterSection';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import { IconFilter, IconChevronRight } from '@/components/icons';
import type { ControlFilters, FacetCounts } from '@/hooks/useFilteredControls';
import type { Modalverb, LinkRelation } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import {
  OFFICIAL_EFFORT_LEVELS,
  OFFICIAL_SECURITY_LEVELS,
  getOfficialEffortLevelLabel,
  getOfficialEffortLevelTooltip,
  getOfficialSecurityLevelLabel,
  getOfficialSecurityLevelTooltip,
} from '@/features/vocabulary/display';

export interface FilterPanelProps {
  filters: ControlFilters;
  facetCounts: FacetCounts;
  filteredFacetCounts: FacetCounts;
  hasActiveFilters: boolean;
  filteredCount: number;
  totalCount: number;
  onFiltersChange: (filters: ControlFilters) => void;
  onClearFilters: () => void;
  onCollapse?: () => void;
}

const MODALVERB_LABELS: Record<Modalverb, string> = {
  MUSS: 'MUSS',
  SOLLTE: 'SOLLTE',
  KANN: 'KANN',
};

const LINK_RELATION_LABELS: Record<LinkRelation, string> = {
  required: 'Erforderlich',
  related: 'Verwandt',
};

function toggleArrayItem<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

/** Returns true if the given filter dimension has an active selection. */
function hasDimensionFilter(filters: ControlFilters, dimension: keyof FacetCounts): boolean {
  switch (dimension) {
    case 'modalverben': return filters.modalverben.length > 0;
    case 'securityLevels': return filters.securityLevels.length > 0;
    case 'effortLevels': return filters.effortLevels.length > 0;
    case 'tags': return filters.tags.length > 0;
    case 'zielobjektKategorien': return filters.zielobjektKategorien.length > 0;
    case 'handlungsworte': return filters.handlungsworte.length > 0;
    case 'dokumentationstypen': return filters.dokumentationstypen.length > 0;
    case 'linkRelationen': return filters.linkRelationen.length > 0;
  }
}

export function FilterPanel({
  filters,
  facetCounts,
  filteredFacetCounts,
  hasActiveFilters,
  filteredCount,
  totalCount,
  onFiltersChange,
  onClearFilters,
  onCollapse,
}: FilterPanelProps) {
  const { vocabularyRegistry } = useCatalog();

  // Per-dimension: use global counts if this dimension has active filters (freeze),
  // otherwise use filtered counts so the user sees what's actually in the current result set.
  const modalverbCounts = hasDimensionFilter(filters, 'modalverben')
    ? facetCounts.modalverben
    : filteredFacetCounts.modalverben;
  const securityLevelCounts = hasDimensionFilter(filters, 'securityLevels')
    ? facetCounts.securityLevels
    : filteredFacetCounts.securityLevels;
  const effortLevelCounts = hasDimensionFilter(filters, 'effortLevels')
    ? facetCounts.effortLevels
    : filteredFacetCounts.effortLevels;
  const zielobjektCounts = hasDimensionFilter(filters, 'zielobjektKategorien')
    ? facetCounts.zielobjektKategorien
    : filteredFacetCounts.zielobjektKategorien;
  const handlungswortCounts = hasDimensionFilter(filters, 'handlungsworte')
    ? facetCounts.handlungsworte
    : filteredFacetCounts.handlungsworte;
  const dokumentationCounts = hasDimensionFilter(filters, 'dokumentationstypen')
    ? facetCounts.dokumentationstypen
    : filteredFacetCounts.dokumentationstypen;
  const linkRelationCounts = hasDimensionFilter(filters, 'linkRelationen')
    ? facetCounts.linkRelationen
    : filteredFacetCounts.linkRelationen;
  const tagCounts = hasDimensionFilter(filters, 'tags')
    ? facetCounts.tags
    : filteredFacetCounts.tags;

  // Sort dynamic lists by count descending (use filteredFacetCounts for relevance ordering)
  const sortedTags = Object.entries(filteredFacetCounts.tags)
    .sort((a, b) => b[1] - a[1]);
  const sortedZielobjekte = Object.entries(filteredFacetCounts.zielobjektKategorien)
    .sort((a, b) => b[1] - a[1]);
  const sortedHandlungsworte = Object.entries(filteredFacetCounts.handlungsworte)
    .sort(([a], [b]) => a.localeCompare(b, 'de'));
  const sortedDokumentationstypen = Object.entries(filteredFacetCounts.dokumentationstypen)
    .sort(([a], [b]) => a.localeCompare(b, 'de'));

  // For active-filter dimensions, include all selected values even if count is 0
  const visibleZielobjekte = hasDimensionFilter(filters, 'zielobjektKategorien')
    ? [
        ...sortedZielobjekte,
        ...filters.zielobjektKategorien
          .filter((k) => !filteredFacetCounts.zielobjektKategorien[k])
          .map((k) => [k, 0] as [string, number]),
      ]
    : sortedZielobjekte;
  const visibleHandlungsworte = hasDimensionFilter(filters, 'handlungsworte')
    ? [
        ...sortedHandlungsworte,
        ...filters.handlungsworte
          .filter((h) => !filteredFacetCounts.handlungsworte[h])
          .map((h) => [h, 0] as [string, number]),
      ]
    : sortedHandlungsworte;
  const visibleDokumentationstypen = hasDimensionFilter(filters, 'dokumentationstypen')
    ? [
        ...sortedDokumentationstypen,
        ...filters.dokumentationstypen
          .filter((d) => !filteredFacetCounts.dokumentationstypen[d])
          .map((d) => [d, 0] as [string, number]),
      ]
    : sortedDokumentationstypen;
  const visibleTags = hasDimensionFilter(filters, 'tags')
    ? [
        ...sortedTags,
        ...filters.tags
          .filter((t) => !filteredFacetCounts.tags[t])
          .map((t) => [t, 0] as [string, number]),
      ]
    : sortedTags;

  const activeModalverben = filters.modalverben.length;
  const activeSecurityLevels = filters.securityLevels.length;
  const activeEffortLevels = filters.effortLevels.length;
  const activeZielobjekte = filters.zielobjektKategorien.length;
  const activeHandlungsworte = filters.handlungsworte.length;
  const activeDokumentationstypen = filters.dokumentationstypen.length;
  const activeLinkRelationen = filters.linkRelationen.length;
  const activeTags = filters.tags.length;

  return (
    <form
      role="search"
      aria-label="Kontrollen filtern"
      onSubmit={(e) => e.preventDefault()}
      className="flex-1 min-h-0 w-full flex flex-col bg-[var(--color-surface-subtle)]"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border-default)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconFilter className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <h2 className="type-meta">Filter</h2>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
              aria-label="Filter ausblenden"
              title="Filter ausblenden"
            >
              <IconChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="type-meta tabular-nums" aria-live="polite" aria-atomic="true">
            {filteredCount === totalCount
              ? `${totalCount} Kontrollen`
              : `${filteredCount} von ${totalCount} Kontrollen`}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Zurücksetzen
            </button>
          )}
        </div>
      </div>

      {/* Filter Sections */}
      <div data-filter-scroll className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y px-4 py-1">
        {/* modal_verb */}
        <FilterSection title="Modalverben" activeCount={activeModalverben}>
          {(Object.keys(MODALVERB_LABELS) as Modalverb[]).map((mv) => {
            const count = modalverbCounts[mv] ?? 0;
            const isSelected = filters.modalverben.includes(mv);
            if (!isSelected && count === 0) return null;
            return (
              <CheckboxLabel
                key={mv}
                label={MODALVERB_LABELS[mv]}
                count={count}
                checked={isSelected}
                onChange={() =>
                  onFiltersChange({
                    ...filters,
                    modalverben: toggleArrayItem(filters.modalverben, mv),
                  })
                }
              />
            );
          })}
        </FilterSection>

        {/* sec_level */}
        <FilterSection title="Sicherheitsniveau" activeCount={activeSecurityLevels}>
          {OFFICIAL_SECURITY_LEVELS.map((sl) => {
            const count = securityLevelCounts[sl] ?? 0;
            const isSelected = filters.securityLevels.includes(sl);
            if (!isSelected && count === 0) return null;
            return (
              <CheckboxLabel
                key={sl}
                label={getOfficialSecurityLevelLabel(sl)}
                title={getOfficialSecurityLevelTooltip(vocabularyRegistry, sl)}
                count={count}
                checked={isSelected}
                onChange={() =>
                  onFiltersChange({
                    ...filters,
                    securityLevels: toggleArrayItem(filters.securityLevels, sl),
                  })
                }
              />
            );
          })}
        </FilterSection>

        {/* effort_level */}
        <FilterSection title="Aufwandsstufen" activeCount={activeEffortLevels}>
          {OFFICIAL_EFFORT_LEVELS.map((el) => {
            const count = effortLevelCounts[el] ?? 0;
            const isSelected = filters.effortLevels.includes(el);
            if (!isSelected && count === 0) return null;
            return (
              <CheckboxLabel
                key={el}
                label={getOfficialEffortLevelLabel(el)}
                title={getOfficialEffortLevelTooltip(vocabularyRegistry, el)}
                count={count}
                checked={isSelected}
                onChange={() =>
                  onFiltersChange({
                    ...filters,
                    effortLevels: toggleArrayItem(filters.effortLevels, el),
                  })
                }
              />
            );
          })}
        </FilterSection>

        {/* Zielobjekt-Kategorien */}
        {(visibleZielobjekte.length > 0 || activeZielobjekte > 0) && (
          <FilterSection title="Zielobjekt-Kategorien" activeCount={activeZielobjekte}>
            {visibleZielobjekte.map(([kat]) => {
              const count = zielobjektCounts[kat] ?? 0;
              const isSelected = filters.zielobjektKategorien.includes(kat);
              if (!isSelected && count === 0) return null;
              return (
                <CheckboxLabel
                  key={kat}
                  label={kat}
                  count={count}
                  checked={isSelected}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      zielobjektKategorien: toggleArrayItem(filters.zielobjektKategorien, kat),
                    })
                  }
                />
              );
            })}
          </FilterSection>
        )}

        {(visibleHandlungsworte.length > 0 || activeHandlungsworte > 0) && (
          <FilterSection title="Handlungsworte" activeCount={activeHandlungsworte}>
            {visibleHandlungsworte.map(([handlungswort]) => {
              const count = handlungswortCounts[handlungswort] ?? 0;
              const isSelected = filters.handlungsworte.includes(handlungswort);
              if (!isSelected && count === 0) return null;
              return (
                <CheckboxLabel
                  key={handlungswort}
                  label={handlungswort}
                  count={count}
                  checked={isSelected}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      handlungsworte: toggleArrayItem(filters.handlungsworte, handlungswort),
                    })
                  }
                />
              );
            })}
          </FilterSection>
        )}

        {(visibleDokumentationstypen.length > 0 || activeDokumentationstypen > 0) && (
          <FilterSection title="Dokumentationsvorgaben" activeCount={activeDokumentationstypen}>
            {visibleDokumentationstypen.map(([dokumentation]) => {
              const count = dokumentationCounts[dokumentation] ?? 0;
              const isSelected = filters.dokumentationstypen.includes(dokumentation);
              if (!isSelected && count === 0) return null;
              return (
                <CheckboxLabel
                  key={dokumentation}
                  label={dokumentation}
                  count={count}
                  checked={isSelected}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      dokumentationstypen: toggleArrayItem(filters.dokumentationstypen, dokumentation),
                    })
                  }
                />
              );
            })}
          </FilterSection>
        )}

        {(Object.keys(filteredFacetCounts.linkRelationen).length > 0 || activeLinkRelationen > 0) && (
          <FilterSection title="Link-Relationen" activeCount={activeLinkRelationen}>
            {(Object.keys(LINK_RELATION_LABELS) as LinkRelation[]).map((relation) => {
              const count = linkRelationCounts[relation] ?? 0;
              const isSelected = filters.linkRelationen.includes(relation);
              if (!isSelected && count === 0) return null;
              return (
                <CheckboxLabel
                  key={relation}
                  label={LINK_RELATION_LABELS[relation]}
                  count={count}
                  checked={isSelected}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      linkRelationen: toggleArrayItem(filters.linkRelationen, relation),
                    })
                  }
                />
              );
            })}
          </FilterSection>
        )}

        {/* Tags */}
        {(visibleTags.length > 0 || activeTags > 0) && (
          <FilterSection title="Tags" activeCount={activeTags}>
            {visibleTags.map(([tag]) => {
              const count = tagCounts[tag] ?? 0;
              const isSelected = filters.tags.includes(tag);
              if (!isSelected && count === 0) return null;
              return (
                <CheckboxLabel
                  key={tag}
                  label={tag}
                  count={count}
                  checked={isSelected}
                  onChange={() =>
                    onFiltersChange({
                      ...filters,
                      tags: toggleArrayItem(filters.tags, tag),
                    })
                  }
                />
              );
            })}
          </FilterSection>
        )}
      </div>
    </form>
  );
}
