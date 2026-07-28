import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVocabularyIndexPath } from '@/features/vocabulary/routes';
import { useCatalog } from '@/hooks/useCatalog';
import { Footer } from './Footer';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);

const secondaryFooterLinks = [
  { label: 'About', href: '/about' },
  { label: 'Vokabulare', href: buildVocabularyIndexPath() },
  { label: 'Datenschutz', href: '/datenschutz' },
  { label: 'Lizenzen', href: '/lizenzen' },
  { label: 'Impressum', href: '/impressum' },
] as const;

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
}

describe('Footer', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseCatalog.mockReturnValue({
      catalog: null,
      provenance: {
        source: {
          commit_date: '2026-03-26T12:00:00.000Z',
        },
        integrity: {
          fetched_at: '2026-04-15T12:00:00.000Z',
        },
      },
      verification: {
        valid: true,
        computedHash: 'hash',
        expectedHash: 'hash',
        sourceCommit: 'abc123',
        fetchedAt: '2026-03-26T12:00:00.000Z',
      },
      vocabularyRegistry: null,
      vocabularyProvenance: null,
      vocabularyVerification: null,
      loading: false,
      error: null,
    } as ReturnType<typeof useCatalog>);
  });

  it('uses focus-visible rings for footer links', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    const links = [
      screen.getByRole('link', { name: /quelle: bsi stand-der-technik-bibliothek/i }),
      screen.getByRole('link', { name: 'Verifiziert' }),
      ...secondaryFooterLinks.map(({ label }) => screen.getByRole('link', { name: label })),
    ];

    expect(links[0]).toHaveClass('catalog-link-color');

    for (const link of links) {
      expect(link.className).toContain('focus-visible:ring-2');
      expect(link.className).toContain('focus-visible:outline-none');
      expect(link.className).not.toContain('focus:ring-2');
    }
  });

  it('uses token-based verification colors instead of hardcoded palette classes', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    const verificationLink = screen.getByRole('link', { name: 'Verifiziert' });

    expect(verificationLink.className).toContain('text-[var(--color-success)]');
    expect(verificationLink.querySelector('span')).toBeNull();
  });

  it('marks decorative footer icons as aria-hidden', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    const externalIcon = screen
      .getByRole('link', { name: /quelle: bsi stand-der-technik-bibliothek/i })
      .querySelector('svg');
    const verificationIcon = screen
      .getByRole('link', { name: 'Verifiziert' })
      .querySelector('svg');

    expect(externalIcon).toHaveAttribute('aria-hidden', 'true');
    expect(verificationIcon).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the source link as a source reference and preserves external-link semantics', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    const sourceLink = screen.getByRole('link', {
      name: /quelle: bsi stand-der-technik-bibliothek/i,
    });

    expect(sourceLink).toHaveAttribute(
      'href',
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    );
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(sourceLink).toHaveTextContent('öffnet in neuem Tab');
  });

  it('does not render provenance dates even when commit and fetch timestamps are available', () => {
    renderFooter();

    expect(screen.queryByText('26. März 2026')).not.toBeInTheDocument();
    expect(screen.queryByText('15. Apr. 2026')).not.toBeInTheDocument();
  });

  it('groups source and verification before the separately aligned responsive navigation', () => {
    renderFooter();

    const sourceLink = screen.getByRole('link', {
      name: /quelle: bsi stand-der-technik-bibliothek/i,
    });
    const secondaryLinks = secondaryFooterLinks.map(({ label }) =>
      screen.getByRole('link', { name: label }),
    );
    const verificationLink = screen.getByRole('link', { name: 'Verifiziert' });
    const informationGroup = sourceLink.parentElement;
    const secondaryGroup = secondaryLinks[0].parentElement;

    expect(sourceLink.nextElementSibling).toBe(verificationLink);
    expect(verificationLink.parentElement).toBe(informationGroup);
    expect(sourceLink).toHaveClass('min-w-0');
    expect(sourceLink).not.toHaveClass('flex-1', 'lg:mr-auto');
    expect(sourceLink.querySelector('.sm\\:hidden')).toHaveClass('min-w-0', 'truncate');
    expect(verificationLink).toHaveClass('shrink-0', 'whitespace-nowrap');
    expect(informationGroup).toHaveClass(
      'basis-full',
      'min-w-0',
      'flex',
      'flex-wrap',
      'lg:basis-auto',
      'lg:flex-1',
      'lg:flex-nowrap',
    );
    expect(secondaryGroup).toHaveClass(
      'basis-full',
      'min-w-0',
      'flex',
      'flex-wrap',
      'lg:basis-auto',
      'lg:flex-nowrap',
      'lg:justify-end',
      'lg:ml-auto',
    );
    expect(informationGroup?.parentElement).toBe(secondaryGroup?.parentElement);
  });

  it('uses compact mobile spacing for the complete secondary footer row', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    const secondaryGroup = screen.getByRole('link', { name: 'About' }).parentElement;

    expect(secondaryGroup).toHaveClass('gap-x-2', 'sm:gap-x-3');
  });

  it('places the non-verified status directly after the source link', () => {
    mockedUseCatalog.mockReturnValue({
      catalog: null,
      provenance: {
        source: {
          commit_date: '2026-03-26T12:00:00.000Z',
        },
        integrity: {
          fetched_at: '2026-04-15T12:00:00.000Z',
        },
      },
      verification: {
        valid: false,
        computedHash: 'different-hash',
        expectedHash: 'hash',
        sourceCommit: 'abc123',
        fetchedAt: '2026-04-15T12:00:00.000Z',
      },
      vocabularyRegistry: null,
      vocabularyProvenance: null,
      vocabularyVerification: null,
      loading: false,
      error: null,
    } as ReturnType<typeof useCatalog>);

    renderFooter();

    const sourceLink = screen.getByRole('link', {
      name: /quelle: bsi stand-der-technik-bibliothek/i,
    });
    const verificationLink = screen.getByRole('link', { name: 'Nicht verifiziert' });

    expect(sourceLink.nextElementSibling).toBe(verificationLink);
    expect(verificationLink.parentElement).toBe(sourceLink.parentElement);
  });

  it('renders no status link or placeholder when verification is unavailable', () => {
    mockedUseCatalog.mockReturnValue({
      catalog: null,
      provenance: {
        source: {
          commit_date: '2026-03-26T12:00:00.000Z',
        },
        integrity: {
          fetched_at: '2026-04-15T12:00:00.000Z',
        },
      },
      verification: null,
      vocabularyRegistry: null,
      vocabularyProvenance: null,
      vocabularyVerification: null,
      loading: false,
      error: null,
    } as ReturnType<typeof useCatalog>);

    renderFooter();

    const sourceLink = screen.getByRole('link', {
      name: /quelle: bsi stand-der-technik-bibliothek/i,
    });

    expect(screen.queryByRole('link', { name: 'Verifiziert' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nicht verifiziert' })).not.toBeInTheDocument();
    expect(sourceLink.nextElementSibling).toBeNull();
  });

  it('renders the product name without a version label', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    const brand = screen.getByText('Grundschutz++ Navigator');
    expect(brand).toBeInTheDocument();
    expect(brand.textContent).not.toMatch(/Pre-Release|v\d/);
  });

  it('renders secondary footer links in the required order with their existing targets', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    const footer = screen.getByRole('contentinfo');
    const secondaryLinks = within(footer)
      .getAllByRole('link')
      .filter((link) => secondaryFooterLinks.some(({ label }) => link.textContent === label));

    expect(secondaryLinks.map((link) => ({
      label: link.textContent,
      href: link.getAttribute('href'),
    }))).toEqual(secondaryFooterLinks);
  });

  it('keeps legal and secondary links directly visible on mobile breakpoints', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    for (const { label } of secondaryFooterLinks) {
      expect(screen.getByRole('link', { name: label }).className).not.toContain('hidden');
    }
  });
});
