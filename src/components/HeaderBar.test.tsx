import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { HeaderBar } from './HeaderBar';

function renderHeaderWithEditableTarget(target: React.ReactNode) {
  render(
    <MemoryRouter>
      <HeaderBar />
      {target}
    </MemoryRouter>,
  );
}

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

  it.each([
    ['Meta+K', { metaKey: true }],
    ['Ctrl+K', { ctrlKey: true }],
  ])('focuses the search field for %s outside editable targets', (_, modifier) => {
    renderHeaderWithEditableTarget(<button type="button">Außerhalb</button>);
    const outsideButton = screen.getByRole('button', { name: 'Außerhalb' });
    const searchInput = screen.getByRole('searchbox', { name: 'Katalog durchsuchen' });
    outsideButton.focus();

    const wasNotPrevented = fireEvent.keyDown(outsideButton, { key: 'k', ...modifier });

    expect(wasNotPrevented).toBe(false);
    expect(searchInput).toHaveFocus();
  });

  it.each([
    ['Meta+K', { metaKey: true }],
    ['Ctrl+K', { ctrlKey: true }],
  ])('prevents the browser default for %s in the header search field', (_, modifier) => {
    renderHeaderWithEditableTarget(null);
    const searchInput = screen.getByRole('searchbox', { name: 'Katalog durchsuchen' });
    searchInput.focus();

    const wasNotPrevented = fireEvent.keyDown(searchInput, { key: 'k', ...modifier });

    expect(wasNotPrevented).toBe(false);
    expect(searchInput).toHaveFocus();
  });

  it.each([
    ['text input', <input aria-label="Editierbares Ziel" key="input" />],
    ['search input', <input aria-label="Editierbares Ziel" key="search" type="search" />],
    ['textarea', <textarea aria-label="Editierbares Ziel" key="textarea" />],
    ['select with type-ahead', <select aria-label="Editierbares Ziel" key="select"><option>Option</option></select>],
    ['contenteditable', <div aria-label="Editierbares Ziel" contentEditable key="contenteditable" tabIndex={0} />],
  ])('preserves focus when the shortcut starts in an editable %s', (_, target) => {
    renderHeaderWithEditableTarget(target);
    const editableTarget = screen.getByLabelText('Editierbares Ziel');
    editableTarget.focus();

    const wasNotPrevented = fireEvent.keyDown(editableTarget, { key: 'k', metaKey: true });

    expect(wasNotPrevented).toBe(true);
    expect(editableTarget).toHaveFocus();
  });

  it.each([
    ['checkbox', 'Meta+K', { metaKey: true }],
    ['checkbox', 'Ctrl+K', { ctrlKey: true }],
    ['radio', 'Meta+K', { metaKey: true }],
    ['radio', 'Ctrl+K', { ctrlKey: true }],
    ['range', 'Meta+K', { metaKey: true }],
    ['range', 'Ctrl+K', { ctrlKey: true }],
  ] as const)(
    'focuses the search field for %s input with %s',
    (type, _, modifier) => {
      renderHeaderWithEditableTarget(
        <input aria-label="Nicht-textuelles Ziel" type={type} />,
      );
      const input = screen.getByLabelText('Nicht-textuelles Ziel');
      const searchInput = screen.getByRole('searchbox', { name: 'Katalog durchsuchen' });
      input.focus();

      const wasNotPrevented = fireEvent.keyDown(input, { key: 'k', ...modifier });

      expect(wasNotPrevented).toBe(false);
      expect(searchInput).toHaveFocus();
    },
  );
});
