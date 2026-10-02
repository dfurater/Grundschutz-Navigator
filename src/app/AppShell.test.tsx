import { fireEvent, render, screen } from '@testing-library/react';
import type { RefObject } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { AppShell } from './AppShell';
import { STATIC_PAGE_ROUTES } from './staticPageRoutes';
import { PAGE_TITLES, PRODUCT_TITLE } from './pageTitles';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { expectSingleDocumentTitle } from '@/test/documentTitle';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

vi.mock('@/components/HeaderBar', () => ({
  HeaderBar: ({
    onMenuToggle,
    menuExpanded,
    menuControls,
    menuButtonRef,
    catalogSwitcherOpen,
    onCatalogSwitcherOpenChange,
  }: {
    onMenuToggle: () => void;
    menuExpanded?: boolean;
    menuControls?: string;
    menuButtonRef?: RefObject<HTMLButtonElement | null>;
    onSearch: (term: string) => void;
    catalogSwitcherOpen: boolean;
    onCatalogSwitcherOpenChange: (open: boolean) => void;
  }) => (
    <>
      <button type="button" ref={menuButtonRef} aria-expanded={menuExpanded} aria-controls={menuControls} onClick={onMenuToggle}>
        Menu
      </button>
      <button
        type="button"
        onClick={() => onCatalogSwitcherOpenChange(!catalogSwitcherOpen)}
      >
        Katalog wechseln
      </button>
      <output data-testid="catalog-switcher-open">{String(catalogSwitcherOpen)}</output>
    </>
  ),
}));

vi.mock('@/components/TreeNav', () => ({
  TreeNav: () => <nav aria-label="TreeNav">TreeNav</nav>,
}));

vi.mock('@/components/Footer', () => ({
  Footer: ({ className = '' }: { className?: string }) => (
    <footer className={className}>Footer</footer>
  ),
}));

vi.mock('@/features/home/HomePage', () => ({
  HomePage: () => <div>Home</div>,
}));

vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => <div data-testid="catalog-browser">Katalog</div>,
}));

vi.mock('@/features/search/SearchPage', () => ({
  SearchPage: () => <div>Suche</div>,
}));

vi.mock('@/features/vocabularies/VocabularyOverviewPage', () => ({
  VocabularyOverviewPage: () => <div>Vokabulare Seite</div>,
}));

vi.mock('@/features/vocabularies/VocabularyNamespacePage', () => ({
  VocabularyNamespacePage: () => <div>Vokabular-Detail</div>,
}));

vi.mock('@/features/pages/AboutPage', () => ({
  AboutPage: () => <div>About</div>,
}));

vi.mock('@/features/pages/DatenschutzPage', () => ({
  DatenschutzPage: () => <div>Datenschutz</div>,
}));

vi.mock('@/features/pages/ImpressumPage', () => ({
  ImpressumPage: () => <div>Impressum</div>,
}));

vi.mock('@/features/pages/LizenzenPage', () => ({
  LizenzenPage: () => <div>Lizenzen</div>,
}));


const mockedUseCatalog = vi.mocked(useCatalog);
const mockedUseMediaQuery = vi.mocked(useMediaQuery);

describe('AppShell', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseMediaQuery.mockReset();

    mockedUseCatalog.mockReturnValue({
      ...catalogCollectionDefaults(),
      catalogDocument: null,
      catalog: {
        catalogKey: 'gspp',
        uuid: 'catalog-1',
        metadata: {
          title: 'Grundschutz++',
          lastModified: '2026-03-27T00:00:00Z',
          version: '1.0',
          oscalVersion: '1.1.3',
          props: [],
          links: [],
          roles: [],
          parties: [],
          responsibleParties: [],
        },
        practices: [],
        controlsById: new Map(),
        controlsByAltIdentifier: new Map(),
        controls: [],
        backMatter: [],
        totalControls: 0,
      },
      provenance: null,
      vocabularyRegistry: null,
      vocabularyProvenance: null,
      verification: null,
      vocabularyVerification: null,
      loading: false,
      error: null,
    } as ReturnType<typeof useCatalog>);
    mockedUseMediaQuery.mockReturnValue(false);
  });

  it('makes only the closed mobile drawer inert and links it to the menu button', () => {
    const { container } = render(<MemoryRouter><AppShell /></MemoryRouter>);
    const sidebar = container.querySelector('aside');
    const menuButton = screen.getByRole('button', { name: 'Menu' });

    expect(sidebar).toHaveAttribute('inert');
    expect(sidebar?.id).toBeTruthy();
    expect(menuButton).toHaveAttribute('aria-controls', sidebar?.id);
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(menuButton);
    expect(sidebar).not.toHaveAttribute('inert');
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Menü schließen' }));
    expect(sidebar).toHaveAttribute('inert');
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('makes the main content inert only while mobile navigation is open', () => {
    let persistent = false;
    mockedUseMediaQuery.mockImplementation((query) => query === '(min-width: 768px)' && persistent);
    const view = render(<MemoryRouter><AppShell /></MemoryRouter>);
    const main = view.container.querySelector('main');
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    expect(main).not.toHaveAttribute('inert');

    fireEvent.click(menuButton);
    expect(main).toHaveAttribute('inert');
    persistent = true;
    view.rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(main).not.toHaveAttribute('inert');
    persistent = false;
    view.rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(main).toHaveAttribute('inert');
    fireEvent.keyDown(menuButton, { key: 'Escape' });
    expect(main).not.toHaveAttribute('inert');
  });

  it.each(['close', 'link', 'backdrop'] as const)('returns focus when mobile navigation is dismissed through %s', (method) => {
    const { container } = render(<MemoryRouter><AppShell /></MemoryRouter>);
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menuButton);
    const target = method === 'close'
      ? screen.getByRole('button', { name: 'Menü schließen' })
      : method === 'link' ? screen.getByRole('link', { name: 'Suche' }) : screen.getByTestId('mobile-nav-backdrop');
    if (method === 'backdrop') screen.getByRole('link', { name: 'Suche' }).focus();
    else target.focus();
    const focus = vi.spyOn(menuButton, 'focus');
    fireEvent.click(target);

    expect(container.querySelector('aside')).toHaveAttribute('inert');
    expect(container.querySelector('main')).not.toHaveAttribute('inert');
    expect(menuButton).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it.each(['body', 'menu', 'drawer'] as const)('closes the mobile drawer for Escape from %s and returns focus without scrolling', (origin) => {
    const bubbleHandler = vi.fn();
    const { container } = render(
      <MemoryRouter><div onKeyDown={bubbleHandler}><AppShell /></div></MemoryRouter>,
    );
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menuButton);
    const target = origin === 'body'
      ? document.querySelector('body')!
      : origin === 'menu' ? menuButton : screen.getByRole('button', { name: 'Menü schließen' });
    target.focus();
    const focus = vi.spyOn(menuButton, 'focus');
    const wasNotPrevented = fireEvent.keyDown(target, { key: 'Escape' });

    expect(wasNotPrevented).toBe(false);
    expect(bubbleHandler).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mobile-nav-backdrop')).not.toBeInTheDocument();
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    expect(menuButton).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not consume unrelated keys or Escape while the mobile drawer is closed', () => {
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    expect(fireEvent.keyDown(document.querySelector('body')!, { key: 'Escape' })).toBe(true);

    fireEvent.click(menuButton);
    expect(fireEvent.keyDown(document.querySelector('body')!, { key: 'Enter' })).toBe(true);
    expect(screen.getByTestId('mobile-nav-backdrop')).toBeInTheDocument();
  });

  it('leaves persistent desktop navigation interactive without consuming Escape', () => {
    mockedUseMediaQuery.mockImplementation((query) => query === '(min-width: 768px)');
    const { container } = render(<MemoryRouter><AppShell /></MemoryRouter>);
    const menuButton = screen.getByRole('button', { name: 'Menu' });

    expect(container.querySelector('aside')).not.toHaveAttribute('inert');
    // Auch ein aus einem mobilen Zustand erhaltenes open darf desktop kein Escape besitzen.
    fireEvent.click(menuButton);
    const focus = vi.spyOn(menuButton, 'focus');
    expect(fireEvent.keyDown(document.querySelector('body')!, { key: 'Escape' })).toBe(true);
    expect(focus).not.toHaveBeenCalled();
  });

  it('updates Escape ownership and inert when crossing the navigation breakpoint', () => {
    let persistent = false;
    mockedUseMediaQuery.mockImplementation((query) => query === '(min-width: 768px)' && persistent);
    const app = () => <MemoryRouter><AppShell /></MemoryRouter>;
    const view = render(app());
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menuButton);

    persistent = true;
    view.rerender(app());
    expect(view.container.querySelector('aside')).not.toHaveAttribute('inert');
    expect(fireEvent.keyDown(document.querySelector('body')!, { key: 'Escape' })).toBe(true);

    persistent = false;
    view.rerender(app());
    expect(fireEvent.keyDown(document.querySelector('body')!, { key: 'Escape' })).toBe(false);
    expect(view.container.querySelector('aside')).toHaveAttribute('inert');
    expect(menuButton).toHaveFocus();

    persistent = true;
    view.rerender(app());
    expect(view.container.querySelector('aside')).not.toHaveAttribute('inert');
    expect(fireEvent.keyDown(document.querySelector('body')!, { key: 'Escape' })).toBe(true);
  });

  it('überblendet die Drawer-Bewegung über translate und schaltet sie bei Reduced Motion ab', () => {
    const { container, rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    const sidebar = container.querySelector('aside');
    expect(sidebar).toHaveStyle({
      transition: 'width var(--duration-normal) var(--easing-default), translate var(--duration-normal) var(--easing-default)',
    });

    mockedUseMediaQuery.mockReturnValue(true);

    rerender(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(container.querySelector('aside')).toHaveStyle({ transition: 'none' });
  });

  it('uses focus-visible rings for sidebar controls and the 404 link', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/missing']}>
        <AppShell />
      </MemoryRouter>,
    );

    const explorerButton = screen.getByRole('button', { name: 'Katalog-Explorer' });
    const collapseButton = screen.getByRole('button', { name: 'Katalog-Explorer ausblenden' });
    const resizeHandle = screen.getByRole('button', { name: 'Sidebar-Breite anpassen' });
    const homeLink = screen.getByRole('link', { name: 'Zur Startseite' });

    expect(explorerButton.className).toContain('focus-visible:ring-2');
    expect(collapseButton.className).toContain('focus-visible:ring-2');
    expect(resizeHandle.className).toContain('focus-visible:ring-2');
    expect(homeLink.className).toContain('focus-visible:ring-2');

    fireEvent.click(collapseButton);

    expect(screen.getByRole('button', { name: 'Katalog-Explorer einblenden' }).className).toContain('focus-visible:ring-2');
    expect(container.querySelector('aside')).toBeInTheDocument();
  });

  // Deckt jede statische Route ab: keine Route kann ohne geprüften Titel
  // hinzukommen, weil sie sonst gar nicht in STATIC_PAGE_ROUTES steht.
  it.each(STATIC_PAGE_ROUTES.map(({ path, title }) => ({ path, title })))(
    'gives the static route $path its declared document title',
    ({ path, title }) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <AppShell />
        </MemoryRouter>,
      );

      expectSingleDocumentTitle(
        title === undefined ? PRODUCT_TITLE : `${title} — ${PRODUCT_TITLE}`,
      );
    },
  );

  it('covers every static page route the shell renders', () => {
    expect(STATIC_PAGE_ROUTES.map(({ path }) => path)).toEqual([
      '/',
      '/suche',
      '/vokabular',
      '/about',
      '/datenschutz',
      '/impressum',
      '/lizenzen',
    ]);
  });

  it('registers vocabulary routes and document titles', () => {
    render(
      <MemoryRouter initialEntries={['/vokabular']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByText('Vokabulare Seite')).toBeInTheDocument();
    expectSingleDocumentTitle(`${PAGE_TITLES.vocabularies} — ${PRODUCT_TITLE}`);
  });

  it('titles the /mehr redirect with its destination', () => {
    render(
      <MemoryRouter initialEntries={['/mehr']}>
        <AppShell />
      </MemoryRouter>,
    );

    expectSingleDocumentTitle(`${PAGE_TITLES.about} — ${PRODUCT_TITLE}`);
  });

  it('registers vocabulary detail routes', () => {
    render(
      <MemoryRouter initialEntries={['/vokabular/security-level']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByText('Vokabular-Detail')).toBeInTheDocument();
  });

  it('uses a specific title for the general catch-all route', () => {
    render(
      <MemoryRouter initialEntries={['/missing']}>
        <AppShell />
      </MemoryRouter>,
    );

    expectSingleDocumentTitle(`${PAGE_TITLES.notFound} — ${PRODUCT_TITLE}`);
  });

  it('renders the footer without hiding it below desktop breakpoints', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByText('Footer')).not.toHaveClass('hidden');
  });

  it('keeps only primary mobile destinations in the drawer', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('navigation', { name: 'Sektionen' }))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Katalog' })).toHaveAttribute(
      'href',
      '/katalog/gspp',
    );
    expect(screen.getByRole('link', { name: 'Suche' })).toHaveAttribute(
      'href',
      '/suche',
    );
    expect(screen.queryByRole('navigation', { name: 'Weitere Seiten' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Datenschutz' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Impressum' }))
      .not.toBeInTheDocument();
  });

  // Das Switcher-Menü sitzt im Stacking-Context des Headers und bliebe hinter
  // dem Drawer. Statt eines z-index-Eingriffs weicht mobil der Drawer — über
  // denselben State, den Backdrop, X-Schalter und Tree-Auswahl schon nutzen,
  // und damit über die bestehende transform-Transition des `aside` (GSPP-440).
  it('schließt den mobilen Drawer, sobald der Katalog-Switcher öffnet', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(container.querySelector('aside')?.className).not.toContain('-translate-x-full');
    expect(screen.getByTestId('mobile-nav-backdrop')).toBeInTheDocument();
    // Safari 26 liest keine Farbe vom festen Element selbst (BackdropTint, GSPP-447).
    expect(screen.getByTestId('mobile-nav-backdrop').className).not.toMatch(/\bbg-/);

    fireEvent.click(screen.getByRole('button', { name: 'Katalog wechseln' }));

    expect(screen.getByTestId('catalog-switcher-open')).toHaveTextContent('true');
    expect(container.querySelector('aside')?.className).toContain('-translate-x-full');
    expect(screen.queryByTestId('mobile-nav-backdrop')).not.toBeInTheDocument();
  });

  // Gegenrichtung über denselben gemeinsamen Zustand. Der Hamburger löst bei
  // Maus wie bei Tastatur denselben onClick-Pfad aus; der Outside-`mousedown`
  // des Switchers erreicht die Tastaturaktivierung nicht und ließe beide
  // Overlays offen (GSPP-440).
  it('schließt das Katalog-Switcher-Menü, sobald der mobile Drawer öffnet', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Katalog wechseln' }));
    expect(screen.getByTestId('catalog-switcher-open')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByTestId('catalog-switcher-open')).toHaveTextContent('false');
    expect(container.querySelector('aside')?.className).not.toContain('-translate-x-full');
    expect(screen.getByTestId('mobile-nav-backdrop')).toBeInTheDocument();
  });

  it('registers the canonical catalog-scoped control route', () => {
    render(
      <MemoryRouter initialEntries={['/katalog/gspp/kontrolle/stable-alt-id']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('catalog-browser')).toBeInTheDocument();
  });

  /* ---------------------------------------------------------------- */
  /*  Mehr-Katalog-Navigation (GSPP-284)                                */
  /* ---------------------------------------------------------------- */

  it('meldet den Routen-catalogKey an die Katalogauswahl', () => {
    const selectCatalog = vi.fn();
    mockedUseCatalog.mockReturnValue({
      ...mockedUseCatalog(),
      selectCatalog,
    });

    render(
      <MemoryRouter initialEntries={['/katalog/wlan/kontrolle/stable-alt-id']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(selectCatalog).toHaveBeenCalledWith('wlan');
  });

  it('folgt dem geladenen Routen-Katalog statt auf den Einstieg zurückzufallen', () => {
    const base = mockedUseCatalog();
    mockedUseCatalog.mockReturnValue({
      ...base,
      activeCatalogKey: 'wlan',
      catalog: base.catalog ? { ...base.catalog, catalogKey: 'wlan' } : null,
    });

    render(
      <MemoryRouter initialEntries={['/katalog/wlan']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Katalog' })).toHaveAttribute(
      'href',
      '/katalog/wlan',
    );
  });

  it('hält die Navigation beim ausgewählten Katalog, solange er noch lädt', () => {
    mockedUseCatalog.mockReturnValue({
      ...mockedUseCatalog(),
      activeCatalogKey: 'wlan',
      catalog: null,
      catalogDocument: null,
      loading: true,
    });

    render(
      <MemoryRouter initialEntries={['/katalog/wlan']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Katalog' })).toHaveAttribute(
      'href',
      '/katalog/wlan',
    );
  });

  it('does not register or redirect the unscoped catalog route', () => {
    render(
      <MemoryRouter initialEntries={['/katalog']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: '404 — Seite nicht gefunden' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-browser')).not.toBeInTheDocument();
  });
});
