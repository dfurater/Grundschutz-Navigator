import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HeaderBar } from './HeaderBar';

describe('HeaderBar', () => {
  it('uses the header reference theme with focus-visible rings for interactive elements', () => {
    const { container } = render(
      <MemoryRouter>
        <HeaderBar onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    const menuButton = screen.getByRole('button', { name: 'Menü öffnen' });
    const homeLink = screen.getByRole('link', { name: 'Zur Startseite' });
    const searchInput = screen.getByRole('searchbox', { name: 'Katalog durchsuchen' });

    expect(menuButton.className).toContain('focus-visible:ring-2');
    expect(homeLink.className).toContain('focus-visible:ring-2');
    expect(searchInput.className).toContain('focus-visible:ring-2');

    expect(screen.queryByRole('link', { name: 'Über das Projekt' }))
      .not.toBeInTheDocument();

    expect(container.firstChild).toBeInstanceOf(HTMLElement);

    const classNames = [menuButton, homeLink, searchInput, container.firstChild]
      .map((element) => (element instanceof HTMLElement ? element.className : ''))
      .join(' ');

    expect(classNames).toContain('header-reference-theme');
    expect(classNames).not.toContain('focus:ring-');
  });
});
