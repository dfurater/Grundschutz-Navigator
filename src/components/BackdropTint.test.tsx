import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackdropTint } from './BackdropTint';

describe('BackdropTint', () => {
  it('trägt die Farbe selbst, damit das feste Elternelement farblos bleibt', () => {
    render(
      <div data-testid="backdrop" className="fixed inset-0">
        <BackdropTint className="bg-black/30" />
      </div>,
    );
    const backdrop = screen.getByTestId('backdrop');
    const tint = backdrop.firstElementChild;

    expect(backdrop.className).not.toMatch(/\bbg-/);
    expect(tint).toHaveClass('absolute', 'inset-0', 'bg-black/30');
    expect(tint).toHaveAttribute('aria-hidden', 'true');
  });
});
