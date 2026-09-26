import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Control, Practice, Topic } from '@/domain/models';
import { resolvePracticeVocabulary, resolveTopicVocabulary } from '@/domain/taxonomyVocabulary';
import { resolveControlVocabularies } from '@/domain/vocabulary';
import {
  VOCABULARY_IDENTIFIERS,
  createTestVocabularyRegistry,
} from '@/test/fixtures/vocabulary';
import { ControlClassification } from './ControlClassification';
import { ControlTaxonomyBreadcrumb } from './ControlTaxonomyBreadcrumb';

const registry = createTestVocabularyRegistry();

const practice: Practice = {
  id: 'GC',
  title: 'Governance und Compliance',
  label: 'GC',
  altIdentifier: VOCABULARY_IDENTIFIERS.practiceGC,
  topics: [],
  controlCount: 1,
};

const topic: Topic = {
  id: 'GC.2',
  title: 'Organisation',
  label: '2',
  altIdentifier: VOCABULARY_IDENTIFIERS.topicOrganisation,
  practiceId: 'GC',
  controlCount: 1,
  controlIds: ['GC.2.2'],
};

const practiceVocabulary = resolvePracticeVocabulary(registry, practice);
const topicVocabulary = resolveTopicVocabulary(registry, topic);

function makeControl(): Control {
  return {
    id: 'GC.2.2',
    title: 'Kurzprofil-Kontrolle',
    groupId: 'GC.2',
    practiceId: 'GC',
    modalverb: 'MUSS',
    modalverbProp: {
      name: 'modal_verb',
      value: 'MUSS',
      ns: 'https://example.com/namespaces/modal_verbs.csv',
    },
    securityLevel: 'normal-SdT',
    securityLevelProp: {
      name: 'security_level',
      value: 'normal-SdT',
      ns: 'https://example.com/namespaces/security_level.csv',
    },
    effortLevel: '3',
    effortLevelProp: {
      name: 'effort_level',
      value: '3',
      ns: 'https://example.com/namespaces/effort_level.csv',
    },
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Anforderung',
    statementRaw: 'Anforderung',
    guidance: '',
    statementProps: { zielobjektKategorien: [] },
    links: [],
    params: {},
  };
}

const control = makeControl();
const resolvedVocabularies = resolveControlVocabularies(registry, control);

function renderClassification() {
  return render(
    <MemoryRouter>
      <ControlClassification
        control={control}
        resolvedVocabularies={resolvedVocabularies}
      />
    </MemoryRouter>,
  );
}

describe('ControlShortProfile (GSPP-303 T6)', () => {
  it('Breadcrumb: Begriffe mit Resolution als TermTrigger, ohne als Plain-Text', () => {
    const { container } = render(
      <MemoryRouter>
        <ControlTaxonomyBreadcrumb
          practiceName="Governance und Compliance"
          topicName="Organisation"
          hasTopic
          practiceVocabulary={practiceVocabulary}
          topicVocabulary={topicVocabulary}
          isVocabularyActive={() => false}
          onToggleVocabulary={vi.fn()}
        />
      </MemoryRouter>,
    );
    const scope = within(container);

    // Mit Resolution: TermTrigger im Abkürzungs-Stil (gepunktet, kein Icon).
    for (const name of ['Praktik: Governance und Compliance', 'Thema: Organisation']) {
      expect(scope.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(scope.getByText('Governance und Compliance')).toHaveClass(
      'underline',
      'decoration-dotted',
      'underline-offset-4',
    );
    expect(container.querySelector('svg')).toBeNull();

    // Ohne Resolution: Plain-Text, kein Button.
    const { container: plain } = render(
      <MemoryRouter>
        <ControlTaxonomyBreadcrumb
          practiceName="Governance und Compliance"
          topicName="Organisation"
          hasTopic
          practiceVocabulary={null}
          topicVocabulary={null}
          isVocabularyActive={() => false}
          onToggleVocabulary={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(within(plain).queryByRole('button')).toBeNull();
    expect(within(plain).getByText('Organisation').tagName).toBe('SPAN');
    expect(within(plain).getByText('keine offizielle Definition')).toBeInTheDocument();

    // Ohne Thema erst recht kein Hinweis.
    const { container: noTopic } = render(
      <MemoryRouter>
        <ControlTaxonomyBreadcrumb
          practiceName="Governance und Compliance"
          topicName="Ohne Gruppenkennung"
          hasTopic={false}
          practiceVocabulary={null}
          topicVocabulary={null}
          isVocabularyActive={() => false}
          onToggleVocabulary={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(within(noTopic).queryByText('keine offizielle Definition')).toBeNull();
  });

  it('Kurzprofil: Kriterien-Badges ohne Button-Hülle, Legende als Textlink', () => {
    const { container } = renderClassification();
    const criteria = within(container).getByRole('group', { name: 'Kriterien' });

    // Badges sind reine Spans: kein Button im Kriterien-Block.
    expect(criteria.querySelector('button')).toBeNull();
    expect(within(criteria).getByText('MUSS')).toBeInTheDocument();
    expect(within(criteria).getByText('normal-SdT')).toBeInTheDocument();
    expect(within(criteria).getByText('Aufwand')).toBeInTheDocument();

    // Textlink „Legende" rechts neben den Badges, außerhalb der Gruppe.
    expect(within(criteria).queryByRole('button', { name: 'Legende' })).toBeNull();
    expect(within(container).getByRole('button', { name: 'Legende' })).toBeInTheDocument();
  });

  it('Legende zeigt je Wert Term, BSI-Definition und Vokabular-Link', () => {
    const { container } = renderClassification();
    const scope = within(container);

    fireEvent.click(scope.getByRole('button', { name: 'Legende' }));
    expect(document.getElementById('legende-kurzprofil')).not.toHaveAttribute('hidden');

    const muss = scope.getByRole('link', { name: 'MUSS' });
    expect(muss).toHaveAttribute('href', '/vokabular/modal-verbs?wert=MUSS');
    expect(scope.getByText(': Modalverb definiert verbindliche Anforderungen.'))
      .toBeInTheDocument();

    const niveau = scope.getByRole('link', { name: 'normal-SdT' });
    expect(niveau).toHaveAttribute('href', '/vokabular/security-level?wert=normal-SdT');
    expect(scope.getByText(': Standard-Sicherheitsniveau für den Stand der Technik.'))
      .toBeInTheDocument();

    const aufwand = scope.getByRole('link', { name: '3' });
    expect(aufwand).toHaveAttribute('href', '/vokabular/effort-level?wert=3');
    expect(scope.getByText(': Mittlere Aufwandsstufe.')).toBeInTheDocument();
  });

  it('kein catalog-vocabulary-affordance in Breadcrumb und Kurzprofil', () => {
    const { container: breadcrumb } = render(
      <MemoryRouter>
        <ControlTaxonomyBreadcrumb
          practiceName="Governance und Compliance"
          topicName="Organisation"
          hasTopic
          practiceVocabulary={practiceVocabulary}
          topicVocabulary={topicVocabulary}
          isVocabularyActive={() => true}
          onToggleVocabulary={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(breadcrumb.querySelector('.catalog-vocabulary-affordance')).toBeNull();

    const { container: profile } = renderClassification();
    const criteria = within(profile).getByRole('group', { name: 'Kriterien' });
    expect(criteria.querySelector('.catalog-vocabulary-affordance')).toBeNull();
  });
});
