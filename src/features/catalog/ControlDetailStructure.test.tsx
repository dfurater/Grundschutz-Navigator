import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, CatalogState, Control } from '@/domain/models';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import { useCatalog } from '@/hooks/useCatalog';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { ControlDetail } from './ControlDetail';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const vocabularyRegistry = createTestVocabularyRegistry();

const SECURITY_TARGETS_NS =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.2.2',
    title: 'Struktur-Kontrolle',
    groupId: 'GC.2',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Die Institution muss die Vorgaben verankern.',
    statementRaw: 'Die Institution muss die Vorgaben verankern.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
      ...overrides.statementProps,
    },
    links: [],
    params: {},
    ...overrides,
  };
}

function makeCatalogState(overrides: Partial<CatalogState> = {}): CatalogState {
  return {
    ...catalogCollectionDefaults(),
    catalogDocument: null,
    catalog: {
      catalogKey: 'gspp',
      uuid: 'test-catalog',
      metadata: {
        title: 'Testkatalog',
        lastModified: '2026-07-21T00:00:00Z',
        version: 'test',
        oscalVersion: '1.1.3',
        props: [],
        links: [],
        roles: [],
        parties: [],
        responsibleParties: [],
      },
      practices: [],
      controlsById: new Map(),
      controlsByAltIdentifier: new Map(),
      controls: [],
      backMatter: [],
      totalControls: 0,
    } satisfies Catalog,
    provenance: null,
    verification: null,
    vocabularyRegistry,
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
    ...overrides,
  };
}

function makeCatalogStateWithSource(
  control: Control,
  sourceLinks: readonly Record<string, unknown>[],
  sourceResources: readonly Record<string, unknown>[],
): CatalogState {
  const state = makeCatalogState();
  state.catalogDocument = {
    source: {
      catalog: {
        uuid: 'test-catalog',
        metadata: {
          title: 'Testkatalog',
          'last-modified': '2026-07-21T00:00:00Z',
          version: 'test',
          'oscal-version': '1.1.3',
        },
        groups: [{
          id: 'GC',
          title: 'Praktik',
          groups: [{
            id: 'GC.2',
            title: 'Thema',
            controls: [{
              id: control.id,
              title: control.title,
              links: sourceLinks,
            }],
          }],
        }],
        'back-matter': { resources: sourceResources },
      },
    },
    context: {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    },
    view: state.catalog!,
  };
  return state;
}

const linkTarget = makeControl({ id: 'GC.2.3', title: 'Verknüpfte Kontrolle' });
const incomingOnlyControl = makeControl({ id: 'GC.3.1', title: 'Eingehende Kontrolle' });
const parentControl = makeControl({ id: 'GC.2', title: 'Übergeordnete Kontrolle' });
const childControl = makeControl({ id: 'GC.2.2.1', title: 'Erweiterung' });

function makeFullControl(): Control {
  return makeControl({
    modalverb: 'MUSS',
    modalverbProp: {
      name: 'modal_verb',
      value: 'MUSS',
      ns: 'https://example.com/namespaces/modal_verbs.csv',
    },
    confidentiality: '2',
    confidentialityProp: { name: 'confidentiality', value: '2', ns: SECURITY_TARGETS_NS },
    integrity: '1',
    integrityProp: { name: 'integrity', value: '1', ns: SECURITY_TARGETS_NS },
    availability: '1',
    availabilityProp: { name: 'availability', value: '1', ns: SECURITY_TARGETS_NS },
    authenticity: '0',
    authenticityProp: { name: 'authenticity', value: '0', ns: SECURITY_TARGETS_NS },
    threats: ['G 0.18'],
    guidance: 'Ausführlicher Umsetzungshinweis.',
    links: [{
      targetId: linkTarget.id,
      href: `#${linkTarget.id}`,
      rel: 'related',
      relStatus: 'custom',
    }],
    altIdentifier: 'uuid-struktur-test',
  });
}

function makeFullState(control: Control): CatalogState {
  return makeCatalogStateWithSource(
    control,
    [{ href: '#resource-uuid' }],
    [{
      uuid: 'resource-uuid',
      title: 'Quellendokument',
      rlinks: [],
    }],
  );
}

interface RenderFullOptions {
  readonly control?: Control;
  readonly state?: CatalogState;
  readonly parent?: Control;
  readonly children?: Control[];
  readonly incoming?: IncomingControlLink[];
  readonly onNavigateToControl?: (control: Control) => void;
}

function renderFull(options: RenderFullOptions = {}) {
  const control = options.control ?? makeFullControl();
  mockedUseCatalog.mockReturnValue(options.state ?? makeFullState(control));
  const onNavigateToControl = options.onNavigateToControl ?? vi.fn();
  const view = render(
    <MemoryRouter>
      <ControlDetail
        control={control}
        controlsById={new Map([[linkTarget.id, linkTarget]])}
        incomingLinks={options.incoming ?? [
          { control: incomingOnlyControl, link: { targetId: incomingOnlyControl.id, href: `#${incomingOnlyControl.id}`, rel: 'related', relStatus: 'custom' } },
        ]}
        parentControl={options.parent ?? parentControl}
        childControls={options.children ?? [childControl]}
        onClose={vi.fn()}
        onNavigateToControl={onNavigateToControl}
      />
    </MemoryRouter>,
  );
  return { ...view, onNavigateToControl };
}

describe('ControlDetail Struktur (GSPP-303 T9)', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
  });

  it('(a) rendert die Blöcke in der T4-Reihenfolge', () => {
    const { container } = renderFull();
    const scope = within(container);

    const kopf = scope.getByRole('button', { name: 'Zurück zur Übersicht' });
    const kurzprofil = scope.getByRole('group', { name: 'Kriterien' });
    const anforderung = scope.getByRole('heading', { level: 3, name: 'Anforderung' });
    const hinweise = scope.getByRole('heading', { level: 3, name: 'Umsetzungshinweise' });
    const merkmale = scope.getByRole('heading', { level: 3, name: 'Schutzziele und Gefährdungen' });
    const zusammenhaenge = scope.getByRole('heading', { level: 3, name: 'Zusammenhänge' });
    const fusszeile = scope.getByText('uuid-struktur-test');

    // Kopf → Anforderung (Kriterien als erste Zeile) → Umsetzungshinweise → Schutzziele und Gefährdungen → Zusammenhänge → Fußzeile
    const ordered = [kopf, anforderung, kurzprofil, hinweise, merkmale, zusammenhaenge, fusszeile];
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const position = ordered[index].compareDocumentPosition(ordered[index + 1]);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    // Kriterien: Badges im Block „Anforderung“, Legende in dessen Leiste
    expect(within(kurzprofil).getByText('MUSS')).toBeInTheDocument();
    expect(anforderung.closest('section')!.contains(kurzprofil)).toBe(true);
    expect(within(anforderung.parentElement!).getByRole('button', { name: 'Legende' }))
      .toHaveAttribute('aria-controls', 'legende-anforderung');

    // Anforderung: Satz in derselben Fließtextgröße wie die Umsetzungshinweise
    const satz = Array.from(container.querySelectorAll('p')).find(
      (paragraph) => paragraph.textContent?.includes('Die Institution muss die Vorgaben verankern.'),
    );
    expect(satz).toHaveClass('text-sm', 'leading-relaxed', 'text-slate-700');

    // Legenden „Schutzziele und Gefährdungen“ und „Zusammenhänge“
    expect(container.querySelector('#legende-schutzziele')).not.toBeNull();
    expect(container.querySelector('#legende-zusammenhaenge')).not.toBeNull();
  });

  it('(b) führt exakt die vier Blocküberschriften; Kurzprofil/Fußzeile ohne h3', () => {
    const { container } = renderFull();
    const scope = within(container);

    const headings = scope.getAllByRole('heading', { level: 3 }).map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual([
      'Anforderung',
      'Umsetzungshinweise',
      'Schutzziele und Gefährdungen',
      'Zusammenhänge',
    ]);

    expect(scope.queryByRole('heading', { name: 'Kurzprofil' })).toBeNull();
    expect(scope.queryByRole('heading', { name: 'Fußzeile' })).toBeNull();
    expect(scope.queryByRole('heading', { name: 'Klassifikation' })).toBeNull();
  });

  it('(c) zeigt „Teil von" nur mit parentControl und navigiert dorthin', async () => {
    const user = userEvent.setup();
    const { container, onNavigateToControl } = renderFull();
    const scope = within(container);

    const teilVon = scope.getByRole('button', {
      name: 'Teil von GC.2 Übergeordnete Kontrolle',
    });
    expect(teilVon).toHaveTextContent('↳ Teil von GC.2 Übergeordnete Kontrolle');
    await user.click(teilVon);
    expect(onNavigateToControl).toHaveBeenCalledWith(parentControl);

    // Ohne parentControl: keine Zeile (auch kein Metadata-Fallback ohne parentId)
    const control = makeFullControl();
    mockedUseCatalog.mockReturnValue(makeFullState(control));
    const bare = render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(
      within(bare.container).queryByRole('button', { name: /Teil von/ }),
    ).toBeNull();
  });

  it('(d) gruppiert Zusammenhänge in Erweiterungen/Verknüpft/Quellen', () => {
    const { container } = renderFull();
    const scope = within(container);

    expect(scope.getByRole('heading', { level: 4, name: 'Erweiterungen' })).toBeInTheDocument();
    expect(scope.getByRole('heading', { level: 4, name: 'Verknüpft' })).toBeInTheDocument();
    expect(scope.getByRole('heading', { level: 4, name: 'Quellen' })).toBeInTheDocument();

    // Kinder
    expect(scope.getByRole('button', { name: 'GC.2.2.1 Erweiterung' })).toBeInTheDocument();
    // Aus- und eingehende Links unter EINER Beschriftung
    const verknuepft = scope.getByRole('heading', { level: 4, name: 'Verknüpft' }).parentElement!;
    expect(within(verknuepft).getByText('Verknüpfte Kontrolle')).toBeInTheDocument();
    expect(within(verknuepft).getByText('Eingehende Kontrolle')).toBeInTheDocument();
    // Quellen
    expect(scope.getByText('Quellendokument')).toBeInTheDocument();

    // Fehlt alles → kein Zusammenhänge-Block
    const control = makeControl({ guidance: '' });
    mockedUseCatalog.mockReturnValue(makeCatalogState());
    const bare = render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(
      within(bare.container).queryByRole('heading', { level: 3, name: 'Zusammenhänge' }),
    ).toBeNull();
  });

  it('(e) baut alle Blöcke gleich auf: keine graue Zone, Leisten im selben Ton', () => {
    const { container } = renderFull();
    const scope = within(container);

    // Alle Blöcke und die Fußzeile stehen direkt im Scrollbereich, ohne Zonen-Hülle.
    const scroll = container.querySelector('[data-control-detail-scroll]')!;
    for (const name of ['Anforderung', 'Schutzziele und Gefährdungen', 'Zusammenhänge']) {
      expect(scope.getByRole('heading', { level: 3, name }).closest('section')!.parentElement).toBe(scroll);
    }
    expect(scope.getByText('uuid-struktur-test').closest('dl')!.parentElement).toBe(scroll);

    // Jede Leiste trägt denselben Ton; die Leiste ist das Elternelement der Überschrift.
    const barOf = (name: string) =>
      scope.getByRole('heading', { level: 3, name }).parentElement!.className;
    for (const name of ['Anforderung', 'Schutzziele und Gefährdungen', 'Zusammenhänge']) {
      expect(barOf(name)).toContain('bg-[var(--color-surface-subtle)]');
      expect(barOf(name)).not.toContain('bg-slate-100');
    }
  });

  it('(f) lässt leere Gruppen/Blöcke entfallen', () => {
    const control = makeControl({ guidance: '' });
    mockedUseCatalog.mockReturnValue(makeCatalogState());
    const { container } = render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    const scope = within(container);

    // Keine Tags-Gruppe ohne Tags/Zielobjekte
    expect(scope.queryByText('Tags und Zielobjektkategorien')).toBeNull();
    // Kein Zusammenhänge-Block ohne Kinder/Links/Quellen
    expect(
      scope.queryByRole('heading', { level: 3, name: 'Zusammenhänge' }),
    ).toBeNull();
    // Übrig bleibt nur die Anforderung
    expect(
      scope.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Anforderung']);
  });
});
