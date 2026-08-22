import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Control, ControlLink } from '@/domain/models';
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

function makeLink(targetId: string, rel: 'required' | 'related'): ControlLink {
  return { targetId, href: `#${targetId}`, rel, relStatus: 'custom' };
}

function makeIncomingLink(
  control: Control,
  rel: 'required' | 'related',
): IncomingControlLink {
  return { control, link: makeLink(control.id, rel) };
}

describe('ControlDependencies', () => {
  it('preserves reverse labels, reciprocal filtering, and navigation without dead targets', async () => {
    const user = userEvent.setup();
    const target = makeControl('GC.2.2', 'Zielkontrolle');
    const reciprocalSource = target;
    const incomingOnlySource = makeControl('GC.3.1', 'Eingehende Kontrolle');
    const incomingLinks: IncomingControlLink[] = [
      makeIncomingLink(reciprocalSource, 'related'),
      makeIncomingLink(incomingOnlySource, 'related'),
    ];
    const onNavigateToControl = vi.fn();

    render(
      <ControlDependencies
        links={[
          makeLink(target.id, 'required'),
          makeLink('GC.9.9', 'related'),
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

    // Jedes Beziehungslabel erscheint als programmatisch benannte Gruppe
    // genau einmal, auch wenn mehrere Links dasselbe Label tragen.
    expect(screen.getByRole('group', {
      name: 'Erforderlich · benutzerdefinierte OSCAL-Relation · ↔ verwandt · benutzerdefinierte OSCAL-Relation',
    }))
      .toBeInTheDocument();
    const reciprocal = screen.getByRole('button', {
      name: 'GC.2.2 Zielkontrolle (erforderlich · benutzerdefinierte OSCAL-Relation · ↔ verwandt · benutzerdefinierte OSCAL-Relation)',
    });
    expect(screen.queryByRole('button', {
      name: 'GC.9.9 (verwandt · benutzerdefinierte OSCAL-Relation)',
    })).not.toBeInTheDocument();
    expect(screen.getAllByText('GC.2.2')).toHaveLength(1);

    const incomingOnly = screen.getByRole('button', {
      name: 'GC.3.1 Eingehende Kontrolle (verwandt · benutzerdefinierte OSCAL-Relation)',
    });
    await user.click(reciprocal);
    await user.click(incomingOnly);
    expect(onNavigateToControl).toHaveBeenNthCalledWith(1, target);
    expect(onNavigateToControl).toHaveBeenNthCalledWith(2, incomingOnlySource);
  });

  it('groups multiple links with the same relation label under one heading', () => {
    const required = makeControl('STM.2.1.3', 'Mapping der Assets');
    const relatedA = makeControl('STM.2.1.4.1', 'Vererbung von Zielobjektkategorien');
    const relatedB = makeControl('STM.2.1.4.2', 'Konsolidierung und Redundanzprüfung');
    const relatedC = makeControl('STM.2.1.5', 'Modellierung ohne Zielobjektkategorie');

    render(
      <ControlDependencies
        links={[
          makeLink(required.id, 'required'),
          makeLink(relatedA.id, 'related'),
          makeLink(relatedB.id, 'related'),
          makeLink(relatedC.id, 'related'),
        ]}
        controlsById={new Map([
          [required.id, required],
          [relatedA.id, relatedA],
          [relatedB.id, relatedB],
          [relatedC.id, relatedC],
        ])}
      />,
    );

    // Jedes Label erscheint genau einmal als Gruppenüberschrift, nicht je Zeile,
    // und ist als programmatisch benannte Gruppe (nicht nur visueller Text) exponiert.
    expect(screen.getAllByText('Erforderlich · benutzerdefinierte OSCAL-Relation')).toHaveLength(1);
    expect(screen.getAllByText('Verwandt · benutzerdefinierte OSCAL-Relation')).toHaveLength(1);

    const requiredGroup = screen.getByRole('group', {
      name: 'Erforderlich · benutzerdefinierte OSCAL-Relation',
    });
    const relatedGroup = screen.getByRole('group', {
      name: 'Verwandt · benutzerdefinierte OSCAL-Relation',
    });
    expect(within(requiredGroup).getAllByRole('button')).toHaveLength(1);
    expect(within(relatedGroup).getAllByRole('button')).toHaveLength(3);

    expect(screen.getByRole('button', {
      name: 'STM.2.1.4.1 Vererbung von Zielobjektkategorien (verwandt · benutzerdefinierte OSCAL-Relation)',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'STM.2.1.4.2 Konsolidierung und Redundanzprüfung (verwandt · benutzerdefinierte OSCAL-Relation)',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'STM.2.1.5 Modellierung ohne Zielobjektkategorie (verwandt · benutzerdefinierte OSCAL-Relation)',
    })).toBeInTheDocument();
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
