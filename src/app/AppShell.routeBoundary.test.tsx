import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, UNSAFE_createMemoryHistory } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { expectSingleDocumentTitle } from '@/test/documentTitle';
import { AppShell } from './AppShell';
import { NAVIGATION_PENDING_DELAY_MS, TransitionRouter } from './navigationPending';
import { PRODUCT_TITLE } from './pageTitles';

/*
 * Die eine Grenze um alle Routen in `<main>` (GSPP-506), Client-Navigation:
 * - Eine Navigation zu einer Lazy-Seite hält die vorige Seite samt Titel, bis der
 *   Chunk eintrifft; der Ladezustand der Grenze erscheint nicht. Ein neu
 *   gemounteter Suspense-Rand würde ihn zeigen, und React hielte ihn mindestens
 *   300 ms. Wartet die Navigation länger als die Schwelle, meldet der Hinweis in
 *   `<main>` „Seite wird geladen…“, bis die Seite steht.
 * - Ein Renderfehler einer eager Kernroute zeigt die Fehlerfläche innerhalb von
 *   `<main>`; die Shell bleibt, und der nächste Pfad erholt sich.
 *
 * `lazy()` merkt sich ein aufgelöstes Modul für die ganze Testdatei: Die Suche
 * wird hier genau einmal aufgelöst.
 */

const control = vi.hoisted(() => {
  let open: () => void = () => {};
  const searchOpened = new Promise<void>((resolve) => { open = resolve; });
  return { searchOpened, openSearch: open, catalogThrows: false };
});

vi.mock('@/hooks/useCatalog', () => ({ useCatalog: vi.fn() }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('@/components/TreeNav', () => ({ TreeNav: () => <nav aria-label="TreeNav">TreeNav</nav> }));
vi.mock('@/components/Footer', () => ({ Footer: () => <footer>Fußzeile</footer> }));
vi.mock('@/components/HeaderBar', () => ({
  HeaderBar: () => (
    <header>
      <span>Kopfzeile</span>
      <Link to="/">Zur Startseite (Kopf)</Link>
      <Link to="/suche">Zur Suche</Link>
      <Link to="/katalog/gspp">Zum Katalog</Link>
    </header>
  ),
}));
vi.mock('@/features/home/HomePage', () => ({ HomePage: () => <h1>Startseite</h1> }));
vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => {
    if (control.catalogThrows) throw new Error('Renderfehler im Katalog');
    return <h1>Katalogseite</h1>;
  },
}));
vi.mock('@/features/search/SearchPage', async () => {
  await control.searchOpened;
  return { SearchPage: () => <h1>Suchseite</h1> };
});

function renderShell(initialEntry = '/') {
  vi.mocked(useCatalog).mockReturnValue({
    ...catalogCollectionDefaults(),
    catalog: null,
    loading: false,
    error: null,
  } as unknown as ReturnType<typeof useCatalog>);
  const history = UNSAFE_createMemoryHistory({ initialEntries: [initialEntry], v5Compat: true });
  return render(
    <TransitionRouter history={history}>
      <AppShell />
    </TransitionRouter>,
  );
}

describe('AppShell: Grenze um alle Routen', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    control.catalogThrows = false;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('hält bei der Navigation zu einer ladenden Lazy-Seite die vorige Seite und meldet das Warten nach der Schwelle', async () => {
    const { container } = renderShell('/');
    expect(screen.getByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expectSingleDocumentTitle(PRODUCT_TITLE);
    const status = screen.getByRole('status');
    expect(container.querySelector('main')).toContainElement(status);
    expect(status).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('link', { name: 'Zur Suche' }));

    // Chunk gesperrt: weiter die Startseite samt Titel, kein Fallback der Grenze.
    expect(screen.getByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Suchseite' })).not.toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expectSingleDocumentTitle(PRODUCT_TITLE);

    // Über die Schwelle hinaus gesperrt: Der Hinweis erscheint, die Startseite bleibt bedienbar.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, NAVIGATION_PENDING_DELAY_MS + 50)); });
    expect(status).toHaveTextContent('Seite wird geladen…');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expectSingleDocumentTitle(PRODUCT_TITLE);

    await act(async () => { control.openSearch(); });

    expect(await screen.findByRole('heading', { name: 'Suchseite' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Startseite' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expectSingleDocumentTitle(`Suche | ${PRODUCT_TITLE}`);
  });

  it('zeigt den Renderfehler einer Kernroute innerhalb von main, die Shell bleibt', async () => {
    control.catalogThrows = true;
    const { container } = renderShell('/katalog/gspp');

    const alert = await screen.findByRole('alert');
    expect(container.querySelector('main')).toContainElement(alert);
    expect(screen.getByRole('heading', { level: 1, name: 'Seite konnte nicht geladen werden' })).toBeInTheDocument();
    expect(screen.getByText('Kopfzeile')).toBeInTheDocument();
    expect(screen.getByText('Fußzeile')).toBeInTheDocument();
    expect(screen.queryByText(/Renderfehler im Katalog/)).not.toBeInTheDocument();
    expectSingleDocumentTitle(PRODUCT_TITLE);
  });

  it('erholt sich vom Kernroutenfehler beim Wechsel auf einen anderen Pfad', async () => {
    control.catalogThrows = true;
    renderShell('/katalog/gspp');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Zur Startseite (Kopf)' }));

    expect(await screen.findByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
