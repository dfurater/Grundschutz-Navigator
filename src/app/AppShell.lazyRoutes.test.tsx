import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { expectSingleDocumentTitle } from '@/test/documentTitle';
import { renderAppShell } from '@/test/renderAppShell';
import { PAGE_TITLES, PRODUCT_TITLE } from './pageTitles';
import { STATIC_PAGE_ROUTES } from './staticPageRoutes';

/*
 * Chunk-Vertrag der Nebenrouten (GSPP-506): Jede Seite lädt erst beim ersten
 * Aufruf, und der Titel steht schon, bevor ihr Chunk eintrifft.
 *
 * Gilt für den Direktaufruf; die Client-Navigation prüft AppShell.routeBoundary.test.tsx.
 * Die Seitenmodule sind hier absichtlich gesperrt, bis der Test sie freigibt.
 * `lazyPage` merkt sich ein aufgelöstes Modul für die Lebensdauer der Testdatei;
 * diese Datei rendert deshalb jede Seite genau einmal und enthält nur diese
 * Fälle. AppShell.test.tsx prüft die übrige Shell mit sofort verfügbaren Mocks.
 */

const gates = vi.hoisted(() => {
  const gate = () => {
    let open: () => void = () => {};
    const opened = new Promise<void>((resolve) => { open = resolve; });
    return { opened, open };
  };
  return {
    search: gate(),
    vocabularies: gate(),
    vocabularyNamespace: gate(),
    about: gate(),
    privacy: gate(),
    imprint: gate(),
    licenses: gate(),
  };
});

vi.mock('@/hooks/useCatalog', () => ({ useCatalog: vi.fn() }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('@/components/HeaderBar', () => ({ HeaderBar: () => <header>Kopfzeile</header> }));
vi.mock('@/components/TreeNav', () => ({ TreeNav: () => <nav aria-label="TreeNav">TreeNav</nav> }));
vi.mock('@/components/Footer', () => ({ Footer: () => <footer>Fußzeile</footer> }));
vi.mock('@/features/home/HomePage', () => ({ HomePage: () => <div>Startseite</div> }));
vi.mock('@/features/catalog/CatalogBrowser', () => ({ CatalogBrowser: () => <div>Katalog</div> }));
vi.mock('@/features/search/SearchPage', async () => {
  await gates.search.opened;
  return { SearchPage: () => <div>Suchseite</div> };
});
vi.mock('@/features/vocabularies/VocabularyOverviewPage', async () => {
  await gates.vocabularies.opened;
  return { VocabularyOverviewPage: () => <div>Vokabularübersicht</div> };
});
vi.mock('@/features/vocabularies/VocabularyNamespacePage', async () => {
  await gates.vocabularyNamespace.opened;
  return { VocabularyNamespacePage: () => <div>Vokabulardetail</div> };
});
vi.mock('@/features/pages/AboutPage', async () => {
  await gates.about.opened;
  return { AboutPage: () => <div>Über-Seite</div> };
});
vi.mock('@/features/pages/DatenschutzPage', async () => {
  await gates.privacy.opened;
  return { DatenschutzPage: () => <div>Datenschutzseite</div> };
});
vi.mock('@/features/pages/ImpressumPage', async () => {
  await gates.imprint.opened;
  return { ImpressumPage: () => <div>Impressumseite</div> };
});
vi.mock('@/features/pages/LizenzenPage', async () => {
  await gates.licenses.opened;
  return { LizenzenPage: () => <div>Lizenzseite</div> };
});

const LAZY_CASES = [
  { path: '/suche', gate: gates.search, marker: 'Suchseite' },
  { path: '/vokabular', gate: gates.vocabularies, marker: 'Vokabularübersicht' },
  { path: '/about', gate: gates.about, marker: 'Über-Seite' },
  { path: '/datenschutz', gate: gates.privacy, marker: 'Datenschutzseite' },
  { path: '/impressum', gate: gates.imprint, marker: 'Impressumseite' },
  { path: '/lizenzen', gate: gates.licenses, marker: 'Lizenzseite' },
] as const;

/** Abfragen innerhalb von `<main>`: Der Ladehinweis der Navigation liegt außerhalb. */
const inMain = () => within(document.querySelector('main')!);

function mockCatalogState() {
  vi.mocked(useCatalog).mockReturnValue({
    ...catalogCollectionDefaults(),
    catalog: null,
    loading: false,
    error: null,
  } as unknown as ReturnType<typeof useCatalog>);
}

describe('AppShell: nachgeladene Nebenrouten', () => {
  it('deckt mit den Fällen genau die lazy Routen der Routentabelle ab', () => {
    expect(LAZY_CASES.map(({ path }) => path)).toEqual(
      STATIC_PAGE_ROUTES.map(({ path }) => path).filter((path) => path !== '/'),
    );
  });

  it.each(LAZY_CASES)('$path: Titel und Ladezustand stehen vor dem Chunk, die Seite danach', async ({ path, gate, marker }) => {
    mockCatalogState();
    const title = STATIC_PAGE_ROUTES.find((route) => route.path === path)?.title;
    renderAppShell([path]);

    expect(inMain().getByRole('status')).toHaveTextContent('Seite wird geladen…');
    expect(screen.getByRole('heading', { level: 1, name: title })).toHaveClass('sr-only');
    expect(screen.queryByText(marker)).not.toBeInTheDocument();
    expectSingleDocumentTitle(`${title} | ${PRODUCT_TITLE}`);
    // Die Shell bleibt während des Ladens bedienbar.
    expect(screen.getByText('Kopfzeile')).toBeInTheDocument();
    expect(screen.getByText('Fußzeile')).toBeInTheDocument();

    await act(async () => { gate.open(); });

    expect(await screen.findByText(marker)).toBeInTheDocument();
    expect(inMain().queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: title })).not.toBeInTheDocument();
    expectSingleDocumentTitle(`${title} | ${PRODUCT_TITLE}`);
  });

  it('/vokabular/:namespaceId: trägt den Vokabeltitel schon im Ladezustand', async () => {
    mockCatalogState();
    renderAppShell(['/vokabular/security-level']);

    expect(inMain().getByRole('status')).toHaveTextContent('Seite wird geladen…');
    expect(screen.getByRole('heading', { level: 1, name: PAGE_TITLES.vocabularies })).toHaveClass('sr-only');
    expectSingleDocumentTitle(`${PAGE_TITLES.vocabularies} | ${PRODUCT_TITLE}`);

    await act(async () => { gates.vocabularyNamespace.open(); });

    expect(await screen.findByText('Vokabulardetail')).toBeInTheDocument();
  });

  it('lädt die Startseite ohne Ladezustand', () => {
    mockCatalogState();
    renderAppShell(['/']);

    expect(screen.getByText('Startseite')).toBeInTheDocument();
    expect(inMain().queryByRole('status')).not.toBeInTheDocument();
    expectSingleDocumentTitle(PRODUCT_TITLE);
  });
});
