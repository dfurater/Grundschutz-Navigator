import { useCallback, useEffect, useMemo, useRef } from 'react';
import { matchPath, useBlocker, useNavigate, type BlockerFunction } from 'react-router';
import {
  STATION_ROUTE_PATTERN,
  VERBUND_ROUTE_PATTERN,
  WORKSPACE_DOCUMENT_ROUTE_PATTERN,
  areaForPath,
  buildCatalogUrl,
  buildWorkspaceIndexUrl,
  isLocalIdentity,
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

/** Jede Navigation aus dem Bereich Informationsverbünde in den Katalogbereich. */
const leavesWorkspace = (currentPath: string, nextPath: string) =>
  areaForPath(currentPath) === 'informationsverbuende' && areaForPath(nextPath) === 'katalog';

/**
 * Hält jeden Übertritt in den Katalogbereich an, bis die registrierten Autosaves
 * gespeichert haben (ADR-11 §4): Bereichswechsel, Kopfzeilensuche, Markenlink und
 * Zurück/Vor. Scheitert ein Autosave, bleibt die Arbeitsroute stehen und die
 * Speichermeldung erscheint.
 *
 * Nur der jüngste Navigationsversuch darf den Blocker auflösen: Der Router ruft die
 * Blockerfunktion bei jeder Navigation, sie zählt die Versuche mit. Ein Speichervorgang,
 * dessen Versuch durch ein neues Ziel oder einen Klick im Bereich ersetzt wurde, ruft
 * weder `proceed()` noch `reset()`. Speichervorgänge laufen nacheinander, und jeder
 * Versuch speichert selbst, weil sich der Entwurf seit dem vorigen geändert haben kann.
 */
function useAutosaveOnLeave(flushAutosaves: () => Promise<boolean>) {
  const attempt = useRef({ count: 0, key: '' });
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    attempt.current = { count: attempt.current.count + 1, key: nextLocation.key };
    return leavesWorkspace(currentLocation.pathname, nextLocation.pathname);
  }, []);
  const blocker = useBlocker(shouldBlock);
  // Ein angehaltener Versuch speichert genau einmal, auch wenn der Effekt erneut läuft.
  const started = useRef(0);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const { count, key } = attempt.current;
    if (key !== blocker.location.key || started.current === count) return;
    started.current = count;
    const { proceed, reset } = blocker;
    const flushed = saving.current.then(flushAutosaves);
    saving.current = flushed.catch(() => undefined);
    void flushed.then((saved) => {
      if (attempt.current.count !== count) return;
      if (saved) proceed();
      else reset();
    });
  }, [blocker, flushAutosaves]);
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

  useAutosaveOnLeave(flushAutosaves);

  const selectArea = (href: string) => {
    beforeNavigate();
    void navigate(href);
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
