import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Catalog, Control } from '@/domain/models';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import { CatalogDetailPanel } from './CatalogDetailPanel';

const onControlDetailRender = vi.fn();

vi.mock('./ControlDetail', () => ({
  ControlDetail: (props: {
    control: Control;
    controlsById: Map<string, Control>;
    incomingLinks: IncomingControlLink[];
    parentControl?: Control;
    childControls: Control[];
    onClose: () => void;
    onNavigateToControl: (control: Control) => void;
  }) => {
    onControlDetailRender(props);
    return (
      <div>
        <button type="button" onClick={props.onClose}>Detail schließen</button>
        <button
          type="button"
          onClick={() => props.onNavigateToControl(props.childControls[0])}
        >
          Kind öffnen
        </button>
      </div>
    );
  },
}));

function makeControl(overrides: Partial<Control>): Control {
  return {
    id: 'TOP.1.1',
    altIdentifier: 'stable-top-1-1',
    title: 'Testkontrolle',
    groupId: 'TOP.1',
    practiceId: 'TOP',
    tags: [],
    threats: [],
    statement: '',
    statementRaw: '',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
    },
    links: [],
    params: {},
    ...overrides,
  };
}

const parent = makeControl({
  id: 'TOP.1.1',
  title: 'Elternkontrolle',
});
const selected = makeControl({
  id: 'TOP.1.2',
  parentId: parent.id,
  title: 'Ausgewählte Kontrolle',
});
const child = makeControl({
  id: 'TOP.1.2.1',
  parentId: selected.id,
  title: 'Kindkontrolle',
});
const source = makeControl({
  id: 'TOP.1.3',
  title: 'Verknüpfte Kontrolle',
  links: [{
    targetId: selected.id,
    href: `#${selected.id}`,
    rel: 'required',
    relStatus: 'custom',
  }],
});
const controls = [parent, selected, child, source];
const catalog = {
  catalogKey: 'gspp',
  controls,
  controlsById: new Map(controls.map((control) => [control.id, control])),
} as Catalog;

describe('CatalogDetailPanel', () => {
  it('resolves hierarchy and incoming relationships for ControlDetail', () => {
    const onClose = vi.fn();
    const onNavigateToControl = vi.fn();
    onControlDetailRender.mockClear();

    render(
      <CatalogDetailPanel
        catalog={catalog}
        control={selected}
        onClose={onClose}
        onNavigateToControl={onNavigateToControl}
      />,
    );

    const detailProps = onControlDetailRender.mock.lastCall?.[0];
    expect(detailProps).toMatchObject({
      control: selected,
      controlsById: catalog.controlsById,
      parentControl: parent,
      childControls: [child],
      incomingLinks: [{ control: source, link: source.links[0] }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Detail schließen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kind öffnen' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onNavigateToControl).toHaveBeenCalledWith(child);
  });
});
