import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Control } from '@/domain/models';
import { useFilteredControls } from './useFilteredControls';
import { useFilterParams } from './useFilterParams';

function makeControl(id: string, title: string): Control {
  return {
    id,
    title,
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: `${title} MUSS umgesetzt werden.`,
    statementRaw: `${title} MUSS umgesetzt werden.`,
    guidance: '',
    statementProps: { zielobjektKategorien: [] },
    links: [],
    params: {},
  };
}

function routerWrapper(initialEntry: string) {
  return function RouterWrapper({ children }: PropsWithChildren) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

describe('useFilterParams', () => {
  it('ignoriert q als Katalogfilter vollständig', () => {
    const controls = [
      makeControl('GC.1.1', 'Prüfen der Wirksamkeit'),
      makeControl('GC.1.2', 'Leitlinie freigeben'),
    ];

    const { result } = renderHook(() => {
      const filterParams = useFilterParams();
      return {
        ...filterParams,
        filtered: useFilteredControls(controls, filterParams.filters).filtered,
      };
    }, { wrapper: routerWrapper('/katalog?q=prüfen') });

    expect(result.current.filters).not.toHaveProperty('searchTerm');
    expect(result.current.filtered.map((control) => control.id)).toEqual([
      'GC.1.1',
      'GC.1.2',
    ]);
  });

  it('hält Facetten und Sortierung URL-stabil und schreibt verwaistes q nicht zurück', async () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: routerWrapper('/katalog?mv=MUSS&sort=title:desc&q=verwaist'),
    });

    expect(result.current.filters.modalverben).toEqual(['MUSS']);
    expect(result.current.sort).toEqual([{ field: 'title', direction: 'desc' }]);

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        tags: ['audit'],
      }));
    });

    await waitFor(() => {
      expect(result.current.searchString).toBe('mv=MUSS&tags=audit&sort=title%3Adesc');
    });
  });
});

describe('useFilterParams — Schutzziel-Facetten', () => {
  it('liest alle vier Dimensionen aus eigenen Parametern', () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: routerWrapper(
        '/katalog?stc=1&sti=2&stav=0&stau=2',
      ),
    });

    expect(result.current.filters.securityTargets).toEqual({
      confidentiality: ['1'],
      integrity: ['2'],
      availability: ['0'],
      authenticity: ['2'],
    });
  });

  it('verwirft ungültige Werte und behält die gültigen derselben Dimension', () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: routerWrapper('/katalog?stc=1,unrated,3,-1,unknown,,2'),
    });

    expect(result.current.filters.securityTargets.confidentiality).toEqual([
      '1',
      '2',
    ]);
  });

  it('entfernt Duplikate — ein Facettenwert ist der Zustand einer Checkbox', () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: routerWrapper('/katalog?sti=1,1,0,1'),
    });

    expect(result.current.filters.securityTargets.integrity).toEqual(['1', '0']);
  });

  it('lässt eine Dimension ohne Parameter leer', () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: routerWrapper('/katalog?stc=1'),
    });

    expect(result.current.filters.securityTargets.integrity).toEqual([]);
    expect(result.current.filters.securityTargets.availability).toEqual([]);
    expect(result.current.filters.securityTargets.authenticity).toEqual([]);
  });

  it('schreibt eine Auswahl zurück in die URL und bleibt damit teilbar', async () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: routerWrapper('/katalog'),
    });

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        securityTargets: {
          ...current.securityTargets,
          confidentiality: ['1', '0'],
          authenticity: ['2'],
        },
      }));
    });

    await waitFor(() => {
      expect(result.current.searchString).toBe(
        'stc=1%2C0&stau=2',
      );
    });
  });

  it('entfernt den Parameter, sobald die Auswahl einer Dimension leer ist', async () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: routerWrapper('/katalog?stc=1&sti=2'),
    });

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        securityTargets: { ...current.securityTargets, confidentiality: [] },
      }));
    });

    await waitFor(() => {
      expect(result.current.searchString).toBe('sti=2');
    });
  });

  it('übersteht eine Rundreise durch Serialisierung und Deserialisierung', async () => {
    const { result } = renderHook(() => useFilterParams(), {
      wrapper: routerWrapper('/katalog?stc=2&stav=0&mv=MUSS'),
    });

    const before = result.current.filters.securityTargets;

    act(() => {
      result.current.setFilters((current) => ({ ...current }));
    });

    await waitFor(() => {
      expect(result.current.filters.securityTargets).toEqual(before);
    });
    expect(result.current.filters.modalverben).toEqual(['MUSS']);
  });
});
