import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFilters, type ControlFilters, type FacetCounts } from '@/hooks/useFilteredControls';
import { useFilterParams } from '@/hooks/useFilterParams';
import { useCatalog } from '@/hooks/useCatalog';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import {
  filterPanelEmptyFacetCounts as emptyFacetCounts,
  filterPanelFacetCounts as facetCounts,
  makeFilterPanelCatalogState,
} from '@/test/fixtures/filterPanel';
import { FilterPanel, type FilterPanelProps } from './FilterPanel';
import { CatalogMobileFilterSheet } from './CatalogMobileFilterSheet';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const vocabularyRegistry = createTestVocabularyRegistry();

function makeCatalogState() {
  return makeFilterPanelCatalogState(vocabularyRegistry);
}

/**
 * Sucht innerhalb einer Facettensektion. Eine Trefferzahl ist derselbe Text wie
 * die Beschriftung einer Aufwandsstufe — im ganzen Panel gesucht, trifft `3`
 * beides.
 */
function inSektion(titel: string) {
  return within(screen.getByRole('button', { name: new RegExp(`^${titel}`) }).parentElement!);
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

    const aufwandsstufen = inSektion('Aufwandsstufen');
    const securityLevelLabel = screen.getByText('normal-SdT').closest('label');
    const effortLevelLabel = aufwandsstufen.getByText('3').closest('label');

    expect(screen.getByText('normal-SdT')).toBeInTheDocument();
    expect(aufwandsstufen.getByText('3')).toBeInTheDocument();
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

const completeFacetCounts: FacetCounts = {
  ...facetCounts,
  zielobjektKategorien: { Server: 2 },
  dokumentationstypen: { Betriebskonzept: 1 },
  handlungsworte: { prüfen: 2 },
  tags: { audit: 1, betrieb: 1 },
  linkRelationen: { required: 1 },
};

const sectionOrder = [
  'Sicherheitsniveau', 'Modalverben', 'Aufwandsstufen', 'Zielobjekt-Kategorien',
  'Schutzziele', 'Dokumentationsvorgaben', 'Handlungsworte', 'Tags', 'Link-Relationen',
];
const specialistSections = ['Dokumentationsvorgaben', 'Handlungsworte', 'Tags', 'Link-Relationen'];

function presentationProps(filters: ControlFilters = emptyFilters): FilterPanelProps {
  return {
    filters,
    facetCounts: completeFacetCounts,
    filteredFacetCounts: completeFacetCounts,
    hasActiveFilters: filters.tags.length > 0 || filters.dokumentationstypen.length > 0
      || filters.handlungsworte.length > 0 || filters.linkRelationen.length > 0,
    filteredCount: 3,
    totalCount: 3,
    onFiltersChange: vi.fn(),
    onClearFilters: vi.fn(),
  };
}

function sectionButtons() {
  return screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'));
}

describe.each(['Desktop', 'Mobile'] as const)('Filterdarstellung — %s', (surface) => {
  beforeEach(() => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());
  });

  function Panel({ props }: { readonly props: FilterPanelProps }) {
    return surface === 'Desktop'
      ? <FilterPanel {...props} />
      : <CatalogMobileFilterSheet filterPanelProps={props} />;
  }

  function openMobile() {
    if (surface === 'Mobile') fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));
  }

  it('ordnet alle sichtbaren Facetten', () => {
    render(<Panel props={presentationProps()} />);
    openMobile();

    expect(sectionButtons().map((button) => button.textContent)).toEqual(sectionOrder);
  });

  it('klappt nur die vier Spezialfilter initial ein', () => {
    render(<Panel props={presentationProps()} />);
    openMobile();

    for (const title of sectionOrder) {
      expect(screen.getByRole('button', { name: title })).toHaveAttribute(
        'aria-expanded', String(!specialistSections.includes(title)),
      );
    }
    for (const option of ['Betriebskonzept', 'prüfen', 'audit', 'Erforderlich']) {
      expect(screen.queryByRole('checkbox', { name: new RegExp(option) })).not.toBeInTheDocument();
    }
  });

  it('liest einen geteilten Link und öffnet alle vier vorbelegten Spezialfilter', () => {
    function LinkedPanel() {
      const { filters, setFilters } = useFilterParams();
      return <Panel props={{ ...presentationProps(filters), onFiltersChange: setFilters }} />;
    }
    render(
      <MemoryRouter initialEntries={['/katalog/gspp?dt=Betriebskonzept&hw=prüfen&tags=audit&lr=required']}>
        <LinkedPanel />
      </MemoryRouter>,
    );
    openMobile();

    for (const title of specialistSections) {
      expect(screen.getByRole('button', { name: title })).toHaveAttribute('aria-expanded', 'true');
    }
    for (const option of ['Betriebskonzept', 'prüfen', 'audit', 'Erforderlich']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(option) })).toBeChecked();
    }
  });

  it.each([
    ['Dokumentationsvorgaben', { dokumentationstypen: ['Betriebskonzept'] }],
    ['Handlungsworte', { handlungsworte: ['prüfen'] }],
    ['Tags', { tags: ['audit'] }],
    ['Link-Relationen', { linkRelationen: ['required'] }],
  ] satisfies [string, Partial<ControlFilters>][])('öffnet %s unabhängig von den anderen Spezialfiltern', (title, selection) => {
    render(<Panel props={presentationProps({ ...emptyFilters, ...selection })} />);
    openMobile();
    for (const section of specialistSections) {
      expect(screen.getByRole('button', { name: section })).toHaveAttribute(
        'aria-expanded', String(section === title),
      );
    }
  });

  it('behält manuelles Einklappen und aktualisiert dabei das aktive Badge', () => {
    const view = render(<Panel props={presentationProps({ ...emptyFilters, tags: ['audit'] })} />);
    openMobile();
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    expect(screen.getByRole('button', { name: 'Tags 1' })).toHaveAttribute('aria-expanded', 'false');

    view.rerender(<Panel props={presentationProps({ ...emptyFilters, tags: ['audit', 'betrieb'] })} />);
    expect(screen.getByRole('button', { name: 'Tags 2' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: /audit/ })).not.toBeInTheDocument();
  });

  it('erhält die relative Reihenfolge bei ausgeblendeten Sektionen', () => {
    const props = presentationProps();
    render(<Panel props={{ ...props, filteredFacetCounts: facetCounts }} />);
    openMobile();
    expect(sectionButtons().map((button) => button.textContent)).toEqual([
      'Sicherheitsniveau', 'Modalverben', 'Aufwandsstufen', 'Schutzziele',
    ]);
  });

  it.each([false, true])('sortiert Tags deutsch alphabetisch mit aktiver Auswahl: %s', (selected) => {
    const props = presentationProps({ ...emptyFilters, tags: selected ? ['Änderung'] : [] });
    const counts = { ...completeFacetCounts, tags: { Zebra: 9, Betrieb: 3, Apfel: 1 } };
    render(<Panel props={{ ...props, facetCounts: counts, filteredFacetCounts: counts }} />);
    openMobile();
    if (!selected) fireEvent.click(screen.getByRole('button', { name: 'Tags' }));

    const tags = inSektion('Tags');
    const order = selected ? ['Änderung', 'Apfel', 'Betrieb', 'Zebra'] : ['Apfel', 'Betrieb', 'Zebra'];
    const checkboxes = tags.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(order.length);
    order.forEach((tag, index) => {
      expect(checkboxes[index]).toBe(tags.getByRole('checkbox', { name: new RegExp(`^${tag}`) }));
    });
    if (selected) {
      expect(tags.getByRole('checkbox', { name: /^Änderung/ })).toBeChecked();
      expect(tags.getByRole('checkbox', { name: /^Änderung/ }).closest('label')).toHaveTextContent('0');
    }
  });
});
