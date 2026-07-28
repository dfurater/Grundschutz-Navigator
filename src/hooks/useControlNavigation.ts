import {
  useCallback,
  useEffect,
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

interface BrowseScope {
  catalogKey: string | undefined;
  scope: string | null | undefined;
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

export function useControlNavigation({
  catalog,
  routeCatalogKey,
  groupId,
  altIdentifier,
  searchString,
  navigate,
}: UseControlNavigationOptions): UseControlNavigationResult {
  const selectedControl = useMemo(
    () => resolveControlRoute(catalog, routeCatalogKey, altIdentifier),
    [altIdentifier, catalog, routeCatalogKey],
  );
  const scopeId = selectedControl?.groupId ?? groupId;
  const routeNotFound =
    !catalog ||
    routeCatalogKey !== catalog.catalogKey ||
    (altIdentifier !== undefined && selectedControl === null) ||
    (groupId !== undefined && !hasGroup(catalog, groupId));

  const browseScopeRef = useRef<BrowseScope>({
    catalogKey: catalog?.catalogKey,
    scope: undefined,
  });

  useEffect(() => {
    const loadedCatalogKey = catalog?.catalogKey;
    if (browseScopeRef.current.catalogKey !== loadedCatalogKey) {
      browseScopeRef.current = {
        catalogKey: loadedCatalogKey,
        scope: undefined,
      };
    }

    if (altIdentifier !== undefined) return;

    if (!catalog || routeCatalogKey !== catalog.catalogKey) {
      browseScopeRef.current.scope = undefined;
    } else if (groupId === undefined) {
      browseScopeRef.current.scope = null;
    } else {
      browseScopeRef.current.scope = hasGroup(catalog, groupId)
        ? groupId
        : undefined;
    }
  }, [altIdentifier, catalog, groupId, routeCatalogKey]);

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

  const resolveBrowseTarget = useCallback(
    (snapshot: NavigationSnapshot) => {
      const currentCatalog = snapshot.catalog;
      if (!currentCatalog) return undefined;

      const rememberedScope =
        browseScopeRef.current.catalogKey === currentCatalog.catalogKey
          ? browseScopeRef.current.scope
          : undefined;
      return rememberedScope === undefined
        ? snapshot.scopeId
        : rememberedScope;
    },
    [],
  );

  const selectControl = useCallback((control: Control) => {
    const snapshot = navigationRef.current;
    const currentCatalog = snapshot.catalog;
    if (!currentCatalog) return;

    if (snapshot.selectedControl?.id === control.id) {
      const target = resolveBrowseTarget(snapshot);
      snapshot.navigate({
        pathname: target
          ? buildGroupUrl(currentCatalog.catalogKey, target)
          : buildCatalogUrl(currentCatalog.catalogKey),
        search: snapshot.searchString,
      });
      return;
    }

    snapshot.navigate({
      pathname: buildControlUrlForControl(currentCatalog.catalogKey, control),
      search: snapshot.searchString,
    });
  }, [resolveBrowseTarget]);

  const closeDetail = useCallback(() => {
    const snapshot = navigationRef.current;
    const currentCatalog = snapshot.catalog;
    if (!currentCatalog) return;

    const target = resolveBrowseTarget(snapshot);
    snapshot.navigate({
      pathname: target
        ? buildGroupUrl(currentCatalog.catalogKey, target)
        : buildCatalogUrl(currentCatalog.catalogKey),
      search: snapshot.searchString,
    }, { replace: true });
  }, [resolveBrowseTarget]);

  const navigateToControl = useCallback((control: Control) => {
    const snapshot = navigationRef.current;
    const currentCatalog = snapshot.catalog;
    if (!currentCatalog) return;

    snapshot.navigate({
      pathname: buildControlUrlForControl(currentCatalog.catalogKey, control),
      search: snapshot.searchString,
    }, { replace: true });
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
