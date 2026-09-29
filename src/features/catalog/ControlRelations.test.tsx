import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { Control, ControlLink } from '@/domain/models';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import { classifyCatalogLinkRelation } from '@/domain/referenceResolution';
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
  it('nennt Richtung und Relationsart ohne die Kennung der Link-Zeile', () => {
    const target = makeControl('GC.2.2', 'Zielkontrolle');
    const incoming: IncomingControlLink = {
      control: target,
      link: makeLink(target.id, 'related', 'custom'),
    };
    expect(buildIncomingEverydayLabel([incoming]))
      .toBe('Verweist auf diese Kontrolle · Verwandt');
  });

  it('führt verschiedene Relationsarten je einmal in ihrer Reihenfolge', () => {
    const source = makeControl('GC.2.1');
    const incomings: IncomingControlLink[] = [
      { control: source, link: makeLink(source.id, 'required', 'custom') },
      { control: source, link: makeLink(source.id, 'related', 'custom') },
      { control: source, link: makeLink(source.id, 'required', 'custom') },
      { control: source, link: makeLink(source.id, 'sonder', 'custom') },
      { control: source, link: makeLink(source.id, undefined, 'missing') },
    ];
    expect(buildIncomingEverydayLabel(incomings)).toBe(
      'Verweist auf diese Kontrolle · Erfordert, Verwandt, Benutzerdefinierte Relation „sonder", Ohne Relationsangabe',
    );
  });
});

describe('ControlDependencies (Alltagssprache)', () => {
  it('beschriftet jede Gruppe einmal sichtbar und hält die Gegenrichtung am Link', () => {
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

    // Gruppen-Label sichtbar über der Liste und zugleich Gruppenname.
    const group = scope.getByRole('group', { name: 'Erfordert' });
    expect(within(group).getByText('Erfordert')).toBeVisible();
    expect(within(group).getByText('Erfordert')).not.toHaveClass('sr-only');
    // Gegenrichtung als Hinweis unter dem Link, zugleich dessen Beschreibung.
    expect(scope.getByRole('button', {
      name: 'GC.2.2 Zielkontrolle (Erfordert)',
      description: 'Verweist auf diese Kontrolle · Verwandt',
    })).toBeInTheDocument();
    for (const node of container.querySelectorAll('[role="group"]')) {
      expect(node.textContent).not.toContain('↔');
      expect(node.textContent).not.toContain('benutzerdefinierte OSCAL-Relation');
    }
    // Eingehende Kontrolle bleibt sichtbar, mit Richtung und Relationsart.
    expect(scope.getByRole('button', {
      name: 'GC.3.1 Eingehende Kontrolle',
      description: 'Verweist auf diese Kontrolle · Verwandt',
    })).toBeInTheDocument();
  });

  it('beschriftet jede Relationsart genau einmal und hält benutzerdefinierte Werte getrennt', () => {
    const controls = ['A.1', 'A.2', 'B.1', 'B.2', 'C.1', 'D.1', 'E.1', 'F.1', 'F.2'].map((id) => makeControl(id));
    const links = [
      makeLink('A.1', 'related', 'custom'),
      makeLink('B.1', 'required', 'custom'),
      makeLink('A.2', 'related', 'custom'),
      makeLink('B.2', 'required', 'custom'),
      makeLink('C.1', 'reference', 'documented'),
      makeLink('D.1', 'sonder', 'custom'),
      makeLink('E.1', 'anders', 'custom'),
      makeLink('F.1', undefined, 'missing'),
      makeLink('F.2', undefined, 'missing'),
    ];
    const { container } = renderWithRouter(
      <ControlDependencies
        links={links}
        controlsById={new Map(controls.map((control) => [control.id, control]))}
      />,
    );
    const groups = within(container).getAllByRole('group');
    const expected: Array<[string, string[]]> = [
      ['Verwandt', ['A.1', 'A.2']],
      ['Erfordert', ['B.1', 'B.2']],
      ['Referenz', ['C.1']],
      ['Benutzerdefinierte Relation „sonder"', ['D.1']],
      ['Benutzerdefinierte Relation „anders"', ['E.1']],
      ['Ohne Relationsangabe', ['F.1', 'F.2']],
    ];
    expect(groups).toHaveLength(expected.length);
    expected.forEach(([label, ids], index) => {
      const group = groups[index];
      expect(group).toHaveAccessibleName(label);
      // Sichtbar genau einmal: keine wiederholte Unterzeile je Link.
      expect(within(group).getAllByText(label)).toHaveLength(1);
      expect(within(group).getAllByRole('button').map((button) => button.firstElementChild?.textContent))
        .toEqual(ids);
    });
    // Ohne Gegenrichtung entsteht kein leerer Hinweis und kein führender Trenner.
    expect(container.querySelectorAll('li p')).toHaveLength(0);
    expect(container.textContent).not.toContain(' · ');
  });

  it('führt eine rein eingehende Kontrolle einmal mit allen Relationsarten', () => {
    const source = makeControl('GC.3.1', 'Eingehende Kontrolle');
    const { container } = renderWithRouter(
      <ControlDependencies
        links={[]}
        controlsById={new Map()}
        incomingLinks={[
          { control: source, link: makeLink(source.id, 'related', 'custom') },
          { control: source, link: makeLink(source.id, 'required', 'custom') },
        ]}
      />,
    );
    const buttons = within(container).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('GC.3.1 Eingehende Kontrolle');
    expect(buttons[0]).toHaveAccessibleDescription('Verweist auf diese Kontrolle · Verwandt, Erfordert');
    expect(container.querySelectorAll('li p')).toHaveLength(1);
    expect(container.querySelector('li p')?.textContent).toBe('Verweist auf diese Kontrolle · Verwandt, Erfordert');
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
    // Der Herkunftshinweis nennt nur Labels, die in der Ansicht stehen, keine
    // früheren Zeilenmarker wie „… · OSCAL-dokumentiert“.
    expect(legend?.textContent).toContain(
      'Nur „Referenz“ (OSCAL-rel „reference“) ist im OSCAL-Katalogmodell dokumentiert. '
      + '„Verwandt“, „Erfordert“ und jede „Benutzerdefinierte Relation“ sind benutzerdefinierte '
      + 'OSCAL-Relationen; „Ohne Relationsangabe“ steht bei Links ohne rel.',
    );
    expect(legend?.textContent).not.toContain('· OSCAL-dokumentiert');
    // Der Hinweis folgt der Klassifikation des Katalogs.
    expect(classifyCatalogLinkRelation('reference')).toBe('documented');
    expect(classifyCatalogLinkRelation('related')).toBe('custom');
    expect(classifyCatalogLinkRelation('required')).toBe('custom');
    expect(classifyCatalogLinkRelation('incorporated-into')).toBe('custom');
    expect(classifyCatalogLinkRelation(undefined)).toBe('missing');

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
