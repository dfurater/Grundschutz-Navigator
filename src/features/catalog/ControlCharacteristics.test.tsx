import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Control } from '@/domain/models';
import { resolveControlVocabularies } from '@/domain/vocabulary';
import {
  VOCABULARY_IDENTIFIERS,
  createTestVocabularyRegistry,
} from '@/test/fixtures/vocabulary';
import { VocabularyEntryCard } from '@/features/vocabularies/VocabularyEntryCard';
import { ControlSecurityContext } from './ControlSecurityContext';
import {
  ControlSecurityTargets,
  type SecurityTargetRow,
} from './ControlSecurityTargets';
import { ControlSubjectGroups } from './ControlTaxonomy';
import { toVocabCardId } from './ControlVocabularyPrimitives';

const registry = createTestVocabularyRegistry();

const SECURITY_TARGETS_NS =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.2.2',
    title: 'Merkmale-Kontrolle',
    groupId: 'GC.2',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Anforderung',
    statementRaw: 'Anforderung',
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

function makeSecurityRows(): SecurityTargetRow[] {
  const control = makeControl({
    confidentialityProp: {
      name: 'confidentiality',
      value: '2',
      ns: SECURITY_TARGETS_NS,
    },
    integrityProp: { name: 'integrity', value: '1', ns: SECURITY_TARGETS_NS },
    availabilityProp: {
      name: 'availability',
      value: '1',
      ns: SECURITY_TARGETS_NS,
    },
    authenticityProp: {
      name: 'authenticity',
      value: '0',
      ns: SECURITY_TARGETS_NS,
    },
  });
  const resolved = resolveControlVocabularies(registry, control);

  return [
    {
      key: 'confidentiality',
      label: 'Vertraulichkeit',
      relevance: '2',
      targetResolution: resolved.securityTargets.confidentiality,
      levelResolution: resolved.securityTargetLevels.confidentiality,
    },
    {
      key: 'integrity',
      label: 'Integrität',
      relevance: '1',
      targetResolution: resolved.securityTargets.integrity,
      levelResolution: resolved.securityTargetLevels.integrity,
    },
    {
      key: 'availability',
      label: 'Verfügbarkeit',
      relevance: '1',
      targetResolution: resolved.securityTargets.availability,
      levelResolution: resolved.securityTargetLevels.availability,
    },
    {
      key: 'authenticity',
      label: 'Authentizität',
      relevance: '0',
      targetResolution: resolved.securityTargets.authenticity,
      levelResolution: resolved.securityTargetLevels.authenticity,
    },
  ];
}

function renderSecurityTargets(rows: SecurityTargetRow[]) {
  return render(
    <MemoryRouter>
      <ControlSecurityTargets
        securityTargets={rows}
        isVocabularyActive={() => false}
        onToggleVocabulary={vi.fn()}
        renderVocabularyCard={() => null}
      />
    </MemoryRouter>,
  );
}

describe('ControlCharacteristics (GSPP-303 T7)', () => {
  it('Schutzziele als 2×2-Raster mit TermTriggern und Punkte-Skala', () => {
    const { container } = renderSecurityTargets(makeSecurityRows());
    const scope = within(container);

    // Grid statt Tabelle: genau ein 2-spaltiger Container, keine Tabelle.
    const grid = container.querySelector('div.grid.grid-cols-2');
    expect(grid).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();

    // Je Row ein Schutzziel-Trigger plus ein Relevanz-Trigger (4 + 4),
    // dazu der Legende-Textlink.
    expect(scope.getAllByRole('button')).toHaveLength(9);
    expect(scope.getByRole('button', { name: 'Legende' })).toBeInTheDocument();
    for (const [label, relevance] of [
      ['Vertraulichkeit', '2'],
      ['Integrität', '1'],
      ['Verfügbarkeit', '1'],
      ['Authentizität', '0'],
    ] as const) {
      const target = scope.getByRole('button', {
        name: `Schutzziel: ${label}`,
      });
      const key = label === 'Vertraulichkeit'
        ? 'confidentiality'
        : label === 'Integrität'
          ? 'integrity'
          : label === 'Verfügbarkeit'
            ? 'availability'
            : 'authenticity';
      expect(target).toHaveAttribute(
        'aria-controls',
        toVocabCardId(`security-target:${key}`),
      );
      // Abkürzungs-Stil statt Icon-Affordanz.
      expect(scope.getByText(label)).toHaveClass(
        'underline',
        'decoration-dotted',
        'underline-offset-4',
      );

      // Relevanz-Trigger nennt Schutzziel + Relevanzwert und ist verdrahtet.
      const level = scope.getByRole('button', {
        name: `Relevanz ${label}: ${relevance}`,
      });
      expect(level).toHaveAttribute(
        'aria-controls',
        toVocabCardId(`security-target-level:${key}`),
      );
    }

    // Punkte-Skala rein visuell (aria-hidden), Bedeutung im aria-label.
    const scales = grid?.querySelectorAll('[aria-hidden="true"]') ?? [];
    expect(scales.length).toBeGreaterThan(0);
  });

  it('Legende erklärt alle drei BSI-Relevanzstufen auch bei nur einem vorkommenden Wert', () => {
    const { container } = renderSecurityTargets(makeSecurityRows().slice(0, 1));
    const scope = within(container);

    fireEvent.click(scope.getByRole('button', { name: 'Legende' }));
    const legend = container.querySelector('#legende-merkmale');
    expect(legend).not.toBeNull();
    for (const level of ['0', '1', '2']) {
      expect(within(legend as HTMLElement).getByRole('link', { name: level })).toBeInTheDocument();
    }
  });

  it('Relevanz außerhalb der Skala bleibt Plain-Text mit amber Hinweis', () => {
    const rows = makeSecurityRows();
    const outOfScale: SecurityTargetRow = {
      key: 'confidentiality',
      label: 'Vertraulichkeit',
      relevance: '3',
      targetResolution: rows[0].targetResolution,
      levelResolution: null,
    };
    const { container } = renderSecurityTargets([outOfScale]);
    const scope = within(container);

    expect(
      scope.queryByRole('button', { name: 'Relevanz Vertraulichkeit: 3' }),
    ).toBeNull();
    expect(scope.getByText('3')).toBeInTheDocument();
    expect(
      scope.getByText(
        'Keine offizielle Definition für diese Relevanzstufe verfügbar.',
      ),
    ).toBeInTheDocument();
  });

  it('Gefährdung zeigt nur den Namen; Kennung in aria-label, Karte und Tooltip', () => {
    const control = makeControl({
      threats: ['G 0.18'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });
    const resolved = resolveControlVocabularies(registry, control);
    const { container } = render(
      <MemoryRouter>
        <ControlSecurityContext
          control={control}
          resolvedVocabularies={resolved}
          isVocabularyActive={() => false}
          onToggleVocabulary={vi.fn()}
          renderVocabularyCard={() => null}
        />
      </MemoryRouter>,
    );
    const scope = within(container);

    // Sichtbar nur der Name — kein `(G x.y)` im Text.
    expect(scope.getByText('Fehlplanung oder fehlende Anpassung')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\(G 0\.18\)/);

    // Kennung im Accessible Name …
    const trigger = scope.getByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    });
    expect(trigger).toHaveAttribute(
      'aria-controls',
      toVocabCardId('threat:G 0.18:0'),
    );

    // … und im Hover-Tooltip.
    fireEvent.focus(trigger);
    expect(
      scope.getByRole('tooltip', { name: 'G 0.18' }),
    ).toBeInTheDocument();
  });

  it('aufgeklappte Gefährdungskarte blendet den redundanten Begriff aus', () => {
    const control = makeControl({
      threats: ['G 0.18'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });
    const resolved = resolveControlVocabularies(registry, control);
    const { container } = render(
      <MemoryRouter>
        <ControlSecurityContext
          control={control}
          resolvedVocabularies={resolved}
          isVocabularyActive={() => true}
          onToggleVocabulary={vi.fn()}
          renderVocabularyCard={(resolution, options) => (
            <VocabularyEntryCard
              resolution={resolution}
              hiddenColumns={options?.hiddenColumns}
            />
          )}
        />
      </MemoryRouter>,
    );

    const card = container.querySelector(
      `#${toVocabCardId('threat:G 0.18:0')}`,
    );
    expect(card).not.toBeNull();
    const cardScope = within(card as HTMLElement);
    expect(cardScope.queryByText('Begriff')).toBeNull();
    expect(
      cardScope.getByText(VOCABULARY_IDENTIFIERS.threatG018),
    ).toBeInTheDocument();
  });

  it('Tags/Zielobjekte ohne Rahmen und Symbol, getrennt durch „·"', () => {
    const control = makeControl({
      tags: ['Governance', 'Unbekannt'],
      tagsProp: {
        name: 'tags',
        value: 'Governance, Unbekannt',
        ns: 'https://example.com/namespaces/tags.csv',
      },
      statementProps: {
        zielobjektKategorien: ['Server'],
        zielobjektKategorienProp: {
          name: 'zielobjekt',
          value: 'Server',
          ns: 'https://example.com/namespaces/target_object_categories.csv',
        },
      },
    });
    const resolved = resolveControlVocabularies(registry, control);
    const { container } = render(
      <MemoryRouter>
        <ControlSubjectGroups
          control={control}
          resolvedVocabularies={resolved}
          hasControllingCriteria={false}
          isVocabularyActive={() => false}
          onToggleVocabulary={vi.fn()}
          renderVocabularyCard={() => null}
        />
      </MemoryRouter>,
    );
    const scope = within(container);

    // Kein Rahmen, kein Symbol.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('span[class*="border"]')).toBeNull();

    // Auflösbar → TermTrigger, sonst Plain-Text.
    expect(scope.getByRole('button', { name: 'Tag: Governance' })).toBeInTheDocument();
    expect(scope.getByRole('button', { name: 'Zielobjekt: Server' })).toBeInTheDocument();
    expect(scope.getByText('Unbekannt')).toBeInTheDocument();
    expect(
      scope.queryByRole('button', { name: 'Tag: Unbekannt' }),
    ).toBeNull();

    expect(scope.getByRole('heading', { name: 'Tags' })).toBeInTheDocument();
    expect(scope.getByRole('heading', { name: 'Zielobjekte' })).toBeInTheDocument();
    // Trennpunkte stehen nur zwischen Werten derselben Gruppe.
    expect(scope.getAllByText('·')).toHaveLength(1);
  });

  it('kein catalog-vocabulary-affordance in allen drei Merkmal-Containern', () => {
    const threatControl = makeControl({
      threats: ['G 0.18'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });
    const threatResolved = resolveControlVocabularies(registry, threatControl);
    const tagControl = makeControl({
      tags: ['Governance'],
      tagsProp: {
        name: 'tags',
        value: 'Governance',
        ns: 'https://example.com/namespaces/tags.csv',
      },
    });
    const tagResolved = resolveControlVocabularies(registry, tagControl);

    const { container: targets } = renderSecurityTargets(makeSecurityRows());
    expect(
      targets.querySelector('.catalog-vocabulary-affordance'),
    ).toBeNull();

    const { container: threats } = render(
      <MemoryRouter>
        <ControlSecurityContext
          control={threatControl}
          resolvedVocabularies={threatResolved}
          isVocabularyActive={() => true}
          onToggleVocabulary={vi.fn()}
          renderVocabularyCard={() => null}
        />
      </MemoryRouter>,
    );
    expect(threats.querySelector('.catalog-vocabulary-affordance')).toBeNull();

    const { container: taxonomy } = render(
      <MemoryRouter>
        <ControlSubjectGroups
          control={tagControl}
          resolvedVocabularies={tagResolved}
          hasControllingCriteria={false}
          isVocabularyActive={() => true}
          onToggleVocabulary={vi.fn()}
          renderVocabularyCard={() => null}
        />
      </MemoryRouter>,
    );
    expect(taxonomy.querySelector('.catalog-vocabulary-affordance')).toBeNull();
  });

  it('Merkmale-Legende listet die drei Relevanzstufen genau einmal', () => {
    const { container } = renderSecurityTargets(makeSecurityRows());
    const scope = within(container);

    fireEvent.click(scope.getByRole('button', { name: 'Legende' }));
    const panel = container.querySelector('#legende-merkmale');
    expect(panel).not.toBeNull();
    expect(panel).not.toHaveAttribute('hidden');

    const panelScope = within(panel as HTMLElement);
    const levelLinks = panelScope.getAllByRole('link');
    // Stufen 2, 1, 0 — die doppelte „1" ist dedupiert.
    expect(levelLinks).toHaveLength(3);
    for (const value of ['2', '1', '0'] as const) {
      const link = panelScope.getByRole('link', { name: value });
      expect(link).toHaveAttribute(
        'href',
        `/vokabular/documentation-namespaces-security-targets-levels?wert=${value}`,
      );
    }
    expect(
      panelScope.getByText(
        ': Die Anforderung wirkt in besonderem Maße auf dieses Schutzziel hin. Dieser Wert zeigt an, dass das Schutzziel im Zentrum dieser Anforderung steht.',
      ),
    ).toBeInTheDocument();
  });
});
