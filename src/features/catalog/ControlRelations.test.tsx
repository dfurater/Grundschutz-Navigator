import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { Control, ControlLink } from '@/domain/models';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import {
  buildIncomingEverydayLabel,
  buildLinkLegendEntries,
  ControlDependencies,
  everydayRelationLabel,
} from './ControlDependencies';
import { ControlHierarchy } from './ControlHierarchy';
import { ControlMetadata } from './ControlMetadata';
import { SectionLegend } from './ControlVocabularyPrimitives';

function makeControl(id: string, title = `Kontrolle ${id}`): Control {
  return {
    id,
    title,
    tags: [],
    taxonomy: [],
    threats: [],
    statement: '',
    statementRaw: '',
    guidance: '',
    statementProps: { zielobjektKategorien: [] },
    links: [],
    params: {},
  };
}

function makeLink(
  targetId: string,
  rel: string | undefined,
  relStatus: ControlLink['relStatus'],
): ControlLink {
  return { targetId, href: `#${targetId}`, rel, relStatus };
}

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('everydayRelationLabel', () => {
  it('mappt OSCAL-Relationen auf Alltagssprache (exakte Strings)', () => {
    expect(everydayRelationLabel(makeLink('X', 'related', 'custom'))).toBe('Verwandt');
    expect(everydayRelationLabel(makeLink('X', 'required', 'custom'))).toBe('Erfordert');
    expect(everydayRelationLabel(makeLink('X', 'related', 'documented')))
      .toBe('Verwandt');
    expect(everydayRelationLabel(makeLink('X', undefined, 'missing')))
      .toBe('Ohne Relationsangabe');
    expect(everydayRelationLabel(makeLink('X', 'sonder', 'custom')))
      .toBe('Benutzerdefinierte Relation „sonder"');
    // Symmetrische Ränder (bindende Antwort 4)
    expect(everydayRelationLabel(makeLink('X', 'required', 'documented')))
      .toBe('Erfordert');
    expect(everydayRelationLabel(makeLink('X', 'reference', 'custom'))).toBe('Referenz');
    expect(everydayRelationLabel(makeLink('X', 'reference', 'documented')))
      .toBe('Referenz');
    expect(everydayRelationLabel(makeLink('X', 'sonder', 'documented')))
      .toBe('Benutzerdefinierte Relation „sonder"');
    expect(everydayRelationLabel(makeLink('X', 'related', 'missing')))
      .toBe('Ohne Relationsangabe');
  });
});

describe('buildIncomingEverydayLabel', () => {
  it('präfixt das Alltags-Label mit „verweist hierauf als …"', () => {
    const target = makeControl('GC.2.2', 'Zielkontrolle');
    const incoming: IncomingControlLink = {
      control: target,
      link: makeLink(target.id, 'related', 'custom'),
    };
    expect(buildIncomingEverydayLabel(incoming))
      .toBe('GC.2.2 verweist hierauf als „Verwandt"');

    const required: IncomingControlLink = {
      control: makeControl('GC.2.1'),
      link: makeLink('GC.2.1', 'required', 'documented'),
    };
    expect(buildIncomingEverydayLabel(required))
      .toBe('GC.2.1 verweist hierauf als „Erfordert"');
  });
});

describe('ControlDependencies (Alltagssprache)', () => {
  it('gruppiert in Alltagssprache, ohne ↔, mit Gegenrichtungs-Zeile', () => {
    const target = makeControl('GC.2.2', 'Zielkontrolle');
    const incomingOnlySource = makeControl('GC.3.1', 'Eingehende Kontrolle');
    const { container } = renderWithRouter(
      <ControlDependencies
        links={[makeLink(target.id, 'required', 'custom')]}
        controlsById={new Map([[target.id, target]])}
        incomingLinks={[
          { control: target, link: makeLink(target.id, 'related', 'custom') },
          {
            control: incomingOnlySource,
            link: makeLink(incomingOnlySource.id, 'related', 'custom'),
          },
        ]}
      />,
    );
    const scope = within(container);

    // Gruppen-Label in Alltagssprache, programmatisch benannt
    expect(scope.getByRole('group', { name: 'Erfordert' })).toBeInTheDocument();
    // Gegenrichtung als eigene Zeile unter dem Link
    expect(scope.getByText('GC.2.2 verweist hierauf als „Verwandt"'))
      .toBeInTheDocument();
    // Kein ↔ und keine technische Relationsbeschreibung im sichtbaren
    // Gruppentext (Legenden-Panel ausgenommen — hidden, aber im DOM);
    // aria-labels ohnehin ausgenommen (Attribute ≠ textContent)
    for (const group of container.querySelectorAll('fieldset')) {
      expect(group.textContent).not.toContain('↔');
      expect(group.textContent).not.toContain('benutzerdefinierte OSCAL-Relation');
      expect(group.textContent).not.toContain('OSCAL-dokumentiert');
    }
    // Eingehende Kontrolle bleibt sichtbar
    expect(scope.getByText('Eingehende Kontrolle')).toBeInTheDocument();
    expect(scope.getByText('GC.3.1 verweist hierauf als „Verwandt"')).toBeInTheDocument();
  });
});

describe('Zusammenhänge-Legende', () => {
  it('erklärt jede Relationsbedeutung plus Herkunftshinweis', async () => {
    const user = userEvent.setup();
    // Die Legende steht in der Zusammenhänge-Leiste; hier isoliert.
    const { container } = renderWithRouter(
      <SectionLegend legendId="legende-zusammenhaenge" entries={buildLinkLegendEntries()} />,
    );
    const scope = within(container);

    await user.click(scope.getByRole('button', { name: 'Legende' }));
    const legend = container.querySelector('#legende-zusammenhaenge');
    expect(legend).not.toBeNull();
    const legendScope = within(legend as HTMLElement);

    // Relationen haben keine eigene Vokabularseite; die Legende zeigt Text
    // ohne irreführende Selbstlinks.
    // Legendenschema: „Merkmal: Wert“ über der Erklärung.
    expect([...(legend?.querySelectorAll('dt') ?? [])].map((term) => term.textContent)).toEqual([
      'Link-Relation: Verwandt',
      'Link-Relation: Erfordert',
      'Link-Relation: Referenz',
      'Herkunft der Relationsangabe',
    ]);

    expect(legendScope.queryAllByRole('link')).toHaveLength(0);
    expect(legend?.textContent).toContain(
      'Ob die Relationsangabe im OSCAL-Katalog dokumentiert ist '
      + '(… · OSCAL-dokumentiert), nur benutzerdefiniert vorliegt '
      + '(… · benutzerdefinierte OSCAL-Relation) oder fehlt (ohne Relationsangabe).',
    );

    // Builder-Konsistenz: statisch, vier disjunkte Entries
    const entries = buildLinkLegendEntries();
    expect(entries).toHaveLength(4);
    expect(new Set(entries.map((entry) => entry.term)).size).toBe(4);
  });
});

describe('ControlHierarchy (T8)', () => {
  it('rendert keinen „Übergeordnete Kontrolle"-Block mehr', () => {
    const { container } = renderWithRouter(
      <ControlHierarchy
        childControls={[makeControl('GC.2.1.1', 'Erweiterung')]}
      />,
    );
    const scope = within(container);

    expect(container.textContent).not.toContain('Übergeordnete Kontrolle');
    expect(scope.queryByText('Erweiterungen')).toBeNull();
    expect(scope.getByRole('button', { name: 'GC.2.1.1 Erweiterung' }))
      .toBeInTheDocument();
  });
});

describe('ControlMetadata (Fußzeile)', () => {
  it('rendert ohne Überschrift, Beschriftung und Wert als getrennte Begriffspaare', () => {
    const uuid = '7b38a819-1234-5678-90ab-abcdefabcdef';
    const view = renderWithRouter(
      <ControlMetadata
        parentId="GC.2.1"
        altIdentifier={uuid}
        hasResolvedParent={false}
      />,
    );
    const scope = within(view.container);

    expect(scope.queryByRole('heading')).not.toBeInTheDocument();
    // Owner 26.09.2026: Beschriftung und Wert sichtbar voneinander abgesetzt.
    expect(scope.getByText('UUID').tagName).toBe('DT');
    expect(scope.getByText(uuid).tagName).toBe('DD');
    expect(scope.getByText(uuid)).toHaveClass('font-mono');
    expect(scope.getByText(/GC\.2\.1/)).toBeInTheDocument();

    view.rerender(
      <MemoryRouter>
        <ControlMetadata
          parentId="GC.2.1"
          altIdentifier={uuid}
          hasResolvedParent
        />
      </MemoryRouter>,
    );
    const rescoped = within(view.container);
    expect(rescoped.queryByText(/GC\.2\.1/)).not.toBeInTheDocument();
    expect(rescoped.getByText(uuid)).toBeInTheDocument();
  });
});
