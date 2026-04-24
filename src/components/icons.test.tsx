import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { IconLayoutList, IconMoreHorizontal } from './icons';

describe('IconLayoutList', () => {
  it('renders an svg element', () => {
    const { container } = render(<IconLayoutList />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('forwards className', () => {
    const { container } = render(<IconLayoutList className="w-4 h-4" />);
    expect(container.querySelector('svg')?.classList).toContain('w-4');
  });
});

describe('IconMoreHorizontal', () => {
  it('renders an svg element', () => {
    const { container } = render(<IconMoreHorizontal />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
