import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
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
  it('exposes the controlled drawer state and real menu button through its ref', () => {
    const menuButtonRef = createRef<HTMLButtonElement>();
    const onMenuToggle = vi.fn();
    const renderHeader = (menuExpanded: boolean) => (
      <MemoryRouter>
        <HeaderBar
          onMenuToggle={onMenuToggle}
          menuExpanded={menuExpanded}
          menuControls="navigation-drawer"
          menuButtonRef={menuButtonRef}
        />
      </MemoryRouter>
    );
    const { rerender, unmount } = render(renderHeader(false));
    const menuButton = screen.getByRole('button', { name: 'Menü öffnen' });

    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton).toHaveAttribute('aria-controls', 'navigation-drawer');
    expect(menuButtonRef.current).toBe(menuButton);
    fireEvent.click(menuButton);
    expect(onMenuToggle).toHaveBeenCalledOnce();

    rerender(renderHeader(true));
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expect(menuButtonRef.current).toBe(menuButton);
    unmount();
    expect(menuButtonRef.current).toBeNull();
  });

  it('uses the header reference theme with focus-visible rings for interactive elements', () => {
    const { container } = render(
      <MemoryRouter>
        <HeaderBar onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    const menuButton = screen.getByRole('button', { name: 'Menü öffnen' });
    const homeLink = screen.getByRole('link', { name: 'Grundschutz++ Navigator' });
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

  // WCAG 2.5.3: Der zugängliche Name enthält den sichtbaren Text (GSPP-475).
  it('benennt den Markenlink mit seinem sichtbaren Text', () => {
    render(
      <MemoryRouter>
        <HeaderBar />
      </MemoryRouter>,
    );

    const homeLink = screen.getByRole('link', { name: 'Grundschutz++ Navigator' });
    expect(homeLink).toHaveAttribute('href', '/');
    expect(homeLink).not.toHaveAttribute('aria-label');
  });

  // Die Kontextwahl sitzt im Kopf der Navigationsleiste; der Header trägt nur
  // Marke und Suche, unter 640 px als Lupe (GSPP-476).
  it('führt die Lupe auf die Suchseite und zeigt keinen Katalog-Switcher', () => {
    render(
      <MemoryRouter>
        <HeaderBar onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    const searchLink = screen.getByRole('link', { name: 'Suche' });
    expect(searchLink).toHaveAttribute('href', '/suche');
    expect(searchLink.className).toContain('sm:hidden');
    expect(searchLink.className).toContain('focus-visible:ring-2');
    expect(screen.queryByRole('button', { name: /Katalog/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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

  // Unter 640 px ist das Feld ausgeblendet; das Kürzel führt dann wie die Lupe
  // auf die Suchseite und fordert dort den Fokus an (GSPP-476).
  it.each([
    ['Meta+K', { metaKey: true }],
    ['Ctrl+K', { ctrlKey: true }],
  ])('führt %s ohne sichtbares Suchfeld auf die Suchseite', (_, modifier) => {
    function Location() {
      const location = useLocation();
      return <output data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</output>;
    }
    render(
      <MemoryRouter>
        <HeaderBar />
        <Location />
        <button type="button">Außerhalb</button>
      </MemoryRouter>,
    );
    const searchInput = screen.getByRole('searchbox', { name: 'Katalog durchsuchen' });
    searchInput.checkVisibility = () => false;
    const outsideButton = screen.getByRole('button', { name: 'Außerhalb' });
    outsideButton.focus();

    const wasNotPrevented = fireEvent.keyDown(outsideButton, { key: 'k', ...modifier });

    expect(wasNotPrevented).toBe(false);
    expect(searchInput).not.toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent('/suche|{"focusSearch":true}');
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
