import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyFilters, type FacetCounts } from '@/hooks/useFilteredControls';
import { useCatalog } from '@/hooks/useCatalog';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import {
  filterPanelEmptyFacetCounts as emptyFacetCounts,
  filterPanelFacetCounts as facetCounts,
  makeFilterPanelCatalogState,
} from '@/test/fixtures/filterPanel';
import { FilterPanel } from './FilterPanel';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const vocabularyRegistry = createTestVocabularyRegistry();

function makeCatalogState() {
  return makeFilterPanelCatalogState(vocabularyRegistry);
}

describe('SecurityTargetFilterSection — im FilterPanel', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseCatalog.mockReturnValue(makeCatalogState());
  });

  function renderPanel(overrides: Partial<Parameters<typeof FilterPanel>[0]> = {}) {
    const onFiltersChange = vi.fn();
    render(
      <FilterPanel
        filters={emptyFilters}
        facetCounts={facetCounts}
        filteredFacetCounts={facetCounts}
        hasActiveFilters={false}
        filteredCount={3}
        totalCount={3}
        onFiltersChange={onFiltersChange}
        onClearFilters={vi.fn()}
        {...overrides}
      />,
    );
    return { onFiltersChange };
  }

  /**
   * Die Zeile eines Schutzziels. Ihr zugänglicher Name ist Beschriftung plus
   * Trefferzahl — dieselbe Form wie bei allen übrigen Facettenoptionen. Ohne
   * Layout verkettet jsdom beide ohne Leerzeichen, deshalb das optionale
   * `\s*`; das Muster endet hinter der Zahl und grenzt die Zeile damit gegen
   * die Stufenzeilen `<Label>: Stufe n` ab.
   */
  function zeilenName(label: string): RegExp {
    return new RegExp(`^${label}\\s*\\d*$`);
  }

  function schutzziel(label: string): HTMLInputElement {
    return screen.getByRole('checkbox', { name: zeilenName(label) }) as HTMLInputElement;
  }

  function findeSchutzziel(label: string): HTMLElement | null {
    return screen.queryByRole('checkbox', { name: zeilenName(label) });
  }

  /** Filter mit einer Auswahl in genau einer Dimension. */
  function withSelection(selection: Partial<typeof emptyFilters.securityTargets>) {
    return {
      filters: {
        ...emptyFilters,
        securityTargets: { ...emptyFilters.securityTargets, ...selection },
      },
      hasActiveFilters: true,
    };
  }

  it('fasst die vier Schutzziele in genau einer Sektion zusammen', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: /Schutzziele/ })).toBeInTheDocument();

    // Vier eigene Sektionen gibt es nicht mehr — die Zeilen tragen die Namen.
    for (const label of [
      'Vertraulichkeit',
      'Integrität',
      'Verfügbarkeit',
      'Authentizität',
    ]) {
      expect(
        screen.queryByRole('button', { name: new RegExp(`Schutzziel ${label}`) }),
      ).not.toBeInTheDocument();
      expect(schutzziel(label)).toBeInTheDocument();
    }
  });

  it('zeigt je Schutzziel die Trefferzahl über beide Stufen', () => {
    renderPanel();

    // Vertraulichkeit: 2 + 1 aus dem Fixture; die Stufe 0 zählt nicht mit.
    expect(schutzziel('Vertraulichkeit').closest('label')).toHaveTextContent('3');
    expect(schutzziel('Integrität').closest('label')).toHaveTextContent('1');
    expect(schutzziel('Verfügbarkeit').closest('label')).toHaveTextContent('4');
    expect(schutzziel('Authentizität').closest('label')).toHaveTextContent('2');
  });

  it('erklärt die Stufen in einer Legende über den Optionen', () => {
    renderPanel();

    const sektion = screen.getByRole('button', { name: /Schutzziele/ }).parentElement!;
    const legende = sektion.querySelector('dl')!;

    expect(legende).toBeInTheDocument();
    expect(within(legende).getByText('Stufe 1')).toBeInTheDocument();
    expect(within(legende).getByText('wirkt auf das Schutzziel hin')).toBeInTheDocument();
    expect(within(legende).getByText('Stufe 2')).toBeInTheDocument();
    expect(
      within(legende).getByText('steht im Zentrum der Anforderung'),
    ).toBeInTheDocument();

    // Die Stufenbezeichnung steht in einer eigenen, nicht umbrechenden Spalte;
    // ein Fließsatz bräche bei 256 px Inhaltsbreite mitten in die Definition.
    for (const begriff of within(legende).getAllByText(/^Stufe [12]$/)) {
      expect(begriff.tagName).toBe('DT');
      expect(begriff.className).toContain('whitespace-nowrap');
    }

    // Gegen die Optionen abgesetzt und vor ihnen platziert.
    expect(legende.className).toContain('border-b');
    const ersteOption = schutzziel('Vertraulichkeit');
    expect(
      legende.compareDocumentPosition(ersteOption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('zeigt die Stufen erst, wenn das Schutzziel gewählt ist', () => {
    renderPanel();

    expect(screen.queryByLabelText('Vertraulichkeit: Stufe 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Vertraulichkeit: Stufe 2')).not.toBeInTheDocument();
  });

  it('hakt beide Stufen an, sobald das Schutzziel gewählt ist', () => {
    renderPanel(withSelection({ confidentiality: ['1', '2'] }));

    expect(screen.getByLabelText('Vertraulichkeit: Stufe 1')).toBeChecked();
    expect(screen.getByLabelText('Vertraulichkeit: Stufe 2')).toBeChecked();
    expect(schutzziel('Vertraulichkeit')).toBeChecked();
  });

  it('wählt mit dem Haken auf einem Schutzziel beide Stufen', () => {
    const { onFiltersChange } = renderPanel();

    fireEvent.click(schutzziel('Vertraulichkeit'));

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyFilters,
      securityTargets: { ...emptyFilters.securityTargets, confidentiality: ['1', '2'] },
    });
  });

  it('räumt die Dimension ab, wenn beide Stufen gewählt sind', () => {
    const { onFiltersChange } = renderPanel(withSelection({ confidentiality: ['1', '2'] }));

    fireEvent.click(schutzziel('Vertraulichkeit'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        securityTargets: expect.objectContaining({ confidentiality: [] }),
      }),
    );
  });

  it('zeigt die Stufen mit eigenen Trefferzahlen und lässt sie einzeln abwählen', () => {
    const { onFiltersChange } = renderPanel(withSelection({ confidentiality: ['1', '2'] }));

    expect(
      screen.getByLabelText('Vertraulichkeit: Stufe 1').closest('label'),
    ).toHaveTextContent('2');
    expect(
      screen.getByLabelText('Vertraulichkeit: Stufe 2').closest('label'),
    ).toHaveTextContent('1');

    fireEvent.click(screen.getByLabelText('Vertraulichkeit: Stufe 1'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        securityTargets: expect.objectContaining({ confidentiality: ['2'] }),
      }),
    );
  });

  it('hält die Auswahl in der Ordnung der Skala, unabhängig von der Klickfolge', () => {
    const { onFiltersChange } = renderPanel(withSelection({ confidentiality: ['2'] }));

    fireEvent.click(screen.getByLabelText('Vertraulichkeit: Stufe 1'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        securityTargets: expect.objectContaining({ confidentiality: ['1', '2'] }),
      }),
    );
  });

  it('setzt den dritten Kontrollzustand, sobald genau eine Stufe gewählt ist', () => {
    renderPanel(withSelection({ confidentiality: ['2'] }));

    const eltern = schutzziel('Vertraulichkeit');
    expect(eltern).toBePartiallyChecked();
    expect(eltern).not.toBeChecked();

    expect(screen.getByLabelText('Vertraulichkeit: Stufe 1')).not.toBeChecked();
    expect(screen.getByLabelText('Vertraulichkeit: Stufe 2')).toBeChecked();
  });

  it('unterscheidet den dritten Zustand sichtbar von an und aus', () => {
    renderPanel(withSelection({ confidentiality: ['2'], integrity: ['1', '2'] }));

    const gemischt = schutzziel('Vertraulichkeit').parentElement!;
    const angehakt = schutzziel('Integrität').parentElement!;
    const aus = schutzziel('Verfügbarkeit').parentElement!;

    // Gemischt: gefüllte Box mit Balken statt Haken.
    expect(gemischt.querySelector('span[aria-hidden="true"]')).toBeInTheDocument();
    expect(gemischt.querySelector('svg')).not.toBeInTheDocument();
    expect(gemischt.querySelector('div')?.className).toContain(
      'bg-[var(--color-primary-main)]',
    );

    // An und aus tragen beide den Haken; ihr Unterschied liegt in
    // `peer-checked`, also im Zustand des Inputs, nicht im Markup.
    expect(angehakt.querySelector('svg')).toBeInTheDocument();
    expect(aus.querySelector('svg')).toBeInTheDocument();
    expect(aus.querySelector('span[aria-hidden="true"]')).not.toBeInTheDocument();
  });

  it('vervollständigt aus dem dritten Zustand heraus auf beide Stufen', () => {
    const { onFiltersChange } = renderPanel(withSelection({ confidentiality: ['2'] }));

    fireEvent.click(schutzziel('Vertraulichkeit'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        securityTargets: expect.objectContaining({ confidentiality: ['1', '2'] }),
      }),
    );
  });

  it.each([
    [[], { checked: false, gemischt: false, stufen: 0 }],
    [['1'], { checked: false, gemischt: true, stufen: 2 }],
    [['2'], { checked: false, gemischt: true, stufen: 2 }],
    [['1', '2'], { checked: true, gemischt: false, stufen: 2 }],
  ] as const)(
    'bildet den Zustand %j vollständig auf der Oberfläche ab',
    (auswahl, erwartet) => {
      renderPanel({
        filters: {
          ...emptyFilters,
          securityTargets: { ...emptyFilters.securityTargets, confidentiality: [...auswahl] },
        },
        hasActiveFilters: auswahl.length > 0,
      });

      const eltern = schutzziel('Vertraulichkeit');
      expect(eltern.checked).toBe(erwartet.checked);
      expect(eltern.indeterminate).toBe(erwartet.gemischt);
      expect(screen.queryAllByLabelText(/^Vertraulichkeit: Stufe/)).toHaveLength(
        erwartet.stufen,
      );

      const gewaehlt: readonly string[] = auswahl;
      for (const stufe of ['1', '2'] as const) {
        const zeile = screen.queryByLabelText(`Vertraulichkeit: Stufe ${stufe}`);
        if (zeile) expect(zeile.matches(':checked')).toBe(gewaehlt.includes(stufe));
      }
    },
  );

  it('lässt beide Stufen sichtbar, auch wenn eine ohne Treffer ist', () => {
    // Nur so bleibt eine abgewählte Stufe wieder erreichbar; die Zahlen der
    // Dimension sind bei aktiver Auswahl ohnehin eingefroren.
    renderPanel(withSelection({ integrity: ['1', '2'] }));

    expect(screen.getByLabelText('Integrität: Stufe 2')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Integrität: Stufe 2').closest('label'),
    ).toHaveTextContent('0');
  });

  it('blendet ein Schutzziel ohne Treffer aus, solange es nicht gewählt ist', () => {
    const ohneVerfuegbarkeit: FacetCounts = {
      ...facetCounts,
      securityTargets: { ...facetCounts.securityTargets, availability: {} },
    };

    renderPanel({ facetCounts: ohneVerfuegbarkeit, filteredFacetCounts: ohneVerfuegbarkeit });

    expect(findeSchutzziel('Verfügbarkeit')).not.toBeInTheDocument();
    expect(schutzziel('Vertraulichkeit')).toBeInTheDocument();
  });

  it('lässt die Sektion ganz weg, wenn keine Dimension etwas anzubieten hat', () => {
    renderPanel({ facetCounts: emptyFacetCounts, filteredFacetCounts: emptyFacetCounts });

    expect(screen.queryByRole('button', { name: /Schutzziele/ })).not.toBeInTheDocument();
  });

  it('bietet die Stufe 0 an keiner Stelle als Auswahl an', () => {
    renderPanel(withSelection({ confidentiality: ['1', '2'] }));

    // Das Fixture trägt für Vertraulichkeit einen Zähler auf der Stufe 0.
    expect(screen.queryByLabelText('Vertraulichkeit: Stufe 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Stufe 0')).not.toBeInTheDocument();
  });

  it('lässt die übrigen Dimensionen beim Umschalten unberührt', () => {
    const filters = {
      ...emptyFilters,
      securityTargets: {
        ...emptyFilters.securityTargets,
        confidentiality: ['1' as const],
        integrity: ['2' as const],
      },
    };
    const { onFiltersChange } = renderPanel({ filters, hasActiveFilters: true });

    fireEvent.click(screen.getByLabelText('Vertraulichkeit: Stufe 1'));

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...filters,
      securityTargets: { ...filters.securityTargets, confidentiality: [] },
    });
  });

  it('friert die Zahlen einer Dimension ein, sobald sie selbst gefiltert ist', () => {
    const filteredFacetCounts: FacetCounts = {
      ...emptyFacetCounts,
      securityTargets: {
        confidentiality: { '1': 1 },
        integrity: { '1': 1, '2': 0 },
        availability: { '2': 4 },
        authenticity: { '1': 1, '2': 1 },
      },
    };

    renderPanel({
      ...withSelection({ confidentiality: ['1', '2'] }),
      filteredFacetCounts,
    });

    // Aktive Dimension → globale Zahlen (2 + 1) statt der gefilterten 1.
    expect(schutzziel('Vertraulichkeit').closest('label')).toHaveTextContent('3');
    expect(
      screen.getByLabelText('Vertraulichkeit: Stufe 1').closest('label'),
    ).toHaveTextContent('2');

    // Die übrigen Dimensionen folgen weiter der gefilterten Menge.
    expect(schutzziel('Verfügbarkeit').closest('label')).toHaveTextContent('4');
  });

  it('benennt jede Stufenzeile mit ihrem Schutzziel', () => {
    renderPanel({
      filters: {
        ...emptyFilters,
        securityTargets: {
          confidentiality: ['1'],
          integrity: ['1'],
          availability: ['1'],
          authenticity: ['1'],
        },
      },
      hasActiveFilters: true,
    });

    // Ohne den qualifizierten Namen wären die Stufenzeilen für Screenreader
    // ununterscheidbar — die Elternzeile ist mit ihnen nicht programmatisch
    // verbunden.
    for (const label of [
      'Vertraulichkeit',
      'Integrität',
      'Verfügbarkeit',
      'Authentizität',
    ]) {
      expect(screen.getByLabelText(`${label}: Stufe 1`)).toBeChecked();
      expect(screen.getByLabelText(`${label}: Stufe 2`)).not.toBeChecked();
    }
  });

  it('erklärt die Relevanzstufen mit der vollständigen Definition aus dem BSI-Vokabular', () => {
    renderPanel(withSelection({ confidentiality: ['1', '2'] }));

    // Die Legende kürzt; der Tooltip bleibt wörtlich das Vokabular.
    expect(
      screen.getByLabelText('Vertraulichkeit: Stufe 2').closest('label'),
    ).toHaveAttribute(
      'title',
      'Die Anforderung wirkt in besonderem Maße auf dieses Schutzziel hin. Dieser Wert zeigt an, dass das Schutzziel im Zentrum dieser Anforderung steht.',
    );
    expect(
      screen.getByLabelText('Vertraulichkeit: Stufe 1').closest('label'),
    ).toHaveAttribute('title', 'Die Anforderung wirkt auf dieses Schutzziel hin.');
  });

  it('zeigt die offiziellen Vokabularwerte statt app-eigener Umschreibungen', () => {
    renderPanel(withSelection({ confidentiality: ['1', '2'] }));

    // Dieselbe Regel wie bei Sicherheitsniveau und Aufwandsstufe: Der
    // Katalogwert bleibt sichtbar, statt durch eine erfundene Bezeichnung
    // ersetzt zu werden.
    expect(screen.getByLabelText('Vertraulichkeit: Stufe 1')).toBeInTheDocument();
    expect(screen.queryByText('Hoch relevant (2)')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Relevant/)).not.toBeInTheDocument();
    expect(screen.queryByText(/oder höher/)).not.toBeInTheDocument();
  });

  it('stellt die Facette ohne Abdeckungs- oder Erfüllungsaussage dar', () => {
    renderPanel(withSelection({ confidentiality: ['1', '2'] }));

    const panelText =
      screen.getByRole('search', { name: 'Kontrollen filtern' }).textContent?.toLowerCase() ?? '';
    for (const wort of [
      'abdeckung',
      'abgedeckt',
      'coverage',
      'compliance',
      'erfüllt',
      'konform',
    ]) {
      expect(panelText).not.toContain(wort);
    }
  });
});
