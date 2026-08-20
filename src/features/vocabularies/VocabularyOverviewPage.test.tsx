import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogState, VocabularyRegistryData } from '@/domain/models';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import { useCatalog } from '@/hooks/useCatalog';
import { VocabularyOverviewPage } from './VocabularyOverviewPage';
import { catalogCollectionDefaults } from '@/test/catalogState';

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
          path: 'documentation/namespaces/documentation_guidelines.csv',
          fileName: 'documentation_guidelines.csv',
          routeId: 'documentation-namespaces-documentation-guidelines',
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
      {
        source: {
          namespace: 'https://example.com/namespaces/basethreats.csv',
          repository: 'https://example.com/repo',
          path: 'documentation/namespaces/basethreats.csv',
          fileName: 'basethreats.csv',
          routeId: 'documentation-namespaces-basethreats',
          gitBlobSha: 'blob-threats',
        },
        columnOrder: ['Begriff', 'Definition'],
        valueColumn: 'Begriff',
        definitionColumn: 'Definition',
        entries: [],
      },
      {
        source: {
          namespace:
            'https://example.com/namespaces/security_targets_levels.csv',
          repository: 'https://example.com/repo',
          path: 'documentation/namespaces/security_targets_levels.csv',
          fileName: 'security_targets_levels.csv',
          routeId: 'documentation-namespaces-security-target-levels',
          gitBlobSha: 'blob-target-levels',
        },
        columnOrder: ['Wert', 'Definition'],
        valueColumn: 'Wert',
        definitionColumn: 'Definition',
        entries: [],
      },
      {
        source: {
          namespace: 'https://example.com/namespaces/security_targets.csv',
          repository: 'https://example.com/repo',
          path: 'documentation/namespaces/security_targets.csv',
          fileName: 'security_targets.csv',
          routeId: 'documentation-namespaces-security-targets',
          gitBlobSha: 'blob-targets',
        },
        columnOrder: ['Begriff', 'Definition'],
        valueColumn: 'Begriff',
        definitionColumn: 'Definition',
        entries: [],
      },
      {
        source: {
          namespace: 'https://example.com/namespaces/practices.csv',
          repository: 'https://example.com/repo',
          path: 'documentation/namespaces/practices.csv',
          fileName: 'practices.csv',
          routeId: 'documentation-namespaces-practices',
          gitBlobSha: 'blob-practices',
        },
        columnOrder: ['Kürzel', 'Begriff', 'Definition', 'UUID'],
        valueColumn: 'Kürzel',
        definitionColumn: 'Definition',
        entries: [],
      },
      {
        source: {
          namespace: 'https://example.com/namespaces/topics.csv',
          repository: 'https://example.com/repo',
          path: 'documentation/namespaces/topics.csv',
          fileName: 'topics.csv',
          routeId: 'documentation-namespaces-topics',
          gitBlobSha: 'blob-topics',
        },
        columnOrder: ['Begriff', 'Definition', 'UUID'],
        valueColumn: 'Begriff',
        definitionColumn: 'Definition',
        entries: [],
      },
    ],
  };

  return {
    ...catalogCollectionDefaults(),
    catalogDocument: null,
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

    expect(rowLink).toHaveAttribute('href', '/vokabular/documentation-namespaces-documentation-guidelines');
    expect(screen.getByText('Dokumentationsvorgaben')).toHaveClass('type-object-title');
    expect(fileLink).toHaveAttribute(
      'href',
      'https://example.com/repo/blob/snapshot-123/documentation/namespaces/documentation_guidelines.csv',
    );
    expect(fileLink).toHaveAttribute('target', '_blank');
    expect(fileLink).toHaveClass('catalog-meta-type', 'catalog-link-color', 'block');
    expect(screen.queryByText('documentation/namespaces/documentation_guidelines.csv')).not.toBeInTheDocument();
  });

  it('uses curated German titles and routes for security targets and base threats', () => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());

    render(
      <MemoryRouter>
        <VocabularyOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Elementare Gefährdungen' })).toHaveAttribute(
      'href',
      '/vokabular/documentation-namespaces-basethreats',
    );
    expect(screen.getByRole('link', { name: 'Schutzziele' })).toHaveAttribute(
      'href',
      '/vokabular/documentation-namespaces-security-targets',
    );
    expect(screen.getByRole('link', { name: 'Schutzziel-Relevanz' })).toHaveAttribute(
      'href',
      '/vokabular/documentation-namespaces-security-target-levels',
    );
    expect(screen.getByRole('link', { name: 'Praktiken' })).toHaveAttribute(
      'href',
      '/vokabular/documentation-namespaces-practices',
    );
    expect(screen.getByRole('link', { name: 'Themen' })).toHaveAttribute(
      'href',
      '/vokabular/documentation-namespaces-topics',
    );
  });
});
