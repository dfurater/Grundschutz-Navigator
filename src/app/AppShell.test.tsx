import { act, fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import type { RefObject } from 'react';
import { Link, MemoryRouter, useNavigate } from 'react-router';
import type { NavigateFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { OWN_SCROLL_AREA_QUERY } from '@/hooks/breakpointQueries';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { MobileNavigationContext } from '@/state/MobileNavigationContext';
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
    obscured,
  }: {
    onMenuToggle: () => void;
    obscured?: boolean;
    menuExpanded?: boolean;
    menuControls?: string;
    menuButtonRef?: RefObject<HTMLButtonElement | null>;
    onSearch: (term: string) => void;
  }) => (
    <>
      <button type="button" ref={menuButtonRef} aria-expanded={menuExpanded} aria-controls={menuControls} onClick={onMenuToggle}>
        Menu
      </button>
      <Link to="/suche" inert={obscured}>Lupe</Link>
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

// Zeigt den Kontextwert, den feste Elemente der Seite auswerten (GSPP-494).
vi.mock('@/features/home/HomePage', () => ({
  HomePage: () => {
    const fixedElementsHidden = useContext(MobileNavigationContext);
    return <div data-fixed-elements-hidden={String(fixedElementsHidden)}>Home</div>;
  },
}));

const catalogBrowserMock = vi.hoisted(() => ({ focusHeadingOnMount: false }));

vi.mock('@/features/catalog/CatalogBrowser', async () => {
  const { useLayoutEffect, useRef } = await import('react');
  // Setzt den Fokus wie `useDocumentDetailPage` in einem Layout-Effekt, der als
  // Kind-Effekt vor denen der Shell läuft.
  function DetailHeading() {
    const ref = useRef<HTMLHeadingElement>(null);
    useLayoutEffect(() => { ref.current?.focus(); }, []);
    return <h2 ref={ref} tabIndex={-1}>Detailüberschrift</h2>;
  }
  return {
    CatalogBrowser: () => (
      <div data-testid="catalog-browser">
        Katalog
        {catalogBrowserMock.focusHeadingOnMount && <DetailHeading />}
      </div>
    ),
  };
});

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

const CATALOG_DIRECTORY = [
  { catalogKey: 'gspp', title: 'Anwenderkatalog Grundschutz++' },
  { catalogKey: 'lieferkette', title: 'Supply Chain Security' },
  { catalogKey: 'wlan', title: 'Stand der Technik WLAN' },
] as const;

const scopeTrigger = (title = 'Anwenderkatalog Grundschutz++') =>
  screen.getByRole('button', { name: `Katalog: ${title}` });

describe('AppShell', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseMediaQuery.mockReset();

    mockedUseCatalog.mockReturnValue({
      ...catalogCollectionDefaults(),
      catalogDirectory: CATALOG_DIRECTORY,
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

  it('moves focus from main to the menu before a click makes main inert', () => {
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    const main = screen.getByRole('main');
    main.tabIndex = -1;
    main.focus();
    expect(main).toHaveFocus();
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    const focus = vi.spyOn(menuButton, 'focus');

    // fireEvent.click setzt wie Safari keinen Klickfokus auf den Button.
    fireEvent.click(menuButton);

    expect(main).toHaveAttribute('inert');
    expect(menuButton).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('makes the main content inert only while mobile navigation is open', () => {
    let persistent = false;
    mockedUseMediaQuery.mockImplementation((query) => query === OWN_SCROLL_AREA_QUERY && persistent);
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

  it('nimmt die verdeckten Steuerungen des App-Kopfs nur bei offener mobiler Navigation aus der Bedienung', () => {
    let persistent = false;
    mockedUseMediaQuery.mockImplementation((query) => query === OWN_SCROLL_AREA_QUERY && persistent);
    const view = render(<MemoryRouter><AppShell /></MemoryRouter>);
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    const magnifier = screen.getByText('Lupe');
    expect(magnifier).not.toHaveAttribute('inert');

    fireEvent.click(menuButton);
    expect(magnifier).toHaveAttribute('inert');
    expect(menuButton).not.toHaveAttribute('inert');
    persistent = true;
    view.rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    expect(magnifier).not.toHaveAttribute('inert');
    persistent = false;
    view.rerender(<MemoryRouter><AppShell /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Menü schließen' }));
    expect(magnifier).not.toHaveAttribute('inert');
  });

  it.each(['close', 'selection', 'backdrop'] as const)('returns focus when mobile navigation is dismissed through %s', (method) => {
    const { container } = render(<MemoryRouter><AppShell /></MemoryRouter>);
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menuButton);
    if (method === 'selection') fireEvent.click(scopeTrigger());
    const target = method === 'close'
      ? screen.getByRole('button', { name: 'Menü schließen' })
      : method === 'selection'
        ? screen.getByRole('menuitemradio', { name: 'Stand der Technik WLAN' })
        : screen.getByTestId('mobile-nav-backdrop');
    if (method === 'backdrop') screen.getByRole('button', { name: 'Menü schließen' }).focus();
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
    expect(screen.getByTestId('mobile-nav-backdrop')).toHaveAttribute('data-state', 'closed');
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    expect(menuButton).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('hides fixed page elements until the drawer has finished sliding out (GSPP-494)', () => {
    const { container } = render(<MemoryRouter><AppShell /></MemoryRouter>);
    const hidden = () => screen.getByText('Home').getAttribute('data-fixed-elements-hidden');
    expect(hidden()).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(hidden()).toBe('true');

    // Das Schließen setzt den Zielzustand sofort, `main` gleitet aber noch zurück.
    fireEvent.click(screen.getByRole('button', { name: 'Menü schließen' }));
    expect(screen.getByTestId('mobile-nav-backdrop')).toHaveAttribute('data-state', 'closed');
    expect(hidden()).toBe('true');

    const drawer = container.querySelector('aside')!;
    const slideEnd = new Event('transitionend', { bubbles: true });
    Object.defineProperty(slideEnd, 'propertyName', { value: 'translate' });
    act(() => { drawer.dispatchEvent(slideEnd); });
    expect(hidden()).toBe('false');
  });

  it('does not consume unrelated keys or Escape while the mobile drawer is closed', () => {
    render(<MemoryRouter><AppShell /></MemoryRouter>);
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    expect(fireEvent.keyDown(document.querySelector('body')!, { key: 'Escape' })).toBe(true);

    fireEvent.click(menuButton);
    expect(fireEvent.keyDown(document.querySelector('body')!, { key: 'Enter' })).toBe(true);
    expect(screen.getByTestId('mobile-nav-backdrop')).toHaveAttribute('data-state', 'open');
  });

  it('leaves persistent desktop navigation interactive without consuming Escape', () => {
    mockedUseMediaQuery.mockImplementation((query) => query === OWN_SCROLL_AREA_QUERY);
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
    mockedUseMediaQuery.mockImplementation((query) => query === OWN_SCROLL_AREA_QUERY && persistent);
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

    // Mobil folgt die Breite derselben Bewegung wie die verschobene Seite.
    const sidebar = container.querySelector('aside');
    expect(sidebar).toHaveStyle({
      transition: 'width var(--mobile-nav-motion), translate var(--mobile-nav-motion)',
    });

    mockedUseMediaQuery.mockReturnValue(true);

    rerender(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(container.querySelector('aside')).toHaveStyle({ transition: 'none' });
  });

  it('setzt den Drawer beim Schließen während eines aktiven Resizes sofort zurück', () => {
    const originalScrollY = Object.getOwnPropertyDescriptor(globalThis, 'scrollY');
    const scrollToSpy = vi.spyOn(globalThis, 'scrollTo').mockImplementation(() => {});
    let persistent = true;
    mockedUseMediaQuery.mockImplementation((query) => query === OWN_SCROLL_AREA_QUERY && persistent);
    const app = () => <MemoryRouter><AppShell /></MemoryRouter>;

    try {
      const view = render(app());
      const sidebar = view.container.querySelector('aside')!;
      fireEvent.mouseDown(screen.getByRole('button', { name: 'Sidebar-Breite anpassen' }), {
        button: 0,
        clientX: 320,
      });

      persistent = false;
      view.rerender(app());
      expect(sidebar).toHaveStyle({ transition: 'none' });

      Object.defineProperty(globalThis, 'scrollY', { configurable: true, value: 640 });
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
      expect(sidebar).toHaveStyle({ top: '640px' });

      fireEvent.click(screen.getByRole('button', { name: 'Menü schließen' }));

      expect(sidebar).toHaveStyle({ top: '0px' });
    } finally {
      fireEvent.mouseUp(document);
      scrollToSpy.mockRestore();
      if (originalScrollY) Object.defineProperty(globalThis, 'scrollY', originalScrollY);
      else Reflect.deleteProperty(globalThis, 'scrollY');
    }
  });

  it('uses focus-visible rings for sidebar controls and the 404 link', () => {
    mockedUseMediaQuery.mockImplementation((query) => query === OWN_SCROLL_AREA_QUERY);
    const { container } = render(
      <MemoryRouter initialEntries={['/missing']}>
        <AppShell />
      </MemoryRouter>,
    );

    const explorerButton = scopeTrigger();
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
        title === undefined ? PRODUCT_TITLE : `${title} | ${PRODUCT_TITLE}`,
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
    expectSingleDocumentTitle(`${PAGE_TITLES.vocabularies} | ${PRODUCT_TITLE}`);
  });

  it('titles the /mehr redirect with its destination', () => {
    render(
      <MemoryRouter initialEntries={['/mehr']}>
        <AppShell />
      </MemoryRouter>,
    );

    expectSingleDocumentTitle(`${PAGE_TITLES.about} | ${PRODUCT_TITLE}`);
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

    expectSingleDocumentTitle(`${PAGE_TITLES.notFound} | ${PRODUCT_TITLE}`);
  });

  it('renders the footer without hiding it below desktop breakpoints', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByText('Footer')).not.toHaveClass('hidden');
  });

  // Die Kontextwahl ist der Kopf des Drawers; „Katalog“ war derselbe Link wie
  // der aktive Katalog, „Suche“ steht im Header (GSPP-476).
  it('führt im Drawer die Kontextwahl statt einer Sektionsnavigation', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    const aside = container.querySelector('aside')!;
    expect(aside).toContainElement(scopeTrigger());
    expect(aside).toContainElement(screen.getByRole('button', { name: 'Menü schließen' }));
    expect(screen.queryByRole('navigation', { name: 'Sektionen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Suche' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Katalog' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Datenschutz' })).not.toBeInTheDocument();
    expect(aside.querySelectorAll('svg')).toHaveLength(2);
  });

  // Eine Navigation aus dem App-Kopf bei offenem Drawer ließe die neue Seite
  // sonst im inerten Hauptbereich zurück (GSPP-476).
  it('schließt den Drawer bei jeder Navigation, auch aus dem App-Kopf', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const lupe = screen.getByRole('link', { name: 'Lupe' });
    lupe.focus();
    fireEvent.click(lupe);

    expect(screen.getByText('Suche')).toBeInTheDocument();
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    expect(container.querySelector('main')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('mobile-nav-backdrop')).toHaveAttribute('data-state', 'closed');
    expect(lupe).toHaveFocus();
  });

  // Browser-Zurück hat kein auslösendes Element; lag der Fokus in der
  // Schublade, ginge er mit `inert` verloren (GSPP-476).
  it('gibt den Fokus ans Menü-Symbol, wenn eine Navigation den Drawer mit Fokus darin schließt', () => {
    let navigateTo: NavigateFunction = () => {};
    function NavigateProbe() {
      navigateTo = useNavigate();
      return null;
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/', '/katalog/gspp']} initialIndex={1}>
        <AppShell />
        <NavigateProbe />
      </MemoryRouter>,
    );
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menuButton);
    screen.getByRole('button', { name: 'Menü schließen' }).focus();

    act(() => { void navigateTo(-1); });

    expect(container.querySelector('aside')).toHaveAttribute('inert');
    expect(menuButton).toHaveFocus();
  });

  // Browser-Zurück und -Vorwärts verwenden den `location.key` eines Eintrags
  // wieder; die Fokusrückgabe muss trotzdem bei jedem Schließen greifen.
  it('gibt den Fokus auch beim wiederholten Zurück zur selben Verlaufseite ans Menü-Symbol', () => {
    let navigateTo: NavigateFunction = () => {};
    function NavigateProbe() {
      navigateTo = useNavigate();
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/', '/katalog/gspp']} initialIndex={1}>
        <AppShell />
        <NavigateProbe />
      </MemoryRouter>,
    );
    const menuButton = screen.getByRole('button', { name: 'Menu' });

    for (let round = 0; round < 2; round++) {
      fireEvent.click(menuButton);
      screen.getByRole('button', { name: 'Menü schließen' }).focus();
      act(() => { void navigateTo(-1); });
      expect(menuButton).toHaveFocus();
      act(() => { void navigateTo(1); });
    }
  });

  it('lässt den Fokus auf der neuen Seite, wenn sie ihn beim Schließen des Drawers selbst setzt', () => {
    catalogBrowserMock.focusHeadingOnMount = true;
    let navigateTo: NavigateFunction = () => {};
    function NavigateProbe() {
      navigateTo = useNavigate();
      return null;
    }
    try {
      const { container } = render(
        <MemoryRouter initialEntries={['/']}>
          <AppShell />
          <NavigateProbe />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
      screen.getByRole('button', { name: 'Menü schließen' }).focus();

      act(() => { void navigateTo('/katalog/gspp'); });

      expect(container.querySelector('aside')).toHaveAttribute('inert');
      expect(screen.getByRole('heading', { name: 'Detailüberschrift' })).toHaveFocus();
    } finally {
      catalogBrowserMock.focusHeadingOnMount = false;
    }
  });

  it('lässt den Fokus auch beim wiederholten Zurück auf der Seite, die ihn selbst setzt', () => {
    catalogBrowserMock.focusHeadingOnMount = true;
    let navigateTo: NavigateFunction = () => {};
    function NavigateProbe() {
      navigateTo = useNavigate();
      return null;
    }
    try {
      render(
        <MemoryRouter initialEntries={['/katalog/gspp', '/']} initialIndex={1}>
          <AppShell />
          <NavigateProbe />
        </MemoryRouter>,
      );
      const menuButton = screen.getByRole('button', { name: 'Menu' });

      for (let round = 0; round < 2; round++) {
        fireEvent.click(menuButton);
        screen.getByRole('button', { name: 'Menü schließen' }).focus();
        act(() => { void navigateTo(-1); });
        expect(screen.getByRole('heading', { name: 'Detailüberschrift' })).toHaveFocus();
        act(() => { void navigateTo(1); });
      }
    } finally {
      catalogBrowserMock.focusHeadingOnMount = false;
    }
  });

  it('wechselt den Katalog aus dem Drawer-Kopf und schließt den Drawer', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(scopeTrigger());

    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(CATALOG_DIRECTORY.map(({ title }) => title));
    expect(items.map((item) => item.getAttribute('href'))).toEqual([
      '/katalog/gspp',
      '/katalog/lieferkette',
      '/katalog/wlan',
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Supply Chain Security' }));

    expect(screen.getByTestId('catalog-browser')).toBeInTheDocument();
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    expect(screen.getByTestId('mobile-nav-backdrop')).toHaveAttribute('data-state', 'closed');
  });

  // Der Drawer besitzt Escape in der Capture-Phase; ein offenes Menü in seinem
  // Kopf muss trotzdem zuerst schließen (GSPP-476).
  it('schließt mit Escape zuerst das Menü im Drawer-Kopf und erst danach den Drawer', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );
    const menuButton = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menuButton);
    fireEvent.click(scopeTrigger());
    const item = screen.getAllByRole('menuitemradio')[0];
    expect(item).toHaveFocus();

    expect(fireEvent.keyDown(item, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(scopeTrigger()).toHaveFocus();
    expect(container.querySelector('aside')).not.toHaveAttribute('inert');

    fireEvent.keyDown(scopeTrigger(), { key: 'Escape' });
    expect(container.querySelector('aside')).toHaveAttribute('inert');
    expect(menuButton).toHaveFocus();
  });

  it('zeigt die Kontextwahl auf dem Desktop mit Einklappen und ohne Schild in der eingeklappten Leiste', () => {
    mockedUseMediaQuery.mockImplementation((query) => query === OWN_SCROLL_AREA_QUERY);
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(scopeTrigger()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Menü schließen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Katalog-Explorer ausblenden' }));

    expect(screen.queryByRole('button', { name: /^Katalog:/ })).not.toBeInTheDocument();
    expect(container.querySelector('aside')?.querySelectorAll('svg')).toHaveLength(1);
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

    fireEvent.click(scopeTrigger('Stand der Technik WLAN'));
    expect(screen.getByRole('menuitemradio', { name: 'Stand der Technik WLAN' })).toHaveAttribute(
      'aria-checked',
      'true',
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

    fireEvent.click(scopeTrigger('Stand der Technik WLAN'));
    expect(screen.getByRole('menuitemradio', { name: 'Stand der Technik WLAN' })).toHaveAttribute(
      'aria-checked',
      'true',
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
