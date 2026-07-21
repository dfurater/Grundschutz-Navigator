import { fireEvent, render, screen } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, Control } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { useCatalog } from '@/hooks/useCatalog';
import {
  emptyFilters,
  useFilteredControls,
  type SortConfig,
} from '@/hooks/useFilteredControls';
import { useFilterParams } from '@/hooks/useFilterParams';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CatalogBrowser } from './CatalogBrowser';
import {
  CATALOG_ROUTE_PATTERN,
  CONTROL_ROUTE_PATTERN,
  GROUP_ROUTE_PATTERN,
} from '@/app/routes';

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
    selectMode,
    checked,
    onCheckedChange,
  }: {
    control: Control;
    onSelect: (control: Control) => void;
    selectMode?: boolean;
    checked?: boolean;
    onCheckedChange?: (control: Control, checked: boolean) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        if (selectMode) {
          onCheckedChange?.(control, !checked);
        } else {
          onSelect(control);
        }
      }}
    >
      {control.title}
    </button>
  ),
}));

vi.mock('./ControlDetail', () => ({
  ControlDetail: ({
    control,
    onClose,
    onNavigateToControl,
  }: {
    control: Control;
    onClose: () => void;
    onNavigateToControl?: (control: Control) => void;
  }) => (
    <div>
      <p>{`Detail ${control.id}`}</p>
      <button type="button" onClick={onClose}>Detail schließen</button>
      <button type="button" onClick={() => onNavigateToControl?.(relatedControl)}>
        Verwandte Kontrolle öffnen
      </button>
    </div>
  ),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const mockedUseFilteredControls = vi.mocked(useFilteredControls);
const mockedUseFilterParams = vi.mocked(useFilterParams);
const mockedUseMediaQuery = vi.mocked(useMediaQuery);

const control = {
  id: 'TOP.1.1',
  altIdentifier: 'shared-alt-identifier',
  title: 'Testkontrolle',
  groupId: 'TOP.1',
  practiceId: 'TOP',
  links: [],
} as unknown as Control;

const relatedControl = {
  ...control,
  id: 'TOP.1.2',
  altIdentifier: 'related-alt-identifier',
  title: 'Verwandte Kontrolle',
} as Control;

const defaultSort: SortConfig = [{ field: 'id', direction: 'asc' }];

function makeCatalog(catalogKey: CatalogKey, primaryControl: Control = control): Catalog {
  return {
    catalogKey,
    controls: [primaryControl],
    controlsById: new Map([
      [primaryControl.id, primaryControl],
      [relatedControl.id, relatedControl],
    ]),
    controlsByAltIdentifier: new Map([
      [primaryControl.altIdentifier!, primaryControl],
      [relatedControl.altIdentifier!, relatedControl],
    ]),
    practices: [
      {
        id: primaryControl.practiceId,
        title: 'Testpraktik',
        label: primaryControl.practiceId,
        topics: [
          {
            id: primaryControl.groupId,
            title: 'Testthema',
            label: '1',
            practiceId: 'TOP',
            controlCount: 1,
            controlIds: [primaryControl.id],
          },
        ],
        controlCount: 1,
      },
    ],
    totalControls: 1,
  } as Catalog;
}

function mockCatalog(catalog: Catalog) {
  mockedUseCatalog.mockReturnValue({
    catalog,
    loading: false,
    error: null,
    vocabularyRegistry: null,
  } as unknown as ReturnType<typeof useCatalog>);
}

function mockFilterParams(searchString = '') {
  mockedUseFilterParams.mockReturnValue({
    filters: emptyFilters,
    setFilters: vi.fn(),
    sort: defaultSort,
    setSort: vi.fn(),
    searchString,
  });
}

function LocationProbe({ onCatalogSwitch }: { onCatalogSwitch?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      {onCatalogSwitch && (
        <button
          type="button"
          onClick={() => {
            onCatalogSwitch();
            navigate('/katalog/wlan/kontrolle/shared-alt-identifier');
          }}
        >
          Katalog wechseln
        </button>
      )}
    </>
  );
}

function renderCatalogBrowser(
  initialEntry = '/katalog/gspp',
  onCatalogSwitch?: () => void,
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={CONTROL_ROUTE_PATTERN} element={<CatalogBrowser />} />
        <Route path={GROUP_ROUTE_PATTERN} element={<CatalogBrowser />} />
        <Route path={CATALOG_ROUTE_PATTERN} element={<CatalogBrowser />} />
        <Route path="*" element={<div>404 — Seite nicht gefunden</div>} />
      </Routes>
      <LocationProbe onCatalogSwitch={onCatalogSwitch} />
    </MemoryRouter>,
  );
}

describe('CatalogBrowser mobile focus restoration', () => {
  beforeEach(() => {
    mockCatalog(makeCatalog('gspp'));
    mockedUseMediaQuery.mockReturnValue(false);
    mockFilterParams();
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
    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/gspp');
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

  it('opens list selections with catalogKey and altIdentifier', () => {
    renderCatalogBrowser('/katalog/gspp');

    fireEvent.click(screen.getByRole('button', { name: control.title }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/katalog/gspp/kontrolle/shared-alt-identifier',
    );
    expect(screen.getByText('Detail TOP.1.1')).toBeInTheDocument();
  });

  it('preserves the catalog and group context when opening and closing a control', () => {
    mockFilterParams('?stufe=hoch');
    renderCatalogBrowser('/katalog/gspp/TOP.1?stufe=hoch');

    fireEvent.click(screen.getByRole('button', { name: control.title }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/katalog/gspp/kontrolle/shared-alt-identifier?stufe=hoch',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/katalog/gspp/TOP.1?stufe=hoch',
    );
  });

  it('builds relationship navigation from the resolved target control', () => {
    renderCatalogBrowser('/katalog/gspp/kontrolle/shared-alt-identifier');

    fireEvent.click(screen.getByRole('button', { name: 'Verwandte Kontrolle öffnen' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/katalog/gspp/kontrolle/related-alt-identifier',
    );
    expect(screen.getByText('Detail TOP.1.2')).toBeInTheDocument();
  });

  it('resolves the same alt-identifier inside a second catalog without collision', () => {
    const wlanControl = {
      ...control,
      id: 'TOP.9.9',
      title: 'WLAN-Kontrolle',
    } as Control;
    mockCatalog(makeCatalog('wlan', wlanControl));

    renderCatalogBrowser('/katalog/wlan/kontrolle/shared-alt-identifier');

    expect(screen.getByText('Detail TOP.9.9')).toBeInTheDocument();
    expect(screen.queryByText('Detail TOP.1.1')).not.toBeInTheDocument();
  });

  it('keeps a stable alt-identifier addressable after its control ID changes', () => {
    const movedControl = {
      ...control,
      id: 'TOP.9.9',
    } as Control;
    mockCatalog(makeCatalog('gspp', movedControl));

    renderCatalogBrowser('/katalog/gspp/kontrolle/shared-alt-identifier');

    expect(screen.getByText('Detail TOP.9.9')).toBeInTheDocument();
  });

  it('discards the previous browse scope when the loaded catalog changes', () => {
    const wlanControl = {
      ...control,
      id: 'WLAN.9.1',
      groupId: 'WLAN.9',
      practiceId: 'WLAN',
      title: 'WLAN-Kontrolle',
    } as Control;
    const switchCatalog = () => {
      mockCatalog(makeCatalog('wlan', wlanControl));
    };

    renderCatalogBrowser('/katalog/gspp/TOP.1', switchCatalog);
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    fireEvent.click(screen.getByRole('button', { name: 'Katalog wechseln' }));

    expect(screen.getByText('Detail WLAN.9.1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/wlan/WLAN.9');
  });

  it('discards selected control IDs when the loaded catalog changes', () => {
    const wlanControl = {
      ...control,
      id: 'WLAN.9.1',
      groupId: 'WLAN.9',
      practiceId: 'WLAN',
      title: 'WLAN-Kontrolle',
    } as Control;
    const switchCatalog = () => {
      mockCatalog(makeCatalog('wlan', wlanControl));
    };

    renderCatalogBrowser('/katalog/gspp', switchCatalog);
    fireEvent.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    expect(screen.getAllByText('1 ausgewählt').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Katalog wechseln' }));

    expect(screen.queryByText('1 ausgewählt')).not.toBeInTheDocument();
    expect(screen.getByText('Tippen zum Auswählen')).toBeInTheDocument();
  });

  it.each([
    ['/katalog/unknown-catalog', 'unbekannter Katalog'],
    ['/katalog/wlan/kontrolle/shared-alt-identifier', 'nicht geladener registrierter Katalog'],
    ['/katalog/gspp/kontrolle/unknown-alt', 'unbekannter Alt-Identifier'],
    ['/katalog/TOP.1.1', 'alte Control-ID-Route'],
    ['/katalog/shared-alt-identifier', 'kataloglose Alt-Identifier-Route'],
    ['/katalog/gspp/TOP.1.1', 'Control-ID im Group-Slot'],
  ])('shows not-found for %s (%s)', (initialEntry) => {
    renderCatalogBrowser(initialEntry);

    expect(
      screen.getByRole('heading', { name: '404 — Katalogziel nicht gefunden' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Detail TOP\./)).not.toBeInTheDocument();
  });

  it('does not register an unscoped catalog route or redirect it', () => {
    renderCatalogBrowser('/katalog');

    expect(screen.getByText('404 — Seite nicht gefunden')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/katalog');
  });
});
