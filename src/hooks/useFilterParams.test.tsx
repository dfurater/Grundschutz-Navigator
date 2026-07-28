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
