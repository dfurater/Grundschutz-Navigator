import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Control } from '@/domain/models';
import { emptyFilters, useFilteredControls } from './useFilteredControls';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
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
          { targetId: 'GC.2.2', relation: 'required' },
          { targetId: 'GC.2.3', relation: 'required' },
        ],
      }),
      makeControl({
        id: 'GC.2.4',
        links: [{ targetId: 'GC.2.5', relation: 'related' }],
      }),
      makeControl({
        id: 'GC.2.6',
        links: [
          { targetId: 'GC.2.7', relation: 'required' },
          { targetId: 'GC.2.8', relation: 'related' },
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
