import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScopeUrl, buildVerbundUrl, buildStationUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import type { VerbundId } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { mainLandmark, renderWorkspaceArea } from '@/test/renderWorkspaceArea';
import { SENTINEL_TITLE, readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/reviewTrailFixtures')).importGateMock());
vi.mock('@/adapters/reviewTrailWork', async () => (await import('@/test/reviewTrailFixtures')).reviewTrailWorkMock());

const main = () => within(mainLandmark());
let seeded: SeededWorkspace;

beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(resetWorkspace);

async function setPackage(verbundId: VerbundId = seeded.verbundId) {
  const verbund = (await readStore((store) => store.listVerbuende())).find((row) => row.verbundId === verbundId)!;
  return readStore((store) => store.setRequirementPackage(verbundId, { savedAt: verbund.savedAt, baselineSavedAt: seeded.profile.savedAt }, seeded.profile.localId));
}

async function changeProfile() {
  const source = makeSchemaValidOscalDocument('profile', '1.2.2');
  const body = source.profile as { metadata: Record<string, unknown> };
  body.metadata.title = SENTINEL_TITLE;
  body.metadata['last-modified'] = '2026-11-14T09:12:00Z';
  await readStore((store) => store.saveDocument(seeded.profile.localId, seeded.profile.savedAt, null, {
    source, context: { trustClass: 'class-2-local-user' }, rootType: 'profile', oscalVersion: '1.2.2',
  }));
}

async function openPick(action: string) {
  const trigger = await main().findByRole('button', { name: action });
  fireEvent.click(trigger);
  await waitFor(() => expect(main().getByRole('heading', { name: 'Anforderungspaket festlegen' })).toHaveFocus());
}

describe('Anforderungspaket im Verbundkopf', () => {
  it('legt ein Profile ausdrücklich fest, zeigt Stand und offenen Quellenstand und fokussiert danach die Überschrift', async () => {
    renderWorkspaceArea(buildVerbundUrl(seeded.verbundId));
    expect(await main().findByText('Paket fehlt')).toBeVisible();
    await openPick('Festlegen…');

    // Nur Profiles und Catalogs des Verbunds, ohne Vorauswahl; SSP, AP, AR und das fremde Profile fehlen.
    const radios = main().getAllByRole('radio');
    expect(radios).toHaveLength(1);
    expect(radios[0]).not.toBeChecked();
    expect(main().getByText('Paket nicht festgelegt')).toBeVisible();
    expect(main().queryByText('Fremdes Profil')).toBeNull();
    expect(main().getByRole('button', { name: 'Festlegen' })).toBeDisabled();

    fireEvent.click(radios[0]);
    fireEvent.click(main().getByRole('button', { name: `„${SENTINEL_TITLE}“ festlegen` }));
    await waitFor(() => expect(main().getByRole('heading', { level: 1, name: /SENTINEL/ })).toHaveFocus());
    expect(await main().findByRole('button', { name: 'Ändern…' })).toBeVisible();
    expect(mainLandmark().textContent).toMatch(/Anforderungspaket:.*profile · Version \S+ · Stand \d\d\.\d\d\.\d{4}, \d\d:\d\d · Quellenstand offen/);
    expect(main().queryByText('Paket fehlt')).toBeNull();
    expect(document.title).not.toContain(SENTINEL_TITLE);
    expect(globalThis.location.href).not.toContain('SENTINEL');
  });

  it('listet Profile und Catalog ohne Version gesperrt und nennt je Root-Typ den verfügbaren Korrekturweg', async () => {
    for (const rootType of ['profile', 'catalog'] as const) {
      const source = makeSchemaValidOscalDocument(rootType, '1.2.2');
      const metadata = (source[rootType] as { metadata: Record<string, unknown> }).metadata;
      metadata.title = `${rootType} ohne Version`;
      delete metadata.version;
      await readStore((store) => store.addDocument(seeded.verbundId, { source, context: { trustClass: 'class-2-local-user' }, rootType, oscalVersion: '1.2.2' }, 'draft'));
    }
    renderWorkspaceArea(buildVerbundUrl(seeded.verbundId));
    await openPick('Festlegen…');
    expect(main().getByRole('radio', { name: /profile ohne Version/ })).toBeDisabled();
    expect(main().getByRole('radio', { name: /catalog ohne Version/ })).toBeDisabled();
    expect(main().getByText(/Fehlt: Version · in der OSCAL-Datei ergänzen, dann/)).toBeVisible();
    expect(main().getByText(/Fehlt: Version · in der Sicherungsdatei ergänzen, dann/)).toBeVisible();
    expect(main().getByRole('link', { name: /Profil-Datei einlesen/ })).toHaveAttribute('href', buildStationUrl(seeded.verbundId, 'profile'));
    expect(main().getByRole('link', { name: /Sicherung wiederherstellen/ })).toHaveAttribute('href', buildWorkspaceIndexUrl());
  });

  it('zeigt „überholt“ mit festgelegtem und aktuellem Stand und übernimmt beim Neufestlegen den neuen Stand', async () => {
    await setPackage();
    await changeProfile();
    renderWorkspaceArea(buildVerbundUrl(seeded.verbundId));
    expect(await main().findByText('Überholt')).toBeVisible();
    expect(main().getByText(/festgelegt: Stand .* · aktuell: Stand 14\.11\.2026/)).toBeVisible();
    await openPick('Neu festlegen…');
    expect(main().getAllByRole('radio')[0]).toBeChecked();
    fireEvent.click(main().getByRole('button', { name: `„${SENTINEL_TITLE}“ festlegen` }));
    expect(await main().findByRole('button', { name: 'Ändern…' })).toBeVisible();
    expect(main().queryByText('Überholt')).toBeNull();
  });

  it('meldet ein gelöschtes Baselinedokument ohne Titel als nicht auflösbar und hebt die Festlegung über „Kein Paket“ auf', async () => {
    await setPackage();
    await readStore((store) => store.deleteDocument(seeded.profile.localId));
    renderWorkspaceArea(buildVerbundUrl(seeded.verbundId));
    expect(await main().findByText('Nicht auflösbar')).toBeVisible();
    expect(main().getByText(/Dokument nicht mehr vorhanden/)).toBeVisible();
    expect(main().queryByText(SENTINEL_TITLE)).toBeNull();
    await openPick('Neu festlegen…');
    expect(main().getByText('Kein Profile oder Catalog in diesem Informationsverbund')).toBeVisible();
    expect(main().getByRole('link', { name: /Anforderungspaket anlegen/ })).toBeVisible();
    // Ohne verbleibende Kandidaten bleibt „Kein Paket“ der Weg, die nicht auflösbare Festlegung aufzuheben.
    fireEvent.click(main().getByRole('radio', { name: 'Kein Paket' }));
    fireEvent.click(main().getByRole('button', { name: 'Festlegung aufheben' }));
    expect(await main().findByText('Paket fehlt')).toBeVisible();
    expect((await readStore((store) => store.listVerbuende())).find((row) => row.verbundId === seeded.verbundId)).not.toHaveProperty('requirementPackage');
  });

  it('hebt eine Festlegung auf', async () => {
    await setPackage();
    renderWorkspaceArea(buildVerbundUrl(seeded.verbundId));
    await openPick('Ändern…');
    fireEvent.click(main().getByRole('radio', { name: 'Kein Paket' }));
    fireEvent.click(main().getByRole('button', { name: 'Festlegung aufheben' }));
    expect(await main().findByText('Paket fehlt')).toBeVisible();
    expect((await readStore((store) => store.listVerbuende())).find((row) => row.verbundId === seeded.verbundId)).not.toHaveProperty('requirementPackage');
  });

  it('legt bei veralteten Vergleichswerten nichts fest und meldet den Konflikt', async () => {
    renderWorkspaceArea(buildVerbundUrl(seeded.verbundId));
    await openPick('Festlegen…');
    await readStore((store) => store.renameVerbund(seeded.verbundId, 'Anderswo umbenannt'));
    fireEvent.click(main().getByRole('radio'));
    fireEvent.click(main().getByRole('button', { name: `„${SENTINEL_TITLE}“ festlegen` }));
    expect(await main().findByText(/^Paket oder Dokument inzwischen geändert\. Nichts festgelegt\./)).toHaveAttribute('role', 'alert');
    expect((await readStore((store) => store.listVerbuende())).find((row) => row.verbundId === seeded.verbundId)).not.toHaveProperty('requirementPackage');
  });
});

describe('Paketspalte', () => {
  it('zeigt Bezeichnung, „Paket fehlt“, „Überholt“ und „Nicht auflösbar“ im Arbeitsbereich', async () => {
    await setPackage();
    const { unmount } = renderWorkspaceArea(buildWorkspaceIndexUrl());
    const row = async (name: RegExp | string) => (await main().findByRole('link', { name })).closest('li')!;
    expect(within(await row(/SENTINEL/)).getByText(SENTINEL_TITLE)).toBeVisible();
    expect(within(await row('Zweiter Verbund')).getByText('Paket fehlt')).toBeVisible();
    unmount();

    await changeProfile();
    const second = renderWorkspaceArea(buildWorkspaceIndexUrl());
    expect(await within(await row(/SENTINEL/)).findByText('Überholt')).toBeVisible();
    second.unmount();

    await readStore((store) => store.deleteDocument(seeded.profile.localId));
    renderWorkspaceArea(buildWorkspaceIndexUrl());
    expect(await within(await row(/SENTINEL/)).findByText('Nicht auflösbar')).toBeVisible();
  });

  it('zeigt das Paket in der Anwendungsbereichsübersicht und unter „Bleibt erhalten“', async () => {
    await setPackage();
    const scope = await readStore((store) => store.createScope('Netzbetrieb'));
    const verbund = (await readStore((store) => store.listVerbuende())).find((row) => row.verbundId === seeded.verbundId)!;
    await readStore((store) => store.assignVerbuende(scope.scopeId, { scopeSavedAt: scope.savedAt, verbuende: [{ verbundId: verbund.verbundId, savedAt: verbund.savedAt }] }));
    renderWorkspaceArea(buildScopeUrl(scope.scopeId));
    const row = (await main().findByRole('link', { name: /SENTINEL/ })).closest('li')!;
    expect(await within(row).findByText(SENTINEL_TITLE)).toBeVisible();
    fireEvent.click(within(row).getByRole('button', { name: 'Zuordnung ändern…' }));
    const retained = await main().findByText(/^Verbundidentität ·/);
    expect(within(retained).getByText(SENTINEL_TITLE)).toBeVisible();
    expect(screen.queryByText('vollständig', { exact: false })).toBeNull();
  });
});
