import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogState } from '@/domain/models';
import { emptyFilters, type FacetCounts } from '@/hooks/useFilteredControls';
import { useCatalog } from '@/hooks/useCatalog';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { FilterPanel } from './FilterPanel';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const vocabularyRegistry = createTestVocabularyRegistry();

const facetCounts: FacetCounts = {
  securityLevels: {
    'normal-SdT': 2,
    erhöht: 1,
  },
  effortLevels: {
    '0': 0,
    '1': 0,
    '2': 0,
    '3': 1,
    '4': 1,
    '5': 0,
  },
  modalverben: {
    MUSS: 2,
    SOLLTE: 1,
    KANN: 0,
  },
  tags: {},
  zielobjektKategorien: {},
  handlungsworte: {},
  dokumentationstypen: {},
  linkRelationen: {},
};

const emptyFacetCounts: FacetCounts = {
  securityLevels: {},
  effortLevels: {},
  modalverben: {},
  tags: {},
  zielobjektKategorien: {},
  handlungsworte: {},
  dokumentationstypen: {},
  linkRelationen: {},
};

function makeCatalogState(): CatalogState {
  return {
    catalog: null,
    provenance: null,
    verification: null,
    vocabularyRegistry,
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}

describe('FilterPanel', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseCatalog.mockReturnValue(makeCatalogState());
  });

  it('uses official BSI values instead of app-defined rewordings in security and effort filters', () => {
    render(
      <FilterPanel
        filters={emptyFilters}
        facetCounts={facetCounts}
        filteredFacetCounts={facetCounts}
        hasActiveFilters={false}
        filteredCount={3}
        totalCount={3}
        onFiltersChange={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    );

    const securityLevelLabel = screen.getByText('normal-SdT').closest('label');
    const effortLevelLabel = screen.getByText('3').closest('label');

    expect(screen.getByText('normal-SdT')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('Normal (SdT)')).not.toBeInTheDocument();
    expect(screen.queryByText('Stufe 3 — Hoch')).not.toBeInTheDocument();
    expect(securityLevelLabel).toHaveAttribute(
      'title',
      'Standard-Sicherheitsniveau für den Stand der Technik.',
    );
    expect(effortLevelLabel).toHaveAttribute(
      'title',
      'Mittlere Aufwandsstufe.',
    );
  });

  it('hides unselected options with zero count in filteredFacetCounts', () => {
    const filteredFacetCounts: FacetCounts = {
      ...emptyFacetCounts,
      modalverben: { MUSS: 2 }, // SOLLTE and KANN have count 0
    };

    render(
      <FilterPanel
        filters={emptyFilters}
        facetCounts={facetCounts}
        filteredFacetCounts={filteredFacetCounts}
        hasActiveFilters={false}
        filteredCount={2}
        totalCount={3}
        onFiltersChange={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/^MUSS/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^SOLLTE/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^KANN/)).not.toBeInTheDocument();
  });

  it('keeps selected options visible even when their filtered count is zero', () => {
    const filteredFacetCounts: FacetCounts = {
      ...emptyFacetCounts,
      modalverben: { MUSS: 2 }, // SOLLTE filtered out but is selected
    };

    render(
      <FilterPanel
        filters={{ ...emptyFilters, modalverben: ['SOLLTE'] }}
        facetCounts={facetCounts}
        filteredFacetCounts={filteredFacetCounts}
        hasActiveFilters={true}
        filteredCount={2}
        totalCount={3}
        onFiltersChange={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    );

    // SOLLTE is selected so it stays visible (showing frozen global count)
    expect(screen.getByLabelText(/^SOLLTE/)).toBeInTheDocument();
  });

  it('freezes global counts for a dimension that has active selections', () => {
    const filteredFacetCounts: FacetCounts = {
      ...emptyFacetCounts,
      modalverben: { MUSS: 2 }, // filtered: only MUSS remains
      securityLevels: { 'normal-SdT': 1 },
    };

    render(
      <FilterPanel
        filters={{ ...emptyFilters, modalverben: ['MUSS'] }}
        facetCounts={facetCounts}
        filteredFacetCounts={filteredFacetCounts}
        hasActiveFilters={true}
        filteredCount={2}
        totalCount={3}
        onFiltersChange={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    );

    // Modalverb dimension is active → show global count (2 for MUSS, 1 for SOLLTE)
    const mussLabel = screen.getByLabelText(/^MUSS/);
    expect(mussLabel.closest('label')).toHaveTextContent('2');
    // SOLLTE has global count 1, should be visible with frozen count
    const sollteLabel = screen.getByLabelText(/^SOLLTE/);
    expect(sollteLabel.closest('label')).toHaveTextContent('1');

    // Security level dimension is inactive → show filtered count (1 for normal-SdT)
    const normalLabel = screen.getByText('normal-SdT').closest('label');
    expect(normalLabel).toHaveTextContent('1');
  });
});
