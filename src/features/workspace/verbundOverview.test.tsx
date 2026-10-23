// Verbund-Übersicht und Verbundpfad nach GSPP-307 Bild 2 und 6 (GSPP-616).
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStationUrl, buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { mainLandmark as main, renderWorkspaceArea as renderArea } from '@/test/renderWorkspaceArea';
import {
  SENTINEL_VERBUND, readStore, resetWorkspace, seedWorkspace, type SeededWorkspace,
} from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});

vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => <h1>Katalogansicht</h1>,
}));

let seeded: SeededWorkspace;

beforeEach(async () => {
  seeded = await seedWorkspace();
});

afterEach(async () => {
  await resetWorkspace();
});

describe('Verbund-Übersicht', () => {
  const cards = () => within(within(main()).getByRole('region', { name: 'Stationen' })).getAllByRole('listitem')
    .filter((item) => item.parentElement?.tagName === 'UL' && item.querySelector('h3'));

  it('zeigt Kopf, Herkunft, Speicherstand und fünf Stationskarten in fester Reihenfolge', async () => {
    renderArea(buildVerbundUrl(seeded.verbundId));
    expect(await within(main()).findByRole('heading', { level: 1, name: SENTINEL_VERBUND })).toBeInTheDocument();
    const head = within(main().querySelector('header')!);
    expect(head.getByText('Informationsverbund')).toBeInTheDocument();
    expect(head.getByText('Eigene Daten · kein Integritätsnachweis')).toBeInTheDocument();
    expect(head.getByText(/^Automatisch gespeichert · (gerade eben|vor )/).closest('[aria-live="polite"]')).not.toBeNull();
    expect(cards().map((card) => card.querySelector('h3')?.textContent)).toEqual(['Catalog', 'Profile', 'SSP', 'Assessment', 'POA&M']);
  });

  it('zeigt Statuswörter je Station und für Prüfplan und Prüfergebnisse getrennt; eine Lücke ohne Zahl', async () => {
    renderArea(buildVerbundUrl(seeded.verbundId));
    await within(main()).findByRole('heading', { level: 1, name: SENTINEL_VERBUND });
    const [catalog, profile, ssp, assessment, poam] = cards();
    expect(catalog).not.toHaveTextContent('Anforderungen');
    expect(within(catalog).getByRole('link', { name: 'Katalog öffnen, Catalog' })).toHaveAttribute('href', '/katalog/gspp');
    expect(profile.querySelector('[data-validity]')).toHaveTextContent('Gültig');
    // Das Profil importiert extern: ohne auflösbares Importziel keine Kennzahl.
    expect(profile).not.toHaveTextContent(/aufgenommen/);
    expect(profile).toHaveTextContent(/zuletzt geändert (gerade eben|vor )/);
    expect(ssp.querySelector('[data-validity]')).toHaveTextContent('Entwurf');
    expect(ssp).not.toHaveTextContent(/dokumentiert/);
    expect([...assessment.querySelectorAll('[data-validity]')].map((mark) => mark.textContent)).toEqual(['Gültig', 'Entwurf']);
    expect(assessment).toHaveTextContent('0 geprüft · 0 nicht erfüllt');
    expect(poam).toHaveTextContent('Noch kein Dokument');
    expect(poam).not.toHaveTextContent(/\d/);
    expect(poam.querySelector('[data-validity]')).toBeNull();
    expect(within(poam).getByRole('link', { name: 'Umsetzungsplanung öffnen, POA&M, Noch kein Dokument' }))
      .toHaveAttribute('href', buildStationUrl(seeded.verbundId, 'poam'));
  });

  it('zeigt an der POA&M-Karte den Hinweis zur freien Reihenfolge, solange Prüfergebnisse unvollständig sind', async () => {
    renderArea(buildVerbundUrl(seeded.verbundId));
    await within(main()).findByRole('heading', { level: 1, name: SENTINEL_VERBUND });
    const hint = 'Bereits aktiv, obwohl die Prüfergebnisse noch nicht vollständig sind — keine erzwungene Reihenfolge.';
    expect(cards()[4]).toHaveTextContent(hint);
    for (const card of cards()) expect(within(card).getByRole('link')).not.toHaveAttribute('aria-disabled');

    await readStore((store) => store.deleteDocument(seeded.assessmentResults.localId));
    const { unmount } = renderArea(buildVerbundUrl(seeded.verbundId));
    await waitFor(() => expect(screen.getAllByRole('main').at(-1)).toHaveTextContent(hint));
    unmount();
  });

  it('benennt den Verbund im Kopf um', async () => {
    renderArea(buildVerbundUrl(seeded.verbundId));
    await within(main()).findByRole('heading', { level: 1, name: SENTINEL_VERBUND });
    fireEvent.click(within(main()).getByRole('button', { name: 'Umbenennen' }));
    fireEvent.change(within(main()).getByLabelText('Neuer Name'), { target: { value: 'Rechenzentrum Nord' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Rechenzentrum Nord' })).toBeInTheDocument();
    expect((await readStore((store) => store.listVerbuende())).find((verbund) => verbund.verbundId === seeded.verbundId)?.name).toBe('Rechenzentrum Nord');
  });

  it('löscht den Verbund erst nach Bestätigung und kehrt zur Übersicht zurück', async () => {
    const { router } = renderArea(buildVerbundUrl(seeded.verbundId));
    await within(main()).findByRole('heading', { level: 1, name: SENTINEL_VERBUND });
    fireEvent.click(within(main()).getByRole('button', { name: 'Löschen…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }));
    expect((await readStore((store) => store.listVerbuende())).map((verbund) => verbund.verbundId)).toContain(seeded.verbundId);

    fireEvent.click(within(main()).getByRole('button', { name: 'Löschen…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Endgültig löschen' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(buildWorkspaceIndexUrl()));
    expect((await readStore((store) => store.listVerbuende())).map((verbund) => verbund.verbundId)).toEqual([seeded.otherVerbundId]);
  });
});

describe('Verbundpfad in der Kopfzeile', () => {
  it('nennt den Verbund und wechselt per Tastatur auf einen anderen Verbund', async () => {
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'ssp'));
    const path = within(screen.getByTestId('header-bar')).getByRole('navigation', { name: 'Pfad' });
    expect(within(path).getByRole('link', { name: 'Informationsverbünde' })).toHaveAttribute('href', buildWorkspaceIndexUrl());
    const trigger = await within(path).findByRole('button', { name: `Informationsverbund: ${SENTINEL_VERBUND}` });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const items = within(path).getAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      [SENTINEL_VERBUND, 'true'], ['Zweiter Verbund', 'false'],
    ]);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(within(path).getByRole('menu'), { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.click(items[1]);
    await waitFor(() => expect(router.state.location.pathname).toBe(buildVerbundUrl(seeded.otherVerbundId)));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Zweiter Verbund' })).toBeInTheDocument();
  });

  it('fehlt im Katalogbereich', async () => {
    renderArea('/katalog/gspp');
    expect(await within(main()).findByRole('heading', { name: 'Katalogansicht' })).toBeInTheDocument();
    expect(within(screen.getByTestId('header-bar')).queryByRole('navigation', { name: 'Pfad' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Stationen' })).not.toBeInTheDocument();
  });
});
