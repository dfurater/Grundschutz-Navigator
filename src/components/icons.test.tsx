import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { IconLayoutList, IconListChecks, IconMoreHorizontal } from './icons';

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

describe('IconListChecks', () => {
  it('übernimmt die Pfade von Lucide list-checks im Tag 1.51.0 unverändert', () => {
    const { container } = render(<IconListChecks className="w-4 h-4" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.classList).toContain('w-4');
    expect(
      Array.from(container.querySelectorAll('path'), (path) => path.getAttribute('d')),
    ).toEqual(['M13 5h8', 'M13 12h8', 'M13 19h8', 'm3 17 2 2 4-4', 'm3 7 2 2 4-4']);
  });
});
