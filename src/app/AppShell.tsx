import { useMemo, useState, useCallback, useEffect } from 'react';
import { Routes, Route, Link, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { HeaderBar } from '@/components/HeaderBar';
import { TreeNav } from '@/components/TreeNav';
import { Footer } from '@/components/Footer';
import {
  IconChevronLeft,
  IconChevronRight,
  IconShield,
  IconLayoutList,
  IconSearch,
  IconDocument,
  IconInfo,
  IconShieldCheck,
  IconScale,
  IconX,
} from '@/components/icons';
import type { TreeItem } from '@/components/TreeNav';
import { useCatalog } from '@/hooks/useCatalog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { HomePage } from '@/features/home/HomePage';
import { CatalogBrowser } from '@/features/catalog/CatalogBrowser';
import { SearchPage } from '@/features/search/SearchPage';
import { AboutPage } from '@/features/pages/AboutPage';
import { DatenschutzPage } from '@/features/pages/DatenschutzPage';
import { ImpressumPage } from '@/features/pages/ImpressumPage';
import { LizenzenPage } from '@/features/pages/LizenzenPage';
import { VocabularyOverviewPage } from '@/features/vocabularies/VocabularyOverviewPage';
import { VocabularyNamespacePage } from '@/features/vocabularies/VocabularyNamespacePage';

/* ------------------------------------------------------------------ */
/*  PageScroll — scroll wrapper for page content                      */
/*  Footer lives outside as a direct child of <main> on all routes.  */
/* ------------------------------------------------------------------ */

function PageScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 md:overflow-y-auto pb-safe lg:pb-0">
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // Update document title on route change (a11y: screen readers announce page)
  useEffect(() => {
    const path = location.pathname;
    const base = 'Grundschutz++ Navigator';
    const titles: Record<string, string> = {
      '/': base,
      '/katalog': `Katalog — ${base}`,
      '/suche': `Suche — ${base}`,
      '/vokabular': `Vokabulare — ${base}`,
      '/about': `Über das Projekt — ${base}`,
      '/datenschutz': `Datenschutz — ${base}`,
      '/impressum': `Impressum — ${base}`,
      '/lizenzen': `Lizenzen — ${base}`,
      '/mehr': `Über das Projekt — ${base}`,
    };
    if (titles[path]) {
      document.title = titles[path];
    } else if (path.startsWith('/katalog/')) {
      document.title = `${decodeURIComponent(path.replace('/katalog/', ''))} — ${base}`;
    } else if (path.startsWith('/vokabular/')) {
      document.title = `${decodeURIComponent(path.replace('/vokabular/', ''))} — Vokabulare — ${base}`;
    } else {
      document.title = base;
    }
  }, [location.pathname]);

  // Derive selectedId from URL so tree highlights work for all navigation sources
  const selectedId = useMemo(() => {
    const match = location.pathname.match(/^\/katalog\/(.+)$/);
    return match?.[1];
  }, [location.pathname]);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsSidebarResizing(true);
    document.body.classList.add('is-resizing');

    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsSidebarResizing(false);
      document.body.classList.remove('is-resizing');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  const { catalog, loading, error } = useCatalog();
  const treeItems = useMemo(() => buildTreeItems(catalog), [catalog]);

  const handleSearch = (term: string) => {
    if (term) {
      navigate(`/suche?q=${encodeURIComponent(term)}`);
    }
  };

  const handleTreeSelect = (id: string) => {
    navigate(`/katalog/${id}`);
    setSideNavOpen(false);
  };

  return (
    <div className="flex flex-col bg-slate-100 min-h-dvh md:h-dvh md:overflow-hidden">
      <a href="#main-content" className="skip-link">
        Zum Hauptinhalt springen
      </a>

      <HeaderBar
        onSearch={handleSearch}
        onMenuToggle={() => {
          setSideNavOpen((prev) => !prev);
          if (sidebarCollapsed) setSidebarCollapsed(false);
        }}
      />

      <div className="flex-1 min-w-0 flex md:overflow-hidden relative">
        {/* Backdrop for mobile nav */}
        {sideNavOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-20 md:hidden"
            onClick={() => setSideNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar / Mobile Drawer */}
        <aside
          className={`
            bg-white border-r border-slate-200 flex shrink-0 z-30 overflow-hidden
            fixed inset-y-0 left-0 top-14 md:relative md:inset-auto
            ${sideNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}
          style={{
            width: sidebarCollapsed ? 44 : sidebarWidth,
            transition: isSidebarResizing || prefersReducedMotion
              ? 'none'
              : 'width var(--duration-normal) var(--easing-default), transform var(--duration-normal) var(--easing-default)',
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
              <div
                className="p-2 text-slate-300 mt-1"
                aria-hidden="true"
              >
                <IconShield className="w-4 h-4" />
              </div>
            </div>
          ) : (
            /* Expanded: full tree nav + mobile navigation links */
            <div className="h-full flex flex-col" style={{ width: sidebarWidth }}>
              {/* Mobile drawer header with close button */}
              <div className="px-2.5 border-b border-slate-200 flex items-center justify-between md:hidden" style={{ height: 51 }}>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Navigation
                </span>
                <button
                  type="button"
                  onClick={() => setSideNavOpen(false)}
                  className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                  aria-label="Menü schließen"
                >
                  <IconX className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {/* Mobile section navigation links */}
              <nav className="md:hidden border-b border-slate-200" aria-label="Sektionen">
                {[
                  { to: '/katalog', label: 'Katalog', Icon: IconLayoutList },
                  { to: '/suche', label: 'Suche', Icon: IconSearch },
                ].map(({ to, label, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={false}
                    onClick={() => setSideNavOpen(false)}
                    className={({ isActive }) =>
                      [
                        'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary-light text-primary-main font-semibold border-l-3 border-primary-main'
                          : 'text-slate-700 hover:bg-slate-50',
                      ].join(' ')
                    }
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    {label}
                  </NavLink>
                ))}
              </nav>

              {/* Mobile info links */}
              <nav className="md:hidden border-b border-slate-200" aria-label="Weitere Seiten">
                {[
                  { to: '/vokabular', label: 'Vokabulare', Icon: IconDocument },
                  { to: '/about', label: 'Über das Projekt', Icon: IconInfo },
                  { to: '/datenschutz', label: 'Datenschutz', Icon: IconShieldCheck },
                  { to: '/impressum', label: 'Impressum', Icon: IconDocument },
                  { to: '/lizenzen', label: 'Lizenzen', Icon: IconScale },
                ].map(({ to, label, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setSideNavOpen(false)}
                    className={({ isActive }) =>
                      [
                        'flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors',
                        isActive
                          ? 'text-primary-main font-medium'
                          : 'text-slate-600 hover:bg-slate-50',
                      ].join(' ')
                    }
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    {label}
                  </NavLink>
                ))}
              </nav>

              {/* Desktop sidebar header */}
              <div className="px-2.5 border-b border-slate-200 hidden md:flex items-center justify-between" style={{ height: 51 }}>
                <button
                  type="button"
                  onClick={() => navigate('/katalog')}
                  className="cursor-pointer whitespace-nowrap rounded text-xs font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                  title="Alle Kontrollen anzeigen"
                >
                  Katalog-Explorer
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                  aria-label="Katalog-Explorer ausblenden"
                  title="Katalog-Explorer ausblenden"
                >
                  <IconChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* TreeNav (mobile: below nav links, desktop: main content) */}
              <div className="flex-1 overflow-y-auto py-2">
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
            <div
              className="resize-handle resize-handle--right absolute right-0 top-0 bottom-0 z-20 hidden w-1.5 cursor-col-resize focus-visible:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] md:block"
              onMouseDown={handleSidebarResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Sidebar-Breite anpassen"
              tabIndex={0}
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
          className="flex-1 min-w-0 flex flex-col bg-white md:overflow-hidden"
        >
          <Routes>
              <Route path="/" element={<PageScroll><HomePage /></PageScroll>} />
              <Route path="/katalog" element={<CatalogBrowser />} />
              <Route path="/katalog/:groupId" element={<CatalogBrowser />} />
              <Route path="/suche" element={<SearchPage />} />
              <Route path="/vokabular" element={<PageScroll><VocabularyOverviewPage /></PageScroll>} />
              <Route path="/vokabular/:namespaceId" element={<PageScroll><VocabularyNamespacePage /></PageScroll>} />
              <Route path="/about" element={<PageScroll><AboutPage /></PageScroll>} />
              <Route path="/datenschutz" element={<PageScroll><DatenschutzPage /></PageScroll>} />
              <Route path="/impressum" element={<PageScroll><ImpressumPage /></PageScroll>} />
              <Route path="/lizenzen" element={<PageScroll><LizenzenPage /></PageScroll>} />
              <Route path="/mehr" element={<Navigate to="/about" replace />} />
              <Route
                path="*"
                element={
                  <PageScroll>
                    <div className="p-6">
                      <h1 className="text-xl font-bold text-slate-900">
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
                }
              />
            </Routes>
          <Footer className="hidden lg:block" />
        </main>
      </div>
    </div>
  );
}
