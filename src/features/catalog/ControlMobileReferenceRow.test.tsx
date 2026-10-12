import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { ControlMobileReferenceRow } from './ControlMobileReferenceRow';

function makeControl(id: string, title: () => string): Control {
  const control = {
    id,
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    threats: [],
    links: [],
    params: {},
  } as unknown as Control;
  Object.defineProperty(control, 'title', { configurable: true, get: title });
  return control;
}

describe('ControlMobileReferenceRow', () => {
  it('skips unchanged rows when checked state changes elsewhere', () => {
    const firstTitle = vi.fn(() => 'Erste Kontrolle');
    const secondTitle = vi.fn(() => 'Zweite Kontrolle');
    const controls = [
      makeControl('GC.1.1', firstTitle),
      makeControl('GC.1.2', secondTitle),
    ];
    const controlsById = new Map(controls.map((control) => [control.id, control]));
    const onSelect = vi.fn();
    const onCheckedChange = vi.fn();

    function MobileRows({ checkedIds }: { checkedIds: Set<string> }) {
      return controls.map((control) => (
        <ControlMobileReferenceRow
          key={control.id}
          control={control}
          controlsById={controlsById}
          selectMode
          checked={checkedIds.has(control.id)}
          onSelect={onSelect}
          onCheckedChange={onCheckedChange}
        />
      ));
    }

    const view = render(<MobileRows checkedIds={new Set()} />);
    firstTitle.mockClear();
    secondTitle.mockClear();
    view.rerender(<MobileRows checkedIds={new Set([controls[0].id])} />);

    expect(firstTitle).toHaveBeenCalled();
    expect(secondTitle).not.toHaveBeenCalled();
    expect(
      screen.getAllByRole('button')[0].closest('.catalog-mobile-reference-row'),
    ).not.toBeNull();
  });

  it('meldet im Auswahlmodus echte Checkboxen mit Namen und Zustand statt aria-pressed (GSPP-517)', () => {
    const controls = [makeControl('GC.1.1', () => 'Erste Kontrolle')];
    const controlsById = new Map(controls.map((control) => [control.id, control]));

    const view = render(
      controls.map((control) => (
        <ControlMobileReferenceRow
          key={control.id}
          control={control}
          controlsById={controlsById}
          selectMode
          checked={false}
          onSelect={vi.fn()}
          onCheckedChange={vi.fn()}
        />
      )),
    );

    const checkbox = screen.getByRole('checkbox', { name: 'GC.1.1 auswählen' });
    expect(checkbox).not.toBeChecked();
    expect(view.container.querySelector('[aria-pressed]')).toBeNull();

    view.rerender(
      controls.map((control) => (
        <ControlMobileReferenceRow
          key={control.id}
          control={control}
          controlsById={controlsById}
          selectMode
          checked
          onSelect={vi.fn()}
          onCheckedChange={vi.fn()}
        />
      )),
    );
    expect(screen.getByRole('checkbox', { name: 'GC.1.1 auswählen' })).toBeChecked();
    expect(view.container.querySelector('[aria-pressed]')).toBeNull();
  });

  it('lässt den Zeilen-Tap in beiden Modi navigieren; nur die Checkbox schaltet die Auswahl (GSPP-517)', async () => {
    const user = userEvent.setup();
    const control = makeControl('GC.1.1', () => 'Erste Kontrolle');
    const controlsById = new Map([[control.id, control]]);
    const onSelect = vi.fn();
    const onCheckedChange = vi.fn();

    // Normalmodus: keine Checkbox, der Zeilen-Button navigiert.
    const view = render(
      <ControlMobileReferenceRow
        control={control}
        controlsById={controlsById}
        onSelect={onSelect}
        onCheckedChange={onCheckedChange}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).not.toHaveBeenCalled();

    // Auswahlmodus: Button navigiert weiter, Checkbox schaltet.
    onSelect.mockClear();
    view.rerender(
      <ControlMobileReferenceRow
        control={control}
        controlsById={controlsById}
        selectMode
        checked={false}
        onSelect={onSelect}
        onCheckedChange={onCheckedChange}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).not.toHaveBeenCalled();

    onSelect.mockClear();
    await user.click(screen.getByRole('checkbox', { name: 'GC.1.1 auswählen' }));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(control, true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hält den 44px-Vertrag ein: Checkbox-Treffläche 44px, sichtbare Box 16px, Zeilen-Button 44px hoch (GSPP-517)', () => {
    const control = makeControl('GC.1.1', () => 'Erste Kontrolle');
    const controlsById = new Map([[control.id, control]]);
    render(
      <ControlMobileReferenceRow
        control={control}
        controlsById={controlsById}
        selectMode
        checked={false}
        onSelect={vi.fn()}
        onCheckedChange={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'GC.1.1 auswählen' });
    expect(checkbox).toHaveClass('peer', 'sr-only');
    const touchTarget = checkbox.closest('label');
    expect(touchTarget).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    const visualBox = touchTarget?.querySelector('div[aria-hidden="true"]');
    expect(visualBox).toHaveClass('w-4', 'h-4');
    expect(screen.getByRole('button')).toHaveClass('min-h-[44px]');
  });

  it('erreicht Checkbox und Zeilen-Button per Tastatur in getrennter Reihenfolge (GSPP-517)', async () => {
    const user = userEvent.setup();
    const control = makeControl('GC.1.1', () => 'Erste Kontrolle');
    const controlsById = new Map([[control.id, control]]);
    const onSelect = vi.fn();
    const onCheckedChange = vi.fn();
    render(
      <ControlMobileReferenceRow
        control={control}
        controlsById={controlsById}
        selectMode
        checked={false}
        onSelect={onSelect}
        onCheckedChange={onCheckedChange}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'GC.1.1 auswählen' });
    checkbox.focus();
    expect(checkbox).toHaveFocus();
    fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledWith(control, true);
    expect(onSelect).not.toHaveBeenCalled();

    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
  });
});
