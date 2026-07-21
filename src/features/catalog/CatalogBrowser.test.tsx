import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import {
  emptyFilters,
  useFilteredControls,
  type SortConfig,
} from '@/hooks/useFilteredControls';
import { useFilterParams } from '@/hooks/useFilterParams';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CatalogBrowser } from './CatalogBrowser';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

vi.mock('@/hooks/useFilteredControls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useFilteredControls')>();
  return {
    ...actual,
    useFilteredControls: vi.fn(),
  };
});

vi.mock('@/hooks/useFilterParams', () => ({
  useFilterParams: vi.fn(),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

vi.mock('@/features/export/csvExport', () => ({
  downloadCSV: vi.fn(),
}));

vi.mock('./FilterPanel', () => ({
  FilterPanel: () => <button type="button">Filteraktion</button>,
}));

vi.mock('./ControlTable', () => ({
  ControlTable: () => <div>Kontrolltabelle</div>,
}));

vi.mock('./ControlMobileReferenceRow', () => ({
  ControlMobileReferenceRow: ({
    control,
    onSelect,
  }: {
    control: Control;
    onSelect: (control: Control) => void;
  }) => (
    <button type="button" onClick={() => onSelect(control)}>
      {control.title}
    </button>
  ),
}));

vi.mock('./ControlDetail', () => ({
  ControlDetail: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>Detail schließen</button>
  ),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const mockedUseFilteredControls = vi.mocked(useFilteredControls);
const mockedUseFilterParams = vi.mocked(useFilterParams);
const mockedUseMediaQuery = vi.mocked(useMediaQuery);

const control = {
  id: 'TOP.1.1',
  title: 'Testkontrolle',
  groupId: 'TOP.1',
  practiceId: 'TOP',
  links: [],
} as unknown as Control;

const defaultSort: SortConfig = [{ field: 'id', direction: 'asc' }];

function renderCatalogBrowser(initialEntry = '/katalog') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/katalog" element={<CatalogBrowser />} />
        <Route path="/katalog/:groupId" element={<CatalogBrowser />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CatalogBrowser mobile focus restoration', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReturnValue({
      catalog: {
        controls: [control],
        controlsById: new Map([[control.id, control]]),
        practices: [],
        totalControls: 1,
      },
      loading: false,
      error: null,
      vocabularyRegistry: null,
    } as unknown as ReturnType<typeof useCatalog>);
    mockedUseMediaQuery.mockReturnValue(false);
    mockedUseFilterParams.mockReturnValue({
      filters: emptyFilters,
      setFilters: vi.fn(),
      sort: defaultSort,
      setSort: vi.fn(),
      searchString: '',
    });
    mockedUseFilteredControls.mockImplementation((controls) => ({
      filtered: controls,
      totalCount: controls.length,
      facetCounts: {} as ReturnType<typeof useFilteredControls>['facetCounts'],
      filteredFacetCounts: {} as ReturnType<typeof useFilteredControls>['filteredFacetCounts'],
      hasActiveFilters: false,
    }));
  });

  it('returns focus to the filter trigger after Escape closes the sheet', () => {
    renderCatalogBrowser();
    const trigger = screen.getByRole('button', { name: 'Filter anzeigen' });

    trigger.focus();
    fireEvent.click(trigger);

    expect(document.activeElement).toHaveTextContent('Filteraktion');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(trigger).toHaveFocus();
  });

  it('returns focus to the export trigger after Escape closes the sheet', () => {
    renderCatalogBrowser();
    const trigger = screen.getByRole('button', { name: 'CSV' });

    trigger.focus();
    fireEvent.click(trigger);

    expect(document.activeElement).toHaveTextContent('Aktuelle Ansicht (1)');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(trigger).toHaveFocus();
  });

  it('returns focus to the selected control after Escape closes the detail overlay', () => {
    renderCatalogBrowser();
    const trigger = screen.getByRole('button', { name: control.title });

    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('button', { name: 'Detail schließen' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(trigger).toHaveFocus();
  });
});
