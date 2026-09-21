import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { CatalogSwitcher } from './CatalogSwitcher';
import type { CatalogSwitcherProps } from './CatalogSwitcher';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedNavigate = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => mockedNavigate,
  };
});

// Stellt sicher, dass die Komponente generisch über die Registry iteriert statt
// über hart kodierte Katalog-Keys — mit vier Einträgen, darunter einem ohne
// eigene Icon-Zuordnung, um den Fallback abzudecken.
vi.mock('@/domain/sourceRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/sourceRegistry')>();
  return {
    ...actual,
    SUPPORTED_CATALOGS: [
      { catalogKey: 'gspp', title: 'Grundschutz++ Anwenderkatalog', entryCatalog: true },
      { catalogKey: 'lieferkette', title: 'Anwenderkatalog Lieferkettensicherheit' },
      { catalogKey: 'wlan', title: 'Anwenderkatalog WLAN' },
      { catalogKey: 'mindeststandard-tls', title: 'Mindeststandard TLS (Entwurf)' },
    ],
  };
});

const mockedUseCatalog = vi.mocked(useCatalog);

function catalogState(activeCatalogKey: string): ReturnType<typeof useCatalog> {
  return { activeCatalogKey } as ReturnType<typeof useCatalog>;
}

function renderSwitcher(props: CatalogSwitcherProps = {}) {
  return render(
    <MemoryRouter>
      <CatalogSwitcher {...props} />
    </MemoryRouter>,
  );
}

describe('CatalogSwitcher', () => {
  beforeEach(() => {
    mockedNavigate.mockReset();
  });

  it('shows the active catalog on the trigger', () => {
    mockedUseCatalog.mockReturnValue(catalogState('wlan'));
    renderSwitcher();

    expect(
      screen.getByRole('button', { name: 'Katalog wechseln' }),
    ).toHaveTextContent('Anwenderkatalog WLAN');
  });

  it('lists every supported catalog generically and marks only the active one as current', () => {
    mockedUseCatalog.mockReturnValue(catalogState('wlan'));
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Katalog wechseln' }));

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(screen.getByRole('menuitem', { name: /Anwenderkatalog WLAN/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('menuitem', { name: /Grundschutz\+\+ Anwenderkatalog/ }),
    ).not.toHaveAttribute('aria-current');
    expect(
      screen.getByRole('menuitem', { name: /Anwenderkatalog Lieferkettensicherheit/ }),
    ).not.toHaveAttribute('aria-current');
    // Katalog ohne eigene Icon-Zuordnung fällt auf das generische Icon zurück,
    // statt die Zeile auszulassen oder abzustürzen.
    expect(
      screen.getByRole('menuitem', { name: /Mindeststandard TLS \(Entwurf\)/ }),
    ).toBeInTheDocument();
  });

  it('navigates to the selected catalog root and closes the menu', () => {
    mockedUseCatalog.mockReturnValue(catalogState('gspp'));
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Katalog wechseln' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Anwenderkatalog Lieferkettensicherheit/ }),
    );

    expect(mockedNavigate).toHaveBeenCalledWith('/katalog/lieferkette');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('autofocuses the first item and closes on Escape or outside click', () => {
    mockedUseCatalog.mockReturnValue(catalogState('gspp'));
    const view = renderSwitcher();
    const trigger = screen.getByRole('button', { name: 'Katalog wechseln' });

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(view.container);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('meldet jeden Zustandswechsel an den Aufrufer', () => {
    mockedUseCatalog.mockReturnValue(catalogState('gspp'));
    const onOpenChange = vi.fn();
    renderSwitcher({ onOpenChange });
    const trigger = screen.getByRole('button', { name: 'Katalog wechseln' });

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  // Übernimmt der Aufrufer den Zustand, entscheidet allein er über die
  // Sichtbarkeit — nur so kann die Shell das Menü beim Öffnen des Drawers
  // zuverlässig schließen, unabhängig von der Eingabeart (GSPP-440).
  it('folgt im gesteuerten Betrieb dem Aufrufer statt einem eigenen Zustand', () => {
    mockedUseCatalog.mockReturnValue(catalogState('gspp'));
    const onOpenChange = vi.fn();
    const view = renderSwitcher({ open: false, onOpenChange });
    const trigger = screen.getByRole('button', { name: 'Katalog wechseln' });

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    view.rerender(
      <MemoryRouter>
        <CatalogSwitcher open onOpenChange={onOpenChange} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });
});
