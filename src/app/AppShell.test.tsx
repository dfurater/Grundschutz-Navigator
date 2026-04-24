import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { AppShell } from './AppShell';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

vi.mock('@/components/HeaderBar', () => ({
  HeaderBar: ({ onMenuToggle }: { onMenuToggle: () => void; onSearch: (term: string) => void }) => (
    <button type="button" onClick={onMenuToggle}>
      Menu
    </button>
  ),
}));

vi.mock('@/components/TreeNav', () => ({
  TreeNav: () => <nav aria-label="TreeNav">TreeNav</nav>,
}));

vi.mock('@/components/Footer', () => ({
  Footer: () => <footer>Footer</footer>,
}));

vi.mock('@/features/home/HomePage', () => ({
  HomePage: () => <div>Home</div>,
}));

vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => <div>Katalog</div>,
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
      catalog: {
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

  it('disables sidebar transitions when reduced motion is preferred', () => {
    const { container, rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    const sidebar = container.querySelector('aside');
    expect(sidebar).toHaveStyle({
      transition: 'width var(--duration-normal) var(--easing-default), transform var(--duration-normal) var(--easing-default)',
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
    const resizeHandle = screen.getByRole('separator', { name: 'Sidebar-Breite anpassen' });
    const homeLink = screen.getByRole('link', { name: 'Zur Startseite' });

    expect(explorerButton.className).toContain('focus-visible:ring-2');
    expect(collapseButton.className).toContain('focus-visible:ring-2');
    expect(resizeHandle.className).toContain('focus-visible:ring-2');
    expect(homeLink.className).toContain('focus-visible:ring-2');

    fireEvent.click(collapseButton);

    expect(screen.getByRole('button', { name: 'Katalog-Explorer einblenden' }).className).toContain('focus-visible:ring-2');
    expect(container.querySelector('aside')).toBeInTheDocument();
  });

  it('registers vocabulary routes and document titles', () => {
    render(
      <MemoryRouter initialEntries={['/vokabular']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByText('Vokabulare Seite')).toBeInTheDocument();
    expect(document.title).toBe('Vokabulare — Grundschutz++ Navigator');
  });

  it('registers vocabulary detail routes and document titles', () => {
    render(
      <MemoryRouter initialEntries={['/vokabular/security-level']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByText('Vokabular-Detail')).toBeInTheDocument();
    expect(document.title).toBe('security-level — Vokabulare — Grundschutz++ Navigator');
  });
});
