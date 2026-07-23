import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import { ControlDependencies } from './ControlDependencies';
import { ControlHierarchy } from './ControlHierarchy';
import { ControlMetadata } from './ControlMetadata';

function makeControl(id: string, title: string, overrides: Partial<Control> = {}): Control {
  return {
    id,
    title,
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

describe('ControlDependencies', () => {
  it('preserves reverse labels, reciprocal filtering, unresolved targets, and navigation', async () => {
    const user = userEvent.setup();
    const target = makeControl('GC.2.2', 'Zielkontrolle');
    const reciprocalSource = target;
    const incomingOnlySource = makeControl('GC.3.1', 'Eingehende Kontrolle');
    const incomingLinks: IncomingControlLink[] = [
      { control: reciprocalSource, relation: 'related' },
      { control: incomingOnlySource, relation: 'related' },
    ];
    const onNavigateToControl = vi.fn();

    render(
      <ControlDependencies
        links={[
          { targetId: target.id, relation: 'required' },
          { targetId: 'GC.9.9', relation: 'related' },
        ]}
        controlsById={new Map([[target.id, target]])}
        incomingLinks={incomingLinks}
        onNavigateToControl={onNavigateToControl}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Abhängigkeiten', level: 3 }))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', {
      name: 'Verknüpfte Kontrollen',
      level: 4,
    })).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      name: 'Wird referenziert von',
      level: 4,
    })).toBeInTheDocument();

    const reciprocal = screen.getByRole('button', {
      name: 'GC.2.2 Zielkontrolle (erforderlich · ↔ verwandt)',
    });
    expect(screen.getByText('erforderlich · ↔ verwandt')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'GC.9.9 (verwandt)',
    })).toBeDisabled();
    expect(screen.getAllByText('GC.2.2')).toHaveLength(1);

    const incomingOnly = screen.getByRole('button', {
      name: 'GC.3.1 Eingehende Kontrolle (verwandt)',
    });
    await user.click(reciprocal);
    await user.click(incomingOnly);
    expect(onNavigateToControl).toHaveBeenNthCalledWith(1, target);
    expect(onNavigateToControl).toHaveBeenNthCalledWith(2, incomingOnlySource);
  });
});

describe('ControlHierarchy', () => {
  it('renders parent before children and forwards exact controls', async () => {
    const user = userEvent.setup();
    const parent = makeControl('GC.2.1', 'Übergeordnete Kontrolle');
    const child = makeControl('GC.2.1.1', 'Erweiterung');
    const onNavigateToControl = vi.fn();

    render(
      <ControlHierarchy
        parentControl={parent}
        childControls={[child]}
        onNavigateToControl={onNavigateToControl}
      />,
    );

    const headings = screen.getAllByRole('heading');
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Hierarchie',
      'Übergeordnete Kontrolle',
      'Erweiterungen',
    ]);

    await user.click(screen.getByRole('button', {
      name: 'GC.2.1 Übergeordnete Kontrolle',
    }));
    await user.click(screen.getByRole('button', {
      name: 'GC.2.1.1 Erweiterung',
    }));
    expect(onNavigateToControl).toHaveBeenNthCalledWith(1, parent);
    expect(onNavigateToControl).toHaveBeenNthCalledWith(2, child);
  });
});

describe('ControlMetadata', () => {
  it('renders the unresolved parent fallback and UUID with valid terms', () => {
    const view = render(
      <ControlMetadata
        parentId="GC.2.1"
        altIdentifier="7b38a819-1234-5678-90ab-abcdefabcdef"
        hasResolvedParent={false}
      />,
    );

    expect(screen.getByRole('heading', {
      name: 'Technische Metadaten',
      level: 3,
    })).toBeInTheDocument();
    expect(screen.getByText('Übergeordnet').tagName).toBe('DT');
    expect(screen.getByText('GC.2.1').tagName).toBe('DD');
    expect(screen.getByText('UUID').tagName).toBe('DT');
    expect(screen.getByText('7b38a819-1234-5678-90ab-abcdefabcdef'))
      .toHaveClass('font-mono');

    view.rerender(
      <ControlMetadata
        parentId="GC.2.1"
        altIdentifier="7b38a819-1234-5678-90ab-abcdefabcdef"
        hasResolvedParent
      />,
    );
    expect(screen.queryByText('Übergeordnet')).not.toBeInTheDocument();
    expect(screen.getByText('UUID')).toBeInTheDocument();
  });
});
