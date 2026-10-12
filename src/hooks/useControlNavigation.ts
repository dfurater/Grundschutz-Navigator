import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { NavigateFunction } from 'react-router';
import type { Catalog, Control } from '@/domain/models';
import {
  buildCatalogUrl,
  buildControlUrlForControl,
  buildGroupUrl,
  resolveControlRoute,
} from '@/app/routes';

export interface UseControlNavigationOptions {
  catalog: Catalog | null;
  routeCatalogKey: string | undefined;
  groupId: string | undefined;
  altIdentifier: string | undefined;
  searchString: string;
  locationState?: unknown;
  navigate: NavigateFunction;
}

export interface UseControlNavigationResult {
  selectedControl: Control | null;
  scopeId: string | undefined;
  routeNotFound: boolean;
  selectControl: (control: Control) => void;
  closeDetail: () => void;
  navigateToControl: (control: Control) => void;
}

interface NavigationSnapshot {
  catalog: Catalog | null;
  selectedControl: Control | null;
  scopeId: string | undefined;
  searchString: string;
  navigate: NavigateFunction;
}

function hasGroup(catalog: Catalog, groupId: string): boolean {
  return catalog.practices.some(
    (practice) =>
      practice.id === groupId ||
      practice.topics.some((topic) => topic.id === groupId),
  );
}

// History-State kann aus einem älteren Einstieg oder einem anderen Katalog
// stammen. Nur ein vorhandener Bereich des aktuellen Katalogs zählt als Ursprung.
function readBrowseScope(catalog: Catalog | null, state: unknown): string | null | undefined {
  if (!catalog || !state || typeof state !== 'object' || !('browseScope' in state)) {
    return undefined;
  }
  const candidate = state.browseScope;
  if (!candidate || typeof candidate !== 'object' ||
      !('catalogKey' in candidate) || candidate.catalogKey !== catalog.catalogKey ||
      !('scope' in candidate)) {
    return undefined;
  }
  const scope = candidate.scope;
  return scope === null || (typeof scope === 'string' && hasGroup(catalog, scope))
    ? scope
    : undefined;
}

export function useControlNavigation({
  catalog,
  routeCatalogKey,
  groupId,
  altIdentifier,
  searchString,
  locationState,
  navigate,
}: UseControlNavigationOptions): UseControlNavigationResult {
  const selectedControl = useMemo(
    () => resolveControlRoute(catalog, routeCatalogKey, altIdentifier),
    [altIdentifier, catalog, routeCatalogKey],
  );
  const browseScope = readBrowseScope(catalog, locationState);
  let scopeId = groupId;
  if (selectedControl) {
    scopeId = browseScope === undefined ? selectedControl.groupId : browseScope ?? undefined;
  }
  const routeNotFound =
    !catalog ||
    routeCatalogKey !== catalog.catalogKey ||
    (altIdentifier !== undefined && selectedControl === null) ||
    (groupId !== undefined && !hasGroup(catalog, groupId));

  const navigationRef = useRef<NavigationSnapshot>({
    catalog,
    selectedControl,
    scopeId,
    searchString,
    navigate,
  });
  useLayoutEffect(() => {
    navigationRef.current = {
      catalog,
      selectedControl,
      scopeId,
      searchString,
      navigate,
    };
  }, [catalog, navigate, scopeId, searchString, selectedControl]);

  const selectControl = useCallback((control: Control) => {
    const snapshot = navigationRef.current;
    const currentCatalog = snapshot.catalog;
    if (!currentCatalog) return;

    if (snapshot.selectedControl?.id === control.id) {
      const target = snapshot.scopeId;
      void snapshot.navigate({
        pathname: target
          ? buildGroupUrl(currentCatalog.catalogKey, target)
          : buildCatalogUrl(currentCatalog.catalogKey),
        search: snapshot.searchString,
      });
      return;
    }

    void snapshot.navigate({
      pathname: buildControlUrlForControl(currentCatalog.catalogKey, control),
      search: snapshot.searchString,
    }, { state: { browseScope: {
      catalogKey: currentCatalog.catalogKey,
      scope: snapshot.scopeId ?? null,
    } } });
  }, []);

  const closeDetail = useCallback(() => {
    const snapshot = navigationRef.current;
    const currentCatalog = snapshot.catalog;
    if (!currentCatalog) return;

    const target = snapshot.scopeId;
    void snapshot.navigate({
      pathname: target
        ? buildGroupUrl(currentCatalog.catalogKey, target)
        : buildCatalogUrl(currentCatalog.catalogKey),
      search: snapshot.searchString,
    }, { replace: true });
  }, []);

  const navigateToControl = useCallback((control: Control) => {
    const snapshot = navigationRef.current;
    const currentCatalog = snapshot.catalog;
    if (!currentCatalog) return;

    void snapshot.navigate({
      pathname: buildControlUrlForControl(currentCatalog.catalogKey, control),
      search: snapshot.searchString,
    }, { replace: true, state: { browseScope: {
      catalogKey: currentCatalog.catalogKey,
      scope: snapshot.scopeId ?? null,
    } } });
  }, []);

  return {
    selectedControl,
    scopeId,
    routeNotFound,
    selectControl,
    closeDetail,
    navigateToControl,
  };
}
