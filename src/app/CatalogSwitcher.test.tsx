import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Catalog, LoadedCatalogState } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { CatalogSwitcher } from './CatalogSwitcher';
import type { CatalogSwitcherItem } from './CatalogSwitcher';

const ITEMS: CatalogSwitcherItem[] = [
  { catalogKey: 'gspp', title: 'Anwenderkatalog Grundschutz++', controlCount: 1001, implementsNorm: '§ 44 Abs. 1 BSIG', href: '/katalog/gspp' },
  { catalogKey: 'diva', title: 'DIVA - Durchgängige Identitätsprüfung', controlCount: 168, targetAudience: 'Bundesbehörden', href: '/katalog/diva' },
  { catalogKey: 'lieferkette', title: 'Supply Chain Security', controlCount: 146, href: '/katalog/lieferkette' },
];

const state = (catalogKey: CatalogKey, patch: Partial<LoadedCatalogState>): LoadedCatalogState => ({
  catalogKey, catalogDocument: null, catalog: null, provenance: null, verification: null, loading: false, error: null, ...patch,
});

function setup(initialStates: [CatalogKey, LoadedCatalogState][]) {
  const requestCatalog = vi.fn();
  let setLoadStates: (next: Map<CatalogKey, LoadedCatalogState>) => void = () => {};
  // Wie im Provider setzt die Wiederholung den Fehler synchron auf „lädt“ zurück.
  const retryCatalog = vi.fn((catalogKey: CatalogKey) => setLoadStates(new Map([[catalogKey, state(catalogKey, { loading: true })]])));
  function Harness() {
    const [loadStates, set] = useState(() => new Map(initialStates));
    setLoadStates = set;
    return (
      <CatalogSwitcher
        items={ITEMS}
        activeKey="gspp"
        open
        onToggle={() => {}}
        loadStates={loadStates}
        requestCatalog={requestCatalog}
        retryCatalog={retryCatalog}
      />
    );
  }
  const router = createMemoryRouter([{ path: '*', element: <Harness /> }], { initialEntries: ['/katalog/gspp'] });
  render(<RouterProvider router={router} />);
  const update = (next: [CatalogKey, LoadedCatalogState][]) => act(() => setLoadStates(new Map(next)));
  const list = () => within(screen.getByRole('navigation', { name: 'Verfügbare Kataloge' }));
  return { requestCatalog, retryCatalog, router, update, list };
}

describe('CatalogSwitcher', () => {
  it('zeigt Zählung, Kontrollzahlen und nur belegte Katalogangaben', () => {
    const { list } = setup([['gspp', state('gspp', { catalog: {} as Catalog })]]);

    expect(screen.getByRole('button', { name: 'Katalog Grundschutz++ wechseln' })).toHaveAccessibleDescription('Anwenderkatalog Grundschutz++');
    expect(screen.getByText('3 Kataloge')).toBeInTheDocument();
    const active = list().getByRole('button', { name: 'Anwenderkatalog Grundschutz++' });
    expect(active).toHaveAccessibleDescription('Geöffnet Norm: § 44 Abs. 1 BSIG 1.001 Kontrollen');
    expect(list().getByRole('link', { name: /^DIVA/ })).toHaveAccessibleDescription('Zielgruppe: Bundesbehörden 168 Kontrollen');
    expect(list().getByRole('link', { name: 'Supply Chain Security' })).toHaveAccessibleDescription('146 Kontrollen');
  });

  it('lädt einen Katalog vor dem Wechsel, sperrt die übrigen und bricht mit Escape ab', () => {
    const { requestCatalog, router, update, list } = setup([]);
    const diva = list().getByRole('link', { name: /^DIVA/ });

    fireEvent.click(diva);
    expect(requestCatalog).toHaveBeenCalledWith('diva');
    expect(router.state.location.pathname).toBe('/katalog/gspp');
    expect(diva).toHaveAttribute('aria-busy', 'true');
    expect(diva).toHaveTextContent('Katalog wird geladen…');
    const other = list().getByRole('link', { name: 'Supply Chain Security' });
    expect(other).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(other);
    expect(requestCatalog).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('DIVA wird geladen. Escape bricht ab.');

    fireEvent.keyDown(diva, { key: 'Escape' });
    expect(diva).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('status')).toHaveTextContent('Wechsel abgebrochen. Grundschutz++ bleibt geöffnet.');

    update([['diva', state('diva', { catalog: {} as Catalog })]]);
    expect(router.state.location.pathname).toBe('/katalog/gspp');
  });

  it('bewegt den Fokus mit Pfeiltasten, Pos1 und Ende zwischen den Einträgen', () => {
    const { list } = setup([]);
    const active = list().getByRole('button', { name: 'Anwenderkatalog Grundschutz++' });
    active.focus();

    fireEvent.keyDown(active, { key: 'ArrowDown' });
    expect(list().getByRole('link', { name: /^DIVA/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(list().getByRole('link', { name: 'Supply Chain Security' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(active).toHaveFocus();
  });

  it('lässt einen Klick mit Modifikator den Link normal öffnen', () => {
    const { requestCatalog, list } = setup([]);
    const diva = list().getByRole('link', { name: /^DIVA/ });

    const modifiers = [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }];
    for (const modifier of modifiers) expect(fireEvent.click(diva, modifier)).toBe(true);
    expect(requestCatalog).not.toHaveBeenCalled();
    expect(diva).not.toHaveAttribute('aria-busy');

    // Auch während ein anderer Katalog lädt, bleibt die native Linkaktion erhalten.
    fireEvent.click(list().getByRole('link', { name: 'Supply Chain Security' }));
    for (const modifier of modifiers) expect(fireEvent.click(diva, modifier)).toBe(true);
  });

  it('wechselt erst nach dem Laden und bleibt bei einem Fehler beim geöffneten Katalog', async () => {
    const { retryCatalog, router, update, list } = setup([]);

    fireEvent.click(list().getByRole('link', { name: /^DIVA/ }));
    update([['diva', state('diva', { error: 'Netzwerkfehler' })]]);
    expect(router.state.location.pathname).toBe('/katalog/gspp');
    expect(screen.getByText('DIVA konnte nicht geladen werden: Netzwerkfehler')).toBeInTheDocument();
    expect(screen.getByText('Grundschutz++ bleibt geöffnet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(retryCatalog).toHaveBeenCalledWith('diva');
    expect(list().getByRole('link', { name: /^DIVA/ })).toHaveFocus();
    expect(screen.queryByText('Grundschutz++ bleibt geöffnet.')).not.toBeInTheDocument();

    // Escape nach der Wiederholung bricht ab; ein danach geladener Katalog wechselt nicht.
    fireEvent.keyDown(list().getByRole('link', { name: /^DIVA/ }), { key: 'Escape' });
    update([['diva', state('diva', { catalog: {} as Catalog })]]);
    await act(async () => {});
    expect(router.state.location.pathname).toBe('/katalog/gspp');

    fireEvent.click(list().getByRole('link', { name: /^DIVA/ }));
    update([['diva', state('diva', { catalog: {} as Catalog })]]);
    await waitFor(() => expect(router.state.location.pathname).toBe('/katalog/diva'));
    expect(router.state.location.state).toEqual({ fromCatalogSwitcher: true });
  });
});
