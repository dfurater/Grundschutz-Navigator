import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Control } from '@/domain/models';
import { resolveControlVocabularies } from '@/domain/vocabulary';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { buildClassificationLegendEntries, ControlClassification } from './ControlClassification';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.2.2', title: 'Klassifizierte Kontrolle', groupId: 'GC.2', practiceId: 'GC',
    tags: [], taxonomy: [], threats: [], statement: 'Anforderung', statementRaw: 'Anforderung',
    guidance: '', statementProps: { zielobjektKategorien: [] }, links: [], params: {},
    ...overrides,
  };
}

const resolvedControl = makeControl({
  modalverb: 'MUSS',
  modalverbProp: { name: 'modal_verb', value: 'MUSS', ns: 'https://example.com/namespaces/modal_verbs.csv' },
  securityLevel: 'normal-SdT',
  securityLevelProp: { name: 'security_level', value: 'normal-SdT', ns: 'https://example.com/namespaces/security_level.csv' },
  effortLevel: '3',
  effortLevelProp: { name: 'effort_level', value: '3', ns: 'https://example.com/namespaces/effort_level.csv' },
  tags: ['Governance'],
  taxonomy: [{ name: 'Taxonomy-L1', value: 'Infrastruktur' }],
  statementProps: { zielobjektKategorien: ['Server'] },
});

function renderClassification(control: Control) {
  return render(
    <MemoryRouter>
      <ControlClassification control={control} />
    </MemoryRouter>,
  );
}

describe('ControlClassification', () => {
  it('renders only the short-profile criteria as static badges', () => {
    renderClassification(resolvedControl);

    const criteria = screen.getByRole('group', { name: 'Kriterien' });
    expect(within(criteria).getByText('MUSS')).toBeInTheDocument();
    expect(within(criteria).getByText('normal-SdT')).toBeInTheDocument();
    expect(within(criteria).getByTitle('Aufwand 3')).toBeInTheDocument();
    expect(within(criteria).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Klassifikation' })).not.toBeInTheDocument();
    expect(screen.queryByText('Governance')).not.toBeInTheDocument();
    expect(screen.queryByText('Infrastruktur')).not.toBeInTheDocument();
    expect(screen.queryByText('Server')).not.toBeInTheDocument();
  });

  it('builds legend entries for resolved criteria with vocabulary links', () => {
    const entries = buildClassificationLegendEntries(
      resolvedControl,
      resolveControlVocabularies(createTestVocabularyRegistry(), resolvedControl),
    );
    expect(entries.map((entry) => entry.term)).toEqual(['MUSS', 'normal-SdT', '3']);
    expect(entries[0].href).toBe('/vokabular/modal-verbs?wert=MUSS');
    expect(entries[0].definition).toMatch(/Modalverb definiert verbindliche Anforderungen/);
  });

  it('omits the short profile when only taxonomy and tags exist', () => {
    const { container } = renderClassification(makeControl({
      taxonomy: [{ name: 'Taxonomy-L4', value: 'WLAN' }], tags: ['Governance'],
    }));
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps unresolved criteria visible without inventing a legend', () => {
    const { container } = renderClassification(makeControl({
      modalverb: 'Sonderwert' as NonNullable<Control['modalverb']>,
    }));
    expect(screen.getByText('Sonderwert')).toBeInTheDocument();
    expect(buildClassificationLegendEntries(
      makeControl({ modalverb: 'Sonderwert' as NonNullable<Control['modalverb']> }),
      resolveControlVocabularies(createTestVocabularyRegistry(), makeControl({
        modalverb: 'Sonderwert' as NonNullable<Control['modalverb']>,
      })),
    )).toEqual([]);
    expect(container.querySelector('.catalog-vocabulary-affordance')).toBeNull();
  });
});
