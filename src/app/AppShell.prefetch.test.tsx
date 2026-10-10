import { act, fireEvent, screen } from '@testing-library/react';
import { Link } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { renderAppShell } from '@/test/renderAppShell';

/*
 * Vorladen bei Navigationsabsicht (GSPP-506): Nach dem Überfahren eines Links ist
 * der Chunk da, und die Client-Navigation rendert die Seite, ohne erneut zu laden
 * und ohne Ladehinweis. Ohne Absicht lädt sie erst beim Klick, die vorige Seite
 * bleibt bis dahin stehen.
 *
 * `lazyPage` merkt sich ein aufgelöstes Modul für die ganze Testdatei: Suche und
 * Vokabulardetail (mit Vorladen), Impressum und Übersicht (ohne) werden je einmal
 * aufgelöst.
 */

const gates = vi.hoisted(() => {
  const gate = () => {
    let open: () => void = () => {};
    const opened = new Promise<void>((resolve) => { open = resolve; });
    return { opened, open, loads: 0 };
  };
  return { search: gate(), detail: gate(), imprint: gate() };
});

vi.mock('@/hooks/useCatalog', () => ({ useCatalog: vi.fn() }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('@/components/TreeNav', () => ({ TreeNav: () => null }));
vi.mock('@/components/Footer', () => ({ Footer: () => <footer>Fußzeile</footer> }));
vi.mock('@/components/HeaderBar', () => ({
  HeaderBar: () => (
    <header>
      <Link to="/suche">Zur Suche</Link>
      <Link to="/vokabular/security-level">Zum Detail</Link>
      <Link to="/impressum">Zum Impressum</Link>
    </header>
  ),
}));
vi.mock('@/features/home/HomePage', () => ({ HomePage: () => <h1>Startseite</h1> }));
vi.mock('@/features/catalog/CatalogBrowser', () => ({ CatalogBrowser: () => <h1>Katalog</h1> }));
vi.mock('@/features/search/SearchPage', async () => {
  gates.search.loads += 1;
  await gates.search.opened;
  return { SearchPage: () => <h1>Suchseite</h1> };
});
vi.mock('@/features/vocabularies/VocabularyNamespacePage', async () => {
  gates.detail.loads += 1;
  await gates.detail.opened;
  return { VocabularyNamespacePage: () => <h1>Vokabulardetail</h1> };
});
vi.mock('@/features/pages/ImpressumPage', async () => {
  gates.imprint.loads += 1;
  await gates.imprint.opened;
  return { ImpressumPage: () => <h1>Impressumseite</h1> };
});

function renderShell() {
  vi.mocked(useCatalog).mockReturnValue({
    ...catalogCollectionDefaults(),
    catalog: null,
    loading: false,
    error: null,
  } as unknown as ReturnType<typeof useCatalog>);
  return renderAppShell(['/']);
}

describe('AppShell: Vorladen bei Navigationsabsicht', () => {
  it('lädt beim Start nichts vor', () => {
    renderShell();

    expect(gates.search.loads + gates.detail.loads + gates.imprint.loads).toBe(0);
  });

  it('rendert eine Lazy-Seite nach dem Überfahren ihres Links beim Klick ohne Wartezeit', async () => {
    renderShell();
    const link = screen.getByRole('link', { name: 'Zur Suche' });

    fireEvent.pointerOver(link);
    await vi.waitFor(() => expect(gates.search.loads).toBe(1));
    await act(async () => { gates.search.open(); });
    fireEvent.pointerOver(link);
    await act(async () => { fireEvent.click(link); });

    // Ohne Netzwerk: Seite da, kein Ladehinweis, kein zweites Laden.
    expect(screen.getByRole('heading', { name: 'Suchseite' })).toBeInTheDocument();
    expect(screen.queryByText('Seite wird geladen…')).not.toBeInTheDocument();
    expect(gates.search.loads).toBe(1);
  });

  it('lädt das Vokabulardetail bei Tastaturfokus vor und rendert es danach ohne Wartezeit', async () => {
    renderShell();
    const link = screen.getByRole('link', { name: 'Zum Detail' });

    fireEvent.focusIn(link);
    await vi.waitFor(() => expect(gates.detail.loads).toBe(1));
    await act(async () => { gates.detail.open(); });
    await act(async () => { fireEvent.click(link); });

    expect(screen.getByRole('heading', { name: 'Vokabulardetail' })).toBeInTheDocument();
    expect(screen.queryByText('Seite wird geladen…')).not.toBeInTheDocument();
  });

  it('wartet ohne vorherige Absicht erst nach dem Klick auf den Chunk und hält die vorige Seite', async () => {
    renderShell();
    await act(async () => { gates.imprint.open(); });

    fireEvent.click(screen.getByRole('link', { name: 'Zum Impressum' }));

    expect(screen.queryByRole('heading', { name: 'Impressumseite' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Impressumseite' })).toBeInTheDocument();
  });
});
