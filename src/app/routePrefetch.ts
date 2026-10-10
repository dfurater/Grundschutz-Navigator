import { useState } from 'react';
import { matchPath, useHref } from 'react-router';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { routePathInBase } from '@/app/initialPage';
import { findLazyStaticRoute } from '@/app/staticPageRoutes';
import { VOCABULARY_DETAIL_ROUTE_PATTERN } from '@/app/routes';
import { VocabularyNamespacePage } from '@/app/vocabularyDetailPage';

/*
 * Vorladen bei Navigationsabsicht (GSPP-506).
 *
 * Wer mit der Maus über einen Link fährt, ihn per Tastatur fokussiert oder ihn
 * antippt, will meist dorthin. Zeigt der Link auf eine Lazy-Route, lädt die
 * Anwendung ihren Chunk dann schon vor dem Klick; ist er bis dahin da, erscheint
 * die Seite ohne Wartezeit, sonst verkürzt sich die Wartezeit, und der Hinweis
 * aus `navigationPending.tsx` meldet den Rest. Es gibt weder Vorladen beim Start
 * noch im Leerlauf: Bytes fließen nur bei Absicht.
 */

interface RoutePreload {
  /** Schlüssel, unter dem die Route höchstens einmal vorgeladen wird. */
  readonly key: string;
  readonly preload: () => Promise<void>;
}

/** Die Lazy-Route zu einem Pfad relativ zur Deployment-Basis, sonst `undefined`. */
export function findLazyRoutePreload(routePath: string): RoutePreload | undefined {
  if (matchPath(VOCABULARY_DETAIL_ROUTE_PATTERN, routePath)) {
    return { key: VOCABULARY_DETAIL_ROUTE_PATTERN, preload: VocabularyNamespacePage.preload };
  }
  const route = findLazyStaticRoute(routePath);
  return route?.page ? { key: route.path, preload: route.page.preload } : undefined;
}

function dataSaverActive(): boolean {
  const connection = (globalThis.navigator as { connection?: { saveData?: boolean } } | undefined)?.connection;
  return connection?.saveData === true;
}

/** Der Routenpfad, auf den ein Link innerhalb der App zeigt, sonst `null`. */
export function internalRoutePath(anchor: HTMLAnchorElement, basename?: string): string | null {
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return null;
  if (anchor.hasAttribute('download')) return null;
  const target = anchor.getAttribute('target');
  if (target && target !== '_self') return null;
  if (anchor.origin !== globalThis.location.origin) return null;
  return routePathInBase(anchor.pathname, basename);
}

/**
 * Ereignisbehandlung für Zeiger, Fokus und Berührung. Jede Lazy-Route lädt
 * höchstens einmal, auch bei vielen Ereignissen über demselben Link.
 */
export function createRoutePrefetcher(
  basename?: string,
  lookup: (routePath: string) => RoutePreload | undefined = findLazyRoutePreload,
): (event: Event) => void {
  const started = new Set<string>();
  return (event) => {
    if (!(event.target instanceof Element) || dataSaverActive()) return;
    const anchor = event.target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const routePath = internalRoutePath(anchor, basename);
    const route = routePath === null ? undefined : lookup(routePath);
    if (!route || started.has(route.key)) return;
    started.add(route.key);
    void route.preload();
  };
}

/** Verdrahtet das Vorladen bei Absicht für die ganze Anwendung (nur Aufruf in der Shell). */
export function useRoutePrefetch(): void {
  // Die Basis ist der Routerpfad ohne abschließenden Schrägstrich ('' ohne Basis).
  const basename = useHref('/').replace(/\/$/, '');
  const [handle] = useState(() => createRoutePrefetcher(basename));
  useGlobalEventListener('document', 'pointerover', handle, true, undefined, true);
  useGlobalEventListener('document', 'pointerdown', handle, true, undefined, true);
  useGlobalEventListener('document', 'focusin', handle, true, undefined, true);
}
