import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NavigateFunction } from 'react-router';
import type { Catalog, Control } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { useControlNavigation } from './useControlNavigation';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'TOP.1.1',
    altIdentifier: 'stable-top-1-1',
    title: 'Testkontrolle',
    groupId: 'TOP.1',
    practiceId: 'TOP',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: '',
    statementRaw: '',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
    },
    links: [],
    params: {},
    ...overrides,
  };
}

function makeCatalog(
  catalogKey: CatalogKey,
  primaryControl = makeControl(),
): Catalog {
  const relatedControl = makeControl({
    id: `${primaryControl.practiceId}.1.2`,
    altIdentifier: `related-${catalogKey}`,
    title: 'Verwandte Kontrolle',
    groupId: primaryControl.groupId,
    practiceId: primaryControl.practiceId,
  });
  return {
    catalogKey,
    controls: [primaryControl, relatedControl],
    controlsById: new Map([
      [primaryControl.id, primaryControl],
      [relatedControl.id, relatedControl],
    ]),
    controlsByAltIdentifier: new Map([
      [primaryControl.altIdentifier!, primaryControl],
      [relatedControl.altIdentifier!, relatedControl],
    ]),
    practices: [{
      id: primaryControl.practiceId,
      title: 'Testpraktik',
      label: primaryControl.practiceId,
      topics: [{
        id: primaryControl.groupId,
        title: 'Testthema',
        label: '1',
        practiceId: primaryControl.practiceId,
        controlCount: 2,
        controlIds: [primaryControl.id, relatedControl.id],
      }],
      controlCount: 2,
    }],
    totalControls: 2,
  } as Catalog;
}

function createNavigate() {
  return vi.fn() as unknown as NavigateFunction;
}

describe('useControlNavigation', () => {
  it('resolves route state without a router or catalog provider', () => {
    const catalog = makeCatalog('gspp');
    const { result } = renderHook(() =>
      useControlNavigation({
        catalog,
        routeCatalogKey: 'gspp',
        groupId: undefined,
        altIdentifier: 'stable-top-1-1',
        searchString: '?sl=hoch',
        navigate: createNavigate(),
      }),
    );

    expect(result.current.selectedControl?.id).toBe('TOP.1.1');
    expect(result.current.scopeId).toBe('TOP.1');
    expect(result.current.routeNotFound).toBe(false);
  });

  it('preserves push and replace semantics for control navigation', () => {
    const catalog = makeCatalog('gspp');
    const navigate = createNavigate();
    const { result, rerender } = renderHook(
      (props) => useControlNavigation(props),
      {
        initialProps: {
          catalog,
          routeCatalogKey: 'gspp',
          groupId: 'TOP.1' as string | undefined,
          altIdentifier: undefined as string | undefined,
          searchString: '?sl=hoch',
          navigate,
        },
      },
    );
    const primary = catalog.controls[0];
    const related = catalog.controls[1];

    act(() => result.current.selectControl(primary));
    expect(navigate).toHaveBeenLastCalledWith({
      pathname: '/katalog/gspp/kontrolle/stable-top-1-1',
      search: '?sl=hoch',
    });

    rerender({
      catalog,
      routeCatalogKey: 'gspp',
      groupId: undefined,
      altIdentifier: 'stable-top-1-1',
      searchString: '?sl=hoch',
      navigate,
    });

    act(() => result.current.closeDetail());
    expect(navigate).toHaveBeenLastCalledWith({
      pathname: '/katalog/gspp/TOP.1',
      search: '?sl=hoch',
    }, { replace: true });

    act(() => result.current.navigateToControl(related));
    expect(navigate).toHaveBeenLastCalledWith({
      pathname: '/katalog/gspp/kontrolle/related-gspp',
      search: '?sl=hoch',
    }, { replace: true });
  });

  it('toggles an already selected control back to the remembered browse scope', () => {
    const catalog = makeCatalog('gspp');
    const navigate = createNavigate();
    const { result, rerender } = renderHook(
      (props) => useControlNavigation(props),
      {
        initialProps: {
          catalog,
          routeCatalogKey: 'gspp',
          groupId: 'TOP.1' as string | undefined,
          altIdentifier: undefined as string | undefined,
          searchString: '',
          navigate,
        },
      },
    );

    rerender({
      catalog,
      routeCatalogKey: 'gspp',
      groupId: undefined,
      altIdentifier: 'stable-top-1-1',
      searchString: '',
      navigate,
    });
    act(() => result.current.selectControl(catalog.controls[0]));

    expect(navigate).toHaveBeenLastCalledWith({
      pathname: '/katalog/gspp/TOP.1',
      search: '',
    });
  });

  it('drops remembered browse state when the loaded catalog changes', () => {
    const gspp = makeCatalog('gspp');
    const wlanControl = makeControl({
      id: 'WLAN.9.1',
      altIdentifier: 'stable-wlan-9-1',
      groupId: 'WLAN.9',
      practiceId: 'WLAN',
    });
    const wlan = makeCatalog('wlan', wlanControl);
    const navigate = createNavigate();
    const { result, rerender } = renderHook(
      (props) => useControlNavigation(props),
      {
        initialProps: {
          catalog: gspp,
          routeCatalogKey: 'gspp',
          groupId: 'TOP.1' as string | undefined,
          altIdentifier: undefined as string | undefined,
          searchString: '',
          navigate,
        },
      },
    );

    rerender({
      catalog: wlan,
      routeCatalogKey: 'wlan',
      groupId: undefined,
      altIdentifier: 'stable-wlan-9-1',
      searchString: '',
      navigate,
    });
    act(() => result.current.closeDetail());

    expect(navigate).toHaveBeenLastCalledWith({
      pathname: '/katalog/wlan/WLAN.9',
      search: '',
    }, { replace: true });
  });

  it.each([
    { routeCatalogKey: 'unknown', groupId: undefined, altIdentifier: undefined },
    { routeCatalogKey: 'gspp', groupId: 'UNKNOWN', altIdentifier: undefined },
    { routeCatalogKey: 'gspp', groupId: undefined, altIdentifier: 'unknown' },
  ])('marks an unresolved target as not found', (route) => {
    const { result } = renderHook(() =>
      useControlNavigation({
        catalog: makeCatalog('gspp'),
        ...route,
        searchString: '',
        navigate: createNavigate(),
      }),
    );

    expect(result.current.routeNotFound).toBe(true);
  });

  it('keeps navigation callback identities stable across route updates', () => {
    const catalog = makeCatalog('gspp');
    const navigate = createNavigate();
    const { result, rerender } = renderHook(
      (props) => useControlNavigation(props),
      {
        initialProps: {
          catalog,
          routeCatalogKey: 'gspp',
          groupId: 'TOP.1' as string | undefined,
          altIdentifier: undefined as string | undefined,
          searchString: '',
          navigate,
        },
      },
    );
    const callbacks = {
      selectControl: result.current.selectControl,
      closeDetail: result.current.closeDetail,
      navigateToControl: result.current.navigateToControl,
    };

    rerender({
      catalog,
      routeCatalogKey: 'gspp',
      groupId: undefined,
      altIdentifier: 'stable-top-1-1',
      searchString: '?mv=MUSS',
      navigate,
    });

    expect(result.current.selectControl).toBe(callbacks.selectControl);
    expect(result.current.closeDetail).toBe(callbacks.closeDetail);
    expect(result.current.navigateToControl).toBe(callbacks.navigateToControl);
  });
});
