import { fireEvent, render, screen } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { expectSingleDocumentTitle } from '@/test/documentTitle';

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
  ControlTable: ({
    checkedIds,
    selectedControlId,
  }: {
    checkedIds: Set<string>;
    selectedControlId?: string;
  }) => (
    <div data-testid="desktop-control-list">
      {`${checkedIds.size} Desktop-Auswahl; Detail ${selectedControlId ?? 'geschlossen'}`}
    </div>
  ),
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
      data-testid="mobile-control-row"
      data-control-row={control.id}
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
      <h2 data-control-detail-title tabIndex={-1}>{control.title}</h2>
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
  groupId: 'TOP.2',
} as Control;

const defaultSort: SortConfig = [{ field: 'id', direction: 'asc' }];

function makeCatalog(catalogKey: CatalogKey, primaryControl: Control = control): Catalog {
  return {
    catalogKey,
    uuid: `${catalogKey}-catalog`,
    metadata: {
      title: catalogKey === 'wlan' ? 'WLAN-Katalog' : 'Grundschutz++-Katalog',
    },
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

function LocationProbe({
  onCatalogSwitch,
  secondaryLink,
  withHistoryBack = false,
}: {
  onCatalogSwitch?: () => void;
  secondaryLink?: { label: string; to: string };
  withHistoryBack?: boolean;
}) {
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
      {secondaryLink && (
        <button
          type="button"
          onClick={() => navigate(secondaryLink.to)}
        >
          {secondaryLink.label}
        </button>
      )}
      {withHistoryBack && (
        <button type="button" onClick={() => navigate(-1)}>
          Browser zurück
        </button>
      )}
    </>
  );
}

function CatalogBrowserTestApp({
  initialEntry = '/katalog/gspp',
  onCatalogSwitch,
  secondaryLink,
  withHistoryBack,
}: {
  initialEntry?: string;
  onCatalogSwitch?: () => void;
  secondaryLink?: { label: string; to: string };
  withHistoryBack?: boolean;
}) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path={CONTROL_ROUTE_PATTERN} element={<CatalogBrowser />} />
        <Route path={GROUP_ROUTE_PATTERN} element={<CatalogBrowser />} />
        <Route path={CATALOG_ROUTE_PATTERN} element={<CatalogBrowser />} />
        <Route path="*" element={<div>404 — Seite nicht gefunden</div>} />
      </Routes>
      <LocationProbe onCatalogSwitch={onCatalogSwitch} secondaryLink={secondaryLink} withHistoryBack={withHistoryBack} />
    </MemoryRouter>
  );
}

function renderCatalogBrowser(
  initialEntry = '/katalog/gspp',
  onCatalogSwitch?: () => void,
) {
  return render(
    <CatalogBrowserTestApp
      initialEntry={initialEntry}
      onCatalogSwitch={onCatalogSwitch}
    />,
  );
}

/** Zwischen `md` und `lg`: eigene Scrollbereiche, Detail als Overlay. */
function useTabletWidth() {
  mockedUseMediaQuery.mockImplementation((query) => query === '(min-width: 768px)');
}

/** Dokument-Scrollen der Liste (unterhalb `md`), wie es der Browser meldet. */
function scrollListTo(y: number) {
  Object.defineProperty(globalThis, 'scrollY', { configurable: true, value: y });
  fireEvent.scroll(globalThis.window);
}

describe('CatalogBrowser mobile focus restoration', () => {
  afterEach(() => {
    vi.mocked(globalThis.scrollTo).mockRestore();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, 'scrollTo').mockImplementation(() => {});
    Object.defineProperty(globalThis, 'scrollY', { configurable: true, value: 0 });
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

  it('mounts only the mobile control list while the media query is false', () => {
    renderCatalogBrowser();

    expect(screen.getAllByTestId('mobile-control-row')).toHaveLength(1);
    expect(screen.queryByTestId('desktop-control-list')).not.toBeInTheDocument();
  });

  it('mounts only the desktop control list on the initial desktop render', () => {
    mockedUseMediaQuery.mockReturnValue(true);

    renderCatalogBrowser();

    expect(screen.getByTestId('desktop-control-list')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-control-row')).not.toBeInTheDocument();
  });

  it('preserves scope and checked controls across mobile-desktop switches', () => {
    let isDesktop = false;
    mockedUseMediaQuery.mockImplementation(() => isDesktop);
    const view = renderCatalogBrowser('/katalog/gspp/TOP.1');

    fireEvent.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/gspp/TOP.1');
    expect(screen.getAllByText('1 ausgewählt').length).toBeGreaterThan(0);

    isDesktop = true;
    view.rerender(<CatalogBrowserTestApp initialEntry="/katalog/gspp/TOP.1" />);

    expect(screen.getByTestId('desktop-control-list')).toHaveTextContent('1 Desktop-Auswahl');
    expect(screen.queryByTestId('mobile-control-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/gspp/TOP.1');

    isDesktop = false;
    view.rerender(<CatalogBrowserTestApp initialEntry="/katalog/gspp/TOP.1" />);

    expect(screen.getAllByTestId('mobile-control-row')).toHaveLength(1);
    expect(screen.queryByTestId('desktop-control-list')).not.toBeInTheDocument();
    expect(screen.getAllByText('1 ausgewählt').length).toBeGreaterThan(0);
  });

  it('preserves the selected-control route across mobile-desktop switches', () => {
    let isDesktop = false;
    mockedUseMediaQuery.mockImplementation(() => isDesktop);
    const view = renderCatalogBrowser('/katalog/gspp/TOP.1');

    fireEvent.click(screen.getByRole('button', { name: control.title }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/katalog/gspp/kontrolle/shared-alt-identifier',
    );
    expect(screen.getByText(`Detail ${control.id}`)).toBeInTheDocument();

    isDesktop = true;
    view.rerender(<CatalogBrowserTestApp initialEntry="/katalog/gspp/TOP.1" />);

    expect(screen.getByTestId('desktop-control-list')).toHaveTextContent(`Detail ${control.id}`);
    expect(screen.queryByTestId('mobile-control-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/katalog/gspp/kontrolle/shared-alt-identifier',
    );

    isDesktop = false;
    view.rerender(<CatalogBrowserTestApp initialEntry="/katalog/gspp/TOP.1" />);

    expect(screen.getAllByTestId('mobile-control-row')).toHaveLength(1);
    expect(screen.queryByTestId('desktop-control-list')).not.toBeInTheDocument();
    expect(screen.getByText(`Detail ${control.id}`)).toBeInTheDocument();
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

  it('keeps the overlay with focus trap between md and lg and returns focus after Escape', () => {
    useTabletWidth();
    renderCatalogBrowser();
    const trigger = screen.getByRole('button', { name: control.title });

    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('button', { name: 'Detail schließen' })).toHaveFocus();
    expect(trigger).toBeVisible();
    expect(globalThis.scrollTo).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(trigger).toHaveFocus();
  });

  it('opens the detail below md as a page in the document flow', () => {
    renderCatalogBrowser();
    const trigger = screen.getByRole('button', { name: control.title });

    trigger.focus();
    fireEvent.click(trigger);

    // Liste und Toolbar bleiben gemountet, sind aber weder sichtbar noch bedienbar.
    expect(screen.getByTestId('mobile-control-row')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: control.title })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: control.title })).toHaveFocus();
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 0);
    // Keine Body-Sperre: Das Dokument scrollt.
    expect(document.querySelector('body')?.style.overflow).toBe('');
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })],
    ['Zurück-Button', () => fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }))],
    ['Browser-Zurück', () => fireEvent.click(screen.getByRole('button', { name: 'Browser zurück' }))],
  ])('restores list position and row focus after closing the page via %s', (_label, close) => {
    render(<CatalogBrowserTestApp initialEntry="/katalog/gspp/TOP.1" withHistoryBack />);
    scrollListTo(420);
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 0);

    close();

    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/gspp/TOP.1');
    const row = screen.getByRole('button', { name: control.title });
    expect(row).toBeVisible();
    expect(row).toHaveFocus();
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 420);
  });

  it('falls back to the scope heading when the closed control has no list row', () => {
    mockedUseFilteredControls.mockImplementation(() => ({
      filtered: [],
      totalCount: 1,
      facetCounts: {} as ReturnType<typeof useFilteredControls>['facetCounts'],
      filteredFacetCounts: {} as ReturnType<typeof useFilteredControls>['filteredFacetCounts'],
      hasActiveFilters: true,
    }));
    renderCatalogBrowser('/katalog/gspp/kontrolle/shared-alt-identifier');
    expect(screen.getByRole('heading', { level: 2, name: control.title })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Testthema' })).toHaveFocus();
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('starts a linked control at the top and moves focus to its title', () => {
    renderCatalogBrowser('/katalog/gspp/kontrolle/shared-alt-identifier');
    vi.mocked(globalThis.scrollTo).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Verwandte Kontrolle öffnen' }));

    expect(screen.getByText(`Detail ${relatedControl.id}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: relatedControl.title })).toHaveFocus();
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('returns focus to the row that opened the page after switching to a linked control', () => {
    renderCatalogBrowser('/katalog/gspp/TOP.1');
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    fireEvent.click(screen.getByRole('button', { name: 'Verwandte Kontrolle öffnen' }));
    expect(screen.getByRole('heading', { level: 2, name: relatedControl.title })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));

    // Die verknüpfte Kontrolle steht nicht in der Liste; zurück geht es zur
    // auslösenden Zeile, nicht zur Bereichsüberschrift.
    expect(screen.getByRole('button', { name: control.title })).toHaveFocus();
  });

  it.each([
    ['tablet', 768, false],
    ['desktop', 1024, false],
    ['tablet with relationship navigation', 768, true],
    ['desktop with relationship navigation', 1024, true],
  ])('preserves the opening row and list position across %s width', (_label, wideWidth, navigateWhileWide) => {
    let width = 390;
    mockedUseMediaQuery.mockImplementation((query) =>
      width >= (query === '(min-width: 1024px)' ? 1024 : 768));
    const view = renderCatalogBrowser('/katalog/gspp/TOP.1');
    scrollListTo(420);
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    if (!navigateWhileWide) {
      fireEvent.click(screen.getByRole('button', { name: 'Verwandte Kontrolle öffnen' }));
    }

    width = wideWidth;
    view.rerender(<CatalogBrowserTestApp initialEntry="/katalog/gspp/TOP.1" />);
    if (navigateWhileWide) {
      fireEvent.click(screen.getByRole('button', { name: 'Verwandte Kontrolle öffnen' }));
    }
    // Scroll-Ereignisse außerhalb der mobilen Liste ersetzen ihren Rückkehrpunkt nicht.
    scrollListTo(900);
    width = 390;
    view.rerender(<CatalogBrowserTestApp initialEntry="/katalog/gspp/TOP.1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));

    expect(screen.getByRole('button', { name: control.title })).toHaveFocus();
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 420);
  });

  it.each([768, 1024])('clears the opening row when the detail closes at %i px before a new mobile session', (wideWidth) => {
    const catalog = makeCatalog('gspp');
    catalog.controls.push(relatedControl);
    mockCatalog(catalog);
    let width = 390;
    mockedUseMediaQuery.mockImplementation((query) =>
      width >= (query === '(min-width: 1024px)' ? 1024 : 768));
    const app = () => (
      <CatalogBrowserTestApp
        initialEntry="/katalog/gspp"
        secondaryLink={{ label: 'Verwandte Kontrolle direkt öffnen', to: '/katalog/gspp/kontrolle/related-alt-identifier' }}
      />
    );
    const view = render(app());
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    width = wideWidth;
    view.rerender(app());
    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));
    width = 390;
    view.rerender(app());
    scrollListTo(180);
    fireEvent.click(screen.getByRole('button', { name: 'Verwandte Kontrolle direkt öffnen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));

    expect(screen.getByRole('button', { name: relatedControl.title })).toHaveFocus();
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 180);
  });

  it.each([
    ['Filter', 'Filter anzeigen', 'Filteraktion'],
    ['Export', 'CSV', 'Aktuelle Ansicht (1)'],
  ])('releases the scroll lock of an open %s sheet when a control page opens', (_label, triggerName, sheetContent) => {
    render(
      <CatalogBrowserTestApp
        initialEntry="/katalog/gspp/TOP.1"
        secondaryLink={{ label: 'Vorwärts', to: '/katalog/gspp/kontrolle/shared-alt-identifier' }}
      />,
    );
    // Der Filter-Mock steht auch außerhalb des Sheets; gezählt wird der Zuwachs.
    const countSheetContent = () => screen.queryAllByText(sheetContent).length;
    const closedCount = countSheetContent();
    fireEvent.click(screen.getByRole('button', { name: triggerName }));
    expect(countSheetContent()).toBe(closedCount + 1);
    expect(document.querySelector('body')?.style.overflow).toBe('hidden');

    // Browser-Vorwärts auf die Kontrollroute, während das Sheet offen ist.
    fireEvent.click(screen.getByRole('button', { name: 'Vorwärts' }));

    expect(screen.getByRole('heading', { level: 2, name: control.title })).toBeInTheDocument();
    expect(document.querySelector('body')?.style.overflow).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));

    expect(screen.getByRole('button', { name: triggerName })).toBeVisible();
    expect(countSheetContent()).toBe(closedCount);
    expect(document.querySelector('body')?.style.overflow).toBe('');
  });

  it('starts a different topic at the top instead of restoring the previous list position', () => {
    const catalog = makeCatalog('gspp');
    catalog.practices[0].topics.push({
      id: 'TOP.2',
      title: 'Zweites Thema',
      label: '2',
      practiceId: 'TOP',
      controlCount: 0,
      controlIds: [],
    });
    mockCatalog(catalog);
    render(
      <CatalogBrowserTestApp
        initialEntry="/katalog/gspp/TOP.1"
        secondaryLink={{ label: 'Thema wechseln', to: '/katalog/gspp/TOP.2' }}
      />,
    );
    scrollListTo(420);
    fireEvent.click(screen.getByRole('button', { name: control.title }));

    // Themenwechsel über den Navigations-Drawer bei geöffneter Detailseite.
    fireEvent.click(screen.getByRole('button', { name: 'Thema wechseln' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/gspp/TOP.2');
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 0);
    expect(screen.getByRole('heading', { level: 1, name: 'Zweites Thema' })).toHaveFocus();
  });

  it('restores position and row focus when a page opened from the catalog root closes', () => {
    // Auf der Detailroute nennt `scopeId` das Thema der Kontrolle (TOP.1), die
    // Liste gehörte aber zur Katalogwurzel: Das ist kein Bereichswechsel.
    renderCatalogBrowser('/katalog/gspp');
    scrollListTo(420);
    fireEvent.click(screen.getByRole('button', { name: control.title }));

    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/katalog\/gspp$/);
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 420);
    expect(screen.getByRole('button', { name: control.title })).toHaveFocus();
  });

  it('returns to the control row after a direct call whose catalog loaded first', () => {
    // Die Ladeansicht ist keine Liste: Ihr Bereich darf nicht als Herkunft gelten.
    mockedUseCatalog.mockReturnValue({
      catalog: null,
      loading: true,
      error: null,
      vocabularyRegistry: null,
    } as unknown as ReturnType<typeof useCatalog>);
    const view = renderCatalogBrowser('/katalog/gspp/kontrolle/shared-alt-identifier');
    expect(screen.getByText('Katalog wird geladen…')).toBeInTheDocument();

    mockCatalog(makeCatalog('gspp'));
    view.rerender(<CatalogBrowserTestApp initialEntry="/katalog/gspp/kontrolle/shared-alt-identifier" />);
    expect(screen.getByRole('heading', { level: 2, name: control.title })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));

    expect(screen.getByRole('button', { name: control.title })).toHaveFocus();
  });

  it('starts another catalog at the top while the previous catalog is still loaded', () => {
    // Zwischenstand beim Katalogwechsel: Die Route nennt schon `wlan`, der
    // Kontext liefert noch den geladenen `gspp`-Katalog.
    render(
      <CatalogBrowserTestApp
        initialEntry="/katalog/gspp"
        secondaryLink={{ label: 'Katalog öffnen', to: '/katalog/wlan' }}
      />,
    );
    scrollListTo(420);
    fireEvent.click(screen.getByRole('button', { name: control.title }));

    fireEvent.click(screen.getByRole('button', { name: 'Katalog öffnen' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/wlan');
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('does not record a list position while the catalog switch shows no list', () => {
    const app = () => (
      <CatalogBrowserTestApp
        initialEntry="/katalog/gspp"
        secondaryLink={{ label: 'Katalog öffnen', to: '/katalog/wlan' }}
      />
    );
    const view = render(app());
    fireEvent.click(screen.getByRole('button', { name: 'Katalog öffnen' }));
    // Zwischenstand: Route `wlan`, geladen noch `gspp` – statt der Liste steht
    // die Nicht-gefunden-Ansicht. Ein Scrollen hier ist keine Listenposition.
    expect(screen.queryByTestId('mobile-control-row')).toBeNull();
    scrollListTo(700);
    Object.defineProperty(globalThis, 'scrollY', { configurable: true, value: 0 });

    mockCatalog(makeCatalog('wlan'));
    view.rerender(app());
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/katalog\/wlan$/);
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('focuses the heading of another catalog once its list has loaded', () => {
    const view = render(
      <CatalogBrowserTestApp
        initialEntry="/katalog/gspp/TOP.1"
        secondaryLink={{ label: 'Katalog öffnen', to: '/katalog/wlan' }}
      />,
    );
    scrollListTo(420);
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    mockedUseCatalog.mockReturnValue({
      catalog: null,
      loading: true,
      error: null,
      vocabularyRegistry: null,
    } as unknown as ReturnType<typeof useCatalog>);

    fireEvent.click(screen.getByRole('button', { name: 'Katalog öffnen' }));

    expect(screen.getByText('Katalog wird geladen…')).toBeInTheDocument();
    expect(globalThis.scrollTo).toHaveBeenLastCalledWith(0, 0);

    mockCatalog(makeCatalog('wlan'));
    view.rerender(
      <CatalogBrowserTestApp
        initialEntry="/katalog/gspp/TOP.1"
        secondaryLink={{ label: 'Katalog öffnen', to: '/katalog/wlan' }}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('keeps the page open for Escape outside the detail or already handled elsewhere', () => {
    render(<CatalogBrowserTestApp initialEntry="/katalog/gspp/TOP.1" withHistoryBack />);
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    const detailPath = screen.getByTestId('location').textContent;

    // Escape im mitlaufenden App-Kopf, hier vertreten durch ein Bedienelement außerhalb des Details.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Browser zurück' }), { key: 'Escape' });
    expect(screen.getByTestId('location')).toHaveTextContent(detailPath!);

    // Ein Baustein im Detail hat Escape schon behandelt (z. B. ein Menü).
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    screen.getByRole('heading', { level: 2, name: control.title }).dispatchEvent(handled);
    expect(screen.getByTestId('location')).toHaveTextContent(detailPath!);

    // Ohne Fokus im Detail kommt Escape vom body und schließt die Seite.
    fireEvent.keyDown(document.querySelector('body')!, { key: 'Escape' });
    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/gspp/TOP.1');
  });

  it('switches an open page to the desktop split view without losing the control', () => {
    let width: 'mobile' | 'desktop' = 'mobile';
    mockedUseMediaQuery.mockImplementation(() => width === 'desktop');
    const view = renderCatalogBrowser('/katalog/gspp/kontrolle/shared-alt-identifier');
    expect(screen.getByTestId('mobile-control-row')).not.toBeVisible();

    width = 'desktop';
    view.rerender(<CatalogBrowserTestApp initialEntry="/katalog/gspp/kontrolle/shared-alt-identifier" />);

    expect(screen.getByTestId('desktop-control-list')).toHaveTextContent(`Detail ${control.id}`);
    expect(screen.getAllByText(`Detail ${control.id}`)).toHaveLength(1);
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

  it.each([
    {
      catalogKey: 'gspp' as CatalogKey,
      catalogTitle: 'Grundschutz++-Katalog',
      expectedControl: control,
    },
    {
      catalogKey: 'wlan' as CatalogKey,
      catalogTitle: 'WLAN-Katalog',
      expectedControl: {
        ...control,
        id: 'WLAN.9.9',
        title: 'WLAN-Kontrolle',
      } as Control,
    },
  ])('uses the resolved $catalogKey control and catalog metadata for the document title', ({
    catalogKey,
    catalogTitle,
    expectedControl,
  }) => {
    mockCatalog(makeCatalog(catalogKey, expectedControl));

    renderCatalogBrowser(`/katalog/${catalogKey}/kontrolle/shared-alt-identifier`);

    expectSingleDocumentTitle(
      `${expectedControl.id} — ${expectedControl.title} — ${catalogTitle} — Grundschutz++ Navigator`,
    );
  });

  it('uses catalog domain titles for the root and a resolved group', () => {
    const rootView = renderCatalogBrowser('/katalog/gspp');

    expectSingleDocumentTitle('Grundschutz++-Katalog — Grundschutz++ Navigator');

    // Unmount ist zwingend: zwei gleichzeitig gemountete Titel wuerden den
    // Vergleich still gegen den falschen Knoten laufen lassen.
    rootView.unmount();
    renderCatalogBrowser('/katalog/gspp/TOP.1');

    expectSingleDocumentTitle(
      'TOP.1 — Testthema — Grundschutz++-Katalog — Grundschutz++ Navigator',
    );
  });

  it.each([false, true])('shows only the practice or topic name as scope heading (desktop: %s)', (isDesktop) => {
    mockedUseMediaQuery.mockReturnValue(isDesktop);
    const practiceView = renderCatalogBrowser('/katalog/gspp/TOP');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Testpraktik$/);
    expectSingleDocumentTitle('TOP — Testpraktik — Grundschutz++-Katalog — Grundschutz++ Navigator');

    practiceView.unmount();
    renderCatalogBrowser('/katalog/gspp/TOP.1');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Testthema$/);
    expectSingleDocumentTitle('TOP.1 — Testthema — Grundschutz++-Katalog — Grundschutz++ Navigator');
  });

  it('uses a fixed not-found title without putting an unknown URL fragment in it', () => {
    const unknownAltIdentifier = 'unbekannter-roher-url-wert';

    renderCatalogBrowser(`/katalog/gspp/kontrolle/${unknownAltIdentifier}`);

    expectSingleDocumentTitle('Katalogziel nicht gefunden — Grundschutz++ Navigator');
  });

  it.each([
    { loading: true, error: null, description: 'loading' },
    { loading: false, error: 'Netzwerkfehler', description: 'error' },
  ])('uses a neutral catalog title while $description', ({ loading, error }) => {
    mockedUseCatalog.mockReturnValue({
      catalog: null,
      loading,
      error,
      vocabularyRegistry: null,
    } as unknown as ReturnType<typeof useCatalog>);

    renderCatalogBrowser('/katalog/wlan');

    expectSingleDocumentTitle('Katalog — Grundschutz++ Navigator');
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

  it('preserves the selection when navigating from one topic to another in the same catalog', () => {
    const catalog = makeCatalog('gspp');
    catalog.practices[0].topics.push({
      id: 'TOP.2',
      title: 'Zweites Thema',
      label: '2',
      practiceId: 'TOP',
      controlCount: 0,
      controlIds: [],
    });
    mockCatalog(catalog);

    render(
      <CatalogBrowserTestApp
        initialEntry="/katalog/gspp/TOP.1"
        secondaryLink={{ label: 'Thema wechseln', to: '/katalog/gspp/TOP.2' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    expect(screen.getAllByText('1 ausgewählt').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Thema wechseln' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/gspp/TOP.2');
    expect(screen.getAllByText('1 ausgewählt').length).toBeGreaterThan(0);
  });

  it('preserves the selection when a cross-reference opens a control from another group', () => {
    // Zwischen md und lg bleibt die Toolbar unter dem Overlay im DOM.
    useTabletWidth();
    renderCatalogBrowser('/katalog/gspp');

    fireEvent.click(screen.getByRole('button', { name: control.title }));
    expect(screen.getByText(`Detail ${control.id}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
    fireEvent.click(screen.getByRole('button', { name: control.title }));
    expect(screen.getAllByText('1 ausgewählt').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Verwandte Kontrolle öffnen' }));

    expect(screen.getByText(`Detail ${relatedControl.id}`)).toBeInTheDocument();
    expect(screen.getAllByText('1 ausgewählt').length).toBeGreaterThan(0);
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
