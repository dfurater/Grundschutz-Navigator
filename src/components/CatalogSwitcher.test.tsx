import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalog } from '@/hooks/useCatalog';
import { CatalogSwitcher } from './CatalogSwitcher';

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
      { catalogKey: 'iso27001-annex-a', title: 'ISO/IEC 27001 Annex A Referenzkatalog' },
    ],
  };
});

const mockedUseCatalog = vi.mocked(useCatalog);

function catalogState(activeCatalogKey: string): ReturnType<typeof useCatalog> {
  return { activeCatalogKey } as ReturnType<typeof useCatalog>;
}

function renderSwitcher() {
  return render(
    <MemoryRouter>
      <CatalogSwitcher />
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
      screen.getByRole('menuitem', { name: /ISO\/IEC 27001 Annex A Referenzkatalog/ }),
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
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(view.container);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
