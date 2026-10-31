import { restoreVerbundBackup } from '@/test/restoreWorkspaceBackup';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import type { VerbundId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import type { CatalogState } from '@/domain/models';
import { withSspCategories, SSP_CATEGORY_IDS } from '@/test/fixtures/sspCategories';
import { bindSspCategories, prepareSspTargets, setTargetCategories } from '@/domain/sspTargetObjects';
import { sspCategoryContext } from '@/domain/sspCategoryContext';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { assertNoAxeViolations } from '@/test/browser/axeAssertions';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { makeFullSsp, makeMinimalSsp, SSP_FIXTURE_IDS } from '@/test/fixtures/systemSecurityPlans';
import { readStore, resetWorkspace, seedWorkspace, value } from '@/test/workspaceAreaFixture';
import '@/index.css';

/*
 * SSP-Bearbeitung in Chromium (GSPP-609): Neuanlage und Formulare auf den drei
 * Layoutstufen mit Axe und Touchzielen, Tastaturbedienung, Speichern und
 * Export im echten Modul-Worker sowie die Fehlerfälle des Speichers mit
 * nativer IndexedDB: Konflikt eines zweiten Tabs, doppeltes Speichern, volles
 * Quota, Wiederherstellung eines Entwurfs aus einem Backup, bestätigte
 * Löschung und Autosave beim Wechsel in den Katalog.
 */

const LAYOUTS = [
  { name: 'Desktop', width: 1440, height: 900, touch: false },
  { name: 'Tablet', width: 1032, height: 1376, touch: true },
  { name: 'Mobil', width: 390, height: 844, touch: true },
] as const;

const SENTINEL = 'SSP_BEARBEITUNG_SENTINEL';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;

function unmount() {
  root?.unmount();
  router?.dispose();
  host?.remove();
  root = undefined;
  router = undefined;
  host = undefined;
}

afterEach(async () => {
  unmount();
  vi.restoreAllMocks();
  await commands.setBrowserCoarsePointer(false);
  await resetWorkspace();
});

async function renderAt(path: string, width = 1440, height = 900, touch = false, catalog: CatalogState = createA11yCatalogState()) {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, height);
  const current = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [path] });
  router = current;
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root!.render(createElement(CatalogContext.Provider, { value: catalog },
      createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: current }))));
  });
  await expect.poll(() => current.state.initialized).toBe(true);
  await document.fonts.ready;
  return { shell: host, router: current };
}

async function addSsp(verbundId: VerbundId, source: Record<string, unknown>): Promise<WorkspaceEnvelope> {
  return readStore((store) => store.addDocument(verbundId, {
    source: JSON.parse(JSON.stringify(source)), context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2',
  }));
}

function button(shell: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...shell.querySelectorAll<HTMLButtonElement>('main button')].find((entry) => entry.textContent?.trim() === name && entry.checkVisibility());
}

/** Eingabefeld über den vollständigen OSCAL-Schlüssel seiner Beschriftung. */
function input(shell: HTMLElement, key: string): HTMLInputElement | HTMLTextAreaElement {
  const label = [...shell.querySelectorAll('main label')].find((entry) => entry.querySelector('span.font-mono')?.textContent === key)!;
  return shell.querySelector<HTMLInputElement>(`#${CSS.escape(label.getAttribute('for')!)}`)!;
}

async function editorReady(shell: HTMLElement) {
  await expect.poll(() => button(shell, 'Speichern'), { timeout: 15_000 }).toBeTruthy();
}

async function sspSource(localId: WorkspaceEnvelope['localId']) {
  return (await readStore((store) => store.getDocument(localId)))!;
}

function title(envelope: WorkspaceEnvelope | undefined): string {
  return (envelope?.source as { 'system-security-plan': { metadata: { title: string } } })['system-security-plan'].metadata.title;
}

describe.each(LAYOUTS)('$name ($width px)', ({ name, width, height, touch }) => {
  test('Zielobjekte: Kategorien, Bewertung, Tastatur und Export bleiben lokal und zugänglich', async () => {
    const seeded = await seedWorkspace();
    const catalog = withSspCategories(createA11yCatalogState());
    const context = sspCategoryContext(catalog)!;
    const selected = setTargetCategories(bindSspCategories(makeFullSsp(), context), ['system-implementation', 'components', 0], [SSP_CATEGORY_IDS[1]], context);
    const prepared = prepareSspTargets(selected, context);
    if (!prepared.ok) throw new Error(prepared.code);
    const stored = await addSsp(seeded.verbundId, prepared.source as Record<string, unknown>);
    const downloads = vi.spyOn(URL, 'createObjectURL');
    const { shell, router: current } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, stored.localId), width, height, touch, catalog);
    await editorReady(shell);
    const component = shell.querySelector<HTMLElement>('li[aria-label^="Komponente 1"]')!;
    const field = <T extends HTMLElement>(text: string) => {
      const label = [...component.querySelectorAll('label')].find(label => label.textContent === text)!;
      return document.getElementById(label.htmlFor) as T;
    };
    await userEvent.selectOptions(field<HTMLSelectElement>('Schutzbedarf'), 'hoch');
    await userEvent.fill(field<HTMLTextAreaElement>('Begründung des Schutzbedarfs'), SENTINEL);
    const apply = [...component.querySelectorAll('button')].find(button => button.textContent === 'Bewertung übernehmen')!;
    apply.focus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => shell.textContent).toContain('Schutzbedarf: 1 von 4 Objekten bewertet');
    expect(component.textContent).toContain('Synthetische Elternkategorie · abgeleitet');
    await assertNoAxeViolations(shell, `Zielobjekte (${name})`, 'all');
    button(shell, 'Speichern')!.click();
    await expect.poll(async () => (await sspSource(stored.localId)).documentState, { timeout: 15_000 }).toBe('export-ready');
    button(shell, 'Export')!.click();
    await expect.poll(() => downloads.mock.calls.length, { timeout: 15_000 }).toBe(1);
    const exported = JSON.parse(await (downloads.mock.calls[0][0] as Blob).text());
    expect(exported).toEqual((await sspSource(stored.localId)).source);
    expect(JSON.stringify(current.state.location)).not.toContain(SENTINEL);
    expect(document.title).not.toContain(SENTINEL);
    expect(await commands.assertNoBrowserEgress()).toBeUndefined();
  }, 60_000);
  test('Axe meldet auf Neuanlage und Bearbeitungsansicht keinen Befund; Touchziele messen 44 px', async () => {
    const seeded = await seedWorkspace();
    const full = await addSsp(seeded.verbundId, makeFullSsp());

    const station = await renderAt(buildStationUrl(seeded.verbundId, 'ssp'), width, height, touch);
    await expect.poll(() => button(station.shell, 'Neues SSP')).toBeTruthy();
    button(station.shell, 'Neues SSP')!.click();
    await expect.poll(() => station.shell.querySelector('form h3')?.textContent).toBe('Neues SSP');
    await assertNoAxeViolations(station.shell, `Neuanlage (${name})`, 'all');
    unmount();

    const { shell } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, full.localId), width, height, touch);
    await editorReady(shell);
    await assertNoAxeViolations(shell, `Bearbeitungsansicht (${name})`, 'all');
    if (touch) {
      const targets = [...shell.querySelectorAll<HTMLElement>('main button, main select, main input:not([type="radio"]), main textarea')]
        .filter((element) => element.checkVisibility());
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        const box = target.getBoundingClientRect();
        const label = `${name}: ${target.textContent || target.getAttribute('aria-label') || target.id}`;
        expect(box.height, label).toBeGreaterThanOrEqual(44);
        expect(box.width, label).toBeGreaterThanOrEqual(44);
      }
      expect(shell.scrollWidth).toBeLessThanOrEqual(width);
    }
  });
});

test('Neuanlage per Tastatur, Speichern und Export im echten Worker bleiben lokal', async () => {
  const seeded = await seedWorkspace();
  // Die BSI-Kataloge des Testzustands sind ungeprüft und damit keine Baseline; gewählt wird ein lokaler Catalog.
  await readStore((store) => store.addDocument(seeded.verbundId, {
    source: makeSchemaValidOscalDocument('catalog', '1.2.2'), context: { trustClass: 'class-2-local-user' }, rootType: 'catalog', oscalVersion: '1.2.2',
  }));
  const created = vi.spyOn(URL, 'createObjectURL');
  const { shell, router: current } = await renderAt(buildStationUrl(seeded.verbundId, 'ssp'));
  await expect.poll(() => button(shell, 'Neues SSP')).toBeTruthy();
  button(shell, 'Neues SSP')!.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => shell.querySelector('form input')).toBeTruthy();
  shell.querySelector<HTMLInputElement>('form input')!.focus();
  await userEvent.keyboard(SENTINEL);
  // Die Gruppe „Eigene Daten“ trägt den lokalen Catalog; die Wahl erfolgt dort per Leertaste.
  const local = shell.querySelector<HTMLInputElement>('[role="radiogroup"][aria-label="Eigene Daten"] input[type="radio"]')!;
  local.focus();
  await userEvent.keyboard(' ');
  await expect.poll(() => local.checked).toBe(true);
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => current.state.location.pathname, { timeout: 15_000 }).toMatch(/\/dokument\//);
  await editorReady(shell);
  const localId = current.state.location.pathname.split('/').at(-1) as WorkspaceEnvelope['localId'];
  expect(title(await sspSource(localId))).toBe(SENTINEL);

  const fill = async (key: string, text: string) => {
    await expect.poll(() => input(shell, key)).toBeTruthy();
    await userEvent.fill(input(shell, key), text);
  };
  button(shell, 'Systemkennung hinzufügen')!.click();
  await fill('system-characteristics.system-ids.id', 'SYS-1');
  await fill('system-characteristics.system-name', SENTINEL);
  await fill('system-characteristics.description', 'Beschreibung.');
  await userEvent.selectOptions(input(shell, 'system-characteristics.status.state') as unknown as HTMLSelectElement, 'operational');
  await fill('system-characteristics.authorization-boundary.description', 'Grenze.');
  button(shell, 'Informationsart hinzufügen')!.click();
  await fill('system-characteristics.system-information.information-types.title', 'Daten');
  await fill('system-characteristics.system-information.information-types.description', 'Daten.');
  button(shell, 'Komponente hinzufügen')!.click();
  await fill('system-implementation.components.title', 'Server');
  await fill('system-implementation.components.type', 'this-system');
  await fill('system-implementation.components.description', 'Server.');
  await userEvent.selectOptions(input(shell, 'system-implementation.components.status.state') as unknown as HTMLSelectElement, 'operational');
  await fill('control-implementation.description', 'Umsetzung.');
  // Der Testkatalogzustand liefert keine Anforderungsliste: Die control-id ist dann als Text einzugeben.
  const requirement = input(shell, 'control-id') as HTMLInputElement | HTMLSelectElement;
  if (requirement instanceof HTMLSelectElement) await userEvent.selectOptions(requirement, requirement.options[1].value);
  else await userEvent.fill(requirement, 'GC.1.1');
  button(shell, 'Anforderung hinzufügen')!.click();
  await expect.poll(() => shell.textContent).toContain('Keine offene Pflichtstruktur.');

  button(shell, 'Speichern')!.click();
  await expect.poll(async () => (await sspSource(localId)).documentState, { timeout: 15_000 }).toBe('export-ready');
  button(shell, 'Export')!.click();
  await expect.poll(() => created.mock.calls.length, { timeout: 15_000 }).toBe(1);
  const exported = JSON.parse(await (created.mock.calls[0][0] as Blob).text());
  expect(exported).toEqual((await sspSource(localId)).source);
  expect(JSON.stringify(current.state.location)).not.toContain(SENTINEL);
  expect(document.title).not.toContain(SENTINEL);
  expect(await commands.assertNoBrowserEgress()).toBeUndefined();
}, 60_000);

test('ein Speicherstand aus einem zweiten Tab blockiert das Speichern als Konflikt; doppeltes Speichern schreibt einmal', async () => {
  const seeded = await seedWorkspace();
  const ssp = await addSsp(seeded.verbundId, makeMinimalSsp('1.2.2'));
  const { shell } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId));
  await editorReady(shell);
  await userEvent.fill(input(shell, 'metadata.title'), 'Erster Stand');
  const store = value(await WorkspaceStore.open());
  try {
    const save = vi.spyOn(WorkspaceStore.prototype, 'saveDocument');
    button(shell, 'Speichern')!.click();
    button(shell, 'Speichern')!.click();
    await expect.poll(async () => title(await sspSource(ssp.localId)), { timeout: 15_000 }).toBe('Erster Stand');
    expect(save).toHaveBeenCalledOnce();
    const saved = await sspSource(ssp.localId);
    // Zweiter Tab: schreibt einen eigenen Stand über eine andere Verbindung.
    value(await store.saveDocument(ssp.localId, saved.savedAt, null, {
      source: saved.source, context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2',
    }));
  } finally {
    store.close();
  }
  await userEvent.fill(input(shell, 'metadata.title'), 'Zweiter Stand');
  button(shell, 'Speichern')!.click();
  await expect.poll(() => shell.textContent, { timeout: 15_000 }).toContain('In einem anderen Tab geändert');
  expect(title(await sspSource(ssp.localId))).toBe('Erster Stand');
});

test('beim Wiederöffnen gilt die neuere Baseline-Bindung eines zweiten Tabs statt der älteren ungespeicherten Wahl', async () => {
  const seeded = await seedWorkspace();
  await readStore((store) => store.addDocument(seeded.verbundId, {
    source: makeSchemaValidOscalDocument('catalog', '1.2.2'), context: { trustClass: 'class-2-local-user' }, rootType: 'catalog', oscalVersion: '1.2.2',
  }));
  const { ssp, profile } = seeded;
  const { shell, router: current } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId));
  await editorReady(shell);
  // Der relative href ist an das Profil gebunden; die ungespeicherte Wahl fällt auf den lokalen Catalog.
  const radios = () => [...shell.querySelectorAll<HTMLInputElement>('[role="radiogroup"][aria-label="Eigene Daten"] input[type="radio"]')];
  await expect.poll(() => radios().some((radio) => !radio.checked)).toBe(true);
  await userEvent.click(radios().find((radio) => !radio.checked)!);
  await expect.poll(async () => (await readStore((store) => store.getDraft(ssp.localId)))?.savedAt, { timeout: 15_000 }).toBeTruthy();
  await current.navigate(buildStationUrl(seeded.verbundId, 'ssp'));
  const newer = { fromLocalId: ssp.localId, pointer: '/system-security-plan/import-profile/href', href: 'profile.json', target: { kind: 'local' as const, localId: profile.localId } };
  const store = value(await WorkspaceStore.open());
  try {
    // Zweiter Tab: speichert über eine andere Verbindung die Bindung an das Profil neu.
    const draft = value(await store.getDraft(ssp.localId))!;
    value(await store.saveDocument(ssp.localId, ssp.savedAt, draft.savedAt, {
      source: ssp.source, context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2',
    }, [newer]));
  } finally {
    store.close();
  }
  await current.navigate(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId));
  await editorReady(shell);
  const reopened = await sspSource(ssp.localId);
  button(shell, 'Speichern')!.click();
  await expect.poll(async () => (await sspSource(ssp.localId)).savedAt, { timeout: 15_000 }).not.toBe(reopened.savedAt);
  expect((await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === ssp.localId)).toEqual([newer]);
});

test('volles Quota beim Speichern meldet „Speicher voll“ und schreibt nichts', async () => {
  const seeded = await seedWorkspace();
  const ssp = await addSsp(seeded.verbundId, makeMinimalSsp('1.2.2'));
  const { shell } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId));
  await editorReady(shell);
  await userEvent.fill(input(shell, 'metadata.title'), 'Zu viel');
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'documents') throw new DOMException(SENTINEL, 'QuotaExceededError');
    return original.apply(this, args);
  });
  button(shell, 'Speichern')!.click();
  await expect.poll(() => shell.textContent, { timeout: 15_000 }).toContain('Speicher voll');
  expect(shell.textContent).not.toContain(SENTINEL);
  vi.mocked(IDBObjectStore.prototype.put).mockRestore();
  expect(title(await sspSource(ssp.localId))).toBe(title(ssp));
});

test('ein aus dem Backup wiederhergestellter Entwurf öffnet mit unveränderter Root-UUID', async () => {
  const seeded = await seedWorkspace();
  const ssp = await addSsp(seeded.verbundId, makeFullSsp());
  const draft = structuredClone(ssp.source) as { 'system-security-plan': { metadata: { title: string } } };
  draft['system-security-plan'].metadata.title = 'Entwurfsstand';
  await readStore((store) => store.autosaveDraft(ssp.localId, ssp.savedAt, null, draft));
  const backup = await readStore((store) => store.exportVerbundBackup(seeded.verbundId));
  await readStore((store) => store.deleteDocument(ssp.localId));
  await readStore((store) => restoreVerbundBackup(store, new TextEncoder().encode(backup)));

  const { shell } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId));
  await editorReady(shell);
  expect((input(shell, 'metadata.title') as HTMLInputElement).value).toBe('Entwurfsstand');
  const restored = await sspSource(ssp.localId);
  expect((restored.source as { 'system-security-plan': { uuid: string } })['system-security-plan'].uuid).toBe(SSP_FIXTURE_IDS.ssp);
});

test('Löschen verlangt die Bestätigung und entfernt Dokument und Bindungen', async () => {
  const seeded = await seedWorkspace();
  const { shell, router: current } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId));
  await editorReady(shell);
  button(shell, 'SSP löschen…')!.click();
  await expect.poll(() => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((entry) => entry.textContent === 'Endgültig löschen')).toBeTruthy();
  [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((entry) => entry.textContent === 'Endgültig löschen')!.click();
  await expect.poll(() => current.state.location.pathname).toBe(buildStationUrl(seeded.verbundId, 'ssp'));
  expect(await readStore((store) => store.getDocument(seeded.ssp.localId))).toBeUndefined();
  expect((await readStore((store) => store.listBindings())).some((binding) => binding.fromLocalId === seeded.ssp.localId)).toBe(false);
});

test('der Wechsel in den Katalog speichert einen offenen SSP-Entwurf über registerAutosave()', async () => {
  const seeded = await seedWorkspace();
  const ssp = await addSsp(seeded.verbundId, makeMinimalSsp('1.2.2'));
  const { shell, router: current } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId));
  await editorReady(shell);
  await userEvent.fill(input(shell, 'metadata.title'), 'Ungesicherter Titel');
  // Sofort wechseln: Die Verzögerung des Autosaves ist noch nicht abgelaufen.
  const catalogLink = [...shell.querySelectorAll('header nav[aria-label="Bereiche"] a')].find((link) => link.textContent === 'Katalog') as HTMLElement;
  await userEvent.click(catalogLink);
  await expect.poll(() => current.state.location.pathname).toBe('/katalog/gspp');
  const draft = await readStore((store) => store.getDraft(ssp.localId));
  expect(title(draft as never)).toBe('Ungesicherter Titel');
  expect(title(await sspSource(ssp.localId))).toBe(title(ssp));
});
