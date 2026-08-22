import { renderHook } from '@testing-library/react';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Control } from '@/domain/models';
import {
  emptyFilters,
  useFilteredControls,
  type ControlFilters,
  type SortConfig,
} from './useFilteredControls';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Governance MUSS verankert werden.',
    statementRaw: 'Governance MUSS verankert werden.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
      ...overrides.statementProps,
    },
    links: [],
    params: {},
    ...overrides,
  };
}

describe('useFilteredControls', () => {
  it('exposes only controls, filters, and optional sort parameters', () => {
    expectTypeOf(useFilteredControls).parameters.toEqualTypeOf<[
      controls: Control[],
      filters: ControlFilters,
      sort?: SortConfig,
    ]>();
  });

  it('filters by handlungsworte', () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        statementProps: {
          zielobjektKategorien: [],
          handlungsworte: 'verankern',
        },
      }),
      makeControl({
        id: 'GC.1.2',
        statementProps: {
          zielobjektKategorien: [],
          handlungsworte: 'prüfen',
        },
      }),
    ];

    const { result } = renderHook(() =>
      useFilteredControls(controls, {
        ...emptyFilters,
        handlungsworte: ['verankern'],
      }),
    );

    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].id).toBe('GC.1.1');
    expect(result.current.facetCounts.handlungsworte.verankern).toBe(1);
    expect(result.current.facetCounts.handlungsworte.prüfen).toBe(1);
  });

  it('combines handlungsworte and dokumentationstypen with AND semantics across filter categories', () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        statementProps: {
          zielobjektKategorien: [],
          handlungsworte: 'verankern',
          dokumentation: 'Sicherheitsleitlinie',
        },
      }),
      makeControl({
        id: 'GC.1.2',
        statementProps: {
          zielobjektKategorien: [],
          handlungsworte: 'prüfen',
          dokumentation: 'Sicherheitsleitlinie',
        },
      }),
      makeControl({
        id: 'GC.1.3',
        statementProps: {
          zielobjektKategorien: [],
          handlungsworte: 'verankern',
          dokumentation: 'Checkliste',
        },
      }),
    ];

    const { result } = renderHook(() =>
      useFilteredControls(controls, {
        ...emptyFilters,
        handlungsworte: ['verankern'],
        dokumentationstypen: ['Sicherheitsleitlinie'],
      }),
    );

    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].id).toBe('GC.1.1');
    expect(result.current.facetCounts.dokumentationstypen.Sicherheitsleitlinie).toBe(2);
    expect(result.current.facetCounts.dokumentationstypen.Checkliste).toBe(1);
  });

  it('reuses the unfiltered facet counts when no filters are active', () => {
    const controls = [
      makeControl({ id: 'GC.1.1', modalverb: 'MUSS' }),
      makeControl({ id: 'GC.1.2', modalverb: 'SOLLTE' }),
    ];

    const { result } = renderHook(() =>
      useFilteredControls(controls, emptyFilters),
    );

    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.filteredFacetCounts).toBe(result.current.facetCounts);
  });

  it('returns filteredFacetCounts reflecting only the filtered result set', () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        modalverb: 'MUSS',
        statementProps: { zielobjektKategorien: [], handlungsworte: 'verankern' },
      }),
      makeControl({
        id: 'GC.1.2',
        modalverb: 'SOLLTE',
        statementProps: { zielobjektKategorien: [], handlungsworte: 'prüfen' },
      }),
    ];

    const { result } = renderHook(() =>
      useFilteredControls(controls, {
        ...emptyFilters,
        modalverben: ['MUSS'],
      }),
    );

    // Global counts include both controls
    expect(result.current.facetCounts.modalverben.MUSS).toBe(1);
    expect(result.current.facetCounts.modalverben.SOLLTE).toBe(1);
    expect(result.current.facetCounts.handlungsworte.verankern).toBe(1);
    expect(result.current.facetCounts.handlungsworte.prüfen).toBe(1);

    // Filtered counts only include the MUSS control
    expect(result.current.filteredFacetCounts).not.toBe(result.current.facetCounts);
    expect(result.current.filteredFacetCounts.modalverben.MUSS).toBe(1);
    expect(result.current.filteredFacetCounts.modalverben.SOLLTE).toBeUndefined();
    expect(result.current.filteredFacetCounts.handlungsworte.verankern).toBe(1);
    expect(result.current.filteredFacetCounts.handlungsworte.prüfen).toBeUndefined();
  });

  it('filters by link relation and exposes relation facet counts per control', () => {
    const controls = [
      makeControl({
        id: 'GC.2.1',
        links: [
          { targetId: 'GC.2.2', href: '#GC.2.2', rel: 'required', relStatus: 'custom' },
          { targetId: 'GC.2.3', href: '#GC.2.3', rel: 'required', relStatus: 'custom' },
        ],
      }),
      makeControl({
        id: 'GC.2.4',
        links: [{ targetId: 'GC.2.5', href: '#GC.2.5', rel: 'related', relStatus: 'custom' }],
      }),
      makeControl({
        id: 'GC.2.6',
        links: [
          { targetId: 'GC.2.7', href: '#GC.2.7', rel: 'required', relStatus: 'custom' },
          { targetId: 'GC.2.8', href: '#GC.2.8', rel: 'related', relStatus: 'custom' },
        ],
      }),
    ];

    const { result } = renderHook(() =>
      useFilteredControls(controls, {
        ...emptyFilters,
        linkRelationen: ['required'],
      }),
    );

    expect(result.current.filtered.map((control) => control.id)).toEqual(['GC.2.1', 'GC.2.6']);
    expect(result.current.facetCounts.linkRelationen.required).toBe(2);
    expect(result.current.facetCounts.linkRelationen.related).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Schmales Prop-Set (GSPP-242)                                       */
/* ------------------------------------------------------------------ */

describe('useFilteredControls — Katalog mit schmalem Prop-Set', () => {
  /**
   * Formtreu zum Anwenderkatalog Lieferkettensicherheit: `sec_level`,
   * `effort_level` und `tags` sind gesetzt, Schutzziel-Props, `threats` und
   * `label` fehlen vollständig.
   */
  function makeLieferketteControl(overrides: Partial<Control> = {}): Control {
    return makeControl({
      securityLevel: 'normal-SdT',
      effortLevel: '2',
      tags: ['Inventories'],
      ...overrides,
    });
  }

  it('erzeugt aus fehlenden Props keine leeren oder irreführenden Facetten', () => {
    const { result } = renderHook(() =>
      useFilteredControls([makeLieferketteControl()], emptyFilters),
    );
    const { facetCounts } = result.current;

    // Vorhandene Dimensionen werden gezählt …
    expect(facetCounts.securityLevels).toEqual({ 'normal-SdT': 1 });
    expect(facetCounts.effortLevels).toEqual({ '2': 1 });
    expect(facetCounts.tags).toEqual({ Inventories: 1 });

    // … abwesende erzeugen keinen Eintrag, auch keinen mit Zählwert 0.
    expect(facetCounts.modalverben).toEqual({});
    expect(facetCounts.zielobjektKategorien).toEqual({});
    expect(facetCounts.handlungsworte).toEqual({});
    expect(facetCounts.dokumentationstypen).toEqual({});
    expect(facetCounts.linkRelationen).toEqual({});

    // Schutzziele und Bedrohungen sind überhaupt keine Filterdimension; sie
    // können deshalb auch keine irreführende Facette erzeugen (GSPP-224).
    expect(Object.keys(facetCounts)).not.toContain('confidentiality');
    expect(Object.keys(facetCounts)).not.toContain('threats');
  });

  it('zählt und filtert unverändert, obwohl die Grundschutz++-Props fehlen', () => {
    const controls = [
      makeLieferketteControl({ id: 'ASST.2.3' }),
      makeLieferketteControl({ id: 'BES.1.7', securityLevel: 'erhöht', tags: [] }),
    ];
    const { result } = renderHook(() =>
      useFilteredControls(controls, { ...emptyFilters, securityLevels: ['erhöht'] }),
    );

    expect(result.current.totalCount).toBe(2);
    expect(result.current.filtered.map((control) => control.id)).toEqual(['BES.1.7']);
  });

  it('wählt ein Control ohne Gruppen-id über keine Gruppen- oder Praktik-Facette aus', () => {
    // Eine Gruppe ohne `id` ist laut OSCAL 1.1.3 zulässig und nicht
    // adressierbar; ein aktiver Gruppenfilter darf sie deshalb nie treffen.
    const ohneGruppe = makeLieferketteControl({
      id: 'X.1',
      groupId: undefined,
      practiceId: undefined,
    });
    const mitGruppe = makeLieferketteControl({ id: 'GC.1.1' });

    const byGroup = renderHook(() =>
      useFilteredControls([ohneGruppe, mitGruppe], { ...emptyFilters, groupIds: ['GC.1'] }),
    );
    expect(byGroup.result.current.filtered.map((control) => control.id)).toEqual(['GC.1.1']);

    const byPractice = renderHook(() =>
      useFilteredControls([ohneGruppe, mitGruppe], { ...emptyFilters, practiceIds: ['GC'] }),
    );
    expect(byPractice.result.current.filtered.map((control) => control.id)).toEqual(['GC.1.1']);

    // Ohne aktiven Filter bleibt es sichtbar — nicht adressierbar heißt nicht unsichtbar.
    const ungefiltert = renderHook(() =>
      useFilteredControls([ohneGruppe, mitGruppe], emptyFilters),
    );
    expect(ungefiltert.result.current.filtered).toHaveLength(2);
  });
});
