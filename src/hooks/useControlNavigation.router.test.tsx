import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { matchPath, MemoryRouter, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Catalog, Control } from '@/domain/models';
import { CONTROL_ROUTE_PATTERN, GROUP_ROUTE_PATTERN } from '@/app/routes';
import { useControlNavigation } from '@/hooks/useControlNavigation';
import { useFilterParams } from '@/hooks/useFilterParams';

const controls = ['TOP.1', 'TOP.2'].map((groupId, index) => ({
  id: `${groupId}.1`, altIdentifier: `control-${index}`, groupId, practiceId: 'TOP',
  title: `Kontrolle ${index}`, tags: [], taxonomy: [], threats: [],
  statement: '', statementRaw: '', guidance: '', statementProps: { zielobjektKategorien: [] },
  links: [], params: {},
} satisfies Control));
const catalog = {
  catalogKey: 'gspp', uuid: 'test-catalog', controls, backMatter: [], totalControls: controls.length,
  metadata: { title: 'Testkatalog', lastModified: '', version: '1', oscalVersion: '1.1.3',
    props: [], links: [], roles: [], parties: [], responsibleParties: [] },
  controlsById: new Map(controls.map((c) => [c.id, c])),
  controlsByAltIdentifier: new Map(controls.map((c) => [c.altIdentifier, c])),
  practices: [{ id: 'TOP', title: 'Testpraktik', label: 'TOP', controlCount: 2,
    topics: controls.map((control) => ({ id: control.groupId, title: control.groupId,
      label: control.groupId, controlCount: 1, controlIds: [control.id] })) }],
} satisfies Catalog;

function renderNavigation(pathname: string, state: unknown = null) {
  function Wrapper({ children }: PropsWithChildren) {
    return <MemoryRouter initialEntries={[{ pathname, state }]}>{children}</MemoryRouter>;
  }
  return renderHook(() => {
    const location = useLocation();
    const navigate = useNavigate();
    const controlParams = matchPath(CONTROL_ROUTE_PATTERN, location.pathname)?.params;
    const groupParams = matchPath(GROUP_ROUTE_PATTERN, location.pathname)?.params;
    const filterParams = useFilterParams();
    return {
      ...useControlNavigation({
        catalog, routeCatalogKey: 'gspp', groupId: groupParams?.groupId,
        altIdentifier: controlParams?.altIdentifier, searchString: filterParams.searchString,
        locationState: location.state, navigate,
      }),
      ...filterParams, location, navigate,
    };
  }, { wrapper: Wrapper });
}

describe('control browse scope with router history', () => {
  it.each([
    ['/katalog/gspp', undefined],
    ['/katalog/gspp/TOP', 'TOP'],
    ['/katalog/gspp/TOP.1', 'TOP.1'],
  ] as const)('pins %s through opening and cross-topic references', (entry, scopeId) => {
    const { result } = renderNavigation(entry);
    act(() => result.current.selectControl(controls[0]));
    expect(result.current.scopeId).toBe(scopeId);
    expect(result.current.location.pathname).toBe('/katalog/gspp/kontrolle/control-0');
    act(() => result.current.navigateToControl(controls[1]));
    expect(result.current.scopeId).toBe(scopeId);
    expect(result.current.selectedControl?.id).toBe('TOP.2.1');
    act(() => result.current.closeDetail());
    expect(result.current.location.pathname).toBe(entry);
  });

  it('restores each detail entry scope after visiting another list', () => {
    const { result } = renderNavigation('/katalog/gspp');
    act(() => result.current.selectControl(controls[0]));
    act(() => result.current.navigate('/katalog/gspp/TOP.2'));
    act(() => result.current.selectControl(controls[1]));
    expect(result.current.scopeId).toBe('TOP.2');
    act(() => result.current.navigate(-2));
    expect(result.current.selectedControl?.id).toBe('TOP.1.1');
    expect(result.current.scopeId).toBeUndefined();
    act(() => result.current.navigate(2));
    expect(result.current.scopeId).toBe('TOP.2');
    act(() => result.current.selectControl(controls[1]));
    expect(result.current.location.pathname).toBe('/katalog/gspp/TOP.2');
  });

  it('keeps the pinned scope on filter and sort replacements', () => {
    const { result } = renderNavigation('/katalog/gspp');
    act(() => result.current.selectControl(controls[0]));
    act(() => result.current.setFilters((filters) => ({ ...filters, modalverben: ['MUSS'] })));
    expect(result.current.scopeId).toBeUndefined();
    act(() => result.current.setSort([{ field: 'title', direction: 'desc' }]));
    expect(result.current.scopeId).toBeUndefined();
    act(() => result.current.navigateToControl(controls[1]));
    expect(result.current.scopeId).toBeUndefined();
    act(() => result.current.closeDetail());
    expect(result.current.location.pathname).toBe('/katalog/gspp');
    expect(result.current.location.search).toBe('?mv=MUSS&sort=title%3Adesc');
  });

  it.each([
    null, 42, [], { browseScope: null }, { browseScope: 42 },
    { browseScope: { scope: null } }, { browseScope: { catalogKey: 'gspp' } },
    { browseScope: { catalogKey: 'wlan', scope: null } },
    { browseScope: { catalogKey: 'gspp', scope: 'missing' } },
    { browseScope: { catalogKey: 'gspp', scope: 42 } },
  ])('falls back to the control topic for invalid or missing history state (%j)', (state) => {
    const { result } = renderNavigation('/katalog/gspp/kontrolle/control-0', state);
    expect(result.current.scopeId).toBe('TOP.1');
    act(() => result.current.navigateToControl(controls[1]));
    expect(result.current.scopeId).toBe('TOP.1');
    act(() => result.current.closeDetail());
    expect(result.current.location.pathname).toBe('/katalog/gspp/TOP.1');
  });
});
