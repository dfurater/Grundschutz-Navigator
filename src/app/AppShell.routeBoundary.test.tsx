import { act, fireEvent, screen, within } from '@testing-library/react';
import { Link } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { expectSingleDocumentTitle } from '@/test/documentTitle';
import { renderAppShell } from '@/test/renderAppShell';
import { NAVIGATION_PENDING_DELAY_MS } from './navigationPending';
import { PAGE_TITLES, PRODUCT_TITLE } from './pageTitles';

/*
 * Client-Navigation und Fehlergrenze der Routen (GSPP-506), mit der echten
 * Routentabelle im Data-Router:
 * - Eine Navigation zu einer Lazy-Seite hält vorige Seite, Titel und Ort, bis
 *   der Router den Chunk geladen hat. Wartet sie länger als die Schwelle,
 *   meldet der Hinweis „Seite wird geladen…“; er liegt außerhalb jedes
 *   Bereichs, der bei offener mobiler Schublade `inert` wird.
 * - Eine weitere Navigation löst die wartende ab; der verspätete Chunk wechselt
 *   die Seite nicht nachträglich.
 * - Ladefehler eines Chunks und Renderfehler einer Kernroute zeigen die
 *   Fehlerfläche innerhalb von `<main>`; die Shell bleibt, und die nächste
 *   Navigation erholt sich.
 *
 * `lazyPage` merkt sich ein aufgelöstes Modul für die ganze Testdatei: Die
 * Suche bleibt gesperrt, bis der letzte Test sie freigibt.
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
  HeaderBar: ({ onMenuToggle }: { onMenuToggle: () => void }) => (
    <header>
      <span>Kopfzeile</span>
      <button type="button" onClick={onMenuToggle}>Menü</button>
      <Link to="/">Zur Startseite (Kopf)</Link>
      <Link to="/suche">Zur Suche</Link>
      <Link to="/about">Zu About</Link>
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
vi.mock('@/features/pages/AboutPage', () => {
  throw new Error('Chunk nicht erreichbar');
});

const PENDING_TEXT = 'Seite wird geladen…';

function renderShell(initialEntry = '/') {
  vi.mocked(useCatalog).mockReturnValue({
    ...catalogCollectionDefaults(),
    catalog: null,
    loading: false,
    error: null,
  } as unknown as ReturnType<typeof useCatalog>);
  return renderAppShell([initialEntry]);
}

/** Der Ladehinweis der Navigation; er liegt außerhalb von `<main>`. */
function pendingStatus(container: HTMLElement): HTMLElement {
  const main = container.querySelector('main')!;
  const status = screen.getAllByRole('status').filter((element) => !main.contains(element));
  expect(status).toHaveLength(1);
  return status[0];
}

async function waitBeyondThreshold() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, NAVIGATION_PENDING_DELAY_MS + 50)); });
}

describe('AppShell: Navigation und Fehlergrenze', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    control.catalogThrows = false;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('löst eine wartende Navigation durch eine weitere ab und räumt den Hinweis', async () => {
    const { container, router } = renderShell('/');
    const status = pendingStatus(container);

    fireEvent.click(screen.getByRole('link', { name: 'Zur Suche' }));
    await waitBeyondThreshold();
    expect(status).toHaveTextContent(PENDING_TEXT);

    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Zum Katalog' })); });

    expect(screen.getByRole('heading', { name: 'Katalogseite' })).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(router.state.location.pathname).toBe('/katalog/gspp');
  });

  it('meldet auch eine Navigation ohne Link (Programm, Tastenkürzel)', async () => {
    const { container, router } = renderShell('/');
    const status = pendingStatus(container);

    act(() => { void router.navigate('/suche'); });
    await waitBeyondThreshold();

    expect(status).toHaveTextContent(PENDING_TEXT);
    expect(screen.getByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');

    await act(async () => { await router.navigate('/'); });
    expect(status).toBeEmptyDOMElement();
  });

  it('zeigt einen Ladefehler bei Client-Navigation in main, räumt den Hinweis und erholt sich', async () => {
    const { container } = renderShell('/');
    const status = pendingStatus(container);

    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Zu About' })); });

    const alert = await screen.findByRole('alert');
    expect(container.querySelector('main')).toContainElement(alert);
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByText('Kopfzeile')).toBeInTheDocument();
    expect(screen.queryByText(/Chunk nicht erreichbar/)).not.toBeInTheDocument();
    expectSingleDocumentTitle(`${PAGE_TITLES.about} | ${PRODUCT_TITLE}`);

    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Zur Startseite (Kopf)' })); });

    expect(screen.getByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('zeigt einen Ladefehler beim Direktaufruf in main', async () => {
    const { container } = renderShell('/about');

    const alert = await screen.findByRole('alert');
    expect(container.querySelector('main')).toContainElement(alert);
    expect(within(alert).getByRole('heading', { level: 1, name: 'Seite konnte nicht geladen werden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
    expectSingleDocumentTitle(`${PAGE_TITLES.about} | ${PRODUCT_TITLE}`);
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
    expect(consoleError).toHaveBeenCalled();
  });

  it('erholt sich vom Kernroutenfehler beim Wechsel auf einen anderen Pfad', async () => {
    control.catalogThrows = true;
    renderShell('/katalog/gspp');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Zur Startseite (Kopf)' })); });

    expect(screen.getByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Zuletzt: Gibt die Suche für den Rest der Datei frei.
  it('hält bei der Navigation zu einer ladenden Lazy-Seite die vorige Seite und meldet das Warten nach der Schwelle', async () => {
    const { container, router } = renderShell('/');
    expectSingleDocumentTitle(PRODUCT_TITLE);
    const status = pendingStatus(container);
    expect(status).toBeEmptyDOMElement();

    // Offene mobile Schublade: <main> ist inert, der Hinweis darf es nicht sein.
    fireEvent.click(screen.getByRole('button', { name: 'Menü' }));
    expect(container.querySelector('main')).toHaveAttribute('inert');
    expect(status.closest('[inert]')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Zur Suche' }));

    // Chunk gesperrt: weiter Startseite, Titel und Ort; vor der Schwelle kein Hinweis.
    expect(screen.getByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(router.state.navigation.state).toBe('loading');
    expect(router.state.location.pathname).toBe('/');

    await waitBeyondThreshold();
    expect(status).toHaveTextContent(PENDING_TEXT);
    expect(screen.getByRole('heading', { name: 'Startseite' })).toBeInTheDocument();
    expect(within(container.querySelector('main')!).queryByRole('status')).not.toBeInTheDocument();
    expectSingleDocumentTitle(PRODUCT_TITLE);

    await act(async () => { control.openSearch(); });

    expect(await screen.findByRole('heading', { name: 'Suchseite' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Startseite' })).not.toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(router.state.location.pathname).toBe('/suche');
    expectSingleDocumentTitle(`${PAGE_TITLES.search} | ${PRODUCT_TITLE}`);
  });
});
