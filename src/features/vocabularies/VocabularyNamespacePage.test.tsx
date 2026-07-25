import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogState, VocabularyRegistryData } from '@/domain/models';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import { useCatalog } from '@/hooks/useCatalog';
import { VocabularyNamespacePage } from './VocabularyNamespacePage';

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
          namespace: 'https://example.com/namespaces/effort_level.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/effort_level.csv',
          fileName: 'effort_level.csv',
          routeId: 'dokumentation-namespaces-effort-level',
          gitBlobSha: 'blob-effort',
        },
        columnOrder: ['Aufwand', 'Definition'],
        valueColumn: 'Aufwand',
        definitionColumn: 'Definition',
        entries: [
          {
            value: '0',
            definition: 'Sofort umsetzbar.',
            columns: { Aufwand: '0', Definition: 'Sofort umsetzbar.' },
          },
          {
            value: '1',
            definition: 'Innerhalb weniger Stunden umsetzbar.',
            columns: { Aufwand: '1', Definition: 'Innerhalb weniger Stunden umsetzbar.' },
          },
          {
            value: '2',
            definition: 'In der Regel ist die Umsetzung innerhalb einer Woche moeglich.',
            columns: {
              Aufwand: '2',
              Definition: 'In der Regel ist die Umsetzung innerhalb einer Woche moeglich.',
            },
          },
          {
            value: '3',
            definition: 'Erfordert mehrere Wochen.',
            columns: { Aufwand: '3', Definition: 'Erfordert mehrere Wochen.' },
          },
        ],
      },
      {
        source: {
          namespace: 'https://example.com/namespaces/basethreats.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/basethreats.csv',
          fileName: 'basethreats.csv',
          routeId: 'dokumentation-namespaces-basethreats',
          gitBlobSha: 'blob-basethreats',
        },
        columnOrder: ['ID', 'Begriff', 'Definition', 'uuid'],
        valueColumn: 'ID',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'G 0.1',
            definition: 'Feuer kann schwere Schäden verursachen.',
            columns: {
              ID: 'G 0.1',
              Begriff: 'Feuer',
              Definition: 'Feuer kann schwere Schäden verursachen.',
              uuid: '550e8400-e29b-41d4-a716-446655440001',
            },
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

describe('VocabularyNamespacePage', () => {
  it('shows the selected definition directly below the active entry in the list', () => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());

    render(
      <MemoryRouter initialEntries={['/vokabular/dokumentation-namespaces-effort-level?wert=2']}>
        <Routes>
          <Route path="/vokabular/:namespaceId" element={<VocabularyNamespacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    const activeLink = screen.getByRole('link', { name: '2' });
    const definitionText = screen.getByText('In der Regel ist die Umsetzung innerhalb einer Woche moeglich.');
    const nextLink = screen.getByRole('link', { name: '3' });

    expect(
      activeLink.compareDocumentPosition(definitionText) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      definitionText.compareDocumentPosition(nextLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(activeLink.className).toContain('border-[var(--color-accent-default)]');
    expect(activeLink.className).toContain('bg-[var(--color-accent-soft)]');
    expect(activeLink).toHaveClass('font-medium');
    expect(activeLink.className).toContain('text-[var(--color-text-primary)]');
    expect(nextLink).toHaveClass('border-transparent');
    expect(nextLink.className).toContain('hover:border-[var(--color-border-default)]');
    expect(nextLink.className).toContain('hover:bg-[var(--color-surface-subtle)]');
    expect(screen.queryByRole('link', { name: 'Vokabularseite öffnen' })).not.toBeInTheDocument();
  });

  it('keeps a concise inline hint when no value is selected yet', () => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());

    render(
      <MemoryRouter initialEntries={['/vokabular/dokumentation-namespaces-effort-level']}>
        <Routes>
          <Route path="/vokabular/:namespaceId" element={<VocabularyNamespacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/definition direkt unter dem eintrag anzuzeigen/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('In der Regel ist die Umsetzung innerhalb einer Woche moeglich.')).not.toBeInTheDocument();
  });

  it('shows the Begriff next to the ID in the collapsed list when the value column is not the term itself', () => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());

    render(
      <MemoryRouter initialEntries={['/vokabular/dokumentation-namespaces-basethreats']}>
        <Routes>
          <Route path="/vokabular/:namespaceId" element={<VocabularyNamespacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'G 0.1 — Feuer' })).toBeInTheDocument();
  });

  it('does not duplicate the term when the value column already is the Begriff', () => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());

    render(
      <MemoryRouter initialEntries={['/vokabular/dokumentation-namespaces-effort-level']}>
        <Routes>
          <Route path="/vokabular/:namespaceId" element={<VocabularyNamespacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: '2' })).toBeInTheDocument();
    expect(screen.queryByText(/—/)).not.toBeInTheDocument();
  });

  it('lets the inline definition use the full card width instead of a prose cap', () => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());

    render(
      <MemoryRouter initialEntries={['/vokabular/dokumentation-namespaces-effort-level?wert=2']}>
        <Routes>
          <Route path="/vokabular/:namespaceId" element={<VocabularyNamespacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    const definitionText = screen.getByText('In der Regel ist die Umsetzung innerhalb einer Woche moeglich.');
    const wrapper = definitionText.closest('div.space-y-3');
    expect(wrapper).not.toBeNull();
    expect(wrapper).not.toHaveClass('max-w-3xl');
    expect(wrapper).not.toHaveClass('max-w-prose');
  });
});
