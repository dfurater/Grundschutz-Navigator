import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Control, ControlLink } from '@/domain/models';
import { ControlDependencies } from './ControlDependencies';

function makeControl(id: string): Control {
  return {
    id,
    altIdentifier: `alt-${id}`,
    title: `Kontrolle ${id}`,
    tags: [],
    threats: [],
    statement: '',
    statementRaw: '',
    guidance: '',
    statementProps: { zielobjektKategorien: [] },
    links: [],
    params: {},
  };
}

describe('ControlDependencies', () => {
  it('shows German status labels and keeps custom tokens as technical metadata', () => {
    const targets = ['GC.1.2', 'GC.1.3', 'GC.1.4'].map(makeControl);
    const links: ControlLink[] = [
      {
        targetId: 'GC.1.2',
        href: '#GC.1.2',
        rel: 'reference',
        relStatus: 'documented',
      },
      {
        targetId: 'GC.1.3',
        href: '#GC.1.3',
        rel: 'maps-to',
        relStatus: 'custom',
      },
      {
        targetId: 'GC.1.4',
        href: '#GC.1.4',
        relStatus: 'missing',
      },
    ];

    render(
      <ControlDependencies
        links={links}
        controlsById={new Map(targets.map((control) => [control.id, control]))}
      />,
    );

    expect(screen.getByText('Referenz · OSCAL-dokumentiert')).toBeInTheDocument();
    expect(screen.getByText('Benutzerdefinierte OSCAL-Relation „maps-to“'))
      .toBeInTheDocument();
    expect(screen.getByText('Ohne Relationsangabe')).toBeInTheDocument();
  });
});
