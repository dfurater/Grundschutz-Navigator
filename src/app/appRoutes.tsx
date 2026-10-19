import type { ComponentType, ReactNode } from 'react';
import { Link, Navigate, matchPath, useLocation } from 'react-router';
import type { RouteObject } from 'react-router';
import { CatalogBrowser } from '@/features/catalog/CatalogBrowser';
import {
  CATALOG_ROUTE_PATTERN,
  CONTROL_ROUTE_PATTERN,
  GROUP_ROUTE_PATTERN,
  STATION_ROUTE_PATTERN,
  VERBUND_ROUTE_PATTERN,
  VOCABULARY_DETAIL_ROUTE_PATTERN,
  WORKSPACE_DOCUMENT_ROUTE_PATTERN,
  WORKSPACE_INDEX_PATH,
} from '@/app/routes';
import { lazyPage, type LazyPage } from '@/app/lazyPage';
import { PageScroll } from '@/app/PageScroll';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { RouteLoadError, RouteLoading } from '@/app/RouteBoundary';
import { STATIC_PAGE_ROUTES } from '@/app/staticPageRoutes';
import { VocabularyNamespacePage } from '@/app/vocabularyDetailPage';

/*
 * Routentabelle der Anwendung für den Data-Router (GSPP-506).
 *
 * Die Shell ist die Layoutroute, ihr `<Outlet />` in `<main>` zeigt die Seite.
 * Nebenrouten laden über das Routenfeld `lazy`: Der Router holt den Chunk,
 * bevor er die Navigation festschreibt. Bis dahin bleiben vorige Seite und
 * Titel stehen, und `useNavigation()` meldet `loading` (`navigationPending.tsx`).
 * Bei PUSH/REPLACE schreibt der Router auch die Adresszeile erst zum Abschluss;
 * bei POP (Zurück/Vorwärts) hat der Browser sie schon gewechselt. Beim Direktaufruf zeigt `hydrateFallbackElement`
 * den Ladezustand innerhalb der Shell. Eine pfadlose Route mit `ErrorBoundary`
 * umschließt alle Seiten: Ladefehler eines Chunks und Renderfehler jeder Route,
 * auch der Kernrouten, ersetzen nur den Inhalt von `<main>`.
 */

// Bereich Informationsverbünde (GSPP-577): eigener Chunk, der Katalogpfad lädt ihn nicht.
const VerbundOverviewPage = lazyPage(() =>
  import('@/features/workspace/VerbundOverviewPage').then((m) => ({ default: m.VerbundOverviewPage })));
const VerbundPage = lazyPage(() =>
  import('@/features/workspace/VerbundPage').then((m) => ({ default: m.VerbundPage })));
const DocumentReferenceDetailPage = lazyPage(() =>
  import('@/features/workspace/DocumentReferenceDetail').then((m) => ({ default: m.DocumentReferenceDetailPage })));

/** Titel einer Seite, deren Inhalt noch nicht steht oder ausgefallen ist. */
export function pendingTitle(pathname: string): string | undefined {
  if (matchPath(VOCABULARY_DETAIL_ROUTE_PATTERN, pathname)) return PAGE_TITLES.vocabularies;
  if (matchPath(WORKSPACE_INDEX_PATH, pathname)) return PAGE_TITLES.workspace;
  if (matchPath(WORKSPACE_DOCUMENT_ROUTE_PATTERN, pathname)) return PAGE_TITLES.workspaceDocument;
  if (matchPath(VERBUND_ROUTE_PATTERN, pathname) || matchPath(STATION_ROUTE_PATTERN, pathname)) return PAGE_TITLES.verbund;
  return STATIC_PAGE_ROUTES.find((route) => matchPath(route.path, pathname))?.title;
}

function RouteErrorFallback() {
  return <RouteLoadError title={pendingTitle(useLocation().pathname)} />;
}

function pageFrame(content: ReactNode, { title, scroll = true, withTitle = true }: {
  readonly title?: string;
  readonly scroll?: boolean;
  readonly withTitle?: boolean;
}) {
  return (
    <>
      {withTitle && <PageTitle title={title} />}
      {scroll ? <PageScroll>{content}</PageScroll> : content}
    </>
  );
}

/** Lazy-Route: Der Router lädt die Seite, die Seite erscheint im Rahmen samt Titel. */
function lazyRoute(path: string, page: LazyPage, frame: { title?: string; scroll?: boolean; withTitle?: boolean }, fallbackTitle?: string): RouteObject {
  return {
    path,
    hydrateFallbackElement: <RouteLoading title={fallbackTitle} />,
    lazy: async () => {
      const Page: ComponentType = await page.load();
      return { Component: () => pageFrame(<Page />, frame) };
    },
  };
}

const NOT_FOUND = pageFrame(
  <div className="p-6">
    <h1 className="type-page-title">
      404 — Seite nicht gefunden
    </h1>
    <p className="mt-3 text-sm text-slate-600">
      Diese Seite existiert nicht.{' '}
      <Link to="/" className="rounded catalog-prose-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]">
        Zur Startseite
      </Link>
    </p>
  </div>,
  { title: PAGE_TITLES.notFound },
);

/** Seitenrouten unterhalb der Shell. */
export const PAGE_ROUTES: RouteObject[] = [
  ...STATIC_PAGE_ROUTES.map(({ path, title, element, page, scroll }): RouteObject => (
    page
      ? lazyRoute(path, page, { title, scroll }, title)
      : { path, element: pageFrame(element, { title, scroll }) }
  )),
  { path: CONTROL_ROUTE_PATTERN, element: <CatalogBrowser /> },
  { path: GROUP_ROUTE_PATTERN, element: <CatalogBrowser /> },
  { path: CATALOG_ROUTE_PATTERN, element: <CatalogBrowser /> },
  // Das Vokabulardetail setzt seinen Titel selbst, sobald der Namensraum aufgelöst ist.
  lazyRoute(VOCABULARY_DETAIL_ROUTE_PATTERN, VocabularyNamespacePage, { withTitle: false }, PAGE_TITLES.vocabularies),
  // Arbeitsrouten setzen ihren festen Titel selbst, auch im Nicht-gefunden-Zustand.
  lazyRoute(WORKSPACE_INDEX_PATH, VerbundOverviewPage, { withTitle: false }, PAGE_TITLES.workspace),
  lazyRoute(VERBUND_ROUTE_PATTERN, VerbundPage, { withTitle: false }, PAGE_TITLES.verbund),
  lazyRoute(STATION_ROUTE_PATTERN, VerbundPage, { withTitle: false }, PAGE_TITLES.verbund),
  lazyRoute(WORKSPACE_DOCUMENT_ROUTE_PATTERN, DocumentReferenceDetailPage, { withTitle: false }, PAGE_TITLES.workspaceDocument),
  { path: '/mehr', element: <><PageTitle title={PAGE_TITLES.about} /><Navigate to="/about" replace /></> },
  { path: '*', element: NOT_FOUND },
];

/** Routen der Anwendung: `shell` als Layoutroute, darunter die Fehlergrenze und alle Seiten. */
export function createAppRoutes(shell: ReactNode): RouteObject[] {
  return [{
    element: shell,
    children: [{ ErrorBoundary: RouteErrorFallback, children: PAGE_ROUTES }],
  }];
}
