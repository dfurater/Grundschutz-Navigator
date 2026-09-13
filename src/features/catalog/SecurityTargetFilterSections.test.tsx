import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogState } from '@/domain/models';
import { emptyFilters, type FacetCounts } from '@/hooks/useFilteredControls';
import { useCatalog } from '@/hooks/useCatalog';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { FilterPanel } from './FilterPanel';
import { catalogCollectionDefaults } from '@/test/catalogState';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const vocabularyRegistry = createTestVocabularyRegistry();

const facetCounts: FacetCounts = {
  securityLevels: { 'normal-SdT': 2, erhöht: 1 },
  effortLevels: {},
  modalverben: {},
  tags: {},
  zielobjektKategorien: {},
  handlungsworte: {},
  dokumentationstypen: {},
  linkRelationen: {},
  securityTargets: {
    confidentiality: { '0': 1, '1': 2, '2': 1 },
    integrity: { '1': 1, '2': 0 },
    availability: {},
    authenticity: {},
  },
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
  securityTargets: {
    confidentiality: {},
    integrity: {},
    availability: {},
    authenticity: {},
  },
};

function makeCatalogState(): CatalogState {
  return {
    ...catalogCollectionDefaults(),
    catalogDocument: null,
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

describe('SecurityTargetFilterSections — im FilterPanel', () => {
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

  it('bietet je Schutzziel eine eigene Facette an', () => {
    renderPanel();

    for (const label of [
      'Schutzziel Vertraulichkeit',
      'Schutzziel Integrität',
      'Schutzziel Verfügbarkeit',
      'Schutzziel Authentizität',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('zeigt nach dem Aufklappen die Stufen mit ihren Trefferzahlen', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Schutzziel Vertraulichkeit/ }));

    expect(
      screen.getByLabelText('Vertraulichkeit: 1').closest('label'),
    ).toHaveTextContent('2');
    expect(
      screen.getByLabelText('Vertraulichkeit: 2').closest('label'),
    ).toHaveTextContent('1');
  });

  it('blendet eine Stufe ohne Treffer aus, solange sie nicht gewählt ist', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Schutzziel Integrität/ }));

    // Stufe 2 hat im Fixture den Zähler 0 und ist nicht gewählt.
    expect(screen.queryByLabelText('Integrität: 2')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Integrität: 1')).toBeInTheDocument();
  });

  it('bietet keine Auswahl für unbewertete oder skalenfremde Anforderungen an', () => {
    renderPanel();

    for (const name of [
      /Schutzziel Vertraulichkeit/,
      /Schutzziel Integrität/,
      /Schutzziel Verfügbarkeit/,
      /Schutzziel Authentizität/,
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
    }

    // Eine Facette führt zu den Anforderungen, die ein Schutzziel betreffen —
    // nicht zu denen, die es nicht betreffen.
    expect(screen.queryByText('Ohne Angabe')).not.toBeInTheDocument();
    expect(screen.queryByText('Außerhalb der Skala')).not.toBeInTheDocument();
  });

  it('klappt eine Dimension mit aktiver Auswahl auf und meldet sie als aktiv', () => {
    renderPanel({
      filters: {
        ...emptyFilters,
        securityTargets: { ...emptyFilters.securityTargets, integrity: ['1'] },
      },
      hasActiveFilters: true,
    });

    const checkbox = screen.getByLabelText('Integrität: 1');
    expect(checkbox).toBeChecked();
  });

  it('meldet eine Auswahl mit der gewählten Dimension zurück', () => {
    const { onFiltersChange } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Schutzziel Vertraulichkeit/ }));
    fireEvent.click(screen.getByLabelText('Vertraulichkeit: 2'));

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...emptyFilters,
      securityTargets: { ...emptyFilters.securityTargets, confidentiality: ['2'] },
    });
  });

  it('lässt die übrigen Dimensionen beim Umschalten unberührt', () => {
    const filters = {
      ...emptyFilters,
      securityTargets: {
        ...emptyFilters.securityTargets,
        confidentiality: ['1' as const],
        integrity: ['0' as const],
      },
    };
    const { onFiltersChange } = renderPanel({ filters, hasActiveFilters: true });

    // Dieselbe Option erneut anklicken entfernt sie wieder.
    fireEvent.click(screen.getByLabelText('Vertraulichkeit: 1'));

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
        integrity: {},
        availability: {},
        authenticity: {},
      },
    };

    renderPanel({
      filters: {
        ...emptyFilters,
        securityTargets: { ...emptyFilters.securityTargets, confidentiality: ['1'] },
      },
      filteredFacetCounts,
      hasActiveFilters: true,
    });

    // Aktive Dimension → globale Zahl 2 statt der gefilterten 1.
    expect(
      screen.getByLabelText('Vertraulichkeit: 1').closest('label'),
    ).toHaveTextContent('2');
  });

  it('benennt jede Option mit ihrem Schutzziel, weil die vier Facetten dieselben Optionsnamen teilen', () => {
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

    // Ohne den qualifizierten Namen wären die vier Checkboxen für
    // Screenreader ununterscheidbar — die Facettenüberschrift ist mit ihnen
    // nicht programmatisch verbunden.
    for (const label of [
      'Vertraulichkeit',
      'Integrität',
      'Verfügbarkeit',
      'Authentizität',
    ]) {
      expect(
        screen.getByLabelText(`${label}: 1`),
      ).toBeChecked();
    }
  });

  it('zeigt die offiziellen Vokabularwerte statt app-eigener Umschreibungen', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Schutzziel Vertraulichkeit/ }));

    // Dieselbe Regel wie bei Sicherheitsniveau und Aufwandsstufe: Der
    // Katalogwert steht da, nicht eine erfundene Stufenbezeichnung. Das
    // Vokabular `security_targets_levels.csv` kennt zu 0–2 keine Bezeichnung.
    expect(screen.getByLabelText('Vertraulichkeit: 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Vertraulichkeit: 2')).toBeInTheDocument();
    expect(screen.queryByText('Hoch relevant (2)')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Relevant/)).not.toBeInTheDocument();
    expect(screen.queryByText(/oder höher/)).not.toBeInTheDocument();
  });

  it('erklärt die Relevanzstufen mit der Definition aus dem BSI-Vokabular', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Schutzziel Vertraulichkeit/ }));

    expect(
      screen.getByLabelText('Vertraulichkeit: 2').closest('label'),
    ).toHaveAttribute(
      'title',
      'Die Anforderung wirkt in besonderem Maße auf dieses Schutzziel hin. Dieser Wert zeigt an, dass das Schutzziel im Zentrum dieser Anforderung steht.',
    );

    // Die Stufe ist exakt — der Tooltip ist wörtlich die Vokabulardefinition.
    expect(
      screen.getByLabelText('Vertraulichkeit: 1').closest('label'),
    ).toHaveAttribute('title', 'Die Anforderung wirkt auf dieses Schutzziel hin.');
  });

  it('erklärt auch die Stufe 0 aus dem Vokabular', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Schutzziel Vertraulichkeit/ }));

    expect(
      screen.getByLabelText('Vertraulichkeit: 0').closest('label'),
    ).toHaveAttribute(
      'title',
      'Die Anforderung wirkt nicht oder vernachlässigbar gering auf dieses Schutzziel hin.',
    );
  });

  it('stellt die Facette ohne Abdeckungs- oder Erfüllungsaussage dar', () => {
    renderPanel();

    for (const name of [
      /Schutzziel Vertraulichkeit/,
      /Schutzziel Integrität/,
      /Schutzziel Verfügbarkeit/,
      /Schutzziel Authentizität/,
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
    }

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
