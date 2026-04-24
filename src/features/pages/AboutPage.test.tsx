import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, CatalogState } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import { AboutPage } from './AboutPage';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);

function makeCatalogState(): CatalogState {
  return {
    catalog: {
      totalControls: 42,
      metadata: {
        title: 'Anwenderkatalog Grundschutz++',
        lastModified: '2026-03-05T08:08:21Z',
        version: '2026-03-05',
        oscalVersion: '1.1.3',
        remarks: 'Normativer Scope nach § 44 Abs. 1 BSIG.',
        publisherName: 'Bundesamt für Sicherheit in der Informationstechnik',
        publisherEmail: 'kontakt@bsi.bund.de',
        props: [
          {
            name: 'resolution-tool',
            value: 'Grundschutz++ Navigator',
            ns: 'https://example.com/namespaces/tool',
          },
        ],
        links: [
          {
            href: '#resource-uuid',
            rel: 'reference',
            text: 'BSI IT-Grundschutz Edition 2023',
          },
        ],
        roles: [
          { id: 'creator', title: 'Ersteller' },
        ],
        parties: [
          {
            uuid: 'party-uuid',
            type: 'organization',
            name: 'Bundesamt für Sicherheit in der Informationstechnik',
            email: 'kontakt@bsi.bund.de',
          },
        ],
        responsibleParties: [
          {
            roleId: 'creator',
            partyUuids: ['party-uuid'],
          },
        ],
      },
      backMatter: [
        {
          uuid: 'resource-uuid',
          title: 'BSI IT-Grundschutz Edition 2023',
          rlinks: [
            {
              href: 'https://example.com/grundschutz-edition-2023.pdf',
              hashes: [
                { algorithm: 'sha-256', value: 'abc123' },
              ],
            },
          ],
        },
      ],
    } as Catalog,
    provenance: null,
    verification: null,
    vocabularyRegistry: null,
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}

function makeProvenance(): NonNullable<CatalogState['provenance']> {
  return {
    source: {
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      file: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
      commit_sha: 'abcdef1234567890abcdef1234567890abcdef12',
      commit_date: '2026-03-05T08:08:21Z',
      git_blob_sha: 'blob-123',
      upstream_sha256: 'upstream-hash-123',
      upstream_size_bytes: 42,
    },
    integrity: {
      sha256: 'artifact-hash-456',
      size_bytes: 40,
      fetched_at: '2026-03-06T09:10:11Z',
    },
    build: {
      workflow_run_id: '100',
      workflow_run_url: 'https://github.com/example/actions/runs/100',
      runner_environment: 'github-hosted',
    },
  };
}

function makeVerification(valid: boolean): NonNullable<CatalogState['verification']> {
  return {
    valid,
    computedHash: valid ? 'artifact-hash-456' : 'artifact-hash-other',
    expectedHash: 'artifact-hash-456',
    sourceCommit: 'abcdef1234567890abcdef1234567890abcdef12',
    fetchedAt: '2026-03-06T09:10:11Z',
  };
}

describe('AboutPage', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseCatalog.mockReturnValue(makeCatalogState());
  });

  it('renders catalog metadata, roles and responsible parties', () => {
    render(<AboutPage />);

    expect(
      screen.getByRole('heading', { name: 'Katalog-Metadaten' }),
    ).toBeInTheDocument();
    expect(screen.getByText('resolution-tool')).toBeInTheDocument();
    expect(screen.getByText('Grundschutz++ Navigator')).toBeInTheDocument();
    expect(screen.getAllByText('Ersteller')).toHaveLength(2);
    expect(
      screen.getAllByText(
        'Bundesamt für Sicherheit in der Informationstechnik (kontakt@bsi.bund.de)',
      ),
    ).toHaveLength(3);
  });

  it('mentions the BSI disclaimer only once across header and body copy', () => {
    render(<AboutPage />);

    expect(
      screen.getAllByText(/Die Anwendung ist ein inoffizielles Werkzeug und kein Angebot des BSI\./),
    ).toHaveLength(1);
  });

  it('resolves metadata references through back-matter resources and shows hashes', () => {
    render(<AboutPage />);

    const metadataLink = screen.getByRole('link', {
      name: /BSI IT-Grundschutz Edition 2023/i,
    });

    expect(metadataLink).toHaveAttribute(
      'href',
      'https://example.com/grundschutz-edition-2023.pdf',
    );
    expect(screen.getByText('Referenzierte Ressourcen')).toBeInTheDocument();
    expect(screen.getByText(/sha-256:/i)).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
  });

  it('shows app and upstream catalog links plus a single sha comparison command', () => {
    const state = makeCatalogState();
    state.provenance = makeProvenance();
    state.verification = makeVerification(true);
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    const expectedAppCatalogUrl = `${window.location.origin}/data/catalog.json`;
    const expectedUpstreamCatalogUrl =
      'https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/abcdef1234567890abcdef1234567890abcdef12/Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json';

    expect(screen.getByText('App-Katalog')).toBeInTheDocument();
    expect(screen.getByText(expectedAppCatalogUrl)).toBeInTheDocument();
    expect(screen.getByText('Upstream-Katalog')).toBeInTheDocument();
    expect(screen.getByText(expectedUpstreamCatalogUrl)).toBeInTheDocument();
    expect(
      screen.getByText(
        `bash -lc '[ "$(curl -fsSL "$1" | sha256sum | cut -d" " -f1)" = "$(curl -fsSL "$2" | sha256sum | cut -d" " -f1)" ] && printf "true\\n" || printf "false\\n"' bash '${expectedAppCatalogUrl}' '${expectedUpstreamCatalogUrl}'`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Der Befehl lädt beide Dateien, vergleicht ihre SHA-256-Prüfsummen/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('SHA-256 (Upstream)')).not.toBeInTheDocument();
    expect(screen.queryByText('SHA-256 (Artefakt)')).not.toBeInTheDocument();
  });

  it('uses semantic token classes for positive and negative verification states', () => {
    const validState = makeCatalogState();
    validState.provenance = makeProvenance();
    validState.verification = makeVerification(true);

    const invalidState = makeCatalogState();
    invalidState.provenance = makeProvenance();
    invalidState.verification = makeVerification(false);

    mockedUseCatalog
      .mockReturnValueOnce(validState)
      .mockReturnValueOnce(invalidState);

    const { rerender } = render(<AboutPage />);

    const successTitle = screen.getByText('Katalog verifiziert');
    const successDetail = screen.getByText(
      'Datei-Hash stimmt mit den Build-Metadaten überein',
    );
    const successBanner = successTitle.parentElement?.parentElement?.parentElement;

    expect(successTitle.className).toContain('text-[var(--color-success-text)]');
    expect(successDetail.className).toContain('text-[var(--color-success-text)]');
    expect(successBanner?.className).toContain('bg-[var(--color-success-surface)]');
    expect(successBanner?.className).not.toMatch(/\b(?:bg|text)-(?:green|red)-/);

    rerender(<AboutPage />);

    const failureTitle = screen.getByText('Verifikation fehlgeschlagen');
    const failureDetail = screen.getByText(
      'Datei-Hash weicht von den Build-Metadaten ab',
    );
    const failureBanner = failureTitle.parentElement?.parentElement?.parentElement;

    expect(failureTitle.className).toContain('text-[var(--color-danger-text)]');
    expect(failureDetail.className).toContain('text-[var(--color-danger-text)]');
    expect(failureBanner?.className).toContain('bg-[var(--color-danger-surface)]');
    expect(failureBanner?.className).not.toMatch(/\b(?:bg|text)-(?:green|red)-/);
  });
});
