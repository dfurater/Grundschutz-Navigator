import { describe, expect, it } from 'vitest';
import { emptyFilters, type ControlFilters, type FacetCounts } from '@/hooks/useFilteredControls';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import {
  filterPanelEmptyFacetCounts as emptyFacetCounts,
  filterPanelFacetCounts as facetCounts,
} from '@/test/fixtures/filterPanel';
import {
  SECURITY_TARGETS_AFTER,
  buildFilterDimensions,
  toggleArrayItem,
  type FilterDimensionConfig,
  type FlatFacetDimension,
} from './filterDimensions';

const vocabularyRegistry = createTestVocabularyRegistry();

function build(
  filters: Partial<ControlFilters> = {},
  counts: { facetCounts?: FacetCounts; filteredFacetCounts?: FacetCounts } = {},
): FilterDimensionConfig[] {
  return buildFilterDimensions({
    filters: { ...emptyFilters, ...filters },
    facetCounts: counts.facetCounts ?? facetCounts,
    filteredFacetCounts: counts.filteredFacetCounts ?? counts.facetCounts ?? facetCounts,
    vocabularyRegistry,
  });
}

function dimension(dimensions: FilterDimensionConfig[], field: FlatFacetDimension): FilterDimensionConfig {
  const found = dimensions.find((entry) => entry.field === field);
  if (!found) throw new Error(`Dimension ${field} fehlt`);
  return found;
}

function optionValues(config: FilterDimensionConfig): string[] {
  return config.options.map((option) => option.value);
}

const richCounts: FacetCounts = {
  ...facetCounts,
  zielobjektKategorien: { Anwendungen: 1, Netze: 5, Räume: 3 },
  dokumentationstypen: { Richtlinie: 2, Konzept: 1 },
  handlungsworte: { umsetzen: 2, Ändern: 1, dokumentieren: 4 },
  tags: { Zugang: 1, Ärger: 2, Betrieb: 3 },
  linkRelationen: { required: 2 },
};

describe('buildFilterDimensions', () => {
  it('liefert die acht Dimensionen in fester Reihenfolge mit ihren Titeln', () => {
    expect(build().map(({ field, title }) => [field, title])).toEqual([
      ['securityLevels', 'Sicherheitsniveau'],
      ['modalverben', 'Modalverben'],
      ['effortLevels', 'Aufwandsstufen'],
      ['zielobjektKategorien', 'Zielobjekt-Kategorien'],
      ['dokumentationstypen', 'Dokumentationsvorgaben'],
      ['handlungsworte', 'Handlungsworte'],
      ['tags', 'Tags'],
      ['linkRelationen', 'Link-Relationen'],
    ]);
  });

  it('setzt die Schutzziele nach den Zielobjekt-Kategorien ein', () => {
    expect(SECURITY_TARGETS_AFTER).toBe('zielobjektKategorien');
  });

  it('trägt Tooltips nur bei Sicherheitsniveau und Aufwandsstufen', () => {
    const dimensions = build({}, { facetCounts: richCounts });
    const withTooltip = dimensions
      .filter((config) => config.options.some((option) => option.tooltip !== undefined))
      .map((config) => config.field);

    expect(withTooltip).toEqual(['securityLevels', 'effortLevels']);
    expect(dimension(dimensions, 'securityLevels').options[0]).toMatchObject({
      value: 'normal-SdT',
      label: 'normal-SdT',
      tooltip: 'Standard-Sicherheitsniveau für den Stand der Technik.',
    });
  });

  it('beschriftet Modalverben und Link-Relationen aus ihren Labeltabellen', () => {
    const dimensions = build({}, { facetCounts: richCounts });

    expect(dimension(dimensions, 'modalverben').options.map((option) => option.label)).toEqual(['MUSS', 'SOLLTE']);
    expect(dimension(dimensions, 'linkRelationen').options).toEqual([
      { value: 'required', label: 'Erforderlich', tooltip: undefined, count: 2, checked: false },
    ]);
  });

  it('zeigt die festen Vokabulardimensionen immer, die übrigen nur mit Optionen oder Auswahl', () => {
    const empty = build({}, { facetCounts: emptyFacetCounts });

    expect(empty.filter((config) => config.visible).map((config) => config.field)).toEqual([
      'securityLevels',
      'modalverben',
      'effortLevels',
    ]);

    const selected = build(
      { zielobjektKategorien: ['Netze'], tags: ['Zugang'], linkRelationen: ['related'], handlungsworte: ['umsetzen'], dokumentationstypen: ['Konzept'] },
      { facetCounts: emptyFacetCounts },
    );
    expect(selected.every((config) => config.visible)).toBe(true);
  });

  it('macht Link-Relationen über die gefilterten Relationen sichtbar', () => {
    const dimensions = build({}, { facetCounts: { ...emptyFacetCounts, linkRelationen: { related: 1 } } });

    expect(dimension(dimensions, 'linkRelationen').visible).toBe(true);
  });

  it('klappt nur die letzten vier Dimensionen bei fehlender Auswahl ein', () => {
    const ohneAuswahl = build({}, { facetCounts: richCounts });
    expect(ohneAuswahl.map((config) => config.defaultExpanded)).toEqual([
      true, true, true, true, false, false, false, false,
    ]);

    const mitAuswahl = build(
      { dokumentationstypen: ['Konzept'], handlungsworte: ['umsetzen'], tags: ['Zugang'], linkRelationen: ['required'] },
      { facetCounts: richCounts },
    );
    expect(mitAuswahl.map((config) => config.defaultExpanded)).toEqual([
      true, true, true, true, true, true, true, true,
    ]);
    expect(dimension(mitAuswahl, 'tags').activeCount).toBe(1);
  });

  it('lässt unausgewählte Optionen ohne Treffer weg', () => {
    const dimensions = build();

    expect(optionValues(dimension(dimensions, 'modalverben'))).toEqual(['MUSS', 'SOLLTE']);
    expect(optionValues(dimension(dimensions, 'effortLevels'))).toEqual(['3', '4']);
  });

  it('behält ausgewählte Optionen mit Zähler 0', () => {
    const dimensions = build(
      { effortLevels: ['5'], tags: ['Zugang', 'Archiv'], handlungsworte: ['prüfen'] },
      { facetCounts: richCounts, filteredFacetCounts: { ...emptyFacetCounts, tags: { Betrieb: 1 } } },
    );

    expect(dimension(dimensions, 'effortLevels').options.find((option) => option.value === '5')).toMatchObject({
      count: 0,
      checked: true,
    });
    // Ausgewählte Tags ohne Treffer stehen an ihrer alphabetischen Position.
    expect(dimension(dimensions, 'tags').options.map(({ value, count, checked }) => [value, count, checked])).toEqual([
      ['Archiv', 0, true],
      ['Betrieb', 3, false],
      ['Zugang', 1, true],
    ]);
    // Ausgewählte Handlungsworte ohne Treffer stehen am Ende.
    expect(optionValues(dimension(dimensions, 'handlungsworte'))).toEqual(['prüfen']);
  });

  it('zählt eine Dimension mit Auswahl global, ohne Auswahl in der Treffermenge', () => {
    const filtered: FacetCounts = { ...facetCounts, modalverben: { MUSS: 1 } };

    expect(dimension(build({}, { facetCounts, filteredFacetCounts: filtered }), 'modalverben').options)
      .toMatchObject([{ value: 'MUSS', count: 1 }]);
    expect(dimension(build({ modalverben: ['MUSS'] }, { facetCounts, filteredFacetCounts: filtered }), 'modalverben').options)
      .toMatchObject([{ value: 'MUSS', count: 2 }, { value: 'SOLLTE', count: 1 }]);
  });

  it('sortiert Zielobjekte nach Trefferzahl und Textfacetten deutsch alphabetisch', () => {
    const dimensions = build(
      { handlungsworte: ['abwägen'] },
      { facetCounts: richCounts, filteredFacetCounts: richCounts },
    );

    expect(optionValues(dimension(dimensions, 'zielobjektKategorien'))).toEqual(['Netze', 'Räume', 'Anwendungen']);
    expect(optionValues(dimension(dimensions, 'dokumentationstypen'))).toEqual(['Konzept', 'Richtlinie']);
    expect(optionValues(dimension(dimensions, 'handlungsworte'))).toEqual(['Ändern', 'dokumentieren', 'umsetzen', 'abwägen']);
    expect(optionValues(dimension(dimensions, 'tags'))).toEqual(['Ärger', 'Betrieb', 'Zugang']);
  });
});

describe('toggleArrayItem', () => {
  it('fügt fehlende Werte an und entfernt vorhandene', () => {
    expect(toggleArrayItem(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleArrayItem(['a', 'b'], 'a')).toEqual(['b']);
  });
});
