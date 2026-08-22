import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { buildPracticeListKey, HomePage } from './HomePage';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);

function catalogState(
  overrides: Partial<ReturnType<typeof useCatalog>> = {},
): ReturnType<typeof useCatalog> {
  return {
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
      controlsByAltIdentifier: new Map(),
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

  it('renders the production hero copy and computed statistics without duplicate provenance metadata', () => {
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
    expect(screen.queryByText(/Katalog-Stand:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/verifiziert/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Quelle: BSI Stand-der-Technik-Bibliothek/))
      .not.toBeInTheDocument();

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

  it('does not render verification metadata in the hero when catalog verification fails', () => {
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

    expect(screen.queryByText('nicht verifiziert')).not.toBeInTheDocument();
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

  it('scopes practice links to the active catalog', () => {
    renderHome();

    expect(screen.getByRole('link', { name: /ISMS/ })).toHaveAttribute(
      'href',
      '/katalog/gspp/ISMS',
    );
  });

  it('uses tighter hero spacing and a clearer gap before the practice register', () => {
    renderHome();

    const pageHeader = screen.getByRole('heading', {
      name: 'Grundschutz++ Navigator',
    }).closest('header');
    const summarySection = screen.getByRole('heading', {
      name: 'Was ist Grundschutz++?',
    }).closest('section');
    const practiceRegister = screen.getByRole('region', {
      name: 'Praktiken-Register',
    });

    expect(pageHeader).toHaveClass('pb-6');
    expect(summarySection).toHaveClass('pt-6');
    expect(summarySection).not.toHaveClass('mt-6');
    expect(practiceRegister).toHaveClass('mt-8');
  });
});

describe('buildPracticeListKey', () => {
  it('uses the practice id as list key when present', () => {
    const practice = {
      id: 'GC',
      title: 'Grundschutz-Consulting',
      label: 'GC',
      topics: [],
      controlCount: 0,
    };

    expect(buildPracticeListKey(practice)).toBe('GC');
    expect(buildPracticeListKey(practice)).toBe('GC');
  });

  it('keeps exactly one stable key per id-less practice object', () => {
    const practice = {
      title: 'Ohne ID',
      label: 'X?',
      topics: [],
      controlCount: 0,
    };

    const firstKey = buildPracticeListKey(practice);
    expect(buildPracticeListKey(practice)).toBe(firstKey);
  });

  it('gives identical id-less duplicates distinct keys that stay bound to their record', () => {
    // Greptile-P1 (PR #156): Suffixe dürfen nicht von der Listenposition
    // abhängen — der Key muss am Datensatz (Objektidentität) hängen und
    // Umsortierungen überleben.
    const first = { title: 'Erste', label: 'DUP', topics: [], controlCount: 0 };
    const second = {
      title: 'Zweite',
      label: 'DUP',
      topics: [],
      controlCount: 0,
    };

    const keyFirst = buildPracticeListKey(first);
    const keySecond = buildPracticeListKey(second);
    expect(keyFirst).not.toBe(keySecond);

    // Unabhängig von Zuordnungsreihenfolge und weiteren Datensätzen bleibt
    // jeder Key an sein Objekt gebunden.
    const third = { title: 'Dritte', label: 'DUP', topics: [], controlCount: 0 };
    buildPracticeListKey(third);
    expect(buildPracticeListKey(second)).toBe(keySecond);
    expect(buildPracticeListKey(first)).toBe(keyFirst);
  });
});
