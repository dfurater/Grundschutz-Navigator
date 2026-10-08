import { useMemo, useState, useEffect, useId, useRef } from 'react';
import {
  Routes,
  Route,
  Link,
  Navigate,
  matchPath,
  useNavigate,
  useLocation,
} from 'react-router';
import { HeaderBar } from '@/components/HeaderBar';
import { TreeNav } from '@/components/TreeNav';
import { Footer } from '@/components/Footer';
import { ScopeSwitcher } from '@/components/ScopeSwitcher';
import type { ScopeSwitcherItem } from '@/components/ScopeSwitcher';
import {
  IconChevronLeft,
  IconChevronRight,
  IconX,
} from '@/components/icons';
import type { TreeItem } from '@/components/TreeNav';
import { useCatalog } from '@/hooks/useCatalog';
import { useCloseDrawerOnNavigation } from '@/hooks/useCloseDrawerOnNavigation';
import { useDragToResize } from '@/hooks/useDragToResize';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useMobileDrawerPlacement } from '@/hooks/useMobileDrawerPlacement';
import { useMobileDrawerSwipe } from '@/hooks/useMobileDrawerSwipe';
import { OWN_SCROLL_AREA_QUERY, useOverlayScrollbars } from '@/hooks/useOverlayScrollbars';
import { CatalogBrowser } from '@/features/catalog/CatalogBrowser';
import { VocabularyNamespacePage } from '@/features/vocabularies/VocabularyNamespacePage';
import { isCatalogKey } from '@/domain/sourceRegistry';
import type { CatalogKey } from '@/domain/sourceRegistry';
import {
  CATALOG_ROUTE_PATTERN,
  CONTROL_ROUTE_PATTERN,
  GROUP_ROUTE_PATTERN,
  buildCatalogUrl,
  buildGroupUrl,
  resolveControlRoute,
} from '@/app/routes';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { STATIC_PAGE_ROUTES } from '@/app/staticPageRoutes';
import { MobileNavigationContext } from '@/state/MobileNavigationContext';

/* ------------------------------------------------------------------ */
/*  PageScroll — scroll wrapper for page content                      */
/*  Footer lives outside as a direct child of <main> on all routes.  */
/* ------------------------------------------------------------------ */

function PageScroll({ children }: Readonly<{ children: React.ReactNode }>) {
  const scrollAreaRef = useOverlayScrollbars<HTMLDivElement>(useMediaQuery(OWN_SCROLL_AREA_QUERY));
  return (
    <div ref={scrollAreaRef} className="flex-1 md:overflow-y-auto pb-safe lg:pb-0">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Build TreeNav items from catalog data                              */
/* ------------------------------------------------------------------ */

function buildTreeItems(
  catalog: ReturnType<typeof useCatalog>['catalog'],
): TreeItem[] {
  if (!catalog) return [];

  return catalog.practices.map((practice) => ({
    id: practice.id,
    prefix: practice.label,
    label: practice.title,
    badge: String(practice.controlCount),
    children: practice.topics.map((topic) => ({
      id: topic.id,
      prefix: topic.id,
      label: topic.title,
      badge: String(topic.controlCount),
    })),
  }));
}

/* ------------------------------------------------------------------ */
/*  AppShell                                                           */
/* ------------------------------------------------------------------ */

const SIDEBAR_DEFAULT_WIDTH = 256;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;

export function AppShell() {
  const [sideNavOpen, setSideNavOpen] = useState(false);
  const sideNavId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isPersistentNav = useMediaQuery(OWN_SCROLL_AREA_QUERY);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const {
    size: sidebarWidth,
    isResizing: isSidebarResizing,
    setSize: setSidebarWidth,
    startResize: handleSidebarResizeStart,
  } = useDragToResize({
    axis: 'x',
    edge: 'end',
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    initial: SIDEBAR_DEFAULT_WIDTH,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const treeScrollRef = useOverlayScrollbars<HTMLDivElement>();
  const {
    catalog,
    catalogDirectory,
    activeCatalogKey: selectedCatalogKey,
    selectCatalog,
    loading,
    error,
  } = useCatalog();

  const shellRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mobileNavOpen = sideNavOpen && !isPersistentNav;

  const openSideNav = () => {
    // Safari gibt Klicks keinen Button-Fokus; main wird beim Öffnen inert.
    if (!isPersistentNav) menuButtonRef.current?.focus({ preventScroll: true });
    setSideNavOpen(true);
    setSidebarCollapsed(false);
  };

  const closeSideNav = () => {
    setSideNavOpen(false);
    if (!isPersistentNav) menuButtonRef.current?.focus({ preventScroll: true });
  };

  // Eine Öffnen-Geste zeigt die Schublade schon vor dem Loslassen; für Lage,
  // Scroll-Sperre und Abdunklung gilt sie dann als offen.
  const swipePreviewing = useMobileDrawerSwipe({
    enabled: !isPersistentNav,
    open: mobileNavOpen,
    routeKey: location.key,
    shellRef,
    drawerRef,
    backdropRef,
    onPreview: () => {
      drawerPlacement.captureOffset();
      setSidebarCollapsed(false);
    },
    onOpen: openSideNav,
    onClose: closeSideNav,
  });
  const drawerPlacement = useMobileDrawerPlacement(
    sideNavOpen || swipePreviewing,
    isPersistentNav,
    isSidebarResizing || prefersReducedMotion,
    drawerRef,
  );
  const mobileNavShown = mobileNavOpen || swipePreviewing;
  const expandedNavWidth = sidebarCollapsed ? 44 : sidebarWidth;
  // Mobil bestimmt `--mobile-nav-width` die Breite (src/index.css).
  const persistentNavWidth = isPersistentNav ? expandedNavWidth : undefined;

  useCloseDrawerOnNavigation({
    locationKey: location.key,
    open: sideNavOpen,
    close: () => setSideNavOpen(false),
    persistent: isPersistentNav,
    drawerId: sideNavId,
    menuButtonRef,
  });

  // Capture garantiert den Vorrang vor dem Escape-Handler der Detailseite
  // auch dann, wenn deren Bubble-Listener bereits vor dem Öffnen registriert war.
  // Ein offenes Menü im Drawer-Kopf schließt Escape selbst; erst das nächste
  // Escape gehört wieder dem Drawer.
  useGlobalEventListener(
    'document', 'keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
      event.preventDefault();
      event.stopPropagation();
      closeSideNav();
    }, mobileNavOpen, undefined, true,
  );

  // Die Route wählt den Katalog, nicht der Einstieg. Ein Routen-catalogKey darf
  // deshalb einen anderen ausgelieferten Katalog aktivieren, statt still auf den
  // Einstiegskatalog zurückzufallen (GSPP-284).
  const routeCatalogKey = useMemo(() => {
    const params =
      matchPath(CONTROL_ROUTE_PATTERN, location.pathname)?.params ??
      matchPath(GROUP_ROUTE_PATTERN, location.pathname)?.params ??
      matchPath(CATALOG_ROUTE_PATTERN, location.pathname)?.params;
    const candidate = params?.catalogKey;
    return candidate !== undefined && isCatalogKey(candidate) ? candidate : null;
  }, [location.pathname]);

  useEffect(() => {
    if (routeCatalogKey) selectCatalog(routeCatalogKey);
  }, [routeCatalogKey, selectCatalog]);

  // Während ein nachgeladener Katalog noch unterwegs ist, trägt der ausgewählte
  // Schlüssel die Navigation weiter — kein Sprung zurück auf den Einstieg.
  const activeCatalogKey = catalog?.catalogKey ?? selectedCatalogKey;
  const catalogItems = useMemo<readonly ScopeSwitcherItem<CatalogKey>[]>(
    () => catalogDirectory.map(({ catalogKey, title }) => ({
      key: catalogKey,
      title,
      href: buildCatalogUrl(catalogKey),
    })),
    [catalogDirectory],
  );

  // Derive selectedId from URL so tree highlights work for all navigation sources
  const selectedId = useMemo(() => {
    const controlMatch = matchPath(CONTROL_ROUTE_PATTERN, location.pathname);
    const routedControl = resolveControlRoute(
      catalog,
      controlMatch?.params.catalogKey,
      controlMatch?.params.altIdentifier,
    );
    if (routedControl) return routedControl.groupId;

    const groupParams = matchPath(GROUP_ROUTE_PATTERN, location.pathname)?.params;
    if (groupParams && catalog && groupParams.catalogKey === catalog.catalogKey) {
      return groupParams.groupId;
    }

    return undefined;
  }, [catalog, location.pathname]);

  const treeItems = useMemo(() => buildTreeItems(catalog), [catalog]);

  const handleSearch = (term: string) => {
    if (term) {
      void navigate(`/suche?q=${encodeURIComponent(term)}`);
    }
  };

  const handleTreeSelect = (id: string) => {
    void navigate(buildGroupUrl(activeCatalogKey, id));
    closeSideNav();
  };

  return (
    <div
      ref={shellRef}
      data-mobile-nav={mobileNavShown ? 'open' : 'closed'}
      className="mobile-nav-shell flex flex-col bg-slate-100 min-h-dvh max-md:data-[mobile-nav=open]:bg-white md:h-dvh md:overflow-hidden"
    >
      <a href="#main-content" className="skip-link">
        Zum Hauptinhalt springen
      </a>

      <HeaderBar
        onSearch={handleSearch}
        className="mobile-nav-push"
        menuExpanded={mobileNavOpen}
        menuControls={sideNavId}
        menuButtonRef={menuButtonRef}
        onMenuToggle={() => {
          // Safari gibt Klicks keinen Button-Fokus; main wird beim Öffnen inert.
          if (!isPersistentNav) menuButtonRef.current?.focus({ preventScroll: true });
          drawerPlacement.captureOffset();
          setSideNavOpen((prev) => !prev);
          setSidebarCollapsed(false);
        }}
      />

      <div className="flex-1 min-w-0 flex md:overflow-hidden relative">
        {/* Mobil sind Abdunklung und Schublade weder fest noch sticky: Ein
            solches Element bis zum unteren Bildschirmrand lässt Safari seine
            Leiste mit einer undurchsichtigen Fläche füllen. Beide liegen
            absolut im Inhaltsbereich und reichen um die Höhe des App-Kopfs
            (`-top-14`, `-mt-14`) über ihn hinaus. Die Schublade beginnt an der
            Dokumentposition beim Öffnen und füllt den sichtbaren Bereich in
            voller Höhe, die Scroll-Sperre hält sie dort
            (`useMobileDrawerPlacement`). Als Push-Drawer schiebt sie
            App-Kopf, Inhalt und Abdunklung um ihre Breite nach rechts
            (`mobile-nav-push`, src/index.css). Die Abdunklung (`z-[35]`) liegt
            über dem App-Kopf (`z-30`), die Schublade (`z-40`) über beiden. Die
            Abdunklung bleibt geschlossen eingehängt, damit sie aus- und
            einblenden kann; ohne Deckkraft lässt sie Zeiger durch. */}
        <div
          ref={backdropRef}
          className="mobile-nav-backdrop mobile-nav-push absolute inset-x-0 -top-14 bottom-0 z-[35] touch-none md:hidden"
          data-testid="mobile-nav-backdrop"
          data-state={mobileNavShown ? 'open' : 'closed'}
          onClick={closeSideNav}
          aria-hidden="true"
        />

        {/* Sidebar / Mobile Drawer */}
        <aside
          id={sideNavId}
          inert={!isPersistentNav && !sideNavOpen}
          className="mobile-nav-drawer
            bg-white flex shrink-0 z-40 overflow-hidden touch-pan-y md:z-30 md:border-r md:border-slate-200
            absolute left-0 -mt-14 h-dvh md:relative md:inset-auto md:mt-0 md:h-auto"
          ref={drawerRef}
          style={{
            top: drawerPlacement.top,
            width: persistentNavWidth,
            transition: isSidebarResizing || prefersReducedMotion
              ? 'none'
              : 'width var(--duration-normal) var(--easing-default), translate var(--mobile-nav-motion)',
          }}
        >
          {sidebarCollapsed ? (
            /* Collapsed: icon column, analog zum FilterPanel */
            <div className="flex flex-col items-center py-4 w-full">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="rounded p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                aria-label="Katalog-Explorer einblenden"
                title="Katalog-Explorer einblenden"
              >
                <IconChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            /* Expanded: Kontextwahl + Baum */
            <div
              className="h-full min-w-0 flex flex-1 flex-col md:flex-none"
              style={isPersistentNav ? { width: sidebarWidth } : undefined}
            >
              {/* Kontextwahl als Kopf: mobil mit Schließen, auf dem Desktop mit Einklappen */}
              <ScopeSwitcher
                label="Katalog"
                items={catalogItems}
                activeKey={activeCatalogKey}
                onItemActivate={closeSideNav}
                trailing={isPersistentNav ? (
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(true)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                    aria-label="Katalog-Explorer ausblenden"
                    title="Katalog-Explorer ausblenden"
                  >
                    <IconChevronLeft className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={closeSideNav}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                    aria-label="Menü schließen"
                  >
                    <IconX className="w-4 h-4" />
                  </button>
                )}
              />

              {/* TreeNav */}
              <div ref={treeScrollRef} className="flex-1 overflow-y-auto py-2">
                {loading && (
                  <div className="px-4 py-8 text-center">
                    <div className="inline-block w-5 h-5 border-2 border-slate-300 border-t-primary-main rounded-full animate-spin" />
                    <p className="text-xs text-slate-500 mt-2">Katalog wird geladen…</p>
                  </div>
                )}
                {error && (
                  <div className="px-4 py-4 text-center">
                    <p className="text-xs text-red-600 font-medium">Fehler</p>
                    <p className="text-xs text-red-500 mt-1">{error}</p>
                  </div>
                )}
                {!loading && !error && treeItems.length > 0 && (
                  <TreeNav
                    items={treeItems}
                    onSelect={handleTreeSelect}
                    selectedId={selectedId}
                  />
                )}
              </div>
            </div>
          )}

          {/* Resize handle — only on desktop, only when expanded */}
          {!sidebarCollapsed && (
            <button
              type="button"
              className="resize-handle resize-handle--right absolute right-0 top-0 bottom-0 z-20 hidden w-1.5 cursor-col-resize focus-visible:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] md:block"
              onMouseDown={handleSidebarResizeStart}
              aria-label="Sidebar-Breite anpassen"
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') { e.preventDefault(); setSidebarWidth((w) => Math.min(SIDEBAR_MAX_WIDTH, w + 20)); }
                if (e.key === 'ArrowLeft') { e.preventDefault(); setSidebarWidth((w) => Math.max(SIDEBAR_MIN_WIDTH, w - 20)); }
              }}
            />
          )}
        </aside>

        {/* Main Content */}
        <main
          id="main-content"
          inert={mobileNavOpen}
          className="mobile-nav-push flex-1 min-w-0 flex flex-col bg-white md:overflow-hidden"
        >
          <MobileNavigationContext.Provider value={mobileNavShown}>
            <Routes>
              {STATIC_PAGE_ROUTES.map(({ path, title, element, scroll = true }) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    <>
                      <PageTitle title={title} />
                      {scroll ? <PageScroll>{element}</PageScroll> : element}
                    </>
                  }
                />
              ))}
              <Route path={CONTROL_ROUTE_PATTERN} element={<CatalogBrowser />} />
              <Route path={GROUP_ROUTE_PATTERN} element={<CatalogBrowser />} />
              <Route path={CATALOG_ROUTE_PATTERN} element={<CatalogBrowser />} />
              <Route path="/vokabular/:namespaceId" element={<PageScroll><VocabularyNamespacePage /></PageScroll>} />
              <Route
                path="/mehr"
                element={<><PageTitle title={PAGE_TITLES.about} /><Navigate to="/about" replace /></>}
              />
              <Route
                path="*"
                element={
                  <>
                    <PageTitle title={PAGE_TITLES.notFound} />
                    <PageScroll>
                      <div className="p-6">
                        <h1 className="type-page-title">
                          404 — Seite nicht gefunden
                        </h1>
                        <p className="mt-3 text-sm text-slate-600">
                          Diese Seite existiert nicht.{' '}
                          <Link to="/" className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]">
                            Zur Startseite
                          </Link>
                        </p>
                      </div>
                    </PageScroll>
                  </>
                }
              />
            </Routes>
          </MobileNavigationContext.Provider>
          <Footer />
        </main>
      </div>
    </div>
  );
}
