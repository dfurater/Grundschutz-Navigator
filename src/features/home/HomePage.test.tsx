import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { HomePage } from './HomePage';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);

function catalogState(
  overrides: Partial<ReturnType<typeof useCatalog>> = {},
): ReturnType<typeof useCatalog> {
  return {
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
      practices: [
        {
          id: 'ISMS',
          title: 'ISMS',
          label: 'ISMS',
          topics: [
            {
              id: 'ISMS.1',
              title: 'Governance',
              label: '1',
              practiceId: 'ISMS',
              controlCount: 2,
              controlIds: [],
            },
            {
              id: 'ISMS.2',
              title: 'Risiko',
              label: '2',
              practiceId: 'ISMS',
              controlCount: 1,
              controlIds: [],
            },
          ],
          controlCount: 3,
        },
        {
          id: 'ORP',
          title: 'Organisation und Personal',
          label: 'ORP',
          topics: [
            {
              id: 'ORP.1',
              title: 'Organisation',
              label: '1',
              practiceId: 'ORP',
              controlCount: 4,
              controlIds: [],
            },
          ],
          controlCount: 4,
        },
      ],
      controlsById: new Map(),
      controls: [],
      backMatter: [],
      totalControls: 7,
    },
    provenance: {
      source: {
        repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
        file: 'catalog.json',
        commit_sha: 'abc123',
        commit_date: '2026-03-26T12:00:00.000Z',
        git_blob_sha: 'def456',
      },
      integrity: {
        sha256: 'hash',
        size_bytes: 123,
        fetched_at: '2026-04-15T12:00:00.000Z',
      },
      build: {
        workflow_run_id: '1',
        workflow_run_url: null,
        runner_environment: 'local',
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
    ...overrides,
  } as ReturnType<typeof useCatalog>;
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseCatalog.mockReturnValue(catalogState());
  });

  it('renders the production hero copy, computed statistics and metadata', () => {
    renderHome();

    expect(
      screen.getByText(
        /Werkzeug zum Durchsuchen, Filtern und Exportieren des\s+offiziellen Grundschutz\+\+-Anwenderkatalogs des BSI\. Kein Angebot\s+des BSI\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Inoffizielles/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Kein Angebot des BSI/)).toHaveLength(1);
    expect(
      screen.getByText(/2 Praktiken\s+·\s+3 Themen\s+·\s+7 Kontrollen/),
    ).toHaveClass('tabular-nums');
    expect(screen.getByText(/Katalog-Stand: 26\. März 2026/))
      .toHaveTextContent(/verifiziert\s+·\s+Quelle: BSI Stand-der-Technik-Bibliothek/);

    expect(screen.queryByRole('navigation', { name: 'Primäre Aktionen' }))
      .not.toBeInTheDocument();
  });

  it('keeps statistics hidden while the catalog is still loading', () => {
    mockedUseCatalog.mockReturnValue(catalogState({
      catalog: null,
      loading: true,
    }));

    renderHome();

    expect(screen.getByRole('status', { name: 'Katalog wird geladen' }))
      .toBeInTheDocument();
    expect(screen.queryByText(/Praktiken\s+·\s+.*Themen\s+·\s+.*Kontrollen/))
      .not.toBeInTheDocument();
  });

  it('renders the unverified hero state with the warning color token', () => {
    mockedUseCatalog.mockReturnValue(catalogState({
      verification: {
        valid: false,
        computedHash: 'actual',
        expectedHash: 'expected',
        sourceCommit: 'abc123',
        fetchedAt: '2026-03-26T12:00:00.000Z',
      },
    }));

    renderHome();

    expect(screen.getByText('nicht verifiziert'))
      .toHaveClass('text-[var(--color-warning)]');
  });

  it('renders the compact Grundschutz++ explanation with a project link', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Was ist Grundschutz++?' }))
      .toBeInTheDocument();
    expect(screen.getByText(
      /Grundschutz\+\+ ist ein fortentwickelter Anwenderkatalog des BSI im\s+Kontext des IT-Grundschutzes\./,
    )).toBeInTheDocument();
    expect(screen.getByText(
      /Er liegt maschinenlesbar im\s+OSCAL-Format vor und verbindet methodische mit konkreten\s+technisch-organisatorischen Anforderungen\./,
    )).toBeInTheDocument();

    const aboutLink = screen.getByRole('link', {
      name: 'Über das Projekt',
    });

    expect(aboutLink).toHaveAttribute('href', '/about');
  });

  it('places the Grundschutz++ explanation before the practice register', () => {
    renderHome();

    const summaryHeading = screen.getByRole('heading', {
      name: 'Was ist Grundschutz++?',
    });
    const practiceRegister = screen.getByRole('region', {
      name: 'Praktiken-Register',
    });

    expect(
      summaryHeading.compareDocumentPosition(practiceRegister) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
