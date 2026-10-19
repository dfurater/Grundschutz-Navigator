import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AreaSwitch } from '@/components/AreaSwitch';

function renderSwitch(tone: 'header' | 'drawer') {
  render(
    <MemoryRouter>
      <AreaSwitch active="katalog" catalogHref="/katalog/gspp" workspaceHref="/informationsverbuende" onSelect={() => undefined} tone={tone} />
    </MemoryRouter>,
  );
  return screen.getByRole('link', { name: 'Katalog' });
}

/*
 * Kein Referenzbild zeigt die offene Schublade; die Tönung des aktiven
 * Bereichs je Fläche ist deshalb hier festgehalten.
 */
describe('AreaSwitch', () => {
  it('hebt den aktiven Bereich im dunklen Kopf mit der Kopf-Tokenfamilie ab', () => {
    const active = renderSwitch('header');
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toHaveClass('bg-[var(--header-surface-hover)]', 'text-[var(--header-text)]');
  });

  it('markiert den aktiven Bereich in der hellen Schublade mit den Auswahl-Tokens', () => {
    const active = renderSwitch('drawer');
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toHaveClass('bg-[var(--color-accent-soft)]', 'text-[var(--color-accent-default)]');
    expect(active).not.toHaveClass('bg-[var(--header-surface-hover)]');
  });
});
