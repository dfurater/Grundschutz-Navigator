import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import {
  buildStationUrl, buildVerbundUrl, buildWorkspaceDocumentUrl, buildWorkspaceIndexUrl,
} from '@/app/routes';
import { WORKSPACE_STATIONS } from '@/domain/workspaceStations';
import type { CatalogState } from '@/domain/models';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { renderAppShell } from '@/test/renderAppShell';
import {
  SENTINEL, SENTINEL_DOCUMENT_UUID, SENTINEL_HREF, SENTINEL_PARTY, SENTINEL_TITLE, SENTINEL_VERBUND,
  readStore, resetWorkspace, seedWorkspace, type SeededWorkspace,
} from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});

vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => <h1>Katalogansicht</h1>,
}));

const catalogState: CatalogState = {
  ...catalogCollectionDefaults(),
  catalogDocument: null,
  catalog: null,
  provenance: null,
  verification: null,
  loading: false,
  error: null,
  vocabularyRegistry: null,
  vocabularyProvenance: null,
  vocabularyVerification: null,
} as CatalogState;

function renderArea(path: string) {
  return renderAppShell([path], {
    shell: () => (
      <CatalogContext.Provider value={catalogState}>
        <WorkspaceProvider><AppShell /></WorkspaceProvider>
      </CatalogContext.Provider>
    ),
  });
}

function main() {
  return screen.getByRole('main');
}

let seeded: SeededWorkspace;

beforeEach(async () => {
  seeded = await seedWorkspace();
});

afterEach(async () => {
  await resetWorkspace();
});

describe('Übersicht der Informationsverbünde', () => {
  it('listet die Verbünde aus dem Speicher und legt neue an', async () => {
    renderArea(buildWorkspaceIndexUrl());
    expect(await within(main()).findByRole('link', { name: SENTINEL_VERBUND })).toBeInTheDocument();
    expect(within(main()).getByText('2 Informationsverbünde')).toHaveClass('tabular-nums');

    fireEvent.change(within(main()).getByLabelText('Name'), { target: { value: 'Rechenzentrum Nord' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Anlegen' }));

    expect(await within(main()).findByRole('link', { name: 'Rechenzentrum Nord' })).toBeInTheDocument();
    const stored = await readStore((store) => store.listVerbuende());
    expect(stored.map((verbund) => verbund.name)).toContain('Rechenzentrum Nord');
  });

  it('benennt einen Verbund im Speicher um', async () => {
    renderArea(buildWorkspaceIndexUrl());
    const row = (await within(main()).findByRole('link', { name: 'Zweiter Verbund' })).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Umbenennen' }));
    fireEvent.change(within(main()).getByLabelText('Neuer Name'), { target: { value: 'Standort Süd' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));

    expect(await within(main()).findByRole('link', { name: 'Standort Süd' })).toBeInTheDocument();
    const stored = await readStore((store) => store.listVerbuende());
    expect(stored.find((verbund) => verbund.verbundId === seeded.otherVerbundId)?.name).toBe('Standort Süd');
  });

  it('löscht erst nach ausdrücklicher Bestätigung; Abbrechen löscht nichts', async () => {
    renderArea(buildWorkspaceIndexUrl());
    const row = (await within(main()).findByRole('link', { name: SENTINEL_VERBUND })).closest('li')!;

    fireEvent.click(within(row).getByRole('button', { name: 'Löschen…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Informationsverbund endgültig löschen?' });
    expect(dialog).toHaveTextContent('lässt sich nicht rückgängig machen');
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect((await readStore((store) => store.listVerbuende())).map((verbund) => verbund.verbundId)).toContain(seeded.verbundId);

    fireEvent.click(within(row).getByRole('button', { name: 'Löschen…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => expect(within(main()).queryByRole('link', { name: SENTINEL_VERBUND })).not.toBeInTheDocument());
    expect((await readStore((store) => store.listVerbuende())).map((verbund) => verbund.verbundId)).toEqual([seeded.otherVerbundId]);
    expect(await readStore((store) => store.listDocuments(seeded.verbundId))).toEqual([]);
    expect(await readStore((store) => store.listDocuments(seeded.otherVerbundId))).toHaveLength(1);
  });
});

describe('Verbundseite und Stationen', () => {
  it('zeigt alle Stationen mit Titel und Erklärzeile, ohne Sperre und ohne Fortschrittsbalken', async () => {
    renderArea(buildVerbundUrl(seeded.verbundId));
    const stations = await screen.findByRole('navigation', { name: 'Stationen' });
    for (const [title, explanation] of [
      ['Übersicht', 'Alle Dokumente'],
      ['Catalog', 'Der Anforderungsbestand zum Nachschlagen'],
      ['Profile', 'Das Anforderungspaket für einen Informationsverbund'],
      ['SSP', 'Der Umsetzungsstatus je Anforderung'],
      ['Assessment Plan / Results', 'Die Wirksamkeitsprüfung'],
      ['POA&M', 'Die Umsetzungsplanung für nicht erfüllte Anforderungen'],
    ]) {
      const link = within(stations).getByRole('link', { name: new RegExp(`^${title.replace(/[/&]/g, '.')}`) });
      expect(link).toHaveTextContent(explanation);
      expect(link).not.toHaveAttribute('aria-disabled');
    }
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(await within(main()).findByRole('heading', { level: 1, name: SENTINEL_VERBUND })).toBeInTheDocument();
  });

  it('filtert per Stationsklick über die Route und sagt die Zählung an', async () => {
    const { router } = renderArea(buildVerbundUrl(seeded.verbundId));
    const counts = await within(main()).findByText('5 Dokumente · 2 Entwürfe · 0 Diagnosen');
    expect(counts).toHaveAttribute('aria-live', 'polite');
    expect(counts).toHaveClass('tabular-nums');

    const stations = screen.getByRole('navigation', { name: 'Stationen' });
    fireEvent.click(within(stations).getByRole('link', { name: /^Assessment Plan \/ Results/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe(buildStationUrl(seeded.verbundId, 'assessment')));
    const filtered = await within(main()).findByText('2 von 5 Dokumenten');
    expect(filtered).toHaveAttribute('aria-live', 'polite');
    const list = within(main()).getByRole('region', { name: 'Station Assessment Plan / Results' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual(['Assessment Plan', 'Assessment Results']);
    expect(within(stations).getByRole('link', { name: /^Assessment Plan \/ Results/ })).toHaveAttribute('aria-current', 'page');
  });

  it('zeigt an einer leeren Station eine Lücke statt einer Sperre', async () => {
    renderArea(buildStationUrl(seeded.verbundId, 'poam'));
    expect(await within(main()).findByText('An dieser Station liegt noch kein Dokument.')).toBeInTheDocument();
    const orientation = within(main()).getByRole('region', { name: 'Orientierung' });
    expect(within(orientation).getByRole('link', { name: 'POA&M' })).toHaveAttribute('href', buildStationUrl(seeded.verbundId, 'poam'));
  });

  it('führt Dokumente ohne eigene Station nur in der ungefilterten Liste', async () => {
    renderArea(buildVerbundUrl(seeded.verbundId));
    expect(await within(main()).findByText('Component Definition')).toBeInTheDocument();
    for (const station of WORKSPACE_STATIONS) {
      const { unmount } = renderArea(buildStationUrl(seeded.verbundId, station));
      await waitFor(() => expect(screen.getAllByRole('main').at(-1)).toHaveTextContent(/von 5 Dokumenten/));
      expect(screen.getAllByRole('main').at(-1)).not.toHaveTextContent('Component Definition');
      unmount();
    }
  });

  it('kennzeichnet jedes Dokument als eigene Daten mit Statuswort und ohne Verifikationsanzeige', async () => {
    renderArea(buildVerbundUrl(seeded.verbundId));
    const list = await within(main()).findByRole('region', { name: 'Alle Dokumente' });
    const rows = await within(list).findAllByRole('listitem');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row).toHaveTextContent('Eigene Daten · kein Integritätsnachweis');
      expect(row.querySelector('[data-validity]')?.textContent).toMatch(/^(Entwurf|Gültig)$/);
    }
    const valid = list.querySelector('[data-validity="Gültig"]')!;
    expect(valid.className).not.toMatch(/success|warning/);
    expect(valid.querySelector('svg')).toBeNull();
    expect(list.querySelectorAll('[data-validity="Entwurf"]')).toHaveLength(2);
    expect(main()).not.toHaveTextContent(/Verifiziert|Nicht verifiziert/);
  });
});

describe('Dokumentdetail', () => {
  it('zeigt jede Referenzkante mit Feld, Pflicht und Zustand; ein externer href ist kein Link', async () => {
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, seeded.profile.localId));
    const edges = await within(main()).findByRole('region', { name: 'Referenzkanten' });
    const external = edges.querySelector('[data-edge-state="external"]') as HTMLElement;
    expect(external).toHaveTextContent('/profile/imports/0/href');
    expect(external).toHaveTextContent('Pflicht');
    expect(external).toHaveTextContent('extern, nicht aufgelöst');
    expect(external).toHaveTextContent(SENTINEL_HREF);
    expect(within(external).queryByRole('link')).not.toBeInTheDocument();
    expect(main().querySelector(`a[href="${SENTINEL_HREF}"]`)).toBeNull();
  });

  it('verlinkt eine aufgelöste lokale Bindung auf das Zieldokument desselben Verbunds', async () => {
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId));
    const edges = await within(main()).findByRole('region', { name: 'Referenzkanten' });
    const resolved = edges.querySelector('[data-edge-state="resolved"]') as HTMLElement;
    expect(resolved).toHaveTextContent('/system-security-plan/import-profile/href');
    expect(resolved).toHaveTextContent('Pflicht');
    expect(resolved).toHaveTextContent('aufgelöst');
    expect(within(resolved).getByRole('link', { name: `Profile: ${SENTINEL_TITLE}` }))
      .toHaveAttribute('href', buildWorkspaceDocumentUrl(seeded.verbundId, seeded.profile.localId));
  });
});

describe('Arbeitsroutenraum: Nicht-gefunden, Reload und Zurück', () => {
  it.each([
    ['unbekannte verbundId', () => buildVerbundUrl('0e1d2c3b-4a59-4687-8796-a5b4c3d2e1f0'), 'Informationsverbund nicht gefunden'],
    ['keine lokale Identität', () => '/informationsverbuende/nicht-lokal', 'Informationsverbund nicht gefunden'],
    ['unbekannte Station', () => `${buildVerbundUrl(seeded.verbundId)}/station/catalog`, 'Informationsverbund nicht gefunden'],
    ['unbekannte localId', () => buildWorkspaceDocumentUrl(seeded.verbundId, '0e1d2c3b-4a59-4687-8796-a5b4c3d2e1f0'), 'Dokument nicht gefunden'],
    ['Dokument eines anderen Verbunds', () => buildWorkspaceDocumentUrl(seeded.verbundId, seeded.foreign.localId), 'Dokument nicht gefunden'],
  ])('%s zeigt einen eigenen Nicht-gefunden-Zustand', async (_label, path, heading) => {
    renderArea(path());
    expect(await within(main()).findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(main()).not.toHaveTextContent(SENTINEL_VERBUND);
    expect(main()).not.toHaveTextContent('Fremdes Profil');
  });

  it('führt Reload und Browser-Zurück deterministisch auf dieselbe Ansicht', async () => {
    const station = buildStationUrl(seeded.verbundId, 'profile');
    const first = renderArea(station);
    const firstText = (await within(main()).findByText('1 von 5 Dokumenten')).closest('main')!.textContent;
    first.unmount();

    const { router } = renderArea(station);
    await within(main()).findByText('1 von 5 Dokumenten');
    expect(main().textContent).toBe(firstText);

    fireEvent.click(within(main()).getByRole('link', { name: new RegExp(`^Profile${SENTINEL_TITLE}`) }));
    await within(main()).findByRole('region', { name: 'Referenzkanten' });
    await act(() => router.navigate(-1));
    await within(main()).findByText('1 von 5 Dokumenten');
    expect(router.state.location.pathname).toBe(station);
    expect(main().textContent).toBe(firstText);
  });
});

describe('Egress-Grenze (ADR-11 §3)', () => {
  const FORBIDDEN = [SENTINEL, SENTINEL_DOCUMENT_UUID, SENTINEL_HREF, SENTINEL_PARTY];

  it('hält Dokumenttitel, Verbundnamen, Parteinamen, UUID und href aus Titel, Route und Verlauf', async () => {
    const paths = [
      buildWorkspaceIndexUrl(),
      buildVerbundUrl(seeded.verbundId),
      ...WORKSPACE_STATIONS.map((station) => buildStationUrl(seeded.verbundId, station)),
      buildWorkspaceDocumentUrl(seeded.verbundId, seeded.profile.localId),
      buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId),
    ];
    for (const path of paths) {
      const { router, unmount } = renderArea(path);
      await waitFor(() => expect(main().querySelector('[data-workspace-state="loading"]')).toBeNull());
      await waitFor(() => expect(main()).toHaveTextContent(/Eigene Daten · kein Integritätsnachweis/));
      const { pathname, search, hash, state } = router.state.location;
      const exposed = [document.title, pathname, search, hash, JSON.stringify(state ?? null)].join('\n');
      for (const value of FORBIDDEN) expect(exposed).not.toContain(value);
      unmount();
    }
  });

  it('lässt Eingaben im Bereich nie in URL oder Verlauf; die Kopfzeilensuche bleibt Katalogsuche', async () => {
    const { router } = renderArea(buildWorkspaceIndexUrl());
    await within(main()).findByRole('link', { name: SENTINEL_VERBUND });
    const before = router.state.location.key;

    fireEvent.change(within(main()).getByLabelText('Name'), { target: { value: `Neu ${SENTINEL}` } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Anlegen' }));
    await within(main()).findByRole('link', { name: `Neu ${SENTINEL}` });
    expect(router.state.location.key).toBe(before);
    expect(`${router.state.location.pathname}${router.state.location.search}${router.state.location.hash}`).toBe(buildWorkspaceIndexUrl());

    const search = screen.getByTestId('header-search');
    fireEvent.change(search, { target: { value: 'Zugriff' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/suche'));
    expect(router.state.location.search).toBe('?q=Zugriff');
  });
});

describe('Bereichswechsel', () => {
  it('zeigt den aktiven Bereich mit aria-current und führt in den Katalog', async () => {
    const { router } = renderArea(buildVerbundUrl(seeded.verbundId));
    await within(main()).findByRole('heading', { level: 1, name: SENTINEL_VERBUND });
    const header = within(screen.getByTestId('header-bar'));
    const areas = header.getByRole('navigation', { name: 'Bereiche' });
    expect(within(areas).getByRole('link', { name: 'Informationsverbünde' })).toHaveAttribute('aria-current', 'true');
    expect(within(areas).getByRole('link', { name: 'Katalog' })).not.toHaveAttribute('aria-current');

    fireEvent.click(within(areas).getByRole('link', { name: 'Katalog' }), { button: 0 });
    await waitFor(() => expect(router.state.location.pathname).toBe('/katalog/gspp'));
    expect(await within(main()).findByRole('heading', { name: 'Katalogansicht' })).toBeInTheDocument();
    expect(within(header.getByRole('navigation', { name: 'Bereiche' })).getByRole('link', { name: 'Katalog' }))
      .toHaveAttribute('aria-current', 'true');
  });
});
