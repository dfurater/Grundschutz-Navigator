import { render, screen } from '@testing-library/react';
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
    expect(screen.getAllByRole('button')[0]).toHaveClass('catalog-mobile-reference-row');
  });
});
