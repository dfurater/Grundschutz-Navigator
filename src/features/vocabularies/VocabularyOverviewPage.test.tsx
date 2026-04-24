import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogState, VocabularyRegistryData } from '@/domain/models';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import { useCatalog } from '@/hooks/useCatalog';
import { VocabularyOverviewPage } from './VocabularyOverviewPage';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);

function makeCatalogState(): CatalogState {
  const registryData: VocabularyRegistryData = {
    sourceCommitSha: 'snapshot-123',
    namespaces: [
      {
        source: {
          namespace: 'https://example.com/namespaces/documentation_guidelines.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/documentation_guidelines.csv',
          fileName: 'documentation_guidelines.csv',
          routeId: 'dokumentation-namespaces-documentation-guidelines',
          gitBlobSha: 'blob-docs',
        },
        columnOrder: ['Begriff', 'Definition'],
        valueColumn: 'Begriff',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'Richtlinie A',
            definition: 'Offizielle Dokumentationsvorgabe',
            columns: { Begriff: 'Richtlinie A', Definition: 'Offizielle Dokumentationsvorgabe' },
          },
        ],
      },
    ],
  };

  return {
    catalog: null,
    provenance: null,
    vocabularyRegistry: buildVocabularyRegistry(registryData),
    vocabularyProvenance: null,
    verification: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}

describe('VocabularyOverviewPage', () => {
  it('uses a quieter list with a fachlicher primary label and only secondary technical metadata', () => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());

    render(
      <MemoryRouter>
        <VocabularyOverviewPage />
      </MemoryRouter>,
    );

    const rowLink = screen.getByRole('link', { name: 'Dokumentationsvorgaben' });
    const fileLink = screen.getByRole('link', { name: 'documentation_guidelines.csv' });

    expect(rowLink).toHaveAttribute('href', '/vokabular/dokumentation-namespaces-documentation-guidelines');
    expect(screen.getByText('Dokumentationsvorgaben')).toHaveClass('type-object-title');
    expect(fileLink).toHaveAttribute(
      'href',
      'https://example.com/repo/blob/snapshot-123/Dokumentation/namespaces/documentation_guidelines.csv',
    );
    expect(fileLink).toHaveAttribute('target', '_blank');
    expect(fileLink).toHaveClass('catalog-meta-type', 'catalog-link-color', 'block');
    expect(screen.queryByText('Dokumentation/namespaces/documentation_guidelines.csv')).not.toBeInTheDocument();
  });
});
