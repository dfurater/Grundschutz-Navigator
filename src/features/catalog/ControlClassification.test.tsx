import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { resolveControlVocabularies } from '@/domain/vocabulary';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { ControlClassification } from './ControlClassification';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.2.2',
    title: 'Klassifizierte Kontrolle',
    groupId: 'GC.2',
    practiceId: 'GC',
    tags: [],
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

const resolvedControl = makeControl({
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
  tags: ['Governance'],
  tagsProp: {
    name: 'tags',
    value: 'Governance',
    ns: 'https://example.com/namespaces/tags.csv',
  },
  statementProps: {
    zielobjektKategorien: ['Server'],
    zielobjektKategorienProp: {
      name: 'target_object_categories',
      value: 'Server',
      ns: 'https://example.com/namespaces/target_object_categories.csv',
    },
  },
});

const resolvedVocabularies = resolveControlVocabularies(
  createTestVocabularyRegistry(),
  resolvedControl,
);

function renderVocabularyCard(resolution: typeof resolvedVocabularies.modalverb) {
  return resolution ? <p>{`Karte: ${resolution.entry.value}`}</p> : null;
}

describe('ControlClassification', () => {
  it('renders the resolved classification and GRU-140 taxonomy in one classification section', () => {
    render(
      <ControlClassification
        control={resolvedControl}
        resolvedVocabularies={resolvedVocabularies}
        isVocabularyActive={() => false}
        onToggleVocabulary={vi.fn()}
        renderVocabularyCard={renderVocabularyCard}
      />,
    );

    expect(screen.getAllByRole('heading', { name: 'Klassifikation', level: 3 })).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Kriterien' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Taxonomie' })).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      name: 'Tags und Zielobjektkategorien',
      level: 4,
    })).toBeInTheDocument();

    const modalverb = screen.getByRole('button', { name: 'MUSS' });
    const tag = screen.getByRole('button', { name: 'Tag: Governance' });
    const target = screen.getByRole('button', { name: 'Zielobjekt: Server' });

    expect(modalverb).toHaveAttribute('aria-pressed', 'false');
    expect(modalverb).toHaveAttribute('aria-expanded', 'false');
    expect(modalverb).toHaveAttribute('aria-controls', 'vocab-card-modalverb');
    expect(tag).toHaveAttribute('aria-controls', 'vocab-card-tag-Governance');
    expect(target).toHaveAttribute('aria-controls', 'vocab-card-zielobjekt-Server');
    expect(document.getElementById('vocab-card-modalverb')).toHaveAttribute('hidden');
    expect(document.getElementById('vocab-card-tag-Governance')).toHaveAttribute('hidden');
    expect(document.getElementById('vocab-card-zielobjekt-Server')).toHaveAttribute('hidden');
  });

  it('renders unresolved taxonomy values as non-interactive outline badges', () => {
    const control = makeControl({
      tags: ['Unbekannt'],
      statementProps: {
        zielobjektKategorien: ['Sonderobjekt'],
      },
    });
    const onToggleVocabulary = vi.fn();

    render(
      <ControlClassification
        control={control}
        resolvedVocabularies={resolveControlVocabularies(createTestVocabularyRegistry(), control)}
        isVocabularyActive={() => false}
        onToggleVocabulary={onToggleVocabulary}
        renderVocabularyCard={renderVocabularyCard}
      />,
    );

    expect(screen.getByText('Unbekannt')).toHaveClass('max-w-full', 'break-words');
    expect(screen.getByText('Sonderobjekt')).toHaveClass('max-w-full', 'break-words');
    expect(screen.queryByRole('button', { name: 'Tag: Unbekannt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zielobjekt: Sonderobjekt' })).not.toBeInTheDocument();
    expect(onToggleVocabulary).not.toHaveBeenCalled();
  });

  it('wires classification and taxonomy controls to one active vocabulary callback', async () => {
    const user = userEvent.setup();
    const onToggleVocabulary = vi.fn();

    function ControlledClassification() {
      const [activeKey, setActiveKey] = useState<string | null>(null);

      return (
        <ControlClassification
          control={resolvedControl}
          resolvedVocabularies={resolvedVocabularies}
          isVocabularyActive={(key) => key === activeKey}
          onToggleVocabulary={(key) => {
            onToggleVocabulary(key);
            setActiveKey((currentKey) => currentKey === key ? null : key);
          }}
          renderVocabularyCard={renderVocabularyCard}
        />
      );
    }

    render(<ControlledClassification />);

    const modalverb = screen.getByRole('button', { name: 'MUSS' });
    const tag = screen.getByRole('button', { name: 'Tag: Governance' });

    await user.click(modalverb);
    expect(onToggleVocabulary).toHaveBeenLastCalledWith('modalverb');
    expect(modalverb).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('vocab-card-modalverb')).not.toHaveAttribute('hidden');
    expect(screen.getByText('Karte: MUSS')).toBeInTheDocument();

    await user.click(tag);
    expect(onToggleVocabulary).toHaveBeenLastCalledWith('tag:Governance');
    expect(modalverb).toHaveAttribute('aria-expanded', 'false');
    expect(tag).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('vocab-card-modalverb')).toHaveAttribute('hidden');
    expect(document.getElementById('vocab-card-tag-Governance')).not.toHaveAttribute('hidden');
    expect(screen.getByText('Karte: Governance')).toBeInTheDocument();
  });
});
