import Dexie from 'dexie';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import type { OscalRootKey, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { DocumentState, VerbundId, WorkspaceEnvelope, WorkspaceResult } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

/*
 * Speicher-Fixture für den Bereich Informationsverbünde (GSPP-577). Jeder
 * Klasse-2-Wert trägt einen Sentinel, damit Egress-Tests ihn in Route,
 * Verlauf und Dokumenttitel aufspüren. Komponententests laufen mit
 * `fake-indexeddb/auto`, Browser-Tests mit der IndexedDB von Chromium.
 */

export const SENTINEL = 'SENTINEL_KLASSE2';
export const SENTINEL_VERBUND = `Verbund ${SENTINEL}`;
export const SENTINEL_TITLE = `Titel ${SENTINEL}`;
export const SENTINEL_PARTY = `Partei ${SENTINEL}`;
export const SENTINEL_HREF = `https://example.invalid/${SENTINEL}`;
/** Root-UUID des SSP; sie darf wie jeder Dokumentwert nie in Route oder Titel stehen. */
export const SENTINEL_DOCUMENT_UUID = '5e471ee1-c1a5-4e02-8000-000000000577';

export function value<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}

function source(rootType: OscalRootKey, title: string, version: PinnedOscalVersion = '1.2.2') {
  const document = makeSchemaValidOscalDocument(rootType, version);
  const body = document[rootType] as Record<string, Record<string, unknown>>;
  body.metadata.title = title;
  return { document, body };
}

async function add(store: WorkspaceStore, verbundId: VerbundId, rootType: OscalRootKey, document: unknown, state: DocumentState = 'imported') {
  return value(await store.addDocument(verbundId, {
    source: document, context: { trustClass: 'class-2-local-user' }, rootType, oscalVersion: '1.2.2',
  }, state));
}

export interface SeededWorkspace {
  readonly verbundId: VerbundId;
  readonly otherVerbundId: VerbundId;
  readonly profile: WorkspaceEnvelope;
  readonly ssp: WorkspaceEnvelope;
  readonly assessmentPlan: WorkspaceEnvelope;
  readonly assessmentResults: WorkspaceEnvelope;
  readonly component: WorkspaceEnvelope;
  /** Dokument des zweiten Verbunds; unter dem ersten Verbund gibt es es nicht. */
  readonly foreign: WorkspaceEnvelope;
}

/**
 * Ein Verbund mit Profile (gültig, externer Import), SSP (Entwurf, gebundener
 * `import-profile`), Assessment Plan und Results (zwei Dokumente) und
 * Component Definition; ohne POA&M. Ein zweiter Verbund hält ein eigenes Profile.
 */
export async function seedWorkspace(): Promise<SeededWorkspace> {
  const store = value(await WorkspaceStore.open());
  try {
    const verbundId = value(await store.createVerbund(SENTINEL_VERBUND)).verbundId;
    const otherVerbundId = value(await store.createVerbund('Zweiter Verbund')).verbundId;

    const profileSource = source('profile', SENTINEL_TITLE);
    (profileSource.body.imports as unknown as Record<string, unknown>[])[0].href = SENTINEL_HREF;
    const profile = await add(store, verbundId, 'profile', profileSource.document);

    const sspSource = source('system-security-plan', `SSP ${SENTINEL}`);
    sspSource.body.uuid = SENTINEL_DOCUMENT_UUID as never;
    sspSource.body['import-profile'] = { href: 'profile.json' };
    sspSource.body.metadata.parties = [{ uuid: 'a5e471ee-0000-4000-8000-000000000001', type: 'organization', name: SENTINEL_PARTY }];
    const ssp = await add(store, verbundId, 'system-security-plan', sspSource.document, 'draft');
    value(await store.setBinding({
      fromLocalId: ssp.localId, pointer: '/system-security-plan/import-profile/href', href: 'profile.json',
      target: { kind: 'local', localId: profile.localId },
    }, ssp.savedAt));

    const assessmentPlan = await add(store, verbundId, 'assessment-plan', source('assessment-plan', 'Prüfplan').document);
    const assessmentResults = await add(store, verbundId, 'assessment-results', source('assessment-results', 'Prüfergebnisse').document, 'draft');
    const component = await add(store, verbundId, 'component-definition', source('component-definition', 'Bausteine').document);
    const foreign = await add(store, otherVerbundId, 'profile', source('profile', 'Fremdes Profil').document);
    return {
      verbundId, otherVerbundId, profile, assessmentPlan, assessmentResults, component, foreign,
      ssp: value(await store.getDocument(ssp.localId))!,
    };
  } finally {
    store.close();
  }
}

export async function readStore<T>(read: (store: WorkspaceStore) => Promise<WorkspaceResult<T>>): Promise<T> {
  const store = value(await WorkspaceStore.open());
  try { return value(await read(store)); } finally { store.close(); }
}

export async function resetWorkspace(): Promise<void> {
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
}

