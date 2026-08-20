import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Catalog, CatalogState, Control } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import { downloadCSV } from '@/features/export/csvExport';
import { SearchPage } from './SearchPage';
import { useSearch } from './useSearch';
import { CONTROL_ROUTE_PATTERN } from '@/app/routes';
import { catalogCollectionDefaults } from '@/test/catalogState';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

vi.mock('./useSearch', () => ({
  useSearch: vi.fn(),
}));

vi.mock('@/features/export/csvExport', () => ({
  downloadCSV: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const mockedUseSearch = vi.mocked(useSearch);

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

function renderSearch(controls: Control[]) {
  mockedUseCatalog.mockReturnValue(makeCatalogState(controls));
  mockedUseSearch.mockReturnValue({
    results: controls.map((control) => ({ control })),
    totalResults: controls.length,
  });

  return render(
    <MemoryRouter initialEntries={['/suche?q=verfahren']}>
      <Routes>
        <Route path="/suche" element={<SearchPage />} />
        <Route path={CONTROL_ROUTE_PATTERN} element={<div>Katalogdetail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SearchPage', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseSearch.mockReset();
    vi.mocked(downloadCSV).mockReset();
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
        <SearchPage />
      </MemoryRouter>,
    );

    expect(mockedUseSearch).toHaveBeenCalledWith(
      controls,
      'alias',
      null,
      state.catalog!.practices,
    );
  });

  describe('Desktop-Ergebnisse', () => {
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
      expect(within(desktop).getAllByRole('row').slice(1)).toHaveLength(51);
      expect(within(desktop).getByText('ASST.1.51')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', {
          name: /Weitere Suchergebnisse anzeigen/,
        }),
      ).not.toBeInTheDocument();
    });
  });

  describe('Mobile-Ergebnisse', () => {
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
      const rankedFirst = makeControl({
        id: 'ZZ.9.1',
        title: 'Zweiter Treffer mit hoher Suchrelevanz',
      });
      const rankedSecond = makeControl({
        id: 'AA.1.1',
        title: 'Alphabetisch erster Treffer',
      });

      renderSearch([rankedFirst, rankedSecond]);

      // Desktop nach ID sortieren
      const desktop = screen.getByTestId('search-results-desktop');
      await user.click(within(desktop).getByRole('button', { name: /ID/ }));

      // Mobile muss weiterhin in Relevanzreihenfolge sein: ZZ.9.1 zuerst
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
      renderSearch(makeControls(51));

      const desktop = screen.getByTestId('search-results-desktop');
      await user.click(within(desktop).getByRole('checkbox', { name: 'Alle auswählen' }));

      expect(screen.getByText('51 ausgewählt')).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: /Weitere Suchergebnisse anzeigen/ }),
      );

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
      const controls = makeControls(51);
      renderSearch(controls);

      await user.click(screen.getByRole('button', { name: 'CSV Export' }));

      expect(downloadCSV).toHaveBeenCalledWith(controls, 'grundschutz-suchergebnisse.csv');
    });

    it('aktiviert den mobilen Auswahlmodus über einen beschrifteten 44×44-Toggle und markiert Zeilen über aria-pressed', async () => {
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
      const row = within(mobile).getByRole('button', { name: /ASST\.1\.1/i });
      expect(row).toHaveAttribute('aria-pressed', 'false');

      await user.click(row);
      expect(row).toHaveAttribute('aria-pressed', 'true');
    });

    it('exportiert die mobile Auswahl über die Selection-Bar als grundschutz-auswahl.csv und beendet danach den Auswahlmodus', async () => {
      const user = userEvent.setup();
      const control = makeControl({ id: 'ASST.1.1' });
      renderSearch([control]);

      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      const mobile = screen.getByTestId('search-results-mobile');
      await user.click(within(mobile).getByRole('button', { name: /ASST\.1\.1/i }));

      const selectionBar = screen.getByRole('button', { name: 'Fertig' }).closest('div')!;
      await user.click(within(selectionBar).getByRole('button', { name: 'Export (1)' }));

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
      await user.click(within(desktop).getByRole('button', { name: /ID/ }));

      await user.click(screen.getByRole('button', { name: 'CSV' }));
      await user.click(screen.getByRole('button', { name: /Aktuelle Ansicht/ }));

      expect(downloadCSV).toHaveBeenCalledWith(
        [rankedFirst, rankedSecond],
        'grundschutz-suchergebnisse.csv',
      );
    });

    it('lässt den Gesamtkatalogexport auf Desktop und Mobile als grundschutz-gesamtkatalog.csv verfügbar', async () => {
      const user = userEvent.setup();
      const control = makeControl({ id: 'ASST.1.1' });
      renderSearch([control]);

      await user.click(screen.getByRole('button', { name: 'Weitere Exportoptionen' }));
      await user.click(screen.getByRole('menuitem', { name: /Gesamtkatalog/ }));
      expect(downloadCSV).toHaveBeenCalledWith([control], 'grundschutz-gesamtkatalog.csv');

      vi.mocked(downloadCSV).mockClear();

      await user.click(screen.getByRole('button', { name: 'CSV' }));
      await user.click(screen.getByRole('button', { name: /Gesamtkatalog/ }));
      expect(downloadCSV).toHaveBeenCalledWith([control], 'grundschutz-gesamtkatalog.csv');
    });

    it('leert Auswahl und beendet den mobilen Auswahlmodus bei jeder Änderung von q', async () => {
      const user = userEvent.setup();
      renderSearch([makeControl({ id: 'ASST.1.1' })]);

      await user.click(screen.getByRole('button', { name: 'Kontrollen auswählen' }));
      const mobile = screen.getByTestId('search-results-mobile');
      await user.click(within(mobile).getByRole('button', { name: /ASST\.1\.1/i }));
      expect(screen.getAllByText('1 ausgewählt').length).toBeGreaterThan(0);

      const input = screen.getByPlaceholderText('Suche…');
      fireEvent.change(input, { target: { value: 'zweite anfrage' } });
      fireEvent.submit(input.closest('form')!);

      expect(screen.queryAllByText(/ausgewählt/)).toHaveLength(0);
      expect(
        screen.getByRole('button', { name: 'Kontrollen auswählen' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
