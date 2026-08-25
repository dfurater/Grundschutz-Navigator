import { useCallback, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useCatalog } from '@/hooks/useCatalog';
import { useSearch } from './useSearch';
import { Button } from '@/components/Button';
import { ControlTable } from '@/features/catalog/ControlTable';
import { ControlMobileReferenceRow } from '@/features/catalog/ControlMobileReferenceRow';
import { CatalogMobileSelectionBar } from '@/features/catalog/CatalogMobileSelectionBar';
import { SearchResultsToolbar } from './SearchResultsToolbar';
import { useControlSelection } from '@/hooks/useControlSelection';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { Control } from '@/domain/models';
import {
  emptyFilters,
  useFilteredControls,
  type SortConfig,
} from '@/hooks/useFilteredControls';
import { IconSearch } from '@/components/icons';
import { buildControlUrlForControl } from '@/app/routes';

const SEARCH_RESULTS_PAGE_SIZE = 50;

function pluralizedResultSuffix(count: number): string {
  return count === 1 ? '' : 'se';
}

interface ResultsUiState {
  query: string;
  sort: SortConfig;
  visibleResultCount: number;
  mobileSelectMode: boolean;
}

function createResultsUiState(query: string): ResultsUiState {
  return {
    query,
    sort: [],
    visibleResultCount: SEARCH_RESULTS_PAGE_SIZE,
    mobileSelectMode: false,
  };
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const navigate = useNavigate();
  // Genau ein Media-Query-Abo pro Seite: steuert das Mount-Gate der
  // Exportzugänge in der Toolbar (GSPP-268) und der Ergebnislisten (GSPP-261).
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const { catalog, loading, vocabularyRegistry } = useCatalog();
  const [inputState, setInputState] = useState(() => ({
    query,
    value: query,
  }));
  const inputValue =
    inputState.query === query ? inputState.value : query;

  const { results, totalResults } = useSearch(
    catalog?.controls ?? [],
    query,
    vocabularyRegistry,
    catalog?.practices ?? [],
  );
  const [resultsUiState, setResultsUiState] = useState<ResultsUiState>(() =>
    createResultsUiState(query),
  );
  const { sort, visibleResultCount, mobileSelectMode } =
    resultsUiState.query === query ? resultsUiState : createResultsUiState(query);

  const setSort = useCallback(
    (next: SortConfig) => {
      setResultsUiState((current) => ({
        ...(current.query === query ? current : createResultsUiState(query)),
        query,
        sort: next,
      }));
    },
    [query],
  );

  const handleShowMoreResults = useCallback(() => {
    setResultsUiState((current) => {
      const base = current.query === query ? current : createResultsUiState(query);
      return {
        ...base,
        query,
        visibleResultCount: base.visibleResultCount + SEARCH_RESULTS_PAGE_SIZE,
      };
    });
  }, [query]);

  const setMobileSelectMode = useCallback(
    (next: boolean) => {
      setResultsUiState((current) => ({
        ...(current.query === query ? current : createResultsUiState(query)),
        query,
        mobileSelectMode: next,
      }));
    },
    [query],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputState({
        query,
        value,
      });
    },
    [query],
  );

  const resultControls = useMemo(
    () => results.map(({ control }) => control),
    [results],
  );

  const controlsById = catalog?.controlsById;
  const catalogKey = catalog?.catalogKey ?? '__unknown_catalog__';
  const {
    checkedIds,
    setCheckedIds,
    setChecked,
    clear: clearSelection,
  } = useControlSelection({ scopeId: `search:${catalogKey}:${query}` });

  const finishMobileSelection = useCallback(() => {
    setMobileSelectMode(false);
    clearSelection();
  }, [clearSelection, setMobileSelectMode]);

  const toggleMobileSelectMode = useCallback(() => {
    if (mobileSelectMode) {
      finishMobileSelection();
    } else {
      setMobileSelectMode(true);
    }
  }, [finishMobileSelection, mobileSelectMode, setMobileSelectMode]);

  const handleMobileCheckedChange = useCallback(
    (control: Control, checked: boolean) => {
      setChecked(control.id, checked);
    },
    [setChecked],
  );

  const { filtered: tableControls } = useFilteredControls(
    resultControls,
    emptyFilters,
    sort,
  );
  const displayedResultCount = Math.min(visibleResultCount, totalResults);
  const visibleTableControls = useMemo(
    () => tableControls.slice(0, displayedResultCount),
    [tableControls, displayedResultCount],
  );
  const visibleMobileControls = useMemo(
    () => resultControls.slice(0, displayedResultCount),
    [resultControls, displayedResultCount],
  );
  const hasHiddenResults = displayedResultCount < totalResults;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) {
      setSearchParams({ q: trimmed });
    } else {
      setSearchParams({});
    }
  };

  const isLoading = loading;
  const resultCountSuffix = pluralizedResultSuffix(totalResults);

  return (
    <div className="flex-1 min-w-0 flex flex-col md:overflow-hidden">
      {/* Mobile search input — only visible below sm breakpoint where HeaderBar hides the input */}
      <div className="shrink-0 border-b border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-4 py-3 sm:px-6">
        <form onSubmit={handleSubmit} className="mb-4 sm:hidden">
          <div className="relative">
            <IconSearch
              className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
              aria-hidden={true}
            />
            <input
              type="search"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="Suche…"
              autoFocus
              className="block w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] py-2 pl-9 pr-3 text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-sm)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:border-[var(--color-focus-ring)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-base)]"
              aria-label="Suchbegriff eingeben"
            />
          </div>
        </form>

        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="type-page-title flex items-center gap-2">
              <IconSearch className="w-5 h-5 text-[var(--color-text-muted)] hidden sm:block" aria-hidden={true} />
              Suchergebnisse
            </h1>
            {query && !isLoading && (
              <p className="type-secondary mt-1">
                {hasHiddenResults
                  ? `${displayedResultCount} von ${totalResults} Ergebnissen`
                  : `${totalResults} Ergebnis${resultCountSuffix}`}{' '}
                für{' '}
                <span className="font-medium text-[var(--color-text-secondary)]">"{query}"</span>
              </p>
            )}
            {!query && (
              <p className="type-secondary mt-1">
                Geben Sie einen Suchbegriff ein.
              </p>
            )}
          </div>

          {!isLoading && controlsById && results.length > 0 && (
            <SearchResultsToolbar
              checkedIds={checkedIds}
              onClearSelection={clearSelection}
              mobileSelectMode={mobileSelectMode}
              onToggleMobileSelectMode={toggleMobileSelectMode}
              isDesktop={isDesktop}
              desktopViewControls={tableControls}
              mobileViewControls={resultControls}
              allControls={catalog?.controls ?? []}
              onSelectionExported={finishMobileSelection}
            />
          )}
        </div>
      </div>

      {/* Loading spinner */}
      {isLoading && (
        <div className="flex flex-1 items-start gap-3 p-4 sm:p-6">
          <div className="inline-block w-5 h-5 border-2 border-[var(--color-border-strong)] border-t-[var(--color-primary-main)] rounded-full animate-spin" />
          <span className="text-sm text-[var(--color-text-secondary)]">Suche wird vorbereitet…</span>
        </div>
      )}

      {/* Results — genau ein gemounteter Ergebniszweig je Breakpoint
          (GSPP-261, Invariante aus GRU-217); kein CSS-Doppel-Mount mehr. */}
      {!isLoading && controlsById && results.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {isDesktop ? (
            /* Desktop: volle Katalogtabelle */
            <div data-testid="search-results-desktop" className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <ControlTable
                controls={visibleTableControls}
                controlsById={controlsById}
                selectedControlId={undefined}
                selectableControls={tableControls}
                checkedIds={checkedIds}
                sort={sort}
                onSortChange={setSort}
                onSelectControl={(control) =>
                  catalog && navigate(buildControlUrlForControl(catalog.catalogKey, control))
                }
                onCheckedChange={setCheckedIds}
              />
            </div>
          ) : (
            <>
              {/* Mobile: Katalog-Mobile-Referenzliste */}
              <div
                data-testid="search-results-mobile"
                className={`flex-1 md:overflow-y-auto divide-y divide-[var(--color-border-subtle)] ${mobileSelectMode ? 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))]' : 'pb-safe'}`}
              >
                {visibleMobileControls.map((control) => (
                  <ControlMobileReferenceRow
                    key={control.id}
                    control={control}
                    controlsById={controlsById}
                    selectMode={mobileSelectMode}
                    checked={checkedIds.has(control.id)}
                    onSelect={(control) =>
                      catalog && navigate(buildControlUrlForControl(catalog.catalogKey, control))
                    }
                    onCheckedChange={handleMobileCheckedChange}
                  />
                ))}
              </div>
              {mobileSelectMode && catalog && (
                <CatalogMobileSelectionBar
                  checkedIds={checkedIds}
                  allControls={catalog.controls}
                  onDone={finishMobileSelection}
                />
              )}
            </>
          )}
          {hasHiddenResults && (
            <div className="shrink-0 border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-4 py-3 text-center">
              <Button
                type="button"
                variant="secondary"
                onClick={handleShowMoreResults}
                aria-label={`Weitere Suchergebnisse anzeigen. ${displayedResultCount} von ${totalResults} sichtbar.`}
              >
                Weitere Ergebnisse anzeigen
              </Button>
            </div>
          )}
        </div>
      )}

      {/* No results */}
      {!isLoading && query && results.length === 0 && (
        <div className="flex-1 text-center p-8">
          <p className="text-[var(--color-text-secondary)]">
            Keine Ergebnisse für "{query}" gefunden.
          </p>
          <p className="type-secondary mt-1">
            Versuchen Sie einen anderen Suchbegriff.
          </p>
        </div>
      )}
    </div>
  );
}
