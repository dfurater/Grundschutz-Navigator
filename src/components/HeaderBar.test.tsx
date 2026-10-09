import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  // jsdom hat keine Layoutboxen. Der Standardfall stellt ein sichtbares Feld dar.
  beforeEach(() => vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList));
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['Meta+K', { metaKey: true }],
    ['Ctrl+K', { ctrlKey: true }],
  ])('führt %s auch ohne checkVisibility vom verborgenen Feld zur Suche', (_, modifier) => {
    function Location() {
      const location = useLocation();
      return <output data-testid="location">{`${location.pathname}${location.search}|${JSON.stringify(location.state)}`}</output>;
    }
    render(
      <MemoryRouter initialEntries={['/suche?q=verfahren']}>
        <HeaderBar />
        <Location />
        <button type="button">Außerhalb</button>
      </MemoryRouter>,
    );
    const input = screen.getByRole('searchbox', { name: 'Katalog durchsuchen' });
    Object.defineProperty(input, 'checkVisibility', { value: undefined });
    vi.spyOn(input, 'getClientRects').mockReturnValue({ length: 0 } as DOMRectList);
    const button = screen.getByRole('button', { name: 'Außerhalb' });
    button.focus();

    expect(fireEvent.keyDown(button, { key: 'k', ...modifier })).toBe(false);

    expect(input).not.toHaveFocus();
    expect(screen.getByTestId('location')).toHaveTextContent('/suche?q=verfahren|{"focusSearch":true}');
  });

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

  it('nimmt verdeckt alle Steuerungen außer dem Menübutton aus der Bedienung', () => {
    const renderHeader = (obscured: boolean) => (
      <MemoryRouter>
        <HeaderBar onMenuToggle={vi.fn()} obscured={obscured} />
      </MemoryRouter>
    );
    const { rerender } = render(renderHeader(true));
    const menuButton = screen.getByRole('button', { name: 'Menü öffnen' });
    // Inerte Teilbäume fehlen im Barrierefreiheitsbaum; die Abfrage geht deshalb über das DOM.
    const header = screen.getByTestId('header-bar');
    const obscuredControls = [
      header.querySelector('a[href="/"]')!,
      screen.getByTestId('header-search'),
      header.querySelector('a[href="/suche"]')!,
    ];

    expect(menuButton.closest('[inert]')).toBeNull();
    for (const control of obscuredControls) expect(control.closest('[inert]')).not.toBeNull();

    rerender(renderHeader(false));
    expect(header.querySelector('[inert]')).toBeNull();
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

  // Ab 640 px ist das Feld bei offener mobiler Schublade sichtbar, aber
  // verdeckt und `inert`. Die Suchseite hat dort kein eigenes Feld; das Kürzel
  // gibt deshalb den App-Kopf frei und fokussiert dessen Feld (GSPP-497).
  it('gibt bei verdecktem Suchfeld den App-Kopf frei und fokussiert das Feld danach', () => {
    const onUncover = vi.fn();
    const renderHeader = (obscured: boolean) => (
      <MemoryRouter>
        <HeaderBar obscured={obscured} onUncover={onUncover} />
        <button type="button">Außerhalb</button>
      </MemoryRouter>
    );
    const { rerender } = render(renderHeader(true));
    const searchInput = screen.getByTestId('header-search');
    const outsideButton = screen.getByRole('button', { name: 'Außerhalb' });
    outsideButton.focus();

    expect(fireEvent.keyDown(outsideButton, { key: 'k', ctrlKey: true })).toBe(false);
    expect(onUncover).toHaveBeenCalledOnce();
    expect(searchInput).not.toHaveFocus();

    rerender(renderHeader(false));
    expect(searchInput).toHaveFocus();

    // Ein späteres Freigeben ohne Kürzel verschiebt den Fokus nicht.
    outsideButton.focus();
    rerender(renderHeader(true));
    rerender(renderHeader(false));
    expect(outsideButton).toHaveFocus();
  });

  // Eine Öffnen-Vorschau der Wischgeste verschiebt den App-Kopf, ohne ihn
  // `inert` zu machen. Das Kürzel lässt sie über `onUncover` beenden, bevor es
  // das Feld fokussiert; sonst öffnete das Loslassen die Schublade danach und
  // zöge den Fokus zum Menübutton.
  it('gibt bei sichtbarem, nicht verdecktem Suchfeld den App-Kopf frei und fokussiert das Feld sofort', () => {
    const focusedOnUncover: (Element | null)[] = [];
    const onUncover = vi.fn(() => { focusedOnUncover.push(document.activeElement); });
    render(
      <MemoryRouter>
        <HeaderBar onUncover={onUncover} />
        <button type="button">Außerhalb</button>
      </MemoryRouter>,
    );
    const searchInput = screen.getByTestId('header-search');
    const outsideButton = screen.getByRole('button', { name: 'Außerhalb' });
    outsideButton.focus();

    expect(fireEvent.keyDown(outsideButton, { key: 'k', ctrlKey: true })).toBe(false);
    expect(focusedOnUncover).toHaveLength(1);
    expect(focusedOnUncover[0]).toBe(outsideButton);
    expect(searchInput).toHaveFocus();
  });

  it('führt das Kürzel bei verdecktem und ausgeblendetem Suchfeld auf die Suchseite', () => {
    function Location() {
      const location = useLocation();
      return <output data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</output>;
    }
    const onUncover = vi.fn();
    render(
      <MemoryRouter>
        <HeaderBar obscured onUncover={onUncover} />
        <Location />
        <button type="button">Außerhalb</button>
      </MemoryRouter>,
    );
    screen.getByTestId('header-search').checkVisibility = () => false;
    const outsideButton = screen.getByRole('button', { name: 'Außerhalb' });
    outsideButton.focus();

    expect(fireEvent.keyDown(outsideButton, { key: 'k', ctrlKey: true })).toBe(false);

    expect(onUncover).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/suche|{"focusSearch":true}');
  });

  it('hält auf der Suchseite die laufende Anfrage, wenn das Kürzel ohne sichtbares Feld fokussiert', () => {
    function Location() {
      const location = useLocation();
      return <output data-testid="location">{`${location.pathname}${location.search}|${JSON.stringify(location.state)}`}</output>;
    }
    render(
      <MemoryRouter initialEntries={['/start', '/suche?q=verfahren']} initialIndex={1}>
        <HeaderBar />
        <Location />
        <button type="button">Außerhalb</button>
      </MemoryRouter>,
    );
    screen.getByRole('searchbox', { name: 'Katalog durchsuchen' }).checkVisibility = () => false;
    const outsideButton = screen.getByRole('button', { name: 'Außerhalb' });
    outsideButton.focus();

    fireEvent.keyDown(outsideButton, { key: 'k', metaKey: true });

    expect(screen.getByTestId('location')).toHaveTextContent('/suche?q=verfahren|{"focusSearch":true}');
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
