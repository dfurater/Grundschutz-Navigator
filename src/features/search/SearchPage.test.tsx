import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Catalog, CatalogState, Control } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import { SearchPage } from './SearchPage';
import { useSearch } from './useSearch';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

vi.mock('./useSearch', () => ({
  useSearch: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const mockedUseSearch = vi.mocked(useSearch);

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'ASST.1.1',
    title: 'Verfahren und Regelungen',
    groupId: 'ASST.1',
    practiceId: 'ASST',
    securityLevel: 'erhöht',
    effortLevel: '4',
    modalverb: 'MUSS',
    tags: [],
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
    catalog: {
      controls,
      controlsById: new Map(controls.map((control) => [control.id, control])),
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
        <Route path="/katalog/:groupId" element={<div>Katalogdetail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SearchPage', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseSearch.mockReset();
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
      expect(within(desktop).queryByRole('checkbox', { name: 'Alle auswählen' })).not.toBeInTheDocument();
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

    it('rendert zunächst 50 von mehr als 50 Treffern und lädt weitere nach', async () => {
      const user = userEvent.setup();
      renderSearch(makeControls(75));

      expect(screen.getByText(/50 von 75 Ergebnissen/)).toBeInTheDocument();

      const desktop = screen.getByTestId('search-results-desktop');
      expect(within(desktop).getAllByRole('row').slice(1)).toHaveLength(50);
      expect(within(desktop).queryByText('ASST.1.75')).not.toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: /Weitere Suchergebnisse anzeigen/ }),
      );

      expect(screen.getByText(/75 Ergebnisse für/)).toBeInTheDocument();
      expect(within(desktop).getAllByRole('row').slice(1)).toHaveLength(75);
      expect(within(desktop).getByText('ASST.1.75')).toBeInTheDocument();
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
});
