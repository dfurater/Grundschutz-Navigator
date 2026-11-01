// Gemeinsamer Sicherungs- und Restoreablauf der Übersicht (GSPP-677).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { buildWorkspaceIndexUrl } from '@/app/routes';
import type { LocalId, VerbundId, WorkspaceRestorePreview, WorkspaceVerbund, WorkspaceVerbundRestorePreview } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider, type WorkspaceContextValue } from '@/state/WorkspaceContext';
import type { WorkspacePort } from '@/state/workspaceVerbundView';
import { VERBUND, fail, fakePort, ok } from '@/test/fakeWorkspacePort';
import { EMPTY_CATALOG_STATE, mainLandmark as main } from '@/test/renderWorkspaceArea';
import { renderAppShell } from '@/test/renderAppShell';

vi.mock('@/features/catalog/CatalogBrowser', () => ({ CatalogBrowser: () => <h1>Katalogansicht</h1> }));
const downloads = vi.hoisted(() => [] as string[]);
vi.mock('@/adapters/browserDownload', () => ({ downloadBlob: (_blob: Blob, filename: string) => { downloads.push(filename); } }));

const OTHER: WorkspaceVerbund = { ...VERBUND, verbundId: '8b2e1d3f-6c4a-4d7e-9f0a-1b2c3d4e5f60' as VerbundId, name: 'Anderer Verbund' };
const counts = (file: number, target: number) => ({ file, target });
const TODAY = new Date().toISOString().slice(0, 10);

function verbundPreview(existing = true): WorkspaceVerbundRestorePreview {
  return {
    kind: 'verbund', verbundId: VERBUND.verbundId, name: VERBUND.name, existingVerbund: existing ? VERBUND : null,
    backup: { format: 'gspp-workspace-verbund', storageSchemaVersion: 3, verbuende: [VERBUND], documents: [], drafts: [], bindings: [], reviewTrail: [], reviewBaseline: [] },
    target: { databaseId: 'db', storageSchemaVersion: 3, nativeDatabaseVersion: 30, verbundSavedAt: existing ? VERBUND.savedAt : null, documents: [] },
    counts: { verbuende: counts(1, 1), documents: counts(5, existing ? 4 : 0), drafts: counts(3, existing ? 2 : 0), bindings: counts(0, 0), reviewTrail: counts(0, 0), reviewBaseline: counts(0, 0) },
  } as WorkspaceVerbundRestorePreview;
}

const workspacePreview = {
  kind: 'workspace',
  backup: { format: 'gspp-workspace', storageSchemaVersion: 3, verbuende: [VERBUND], documents: [], drafts: [], bindings: [], reviewTrail: [], reviewBaseline: [], workspaceMeta: [{ id: 'workspace', databaseId: 'db', storageSchemaVersion: 3, createdAt: VERBUND.createdAt, savedAt: VERBUND.savedAt }] },
  target: { databaseId: 'db', storageSchemaVersion: 3, savedAt: VERBUND.savedAt },
  counts: { verbuende: counts(1, 2), documents: counts(0, 3), drafts: counts(0, 1), bindings: counts(0, 0), reviewTrail: counts(0, 0), reviewBaseline: counts(0, 0), workspaceMeta: counts(1, 1) },
} as unknown as WorkspaceRestorePreview;

let workspace: WorkspaceContextValue;
function Probe({ capture }: Readonly<{ capture: (value: WorkspaceContextValue) => void }>) { capture(useWorkspace()); return null; }

function renderWith(port: WorkspacePort) {
  return renderAppShell([buildWorkspaceIndexUrl()], {
    shell: () => (
      <CatalogContext.Provider value={EMPTY_CATALOG_STATE}>
        <WorkspaceProvider open={() => ok(port)}><Probe capture={(value) => { workspace = value; }} /><AppShell /></WorkspaceProvider>
      </CatalogContext.Provider>
    ),
  });
}

async function choose(name = 'sicherung.json') {
  const entry = await screen.findByRole('button', { name: 'Sicherung wiederherstellen…' });
  await waitFor(() => expect(entry).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Sicherungsdatei'), { target: { files: [new File(['{}'], name, { type: 'application/json' })] } });
  return within(main());
}

describe('Sicherung wiederherstellen', () => {
  it('stellt einen vorhandenen Verbund mit genau der gelesenen Vorschau wieder her und meldet das Ergebnis', async () => {
    downloads.length = 0;
    const preview = verbundPreview();
    const restoreVerbundBackup = vi.fn(() => ok(undefined));
    renderWith(fakePort({ listVerbuende: () => ok([VERBUND, OTHER]), previewRestore: () => ok(preview), restoreVerbundBackup }));
    const sheet = await choose();
    expect(await sheet.findByRole('heading', { level: 1, name: 'Sicherung wiederherstellen' })).toHaveFocus();
    expect(document.title).not.toContain(VERBUND.name);
    expect(await sheet.findByText('Verbundsicherung')).toBeInTheDocument();
    expect(sheet.getByText(`Verbund „${VERBUND.name}“`)).toBeInTheDocument();
    expect(sheet.getByText('1 · bleiben unverändert')).toBeInTheDocument();
    expect(sheet.getByText(`Ersetzt „${VERBUND.name}“ mit 4 Dokumenten und 2 gespeicherten Entwürfen.`)).toBeInTheDocument();

    fireEvent.click(sheet.getByRole('button', { name: `Vorher sichern: ${VERBUND.name}` }));
    expect(await sheet.findByText('Download gestartet')).toHaveAttribute('role', 'status');
    expect(downloads).toEqual([`informationsverbund-sicherung-${TODAY}.json`]);

    const confirm = sheet.getByRole('button', { name: `„${VERBUND.name}“ ersetzen` });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    const heading = await within(main()).findByRole('heading', { level: 1, name: 'Informationsverbünde' });
    expect(restoreVerbundBackup).toHaveBeenCalledExactlyOnceWith(preview);
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText('Wiederhergestellt').closest('[role="status"]')).toHaveTextContent(`„${VERBUND.name}“ · 5 Dokumente · 3 Entwürfe`);
    expect(screen.getByRole('link', { name: VERBUND.name }).closest('li')).toHaveAttribute('data-restored', 'true');
    expect(screen.getByRole('link', { name: OTHER.name }).closest('li')).not.toHaveAttribute('data-restored');
  });

  it('legt einen fehlenden Verbund mit Primary an und bietet keine Vorabsicherung', async () => {
    renderWith(fakePort({ previewRestore: () => ok(verbundPreview(false)) }));
    const sheet = await choose();
    expect(await sheet.findByText('Fehlt · wird neu angelegt')).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: `„${VERBUND.name}“ wiederherstellen` })).toBeEnabled();
    expect(sheet.queryByRole('button', { name: /^Vorher sichern/ })).not.toBeInTheDocument();
  });

  it('beschriftet den Gesamt-Restore mit dem Umfang und sichert vorher den gesamten Bestand', async () => {
    downloads.length = 0;
    renderWith(fakePort({ previewRestore: () => ok(workspacePreview) }));
    const sheet = await choose();
    expect(await sheet.findByText('Gesamter lokaler Bestand')).toBeInTheDocument();
    expect(sheet.getByText('Ersetzt alle 2 Informationsverbünde mit 3 Dokumenten und 1 gespeicherten Entwurf.')).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Gesamten Bestand ersetzen' })).toBeEnabled();
    fireEvent.click(sheet.getByRole('button', { name: 'Vorher sichern: gesamter Bestand' }));
    await waitFor(() => expect(downloads).toEqual([`informationsverbuende-sicherung-${TODAY}.json`]));
  });

  it.each([
    ['WORKSPACE_BACKUP_INVALID', 'Datei abgelehnt', 'Die Datei ist keine Sicherung, die diese Version wiederherstellen kann.'],
    ['WORKSPACE_BACKUP_WORKER_FAILURE', 'Prüfung abgebrochen', 'Die Datei wurde nicht geprüft.'],
    ['WORKSPACE_BACKUP_CONFLICT', 'Kollision', 'Dokumente der Datei gehören zu einem anderen Verbund in diesem Browser. Nichts wird überschrieben.'],
  ])('zeigt %s als feste Meldung ohne Restoreaktion', async (code, title, text) => {
    renderWith(fakePort({ previewRestore: () => fail(code) }));
    const sheet = await choose();
    const message = (await sheet.findByText(title)).closest('[role="alert"]');
    expect(message).toHaveTextContent(text);
    expect(sheet.queryByRole('button', { name: /ersetzen|wiederherstellen$/ })).not.toBeInTheDocument();
  });

  it('klärt nur Eingaben des Zielverbunds und liest die Vorschau danach neu', async () => {
    const previewRestore = vi.fn(() => ok(verbundPreview()));
    renderWith(fakePort({ listVerbuende: () => ok([VERBUND, OTHER]), previewRestore }));
    await screen.findByRole('link', { name: OTHER.name });
    workspace.renameDrafts.set(VERBUND.verbundId, 'Neuer Name');
    workspace.renameDrafts.set(OTHER.verbundId, 'Anderer Entwurf');
    const sheet = await choose();
    expect(await sheet.findByRole('heading', { name: /Offene Eingaben · 1/ })).toBeInTheDocument();
    expect(sheet.getByText(/„Lesbarer Verbund“ → „Neuer Name“/)).toBeInTheDocument();
    expect(sheet.getByText('Wartet auf 1 offene Eingabe')).toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: 'Verwerfen' }));
    expect(await sheet.findByRole('button', { name: `„${VERBUND.name}“ ersetzen` })).toBeInTheDocument();
    expect(previewRestore).toHaveBeenCalledTimes(2);
    expect(workspace.renameDrafts.has(VERBUND.verbundId)).toBe(false);
    expect(workspace.renameDrafts.get(OTHER.verbundId)).toBe('Anderer Entwurf');
  });

  it('hält eine nicht gespeicherte Umbenennung offen', async () => {
    renderWith(fakePort({ previewRestore: () => ok(verbundPreview()) }));
    await screen.findByRole('link', { name: VERBUND.name });
    workspace.renameDrafts.set(VERBUND.verbundId, 'Neuer Name');
    const sheet = await choose();
    fireEvent.click(await sheet.findByRole('button', { name: 'Speichern' }));
    expect((await sheet.findByText('Nicht gespeichert')).closest('[role="alert"]')).toHaveTextContent('Die Eingabe bleibt offen.');
    expect(workspace.renameDrafts.get(VERBUND.verbundId)).toBe('Neuer Name');
  });

  it('überschreibt bei einem geänderten Zielbereich nichts und bietet eine neue Vorschau an', async () => {
    const previewRestore = vi.fn(() => ok(verbundPreview()));
    renderWith(fakePort({ previewRestore, restoreVerbundBackup: () => fail('WORKSPACE_SAVE_CONFLICT') }));
    const sheet = await choose();
    fireEvent.click(await sheet.findByRole('button', { name: `„${VERBUND.name}“ ersetzen` }));
    expect((await sheet.findByText('Zielbereich inzwischen geändert')).closest('[role="alert"]')).toHaveTextContent('Nichts wurde überschrieben.');
    fireEvent.click(sheet.getByRole('button', { name: 'Neue Vorschau erstellen' }));
    expect(await sheet.findByRole('button', { name: `„${VERBUND.name}“ ersetzen` })).toBeInTheDocument();
    expect(previewRestore).toHaveBeenCalledTimes(2);
  });

  it('meldet einen vollen Speicher und lässt den Restore erneut versuchen', async () => {
    const restoreVerbundBackup = vi.fn(() => fail('WORKSPACE_QUOTA_EXCEEDED'));
    renderWith(fakePort({ previewRestore: () => ok(verbundPreview()), restoreVerbundBackup }));
    const sheet = await choose();
    fireEvent.click(await sheet.findByRole('button', { name: `„${VERBUND.name}“ ersetzen` }));
    expect((await sheet.findByText('Speicher voll')).closest('[role="alert"]')).toHaveTextContent('Der bisherige Bestand ist unverändert.');
    fireEvent.click(sheet.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(restoreVerbundBackup).toHaveBeenCalledTimes(2));
  });

  it('kehrt bei Abbrechen zum Einstieg zurück', async () => {
    renderWith(fakePort({ previewRestore: () => ok(verbundPreview()) }));
    const sheet = await choose();
    fireEvent.click(await sheet.findByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sicherung wiederherstellen…' })).toHaveFocus());
  });

  it('sperrt den Einstieg unter Schreibsperre; beide Exporte bleiben bedienbar', async () => {
    downloads.length = 0;
    renderWith(fakePort({ schemaStatus: () => ok('newer' as const) }));
    const row = (await screen.findByRole('link', { name: VERBUND.name })).closest('li')!;
    expect(screen.getByRole('button', { name: 'Sicherung wiederherstellen…' })).toBeDisabled();
    fireEvent.click(within(row).getByRole('button', { name: `${VERBUND.name} sichern` }));
    await waitFor(() => expect(downloads).toEqual([`informationsverbund-sicherung-${TODAY}.json`]));
  });
});

describe('Sitzungseingaben nach dem Restore', () => {
  it('verwirft beim Verbund-Restore nur Eingaben des Zielverbunds', async () => {
    const localId = '9c3f2e4a-7d5b-4e8f-a01b-2c3d4e5f6a7b' as LocalId;
    const preview = { ...verbundPreview(), target: { ...verbundPreview().target, documents: [{ localId, savedAt: VERBUND.savedAt, draftSavedAt: null, trailSequence: null, baselineSequence: null }] } };
    renderWith(fakePort({ listVerbuende: () => ok([VERBUND, OTHER]), restoreVerbundBackup: () => ok(undefined) }));
    await screen.findByRole('link', { name: OTHER.name });
    workspace.renameDrafts.set(VERBUND.verbundId, 'Ersetzt');
    workspace.renameDrafts.set(OTHER.verbundId, 'Bleibt');
    workspace.documents.importTargets(localId).set('/profile/imports/0/href', { href: '#x', target: { kind: 'class-1', artifactKey: 'gspp' } });
    expect(await workspace.restoreBackup(preview)).toMatchObject({ ok: true });
    expect([...workspace.renameDrafts.keys()]).toEqual([OTHER.verbundId]);
    expect(workspace.documents.importTargets(localId).size).toBe(0);
  });
});
