import { useCallback, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCatalog } from '@/hooks/useCatalog';
import { useSearch } from './useSearch';
import { Button } from '@/components/Button';
import { ControlTable } from '@/features/catalog/ControlTable';
import { ControlMobileReferenceRow } from '@/features/catalog/ControlMobileReferenceRow';
import {
  emptyFilters,
  useFilteredControls,
  type SortConfig,
} from '@/hooks/useFilteredControls';
import { IconSearch } from '@/components/icons';

const SEARCH_RESULTS_PAGE_SIZE = 50;

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const navigate = useNavigate();
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
  );
  const [resultsUiState, setResultsUiState] = useState(() => ({
    query,
    sort: [] as SortConfig,
    visibleResultCount: SEARCH_RESULTS_PAGE_SIZE,
  }));
  const sort =
    resultsUiState.query === query ? resultsUiState.sort : [];
  const visibleResultCount =
    resultsUiState.query === query
      ? resultsUiState.visibleResultCount
      : SEARCH_RESULTS_PAGE_SIZE;

  const setSort = useCallback(
    (next: SortConfig) => {
      setResultsUiState((current) => {
        const currentVisible =
          current.query === query
            ? current.visibleResultCount
            : SEARCH_RESULTS_PAGE_SIZE;

        return {
          query,
          sort: next,
          visibleResultCount: currentVisible,
        };
      });
    },
    [query],
  );

  const handleShowMoreResults = useCallback(() => {
    setResultsUiState((current) => {
      const currentVisible =
        current.query === query
          ? current.visibleResultCount
          : SEARCH_RESULTS_PAGE_SIZE;
      const currentSort = current.query === query ? current.sort : [];

      return {
        query,
        sort: currentSort,
        visibleResultCount: currentVisible + SEARCH_RESULTS_PAGE_SIZE,
      };
    });
  }, [query]);

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

        <div>
          <h1 className="type-page-title flex items-center gap-2">
            <IconSearch className="w-5 h-5 text-[var(--color-text-muted)] hidden sm:block" aria-hidden={true} />
            Suchergebnisse
          </h1>
          {query && !isLoading && (
            <p className="type-secondary mt-1">
              {hasHiddenResults
                ? `${displayedResultCount} von ${totalResults} Ergebnissen`
                : `${totalResults} Ergebnis${totalResults !== 1 ? 'se' : ''}`}{' '}
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
      </div>

      {/* Loading spinner */}
      {isLoading && (
        <div className="flex flex-1 items-start gap-3 p-4 sm:p-6">
          <div className="inline-block w-5 h-5 border-2 border-[var(--color-border-strong)] border-t-[var(--color-primary-main)] rounded-full animate-spin" />
          <span className="text-sm text-[var(--color-text-secondary)]">Suche wird vorbereitet…</span>
        </div>
      )}

      {/* Results — breakpoint-spezifisch */}
      {!isLoading && controlsById && results.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Desktop: volle Katalogtabelle */}
          <div data-testid="search-results-desktop" className="hidden lg:flex flex-1 min-h-0 flex-col overflow-hidden">
            <ControlTable
              controls={visibleTableControls}
              controlsById={controlsById}
              selectedControlId={undefined}
              sort={sort}
              onSortChange={setSort}
              onSelectControl={(control) => navigate(`/katalog/${control.id}`)}
              showSelection={false}
            />
          </div>
          {/* Mobile: Katalog-Mobile-Referenzliste */}
          <div data-testid="search-results-mobile" className="lg:hidden flex-1 md:overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
            {visibleMobileControls.map((control) => (
              <ControlMobileReferenceRow
                key={control.id}
                control={control}
                controlsById={controlsById}
                onSelect={(ctrl) => navigate(`/katalog/${ctrl.id}`)}
              />
            ))}
          </div>
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
