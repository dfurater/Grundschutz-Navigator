import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, CatalogState } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import { AboutPage } from './AboutPage';
import { catalogCollectionDefaults } from '@/test/catalogState';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

function makeCatalogState(): CatalogState {
  const catalog = {
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
  } as Catalog;

  return {
    ...catalogCollectionDefaults(),
    catalogDocument: {
      source: {
        catalog: {
          uuid: 'catalog-uuid',
          metadata: {
            title: 'Anwenderkatalog Grundschutz++',
            'last-modified': '2026-03-05T08:08:21Z',
            version: '2026-03-05',
            'oscal-version': '1.1.3',
            links: [
              {
                href: '#resource-uuid',
                rel: 'reference',
                text: 'BSI IT-Grundschutz Edition 2023',
              },
            ],
          },
          groups: [],
          'back-matter': {
            resources: [
              {
                uuid: 'resource-uuid',
                title: 'BSI IT-Grundschutz Edition 2023',
                rlinks: [
                  {
                    href: 'https://example.com/grundschutz-edition-2023.pdf',
                    hashes: [{ algorithm: 'sha-256', value: 'abc123' }],
                  },
                ],
              },
            ],
          },
        },
      },
      context: {
        catalogKey: 'gspp',
        trustClass: 'class-1-verified-public',
      },
      view: catalog,
    },
    catalog,
    provenance: null,
    verification: null,
    vocabularyRegistry: null,
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}

function addSourceOnlyResourceLink(state: CatalogState) {
  const source = state.catalogDocument!.source as {
    catalog: {
      'back-matter': {
        resources: Array<{ rlinks: Array<{ href: string; hashes?: Array<{ algorithm: string; value: string }> }> }>;
      };
    };
  };
  source.catalog['back-matter'].resources[0]!.rlinks.push({
    href: 'https://example.com/source-only.pdf',
  });
}

function makeProvenance(): NonNullable<CatalogState['provenance']> {
  return {
    source: {
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      file: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
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

function makeVocabularyProvenance(): NonNullable<CatalogState['vocabularyProvenance']> {
  const modalNamespace =
    'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/modal_verbs.csv';

  return {
    source: {
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      catalogPath: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
      snapshotCommitSha: 'fedcba0987654321fedcba0987654321fedcba09',
      snapshotCommitDate: '2026-03-05T08:08:21Z',
    },
    manifest: {
      schemaVersion: 2,
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      snapshotCommitSha: 'fedcba0987654321fedcba0987654321fedcba09',
      files: [
        {
          artifactKey: 'catalog-gspp',
          rootType: 'catalog',
          lifecycle: 'supported',
          path: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
          gitBlobSha: 'blob-catalog',
          contentSha256: 'hash-catalog',
        },
        {
          artifactKey: 'namespaces-bsi',
          rootType: 'vocabulary',
          lifecycle: 'supported',
          path: 'documentation/namespaces/modal_verbs.csv',
          gitBlobSha: 'blob-modal',
          contentSha256: 'csv-hash-123',
        },
      ],
      signatureSha256: 'signature-abc',
    },
    files: [
      {
        namespace: modalNamespace,
        path: 'documentation/namespaces/modal_verbs.csv',
        fileName: 'modal_verbs.csv',
        routeId: 'documentation-namespaces-modal-verbs',
        gitBlobSha: 'blob-modal',
        sha256: 'csv-hash-123',
        sizeBytes: 123,
      },
    ],
    integrity: {
      sha256: 'vocab-hash-789',
      size_bytes: 77,
      fetched_at: '2026-03-06T09:10:11Z',
    },
    build: {
      workflow_run_id: '100',
      workflow_run_url: null,
      runner_environment: 'github-hosted',
    },
  };
}

function makeVocabularyVerification(
  valid: boolean,
): NonNullable<CatalogState['vocabularyVerification']> {
  return {
    valid,
    computedHash: valid ? 'vocab-hash-789' : 'vocab-hash-other',
    expectedHash: 'vocab-hash-789',
    sourceCommit: 'fedcba0987654321fedcba0987654321fedcba09',
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
    expect(screen.getAllByText('resolution-tool')).toHaveLength(2);
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
      screen.getAllByText(/Die Anwendung ist kein Angebot des BSI\./),
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

  it('uses the preserved source for every resource link and flags missing integrity metadata', () => {
    const state = makeCatalogState();
    addSourceOnlyResourceLink(state);
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getByRole('link', { name: /source-only.pdf/i }))
      .toHaveAttribute('href', 'https://example.com/source-only.pdf');
    expect(screen.getByText('Ohne Integritätsnachweis')).toBeInTheDocument();
    expect(screen.queryByText(/Medientyp:/i)).not.toBeInTheDocument();
    expect(document.querySelector('img, iframe, object, embed, video, audio')).toBeNull();
  });

  it('shows app and upstream catalog links plus a single sha comparison command', () => {
    const state = makeCatalogState();
    state.provenance = makeProvenance();
    state.verification = makeVerification(true);
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    const expectedAppCatalogUrl = `${window.location.origin}/data/catalog.json`;
    const expectedUpstreamCatalogUrl =
      'https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/abcdef1234567890abcdef1234567890abcdef12/control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json';

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

  it('shows the vocabulary verification result with provenance details', () => {
    const state = makeCatalogState();
    state.vocabularyProvenance = makeVocabularyProvenance();
    state.vocabularyVerification = makeVocabularyVerification(true);
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getByText('Vokabulare verifiziert')).toBeInTheDocument();
    expect(
      screen.getByText('Vokabular-Hash stimmt mit den Build-Metadaten überein'),
    ).toBeInTheDocument();
    expect(screen.getByText('Abgerufen am')).toBeInTheDocument();
    expect(screen.getByText('Namespace-Dateien')).toBeInTheDocument();
    expect(screen.getByText('fedcba098765')).toBeInTheDocument();
  });

  it('shows the profile-derived source catalog lineage and keeps all provenance kinds distinct', () => {
    const state = makeCatalogState();
    state.catalog!.metadata.props = [];
    state.vocabularyProvenance = makeVocabularyProvenance();
    state.vocabularyProvenance.catalogLineages = [
      {
        catalogKey: 'gspp',
        profile: {
          artifactKey: 'profile-gspp',
          title: 'Grundschutz++ Profil',
          documentUuid: 'profile-uuid',
          oscalVersion: '1.1.3',
          version: '2026-08-13',
          upstreamPath: 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json',
          gitBlobSha: 'profile-blob',
          contentSha256: 'profile-sha',
        },
        imports: [
          {
            index: 0,
            state: 'complete',
            importHref: '#kernel-resource',
            resourceUuid: 'kernel-resource',
            rlinkHref: '../catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
            source: {
              artifactKey: 'catalog-source-gspp-kernel-g0',
              title: 'Kernel G0',
              documentUuid: 'kernel-uuid',
              oscalVersion: '1.1.3',
              version: '2026-08-13T04:09:30.129500+00:00',
              upstreamPath:
                'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
              gitBlobSha: 'kernel-blob',
              contentSha256: 'kernel-sha',
            },
          },
          {
            index: 1,
            state: 'resource-missing',
            importHref: '#fehlende-resource',
            resourceUuid: 'fehlende-resource',
            rlinkHref: null,
            source: null,
          },
          {
            index: null,
            state: 'configured-import-missing',
            importHref: null,
            resourceUuid: null,
            rlinkHref: '../catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json',
            source: null,
          },
        ],
      },
    ];
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getByText('OSCAL-Ableitungsprovenienz')).toBeInTheDocument();
    expect(screen.getAllByText('nicht vorhanden')).toHaveLength(2);
    expect(screen.getByText(/Projektbefund, kein Schemafehler/i)).toBeInTheDocument();
    expect(screen.getByText('Quellkatalog-Lineage')).toBeInTheDocument();
    expect(screen.getByText(/Profile Resolution: Draft/i)).toBeInTheDocument();
    expect(screen.getByText('Grundschutz++ Profil')).toBeInTheDocument();
    expect(screen.getByText('Kernel G0')).toBeInTheDocument();
    expect(screen.getByText('kernel-uuid')).toBeInTheDocument();
    expect(screen.getByText(/Back-matter-Ressource fehlt/i)).toBeInTheDocument();
    expect(screen.getByText(/Konfigurierter Quellimport fehlt im Profil/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /^Link: \.\.\/catalogs\/Methodik-Grundschutz\+\+\/BSI-Methodik-Grundschutz\+\+-catalog\.json$/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Kernel G0/i })).toHaveAttribute(
      'href',
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/blob/fedcba0987654321fedcba0987654321fedcba09/control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
    );
    expect(screen.getByText('Projekt-Build-Provenienz')).toBeInTheDocument();
    expect(screen.getByText('Ressourcen-Hashes')).toBeInTheDocument();
  });

  it('renders multiple configured missing imports without duplicate React keys', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = makeCatalogState();
    state.vocabularyProvenance = makeVocabularyProvenance();
    state.vocabularyProvenance.catalogLineages = [
      {
        catalogKey: 'gspp',
        profile: {
          artifactKey: 'profile-gspp',
          title: 'Grundschutz++ Profil',
          documentUuid: 'profile-uuid',
          oscalVersion: '1.1.3',
          version: '2026-08-13',
          upstreamPath: 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json',
          gitBlobSha: 'profile-blob',
          contentSha256: 'profile-sha',
        },
        imports: [
          {
            index: null,
            state: 'configured-import-missing',
            importHref: null,
            resourceUuid: null,
            rlinkHref: '../catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json',
            source: null,
          },
          {
            index: null,
            state: 'configured-import-missing',
            importHref: null,
            resourceUuid: null,
            rlinkHref: '../catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json',
            source: null,
          },
        ],
      },
    ];
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getAllByText('Konfigurierter Quellimport fehlt im Profil')).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'Encountered two children with the same key',
    );
    consoleError.mockRestore();
  });

  it('keeps the About page available and rejects a malformed lineage sidecar visibly', () => {
    const state = makeCatalogState();
    state.vocabularyProvenance = makeVocabularyProvenance();
    state.vocabularyProvenance.catalogLineages = [{ catalogKey: 'gspp' }] as unknown as [];
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getByText('Quellkatalog-Lineage nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByText(/unvollständig oder widersprüchlich/i)).toBeInTheDocument();
    expect(screen.queryByText('Aufgelöster Katalog ← Profil ← registrierte Quellkataloge')).not.toBeInTheDocument();
  });

  it('rejects a complete lineage import with a null index', () => {
    const state = makeCatalogState();
    const documentFields = {
      title: null,
      documentUuid: null,
      oscalVersion: null,
      version: null,
      upstreamPath: null,
      gitBlobSha: null,
      contentSha256: null,
    };
    state.vocabularyProvenance = makeVocabularyProvenance();
    state.vocabularyProvenance.catalogLineages = [
      {
        catalogKey: 'gspp',
        profile: { artifactKey: 'profile-gspp', ...documentFields },
        imports: [
          {
            index: null,
            state: 'complete',
            importHref: '#kernel-resource',
            resourceUuid: 'kernel-resource',
            rlinkHref: '../catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
            source: { artifactKey: 'catalog-source-gspp-kernel-g0', ...documentFields },
          },
        ],
      },
    ];
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getByText('Quellkatalog-Lineage nicht verfügbar')).toBeInTheDocument();
  });

  it('uses semantic token classes for the vocabulary verification states', () => {
    const validState = makeCatalogState();
    validState.vocabularyProvenance = makeVocabularyProvenance();
    validState.vocabularyVerification = makeVocabularyVerification(true);

    const invalidState = makeCatalogState();
    invalidState.vocabularyProvenance = makeVocabularyProvenance();
    invalidState.vocabularyVerification = makeVocabularyVerification(false);

    mockedUseCatalog
      .mockReturnValueOnce(validState)
      .mockReturnValueOnce(invalidState);

    const { rerender } = render(<AboutPage />);

    const successTitle = screen.getByText('Vokabulare verifiziert');
    expect(successTitle.className).toContain('text-[var(--color-success-text)]');

    rerender(<AboutPage />);

    const failureTitle = screen.getByText('Vokabular-Verifikation fehlgeschlagen');
    const failureDetail = screen.getByText(
      'Vokabular-Hash weicht von den Build-Metadaten ab',
    );

    expect(failureTitle.className).toContain('text-[var(--color-danger-text)]');
    expect(failureDetail.className).toContain('text-[var(--color-danger-text)]');
    expect(failureTitle.className).not.toMatch(/\b(?:bg|text)-(?:green|red)-/);
  });

  it('shows a pending state while the vocabulary verification has not completed', () => {
    const state = makeCatalogState();
    state.vocabularyProvenance = makeVocabularyProvenance();
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getByText('Verifikation ausstehend…')).toBeInTheDocument();
  });

  it('renders legacy vocabulary metadata without files and fetched_at without crashing', () => {
    const legacyProvenance = makeVocabularyProvenance() as unknown as Record<string, unknown>;
    delete legacyProvenance.files;
    legacyProvenance.integrity = { fetchedAt: '2026-03-06T09:10:11Z' };

    const state = makeCatalogState();
    state.vocabularyProvenance =
      legacyProvenance as unknown as NonNullable<CatalogState['vocabularyProvenance']>;
    state.vocabularyVerification = makeVocabularyVerification(false);
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getByText('Vokabular-Verifikation fehlgeschlagen')).toBeInTheDocument();
    expect(screen.queryByText('Namespace-Dateien')).not.toBeInTheDocument();
    expect(screen.queryByText('Abgerufen am')).not.toBeInTheDocument();
  });

  it('copies the full snapshot commit SHA while displaying the truncated value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);

    const state = makeCatalogState();
    state.vocabularyProvenance = makeVocabularyProvenance();
    state.vocabularyVerification = makeVocabularyVerification(true);
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    expect(screen.getByText('fedcba098765')).toBeInTheDocument();

    const copyButton = screen.getByRole('button', { name: 'Snapshot-Commit kopieren' });
    fireEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith('fedcba0987654321fedcba0987654321fedcba09');
    await waitFor(() => {
      expect(screen.getByText('Kopiert')).toBeInTheDocument();
    });
  });

  it('shows a generic error and keeps the full verification command selectable', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Browser detail'));
    setClipboard(writeText);

    render(<AboutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Code kopieren' }));

    const alert = await screen.findByRole('alert');
    const command = screen.getByLabelText('Prüfbefehl zum manuellen Kopieren');

    expect(alert).toHaveTextContent(
      'Kopieren nicht möglich. Bitte den vollständigen Wert manuell markieren und kopieren.',
    );
    expect(screen.queryByText('Browser detail')).not.toBeInTheDocument();
    expect(command).toHaveClass('select-all');
    expect(command).toHaveTextContent(/^bash -lc/);
  });

  it('shows the full selectable snapshot commit when the Clipboard API is unavailable', async () => {
    setClipboard();
    const state = makeCatalogState();
    state.vocabularyProvenance = makeVocabularyProvenance();
    state.vocabularyVerification = makeVocabularyVerification(true);
    mockedUseCatalog.mockReturnValue(state);

    render(<AboutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Snapshot-Commit kopieren' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Kopieren nicht möglich');
    expect(
      screen.getByLabelText('Snapshot-Commit: vollständiger Wert zum manuellen Kopieren'),
    ).toHaveTextContent('fedcba0987654321fedcba0987654321fedcba09');
    expect(
      screen.getByLabelText('Snapshot-Commit: vollständiger Wert zum manuellen Kopieren'),
    ).toHaveClass('select-all');
  });
});
