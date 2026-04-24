import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreeNav } from './TreeNav';

describe('TreeNav', () => {
  it('uses focus-visible rings and token-based classes for tree rows', () => {
    const { container } = render(
      <TreeNav
        items={[
          {
            id: 'APP.1',
            label: 'Anwendungen',
            prefix: 'APP',
            badge: '12',
            children: [
              { id: 'APP.1.1', label: 'Unterpunkt', badge: '3' },
            ],
          },
        ]}
        selectedId="APP.1"
        onSelect={vi.fn()}
      />,
    );

    const row = screen.getByRole('button', { name: /Anwendungen/ });

    expect(row.className).toContain('focus-visible:ring-2');

    const classNames = [row, container.firstChild]
      .map((element) => (element instanceof HTMLElement ? element.className : ''))
      .join(' ');

    expect(classNames).not.toMatch(/\b(?:bg|text|border|ring)-slate-/);
    expect(classNames).not.toContain('focus:ring-');
  });

  it('allows collapsing a branch even when a descendant is selected', () => {
    render(
      <TreeNav
        items={[
          {
            id: 'APP.1',
            label: 'Anwendungen',
            children: [
              { id: 'APP.1.1', label: 'Unterpunkt' },
            ],
          },
        ]}
        selectedId="APP.1.1"
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /Unterpunkt/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Anwendungen/ }));

    expect(
      screen.queryByRole('button', { name: /Unterpunkt/ }),
    ).not.toBeInTheDocument();
  });
});
