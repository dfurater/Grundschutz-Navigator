import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
  useLocation,
  type InitialEntry,
  type NavigateFunction,
} from 'react-router';
import type { Catalog, CatalogState, Control } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { downloadCSV } from '@/features/export/csvExport';
import { SearchPage } from './SearchPage';
import { useSearch } from './useSearch';
import { CONTROL_ROUTE_PATTERN } from '@/app/routes';
import { FOCUS_SEARCH_STATE } from '@/app/searchFocus';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { SearchSelectionProvider } from '@/state/SearchSelectionProvider';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

vi.mock('./useSearch', () => ({
  useSearch: vi.fn(),
}));

vi.mock('@/features/export/csvExport', () => ({
  downloadCSV: vi.fn(),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const mockedUseSearch = vi.mocked(useSearch);
const mockedUseMediaQuery = vi.mocked(useMediaQuery);

function makeControl(overrides: Partial<Control> = {}): Control {
  const id = overrides.id ?? 'ASST.1.1';
  return {
    id,
    altIdentifier: `alt-${id}`,
    title: 'Verfahren und Regelungen',
    groupId: 'ASST.1',
    practiceId: 'ASST',
    securityLevel: 'erhöht',
    effortLevel: '4',
    modalverb: 'MUSS',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Ein Verfahren ist nachvollziehbar dokumentiert.',
    statementRaw: 'Ein Verfahren ist nachvollziehbar dokumentiert.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
    },
    links: [],
    params: {},
    ...overrides,
  };
}

function makeCatalogState(controls: Control[]): CatalogState {
  return {
    ...catalogCollectionDefaults(),
    catalogDocument: null,
    catalog: {
      catalogKey: 'gspp',
      controls,
      controlsById: new Map(controls.map((control) => [control.id, control])),
      controlsByAltIdentifier: new Map(
        controls.map((control) => [control.altIdentifier!, control]),
      ),
      totalControls: controls.length,
    } as Catalog,
    provenance: null,
    vocabularyRegistry: null,
    vocabularyProvenance: null,
    verification: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}

function makeControls(count: number): Control[] {
  return Array.from({ length: count }, (_, index) =>
    makeControl({
      id: `ASST.1.${index + 1}`,
      title: `Suchtreffer ${index + 1}`,
    }),
  );
}

function searchRoutes(initialEntry = '/suche?q=verfahren') {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <SearchSelectionProvider>
        <HistoryButtons />
        <Routes>
          <Route path="/suche" element={<SearchPage />} />
          <Route path={CONTROL_ROUTE_PATTERN} element={<div>Katalogdetail</div>} />
        </Routes>
      </SearchSelectionProvider>
    </MemoryRouter>
  );
}

function HistoryButtons() {
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <button onClick={() => { void navigate(-1); }}>Browser-Zurück</button>
    <output data-testid="route">{JSON.stringify([location.pathname, location.search, location.state])}</output>
  </>;
}

function renderSearch(controls: Control[], initialEntry?: string) {
  mockedUseCatalog.mockReturnValue(makeCatalogState(controls));
  mockedUseSearch.mockReturnValue({
    results: controls.map((control) => ({ control })),
    totalResults: controls.length,
  });

  return render(searchRoutes(initialEntry));
}

/** Springt per `End` zur letzten Zeile, die das Windowing sonst nicht rendert. */
function revealLastRow(container: HTMLElement) {
  fireEvent.keyDown(within(container).getAllByRole('row')[1], { key: 'End' });
}

describe('SearchPage', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseSearch.mockReset();
    vi.mocked(downloadCSV).mockReset();
    mockedUseMediaQuery.mockReset();
    // jsdom-Default ist der Mobile-Zweig; Desktop-Tests überschreiben explizit.
    mockedUseMediaQuery.mockReturnValue(false);
  });

  it('passes practices to the search hook for UUID-based alias indexing', () => {
    const controls = [makeControl()];
    const state = makeCatalogState(controls);
    state.catalog!.practices = [{
      id: 'ASST',
      title: 'Assets',
      label: 'ASST',
      altIdentifier: 'uuid-practice-assets',
      topics: [],
      controlCount: 1,
    }];
    mockedUseCatalog.mockReturnValue(state);
    mockedUseSearch.mockReturnValue({ results: [], totalResults: 0 });

    render(
      <MemoryRouter initialEntries={['/suche?q=alias']}>
        <SearchSelectionProvider><SearchPage /></SearchSelectionProvider>
      </MemoryRouter>,
    );

    expect(mockedUseSearch).toHaveBeenCalledWith(
      controls,
      'alias',
      null,
      state.catalog!.practices,
      'gspp',
    );
  });

  // ⌘K/Ctrl+K ohne sichtbares Header-Suchfeld führt hierher (GSPP-476). Der
  // Zustand bleibt im Verlaufseintrag; fokussiert wird nur die Navigation des
  // Kürzels, nicht Browser-Zurück, -Vorwärts oder Neuladen (GSPP-483).
  describe('Fokus nach dem Tastenkürzel', () => {
    let navigateTo: NavigateFunction = () => {};

    function NavigationProbe() {
      const navigate = useNavigate();
      useEffect(() => { navigateTo = navigate; }, [navigate]);
      return null;
    }

    function renderWithHistory(initialEntry: InitialEntry) {
      mockedUseCatalog.mockReturnValue(makeCatalogState([]));
      mockedUseSearch.mockReturnValue({ results: [], totalResults: 0 });
      render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <SearchSelectionProvider>
            <NavigationProbe />
            <Routes>
              <Route path="/" element={<p>Start</p>} />
              <Route path="/suche" element={<SearchPage />} />
              <Route path="/treffer" element={<p>Treffer</p>} />
            </Routes>
          </SearchSelectionProvider>
        </MemoryRouter>,
      );
    }

    const searchInput = () => screen.getByRole('searchbox', { name: 'Suchbegriff eingeben' });

    it('fokussiert die Eingabe, wenn das Kürzel auf die Suchseite navigiert', () => {
      renderWithHistory('/');

      act(() => { void navigateTo('/suche', { state: FOCUS_SEARCH_STATE }); });

      expect(searchInput()).toHaveFocus();
    });

    it('fokussiert die Eingabe, wenn das Kürzel den Eintrag der Suchseite ersetzt', () => {
      renderWithHistory('/suche?q=verfahren');
      expect(searchInput()).not.toHaveFocus();

      act(() => {
        void navigateTo('/suche?q=verfahren', { state: FOCUS_SEARCH_STATE, replace: true });
      });

      expect(searchInput()).toHaveFocus();
    });

    it('fokussiert die Eingabe nicht bei der Rückkehr per Browser-Zurück', () => {
      renderWithHistory('/');
      act(() => { void navigateTo('/suche?q=verfahren', { state: FOCUS_SEARCH_STATE }); });
      act(() => { void navigateTo('/treffer'); });
      expect(screen.getByText('Treffer')).toBeInTheDocument();

      act(() => { void navigateTo(-1); });

      expect(searchInput()).not.toHaveFocus();
    });

    it('fokussiert die Eingabe nicht beim Laden eines Eintrags mit dem Zustand', () => {
      renderWithHistory({ pathname: '/suche', state: FOCUS_SEARCH_STATE });

      expect(searchInput()).not.toHaveFocus();
    });

    it('fokussiert die Eingabe nicht bei einem anderen Zustand', () => {
      renderWithHistory('/');

      act(() => { void navigateTo('/suche', { state: { focusSearch: 'ja' } }); });

      expect(searchInput()).not.toHaveFocus();
    });
  });

  describe('Desktop-Ergebnisse', () => {
    beforeEach(() => {
      mockedUseMediaQuery.mockReturnValue(true);
    });

    it('keeps the result pane outside the shrink-0 header wrapper', () => {
      renderSearch([makeControl()]);

      const desktop = screen.getByTestId('search-results-desktop');
      expect(desktop.closest('.shrink-0')).toBeNull();
    });

    it('rendert Suchergebnisse als volle Katalogtabelle', () => {
      renderSearch([makeControl()]);

      const desktop = screen.getByTestId('search-results-desktop');
      expect(within(desktop).getByRole('grid')).toBeInTheDocument();
      expect(within(desktop).getByRole('columnheader', { name: /Modalverb/ })).toBeInTheDocument();
      expect(within(desktop).getByRole('checkbox', { name: 'Alle auswählen' })).toBeInTheDocument();
      expect(screen.queryByText('Ein Verfahren ist nachvollziehbar dokumentiert.')).not.toBeInTheDocument();
    });

    it('behält initiale Suchrelevanzreihenfolge bis eine Spalte sortiert wird', async () => {
      const user = userEvent.setup();
      const rankedFirst = makeControl({
        id: 'ZZ.9.1',
        title: 'Zweiter Treffer mit hoher Suchrelevanz',
      });
      const rankedSecond = makeControl({
        id: 'AA.1.1',
        title: 'Alphabetisch erster Treffer',
      });

      renderSearch([rankedFirst, rankedSecond]);

      const desktop = screen.getByTestId('search-results-desktop');
      const dataRows = () => within(desktop).getAllByRole('row').slice(1);
      expect(within(dataRows()[0]).getByText('ZZ.9.1')).toBeInTheDocument();

      await user.click(within(desktop).getByRole('button', { name: /ID/ }));

      expect(within(dataRows()[0]).getByText('AA.1.1')).toBeInTheDocument();
    });

    it('navigiert bei Klick auf Tabellenzeile zur Katalogdetailroute', () => {
      renderSearch([makeControl()]);

      const desktop = screen.getByTestId('search-results-desktop');
      fireEvent.click(within(desktop).getAllByRole('row')[1]);

      expect(screen.getByText('Katalogdetail')).toBeInTheDocument();
    });

    it('rendert zunächst 50 von mehr als 50 Treffern und lädt weitere nach', () => {
      renderSearch(makeControls(51));

      expect(screen.getByText(/50 von 51 Ergebnissen/)).toBeInTheDocument();

      const desktop = screen.getByTestId('search-results-desktop');
      expect(within(desktop).getAllByRole('row').slice(1)).toHaveLength(50);
      expect(within(desktop).queryByText('ASST.1.51')).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: /Weitere Suchergebnisse anzeigen/ }),
      );

      expect(screen.getByText(/51 Ergebnisse für/)).toBeInTheDocument();
      // Die Tabelle rendert gefenstert (GSPP-262): Die Ergebnismenge steht in
      // aria-rowcount, die letzte Zeile wird per Tastatur erreicht.
      expect(within(desktop).getByRole('grid')).toHaveAttribute('aria-rowcount', '52');
      revealLastRow(desktop);
      expect(within(desktop).getByText('ASST.1.51')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', {
          name: /Weitere Suchergebnisse anzeigen/,
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe('Mobile-Ergebnisse', () => {
    it.each([false, true])('erhält mobilen Auswahlmodus mit Markierung=%s über Detail und Browser-Zurück', async (marked) => {
      const user = userEvent.setup();
      renderSearch([makeControl()]);
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      if (marked) await user.click(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' }));
      await user.click(within(screen.getByTestId('search-results-mobile')).getByRole('button', { name: /ASST\.1\.1/i }));
      expect(screen.queryByTestId('search-results-mobile')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Browser-Zurück' }));
      expect(screen.getByRole('button', { name: 'Auswahl beenden' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' })).toHaveProperty('checked', marked);
      if (marked) expect(screen.getByRole('button', { name: 'Auswahl als CSV exportieren, 1 ausgewählt' })).toBeInTheDocument();
      expect(screen.getByTestId('route')).toHaveTextContent('["/suche","?q=verfahren",null]');
    });

    it('erhält Desktop-Markierungen über Detail und Browser-Zurück', async () => {
      mockedUseMediaQuery.mockReturnValue(true);
      const user = userEvent.setup();
      renderSearch([makeControl()]);
      await user.click(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' }));
      await user.click(within(screen.getByTestId('search-results-desktop')).getAllByRole('row')[1]);
      expect(screen.queryByTestId('search-results-desktop')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Browser-Zurück' }));
      expect(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' })).toBeChecked();
    });

    it.each(['/suche', '/suche/'])('stellt nach Anfragewechsel und Browser-Zurück keine verworfene Auswahl wieder her (%s)', async (path) => {
      const user = userEvent.setup();
      renderSearch([makeControl()], `${path}?q=verfahren`);
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      await user.click(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' }));
      const input = screen.getByRole('searchbox');
      input.focus();
      fireEvent.change(input, { target: { value: 'zweite anfrage' } });
      fireEvent.submit(input.closest('form')!);
      expect(input).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Kontrollen auswählen' })).toHaveAttribute('aria-pressed', 'false');
      await user.click(screen.getByRole('button', { name: 'Browser-Zurück' }));
      expect(screen.getByRole('button', { name: 'Kontrollen auswählen' })).toHaveAttribute('aria-pressed', 'false');
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      expect(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' })).not.toBeChecked();
    });

    it.each([false, true])('verwirft Auswahl bei Katalogwechsel in Detail=%s dauerhaft', async (inDetail) => {
      const user = userEvent.setup();
      const controls = [makeControl()];
      const view = renderSearch(controls);
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      await user.click(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' }));
      if (inDetail) await user.click(within(screen.getByTestId('search-results-mobile')).getByRole('button', { name: /ASST\.1\.1/i }));
      const changed = makeCatalogState(controls);
      changed.catalog!.catalogKey = 'wlan';
      mockedUseCatalog.mockReturnValue(changed);
      view.rerender(searchRoutes());
      mockedUseCatalog.mockReturnValue(makeCatalogState(controls));
      view.rerender(searchRoutes());
      if (inDetail) await user.click(screen.getByRole('button', { name: 'Browser-Zurück' }));
      expect(screen.getByRole('button', { name: 'Kontrollen auswählen' })).toHaveAttribute('aria-pressed', 'false');
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      expect(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' })).not.toBeChecked();
    });

    it.each(['Fertig', 'Export'] as const)('behält Cleanup durch %s über einen weiteren Detailwechsel', async (action) => {
      const user = userEvent.setup();
      const control = makeControl();
      renderSearch([control]);
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      await user.click(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' }));
      await user.click(within(screen.getByTestId('search-results-mobile')).getByRole('button', { name: /ASST\.1\.1/i }));
      await user.click(screen.getByRole('button', { name: 'Browser-Zurück' }));
      await user.click(screen.getByRole('button', { name: action === 'Fertig' ? 'Fertig' : 'Auswahl als CSV exportieren, 1 ausgewählt' }));
      if (action === 'Export') expect(downloadCSV).toHaveBeenCalledWith([control], 'grundschutz-auswahl.csv');
      await user.click(within(screen.getByTestId('search-results-mobile')).getByRole('button', { name: /ASST\.1\.1/i }));
      await user.click(screen.getByRole('button', { name: 'Browser-Zurück' }));
      expect(screen.getByRole('button', { name: 'Kontrollen auswählen' })).toHaveAttribute('aria-pressed', 'false');
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      expect(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' })).not.toBeChecked();
    });

    it('beginnt mit leerem Auswahlzustand nach einem neuen App-Mount', async () => {
      const user = userEvent.setup();
      const controls = [makeControl()];
      const view = renderSearch(controls);
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      await user.click(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' }));
      view.unmount();
      renderSearch(controls);
      expect(screen.getByRole('button', { name: 'Kontrollen auswählen' })).toHaveAttribute('aria-pressed', 'false');
      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      expect(screen.getByRole('checkbox', { name: 'ASST.1.1 auswählen' })).not.toBeChecked();
    });

    it('rendert keine Tabelle im mobilen Bereich', () => {
      renderSearch([makeControl()]);

      const mobile = screen.getByTestId('search-results-mobile');
      expect(within(mobile).queryByRole('table')).not.toBeInTheDocument();
      expect(within(mobile).queryByRole('grid')).not.toBeInTheDocument();
    });

    it('rendert keine Spaltenheader im mobilen Bereich', () => {
      renderSearch([makeControl()]);

      const mobile = screen.getByTestId('search-results-mobile');
      expect(within(mobile).queryByRole('columnheader', { name: /Modalverb/ })).not.toBeInTheDocument();
    });

    it('rendert keine Auswahl-Checkbox im mobilen Bereich', () => {
      renderSearch([makeControl()]);

      const mobile = screen.getByTestId('search-results-mobile');
      expect(within(mobile).queryByRole('checkbox', { name: 'Alle auswählen' })).not.toBeInTheDocument();
    });

    it('rendert ID, Titel, Modalverb, Aufwand und Sicherheitsniveau in Katalog-Mobile-Grammatik', () => {
      renderSearch([makeControl()]);

      const mobile = screen.getByTestId('search-results-mobile');
      expect(within(mobile).getByText('ASST.1.1')).toBeInTheDocument();
      expect(within(mobile).getByText('Verfahren und Regelungen')).toBeInTheDocument();
      expect(within(mobile).getByText('MUSS')).toBeInTheDocument();
      expect(within(mobile).getByText('4')).toBeInTheDocument();
      expect(within(mobile).getByText('erhöht')).toBeInTheDocument();
    });

    it('navigiert bei Tap auf Zeile zur Katalogdetailroute', () => {
      renderSearch([makeControl()]);

      const mobile = screen.getByTestId('search-results-mobile');
      fireEvent.click(within(mobile).getByRole('button', { name: /ASST\.1\.1/i }));

      expect(screen.getByText('Katalogdetail')).toBeInTheDocument();
    });

    it('behält Suchrelevanzreihenfolge auf Mobile auch nach Desktop-Sortierung', async () => {
      const user = userEvent.setup();
      let isDesktop = true;
      mockedUseMediaQuery.mockImplementation(() => isDesktop);
      const rankedFirst = makeControl({
        id: 'ZZ.9.1',
        title: 'Zweiter Treffer mit hoher Suchrelevanz',
      });
      const rankedSecond = makeControl({
        id: 'AA.1.1',
        title: 'Alphabetisch erster Treffer',
      });

      const view = renderSearch([rankedFirst, rankedSecond]);

      // Desktop nach ID sortieren
      const desktop = screen.getByTestId('search-results-desktop');
      await user.click(within(desktop).getByRole('button', { name: /ID/ }));

      // Breakpoint-Wechsel nach Mobile
      isDesktop = false;
      view.rerender(searchRoutes());

      // Mobile muss weiterhin in Relevanzreihenfolge sein: ZZ.9.1 zuerst
      expect(screen.queryByTestId('search-results-desktop')).not.toBeInTheDocument();
      const mobile = screen.getByTestId('search-results-mobile');
      const mobileButtons = within(mobile).getAllByRole('button');
      const zzIndex = mobileButtons.findIndex((btn) => btn.textContent?.includes('ZZ.9.1'));
      const aaIndex = mobileButtons.findIndex((btn) => btn.textContent?.includes('AA.1.1'));
      expect(zzIndex).toBeGreaterThanOrEqual(0);
      expect(aaIndex).toBeGreaterThanOrEqual(0);
      expect(zzIndex).toBeLessThan(aaIndex);
    });
  });

  describe('Auswahl und Export', () => {
    it('zeigt auf Desktop eine Checkbox pro Zeile sowie „Alle auswählen"', () => {
      mockedUseMediaQuery.mockReturnValue(true);
      renderSearch([
        makeControl({ id: 'ASST.1.1' }),
        makeControl({ id: 'ASST.1.2' }),
      ]);

      const desktop = screen.getByTestId('search-results-desktop');
      expect(within(desktop).getByRole('checkbox', { name: 'Alle auswählen' })).toBeInTheDocument();
      expect(within(desktop).getByRole('checkbox', { name: 'ASST.1.1 auswählen' })).toBeInTheDocument();
      expect(within(desktop).getByRole('checkbox', { name: 'ASST.1.2 auswählen' })).toBeInTheDocument();
    });

    it('„Alle auswählen" markiert und demarkiert alle 51 Treffer der Query, auch nicht gerenderte', async () => {
      const user = userEvent.setup();
      mockedUseMediaQuery.mockReturnValue(true);
      renderSearch(makeControls(51));

      const desktop = screen.getByTestId('search-results-desktop');
      await user.click(within(desktop).getByRole('checkbox', { name: 'Alle auswählen' }));

      expect(screen.getByText('51 ausgewählt')).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: /Weitere Suchergebnisse anzeigen/ }),
      );
      revealLastRow(desktop);

      expect(
        within(desktop).getByRole('checkbox', { name: 'ASST.1.51 auswählen' }),
      ).toBeChecked();

      await user.click(within(desktop).getByRole('checkbox', { name: 'Alle auswählen' }));

      expect(screen.queryByText(/ausgewählt/)).not.toBeInTheDocument();
      expect(
        within(desktop).getByRole('checkbox', { name: 'ASST.1.51 auswählen' }),
      ).not.toBeChecked();
    });

    it('exportiert die Auswahl über das Desktop-Menü als grundschutz-auswahl.csv', async () => {
      const user = userEvent.setup();
      mockedUseMediaQuery.mockReturnValue(true);
      const control = makeControl({ id: 'ASST.1.1' });
      renderSearch([control, makeControl({ id: 'ASST.1.2' })]);

      const desktop = screen.getByTestId('search-results-desktop');
      await user.click(
        within(desktop).getByRole('checkbox', { name: 'ASST.1.1 auswählen' }),
      );
      await user.click(screen.getByRole('button', { name: 'Export (1)' }));

      expect(downloadCSV).toHaveBeenCalledWith([control], 'grundschutz-auswahl.csv');
    });

    it('exportiert „Aktuelle Ansicht" ohne Auswahl als grundschutz-suchergebnisse.csv inklusive nicht gerenderter Treffer', async () => {
      const user = userEvent.setup();
      mockedUseMediaQuery.mockReturnValue(true);
      const controls = makeControls(51);
      renderSearch(controls);

      await user.click(screen.getByRole('button', { name: 'CSV Export' }));

      expect(downloadCSV).toHaveBeenCalledWith(controls, 'grundschutz-suchergebnisse.csv');
    });

    it('aktiviert den mobilen Auswahlmodus über einen beschrifteten 44×44-Toggle und meldet echte Checkboxen (GSPP-517)', async () => {
      const user = userEvent.setup();
      renderSearch([makeControl({ id: 'ASST.1.1' })]);

      const toggle = screen.getByRole('button', { name: 'Kontrollen auswählen' });
      expect(toggle).toHaveClass('min-h-[44px]', 'min-w-[44px]');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');

      await user.click(toggle);

      expect(
        screen.getByRole('button', { name: 'Auswahl beenden' }),
      ).toHaveAttribute('aria-pressed', 'true');

      const mobile = screen.getByTestId('search-results-mobile');
      const checkbox = within(mobile).getByRole('checkbox', { name: 'ASST.1.1 auswählen' });
      expect(checkbox).not.toBeChecked();
      // Die Zeilen tragen keine Modus-Semantik mehr: kein aria-pressed in der Liste.
      expect(mobile.querySelector('[aria-pressed]')).toBeNull();

      await user.click(checkbox);
      expect(checkbox).toBeChecked();
      expect(
        screen.getByRole('button', { name: 'Auswahl als CSV exportieren, 1 ausgewählt' }),
      ).toBeInTheDocument();
    });

    it('navigiert der Zeilen-Tap im mobilen Auswahlmodus statt auszuwählen (GSPP-517)', async () => {
      const user = userEvent.setup();
      renderSearch([makeControl({ id: 'ASST.1.1' })]);

      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      const mobile = screen.getByTestId('search-results-mobile');
      await user.click(within(mobile).getByRole('button', { name: /ASST\.1\.1/i }));

      // Navigation statt Auswahl: Detailroute, keine Auswahl in der Leiste.
      expect(screen.getByText('Katalogdetail')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /ausgewählt/ })).not.toBeInTheDocument();
    });

    it('exportiert die mobile Auswahl über die Selection-Bar als grundschutz-auswahl.csv und beendet danach den Auswahlmodus', async () => {
      const user = userEvent.setup();
      const control = makeControl({ id: 'ASST.1.1' });
      renderSearch([control]);

      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      const mobile = screen.getByTestId('search-results-mobile');
      await user.click(within(mobile).getByRole('checkbox', { name: 'ASST.1.1 auswählen' }));

      const selectionBar = screen.getByRole('button', { name: 'Fertig' }).closest('div')!;
      await user.click(
        within(selectionBar).getByRole('button', {
          name: 'Auswahl als CSV exportieren, 1 ausgewählt',
        }),
      );

      expect(downloadCSV).toHaveBeenCalledWith([control], 'grundschutz-auswahl.csv');
      expect(
        screen.queryByRole('button', { name: 'Auswahl beenden' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Kontrollen auswählen' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('exportiert „Aktuelle Ansicht" auf Mobile in Suchrelevanzreihenfolge als grundschutz-suchergebnisse.csv', async () => {
      const user = userEvent.setup();
      let isDesktop = true;
      mockedUseMediaQuery.mockImplementation(() => isDesktop);
      const rankedFirst = makeControl({
        id: 'ZZ.9.1',
        title: 'Zweiter Treffer mit hoher Suchrelevanz',
      });
      const rankedSecond = makeControl({
        id: 'AA.1.1',
        title: 'Alphabetisch erster Treffer',
      });
      const view = renderSearch([rankedFirst, rankedSecond]);

      // Desktop-Sortierung ändern — der Mobile-Export bleibt relevanzsortiert
      const desktop = screen.getByTestId('search-results-desktop');
      await user.click(within(desktop).getByRole('button', { name: /ID/ }));

      // Breakpoint-Wechsel nach Mobile
      isDesktop = false;
      view.rerender(searchRoutes());

      await user.click(screen.getByRole('button', { name: 'CSV exportieren' }));
      await user.click(screen.getByRole('button', { name: /Aktuelle Ansicht/ }));

      expect(downloadCSV).toHaveBeenCalledWith(
        [rankedFirst, rankedSecond],
        'grundschutz-suchergebnisse.csv',
      );
    });

    it('lässt den Gesamtkatalogexport auf Desktop und Mobile als grundschutz-gesamtkatalog.csv verfügbar', async () => {
      const user = userEvent.setup();
      let isDesktop = true;
      mockedUseMediaQuery.mockImplementation(() => isDesktop);
      const control = makeControl({ id: 'ASST.1.1' });
      const view = renderSearch([control]);

      await user.click(screen.getByRole('button', { name: 'Weitere Exportoptionen' }));
      await user.click(screen.getByRole('menuitem', { name: /Gesamtkatalog/ }));
      expect(downloadCSV).toHaveBeenCalledWith([control], 'grundschutz-gesamtkatalog.csv');

      vi.mocked(downloadCSV).mockClear();

      // Breakpoint-Wechsel: Das Mobile-Sheet übernimmt den Gesamtkatalogexport
      isDesktop = false;
      view.rerender(searchRoutes());

      await user.click(screen.getByRole('button', { name: 'CSV exportieren' }));
      await user.click(screen.getByRole('button', { name: /Gesamtkatalog \(/ }));
      expect(downloadCSV).toHaveBeenCalledWith([control], 'grundschutz-gesamtkatalog.csv');
    });

    it('leert Auswahl und beendet den mobilen Auswahlmodus bei jeder Änderung von q', async () => {
      const user = userEvent.setup();
      renderSearch([makeControl({ id: 'ASST.1.1' })]);

      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      const mobile = screen.getByTestId('search-results-mobile');
      await user.click(within(mobile).getByRole('checkbox', { name: 'ASST.1.1 auswählen' }));
      // Im mobilen Auswahlmodus steht die Zahl nur im Export-Button der Leiste (GSPP-471).
      expect(
        screen.getByRole('button', { name: 'Auswahl als CSV exportieren, 1 ausgewählt' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Auswahl aufheben' })).not.toBeInTheDocument();

      const input = screen.getByPlaceholderText('Suche…');
      fireEvent.change(input, { target: { value: 'zweite anfrage' } });
      fireEvent.submit(input.closest('form')!);

      expect(screen.queryAllByText(/ausgewählt/)).toHaveLength(0);
      expect(
        screen.getByRole('button', { name: 'Kontrollen auswählen' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('Breakpoint-Mounting (GSPP-261)', () => {
    it('mounts exactly one result list per breakpoint', () => {
      let isDesktop = false;
      mockedUseMediaQuery.mockImplementation(() => isDesktop);
      const view = renderSearch(makeControls(3));

      expect(screen.getByTestId('search-results-mobile')).toBeInTheDocument();
      expect(screen.queryByTestId('search-results-desktop')).not.toBeInTheDocument();

      isDesktop = true;
      view.rerender(searchRoutes());

      expect(screen.getByTestId('search-results-desktop')).toBeInTheDocument();
      expect(screen.queryByTestId('search-results-mobile')).not.toBeInTheDocument();

      isDesktop = false;
      view.rerender(searchRoutes());

      expect(screen.getByTestId('search-results-mobile')).toBeInTheDocument();
      expect(screen.queryByTestId('search-results-desktop')).not.toBeInTheDocument();
    });

    it('preserves visible count and desktop sort across a breakpoint switch', async () => {
      const user = userEvent.setup();
      let isDesktop = true;
      mockedUseMediaQuery.mockImplementation(() => isDesktop);
      const view = renderSearch(makeControls(51));

      // Desktop: weitere Ergebnisse nachladen und nach ID sortieren
      fireEvent.click(
        screen.getByRole('button', { name: /Weitere Suchergebnisse anzeigen/ }),
      );
      let desktop = screen.getByTestId('search-results-desktop');
      await user.click(within(desktop).getByRole('button', { name: /ID/ }));
      expect(within(desktop).getByRole('grid')).toHaveAttribute('aria-rowcount', '52');

      // Wechsel nach Mobile: sichtbare Ergebnisanzahl erhalten
      isDesktop = false;
      view.rerender(searchRoutes());
      expect(screen.queryByTestId('search-results-desktop')).not.toBeInTheDocument();
      expect(screen.getByText(/51 Ergebnisse für/)).toBeInTheDocument();

      // Zurück nach Desktop: Sortierung erhalten
      isDesktop = true;
      view.rerender(searchRoutes());
      desktop = screen.getByTestId('search-results-desktop');
      expect(within(desktop).getByRole('grid')).toHaveAttribute('aria-rowcount', '52');
      const rows = within(desktop).getAllByRole('row').slice(1);
      expect(within(rows[0]).getByText('ASST.1.1')).toBeInTheDocument();
    });
  });
});
