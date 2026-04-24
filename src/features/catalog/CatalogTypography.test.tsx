import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Catalog,
  CatalogState,
  Control,
  VocabularyRegistryData,
} from '@/domain/models';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import { useCatalog } from '@/hooks/useCatalog';
import { SearchPage } from '@/features/search/SearchPage';
import { useSearch } from '@/features/search/useSearch';
import { ControlDetail } from './ControlDetail';
import { ControlTable } from './ControlTable';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

vi.mock('@/features/search/useSearch', () => ({
  useSearch: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const mockedUseSearch = vi.mocked(useSearch);

const control: Control = {
  id: 'ASST.1.1',
  title: 'Verfahren und Regelungen',
  groupId: 'ASST.1',
  practiceId: 'ASST',
  securityLevel: 'erhöht',
  securityLevelProp: {
    name: 'sec_level',
    value: 'erhöht',
    ns: 'https://example.com/namespaces/security_level.csv',
  },
  effortLevel: '4',
  effortLevelProp: {
    name: 'effort_level',
    value: '4',
    ns: 'https://example.com/namespaces/effort_level.csv',
  },
  modalverb: 'MUSS',
  modalverbProp: {
    name: 'modal_verb',
    value: 'MUSS',
    ns: 'https://example.com/namespaces/modal_verbs.csv',
  },
  tags: ['Governance'],
  tagsProp: {
    name: 'tags',
    value: 'Governance',
    ns: 'https://example.com/namespaces/tags.csv',
  },
  statement: 'Ein Verfahren ist nachvollziehbar dokumentiert.',
  statementRaw: 'Ein Verfahren ist nachvollziehbar dokumentiert.',
  guidance: 'Nutzen Sie etablierte Freigabeprozesse.',
  statementProps: {
    ergebnis: 'Verfahren und Regelungen',
    ergebnisProp: {
      name: 'result',
      value: 'Verfahren und Regelungen',
      ns: 'https://example.com/namespaces/result.csv',
    },
    praezisierung: 'nach einem Standard',
    praezisierungProp: {
      name: 'result_specification',
      value: 'nach einem Standard',
      ns: 'https://example.com/namespaces/result.csv',
    },
    handlungsworte: 'verankern',
    handlungsworteProp: {
      name: 'action_word',
      value: 'verankern',
      ns: 'https://example.com/namespaces/action_words.csv',
    },
    dokumentation: 'Richtlinie A',
    dokumentationProp: {
      name: 'documentation',
      value: 'Richtlinie A',
      ns: 'https://example.com/namespaces/documentation_guidelines.csv',
    },
    zielobjektKategorien: ['Server'],
    zielobjektKategorienProp: {
      name: 'target_object_categories',
      value: 'Server',
      ns: 'https://example.com/namespaces/target_object_categories.csv',
    },
  },
  links: [{ targetId: 'ASST.1.2', relation: 'related' }],
  params: {},
};

const controlMap = new Map<string, Control>([[control.id, control]]);

function makeVocabularyRegistry() {
  const registryData: VocabularyRegistryData = {
    sourceCommitSha: 'snapshot-123',
    namespaces: [
      {
        source: {
          namespace: 'https://example.com/namespaces/security_level.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/security_level.csv',
          fileName: 'security_level.csv',
          routeId: 'dokumentation-namespaces-security-level',
          gitBlobSha: 'blob-security',
        },
        columnOrder: ['Begriff', 'Definition'],
        valueColumn: 'Begriff',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'erhöht',
            definition: 'Erhöhte Sicherheitsstufe',
            columns: { Begriff: 'erhöht', Definition: 'Erhöhte Sicherheitsstufe' },
          },
        ],
      },
      {
        source: {
          namespace: 'https://example.com/namespaces/modal_verbs.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/modal_verbs.csv',
          fileName: 'modal_verbs.csv',
          routeId: 'dokumentation-namespaces-modal-verbs',
          gitBlobSha: 'blob-modal',
        },
        columnOrder: ['Modalverb', 'Definition'],
        valueColumn: 'Modalverb',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'MUSS',
            definition: 'Verbindliche Anforderung',
            columns: { Modalverb: 'MUSS', Definition: 'Verbindliche Anforderung' },
          },
        ],
      },
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
            value: '4',
            definition: 'Mehrere Wochen bis Monate',
            columns: { Aufwand: '4', Definition: 'Mehrere Wochen bis Monate' },
          },
        ],
      },
      {
        source: {
          namespace: 'https://example.com/namespaces/result.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/result.csv',
          fileName: 'result.csv',
          routeId: 'dokumentation-namespaces-result',
          gitBlobSha: 'blob-result',
        },
        columnOrder: ['Begriff', 'Definition'],
        valueColumn: 'Begriff',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'Verfahren und Regelungen',
            definition: 'Offiziell definiertes Ergebnis',
            columns: { Begriff: 'Verfahren und Regelungen', Definition: 'Offiziell definiertes Ergebnis' },
          },
          {
            value: 'nach einem Standard',
            definition: 'Offizielle Präzisierung',
            columns: { Begriff: 'nach einem Standard', Definition: 'Offizielle Präzisierung' },
          },
        ],
      },
      {
        source: {
          namespace: 'https://example.com/namespaces/action_words.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/action_words.csv',
          fileName: 'action_words.csv',
          routeId: 'dokumentation-namespaces-action-words',
          gitBlobSha: 'blob-action',
        },
        columnOrder: ['Infinitiv', 'Definition'],
        valueColumn: 'Infinitiv',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'verankern',
            definition: 'Offizielles Handlungswort',
            columns: { Infinitiv: 'verankern', Definition: 'Offizielles Handlungswort' },
          },
        ],
      },
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
      {
        source: {
          namespace: 'https://example.com/namespaces/target_object_categories.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/target_object_categories.csv',
          fileName: 'target_object_categories.csv',
          routeId: 'dokumentation-namespaces-target-object-categories',
          gitBlobSha: 'blob-target',
        },
        columnOrder: ['Kategorie', 'Definition'],
        valueColumn: 'Kategorie',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'Server',
            definition: 'Offizielle Zielobjekt-Kategorie',
            columns: { Kategorie: 'Server', Definition: 'Offizielle Zielobjekt-Kategorie' },
          },
        ],
      },
      {
        source: {
          namespace: 'https://example.com/namespaces/tags.csv',
          repository: 'https://example.com/repo',
          path: 'Dokumentation/namespaces/tags.csv',
          fileName: 'tags.csv',
          routeId: 'dokumentation-namespaces-tags',
          gitBlobSha: 'blob-tags',
        },
        columnOrder: ['Tag', 'Definition'],
        valueColumn: 'Tag',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'Governance',
            definition: 'Offizieller Tag',
            columns: { Tag: 'Governance', Definition: 'Offizieller Tag' },
          },
        ],
      },
    ],
  };

  return buildVocabularyRegistry(registryData);
}

function makeCatalogState(): CatalogState {
  return {
    catalog: {
      controls: [control],
      controlsById: controlMap,
      totalControls: 1,
    } as Catalog,
    provenance: null,
    vocabularyRegistry: makeVocabularyRegistry(),
    vocabularyProvenance: null,
    verification: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}

describe('catalog typography', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseSearch.mockReset();
    mockedUseCatalog.mockReturnValue(makeCatalogState());
  });

  it('keeps table identifiers mono while effort uses tabular sans numerals', () => {
    render(
      <ControlTable
        controls={[control]}
        controlsById={controlMap}
        selectedControlId={undefined}
        checkedIds={new Set()}
        sort={[{ field: 'id', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectControl={vi.fn()}
        onCheckedChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('columnheader', { name: 'Modalverb' }),
    ).not.toHaveClass('uppercase');
    expect(screen.getByText(control.id)).toHaveClass('catalog-reference-text');
    expect(screen.getByText(control.effortLevel ?? '')).toHaveClass('tabular-nums');
    expect(screen.getByText(control.effortLevel ?? '')).not.toHaveClass('font-mono');
    expect(screen.getByText(control.title).closest('td')).toHaveClass('type-object-title');
  });

  it('aligns hierarchy markers with the control title line in the table view', () => {
    const childControl: Control = {
      ...control,
      id: 'ASST.1.1.1',
      title: 'Erweiterung des Verfahrens',
      parentId: control.id,
    };
    const controlsById = new Map<string, Control>([
      [control.id, control],
      [childControl.id, childControl],
    ]);
    render(
      <ControlTable
        controls={[control, childControl]}
        controlsById={controlsById}
        selectedControlId={undefined}
        checkedIds={new Set()}
        sort={[{ field: 'id', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectControl={vi.fn()}
        onCheckedChange={vi.fn()}
      />,
    );

    const hierarchyMarker = screen.getByText('↳');

    expect(hierarchyMarker).toHaveClass('catalog-hierarchy-marker');
    expect(hierarchyMarker.parentElement).toHaveClass('items-baseline');
    expect(screen.getByText('Erweiterung des Verfahrens')).toBeInTheDocument();
    expect(screen.queryByText(`Erweiterung zu ${control.id}`)).not.toBeInTheDocument();
  });

  it('uses calm meta headings and medium-weight badges in the detail panel', () => {
    render(<ControlDetail control={control} onClose={vi.fn()} />);

    const sectionHeading = screen.getByRole('heading', {
      name: 'Anforderung',
      level: 3,
    });

    expect(sectionHeading).toHaveClass('text-sm', 'font-semibold', 'text-slate-800');
    expect(sectionHeading).not.toHaveClass('uppercase');
    expect(sectionHeading).not.toHaveClass('catalog-meta-text');
    expect(screen.getByText(control.id)).toHaveClass('catalog-reference-text');
    expect(screen.getByText('MUSS')).toHaveClass('font-medium');
    expect(screen.getByText('MUSS')).not.toHaveClass('font-semibold');
  });

  it('uses mobile-safe detail spacing and responsive title sizing', () => {
    const { container } = render(<ControlDetail control={control} onClose={vi.fn()} />);

    const backButton = screen.getByRole('button', { name: 'Zurück zur Übersicht' });
    const title = screen.getByRole('heading', { name: control.title, level: 2 });
    const scrollContainer = title.parentElement?.nextElementSibling;

    expect(backButton).toHaveClass('rounded-lg', 'h-11', 'w-11', 'lg:h-10', 'lg:w-10');
    expect(backButton.querySelector('span')).toBeNull();
    expect(title).toHaveClass('type-page-title');
    expect(scrollContainer).toHaveClass('pb-safe', 'lg:pb-4');
    expect(container.firstChild).toHaveClass('h-full', 'flex', 'flex-col', 'bg-[var(--color-surface-raised)]');
  });

  it('uses internal inline vocabulary cards instead of external namespace links', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /Namespace für/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'MUSS' }));

    expect(screen.getByText('modal_verbs.csv')).toBeInTheDocument();
    expect(screen.getByText('Verbindliche Anforderung')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zu den Vokabularen →' })).toHaveAttribute(
      'href',
      '/vokabular/dokumentation-namespaces-modal-verbs?wert=MUSS',
    );
  });

  it('surfaces parent-child hierarchy in the detail panel', () => {
    const childControl: Control = {
      ...control,
      id: 'ASST.1.1.1',
      title: 'Erweiterung des Verfahrens',
      parentId: control.id,
    };

    render(
      <ControlDetail
        control={control}
        parentControl={undefined}
        childControls={[childControl]}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Erweiterungen', level: 4 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ASST\.1\.1\.1 Erweiterung des Verfahrens/ })).toBeInTheDocument();
  });

  it('reuses the same identifier and title hierarchy in search results', () => {
    mockedUseCatalog.mockReturnValue(makeCatalogState());
    mockedUseSearch.mockReturnValue({
      results: [{ control }],
      totalResults: 1,
    });

    render(
      <MemoryRouter initialEntries={['/suche?q=verfahren']}>
        <Routes>
          <Route path="/suche" element={<SearchPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const desktop = screen.getByTestId('search-results-desktop');
    expect(within(desktop).getByRole('grid')).toBeInTheDocument();
    expect(within(desktop).getByText(control.id)).toHaveClass('catalog-reference-text');
    expect(within(desktop).getByText(control.title).closest('td')).toHaveClass('type-object-title');
    expect(within(desktop).getByText('MUSS')).toHaveClass('catalog-meta-text');
  });
});
