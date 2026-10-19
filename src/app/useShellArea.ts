import { useEffect, useMemo } from 'react';
import { matchPath, useNavigate } from 'react-router';
import {
  STATION_ROUTE_PATTERN,
  VERBUND_ROUTE_PATTERN,
  WORKSPACE_DOCUMENT_ROUTE_PATTERN,
  areaForPath,
  buildCatalogUrl,
  buildWorkspaceIndexUrl,
  isLocalIdentity,
  type ProductArea,
} from '@/app/routes';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { isWorkspaceStation } from '@/domain/workspaceStations';
import type { StationSelection } from '@/features/workspace/StationSidebar';
import { useWorkspace } from '@/hooks/useWorkspace';

/** Verbund und Station aus einer Arbeitsroute; ungültige Identitäten ergeben `null`. */
function routedWorkspace(pathname: string) {
  const station = matchPath(STATION_ROUTE_PATTERN, pathname)?.params;
  const params = station
    ?? matchPath(WORKSPACE_DOCUMENT_ROUTE_PATTERN, pathname)?.params
    ?? matchPath(VERBUND_ROUTE_PATTERN, pathname)?.params;
  const candidate = params?.verbundId;
  let active: StationSelection | null = null;
  if (station) active = isWorkspaceStation(station.station) ? station.station : null;
  else if (matchPath(VERBUND_ROUTE_PATTERN, pathname)) active = 'all';
  return {
    routeVerbundId: candidate ?? null,
    verbundId: candidate !== undefined && isLocalIdentity(candidate) ? candidate : null,
    active,
  };
}

/**
 * Bereich der Shell (ADR-11): Der Pfad bestimmt den Bereich, öffnet den Speicher
 * beim ersten Betreten des Arbeitsroutenraums und wählt den Verbund der Route.
 * `beforeNavigate` läuft unmittelbar vor einem Bereichswechsel, etwa um die
 * Schublade zu schließen.
 */
export function useShellArea(pathname: string, activeCatalogKey: CatalogKey, beforeNavigate: () => void) {
  const navigate = useNavigate();
  const area = areaForPath(pathname);
  const { activate, selectVerbund, flushAutosaves, verbund } = useWorkspace();
  const routed = useMemo(() => routedWorkspace(pathname), [pathname]);

  useEffect(() => {
    if (area === 'informationsverbuende') activate();
  }, [area, activate]);
  useEffect(() => {
    selectVerbund(routed.routeVerbundId);
  }, [routed.routeVerbundId, selectVerbund]);

  // Der Wechsel in den Katalog speichert offene Entwürfe vorher (ADR-11 §4);
  // scheitert das Speichern, bleibt die Ansicht stehen und die Meldung erscheint.
  const selectArea = (target: ProductArea, href: string) => {
    void (async () => {
      if (area === 'informationsverbuende' && target === 'katalog' && !await flushAutosaves()) return;
      beforeNavigate();
      await navigate(href);
    })();
  };

  const routedVerbund = verbund?.verbundId === routed.verbundId ? verbund : null;
  const stationVerbundId = routedVerbund?.status === 'not-found' || routedVerbund?.status === 'failed'
    ? null
    : routed.verbundId;

  return {
    area,
    catalogHref: buildCatalogUrl(activeCatalogKey),
    workspaceHref: buildWorkspaceIndexUrl(),
    selectArea,
    // Die Übersicht der Informationsverbünde hat keine Arbeitsnavigation; die
    // Schublade trägt dort nur den Bereichswechsel.
    hasAreaNav: area === 'katalog' || stationVerbundId !== null,
    navLabel: area === 'katalog' ? 'Katalog-Explorer' : 'Stationen',
    stations: {
      verbundId: stationVerbundId,
      active: routed.active,
      documents: routedVerbund?.view?.documents,
    },
  };
}
