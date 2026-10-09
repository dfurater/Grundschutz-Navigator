import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Catalog, Control } from '@/domain/models';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import { CatalogDetailPanel, CatalogMobileDetailOverlay } from './CatalogDetailPanel';

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
    titleId?: string;
  }) => {
    onControlDetailRender(props);
    return (
      <div>
        <h2 id={props.titleId}>{props.control.title}</h2>
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
    taxonomy: [],
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

describe('CatalogMobileDetailOverlay', () => {
  it('renders as a modal dialog named after the control title, outside the app root (GSPP-503)', () => {
    const onClose = vi.fn();
    const view = render(
      <>
        <button type="button">Zeile</button>
        <CatalogMobileDetailOverlay
          catalog={catalog}
          control={selected}
          active
          onClose={onClose}
          onNavigateToControl={vi.fn()}
        />
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Ausgewählte Kontrolle' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(view.container).not.toContainElement(dialog);
    expect(view.container).toHaveAttribute('inert');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the dialog node and its isolation when switching to a linked control', () => {
    const props = {
      catalog,
      active: true,
      onClose: vi.fn(),
      onNavigateToControl: vi.fn(),
    };
    const view = render(<CatalogMobileDetailOverlay {...props} control={selected} />);
    const dialog = screen.getByRole('dialog', { name: 'Ausgewählte Kontrolle' });

    view.rerender(<CatalogMobileDetailOverlay {...props} control={child} />);

    expect(screen.getByRole('dialog', { name: 'Kindkontrolle' })).toBe(dialog);
    expect(view.container).toHaveAttribute('inert');
    expect(dialog.parentElement).not.toHaveAttribute('inert');
  });

  it('restores focus and releases the isolation when it becomes inactive', () => {
    const props = {
      catalog,
      control: selected,
      onClose: vi.fn(),
      onNavigateToControl: vi.fn(),
    };
    const view = render(
      <>
        <button type="button">Zeile</button>
        <CatalogMobileDetailOverlay {...props} active={false} />
      </>,
    );
    const row = screen.getByRole('button', { name: 'Zeile' });
    row.focus();

    view.rerender(
      <>
        <button type="button">Zeile</button>
        <CatalogMobileDetailOverlay {...props} active />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Detail schließen' })).toHaveFocus();

    view.rerender(
      <>
        <button type="button">Zeile</button>
        <CatalogMobileDetailOverlay {...props} active={false} />
      </>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view.container).not.toHaveAttribute('inert');
    expect(row).toHaveFocus();
  });
});
