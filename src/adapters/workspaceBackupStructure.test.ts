import { describe, expect, it } from 'vitest';
import type { LocalId, VerbundId, WorkspaceBackup } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import {
  createWorkspaceStructureValidator,
  normalizeVerbundBackup,
  normalizeWorkspaceBackup,
  validWorkspaceBackupStructure,
} from './workspaceBackupStructure';

const verbundId = '11111111-1111-4111-8111-111111111111' as VerbundId;
const localId = '22222222-2222-4222-8222-222222222222' as LocalId;
const actionUuid = '33333333-3333-4333-8333-333333333333';
const partyUuid = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-10-16T12:00:00.000Z';
const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
const stand = {
  rootType: 'catalog' as const,
  uuid: '55555555-5555-4555-8555-555555555555',
  lastModified: timestamp,
  version: '1.0',
  oscalVersion: '1.1.3',
  contentHash: { version: 1, algorithm: 'sha-256', value: 'a'.repeat(64) },
};

/** v2-Bündel mit Prüfpunkt, Entscheidungen und Vergleichsbasis. */
function bundle(): WorkspaceBackup {
  return {
    format: 'gspp-workspace',
    storageSchemaVersion: 2,
    verbuende: [{ verbundId, name: 'Test', createdAt: timestamp, savedAt: timestamp }],
    documents: [{
      localId, verbundId, storageSchemaVersion: 2, rootType: 'catalog', oscalVersion: '1.1.3',
      trustClass: 'class-2-local-user', documentState: 'export-ready', createdAt: timestamp, savedAt: timestamp, source,
    }],
    drafts: [],
    bindings: [],
    reviewTrail: [
      {
        localId, sequence: 1, kind: 'checkpoint', createdAt: timestamp, documentState: 'export-ready', stand,
        diff: { version: 1, baseSequence: null, entries: [{ path: '/catalog/metadata/title', kind: 'changed', valueKind: 'string', marker: false }], truncated: false },
      },
      { localId, sequence: 2, kind: 'decision', createdAt: timestamp, decision: 'reviewed', stand, roleId: 'reviewer', partyUuids: [partyUuid], reason: 'geprüft' },
      { localId, sequence: 3, kind: 'decision', createdAt: timestamp, decision: 'approved', stand, actionUuid, roleId: 'reviewer', partyUuids: [partyUuid] },
      { localId, sequence: 4, kind: 'decision', createdAt: timestamp, decision: 'withdrawn', stand, withdraws: { sequence: 3, actionUuid } },
    ],
    reviewBaseline: [{ localId, sequence: 1, stand, source }],
    workspaceMeta: [{ id: 'workspace', storageSchemaVersion: 2, createdAt: timestamp, savedAt: timestamp }],
  };
}

type Mutation = (backup: WorkspaceBackup) => unknown;
const rejected: readonly (readonly [string, Mutation])[] = [
  ['checkpoint-stand-falscher-root', (b) => ({ ...b, reviewTrail: [{ ...(b.reviewTrail[0] as object), stand: { ...stand, rootType: 'profile' } }] })],
  ['checkpoint-diff-unbekannte-basis', (b) => ({ ...b, reviewTrail: [{ ...(b.reviewTrail[0] as object), diff: { version: 1, baseSequence: 1, entries: [], truncated: false } }] })],
  ['checkpoint-diff-falsche-basis-art', (b) => ({ ...b, reviewTrail: [{ ...(b.reviewTrail[0] as object), diff: { version: 1, baseSequence: null, entries: [], truncated: false, extra: true } }] })],
  ['checkpoint-diff-falscher-pfad', (b) => ({ ...b, reviewTrail: [{ ...(b.reviewTrail[0] as object), diff: { version: 1, baseSequence: null, entries: [{ path: 'catalog', kind: 'added', valueKind: 'object', marker: false }], truncated: false } }] })],
  ['sequenz-nicht-aufsteigend', (b) => ({ ...b, reviewTrail: [b.reviewTrail[0], { ...b.reviewTrail[1], sequence: 1 }] })],
  ['freigabe-ohne-aktions-uuid', (b) => ({ ...b, reviewTrail: [b.reviewTrail[0], { ...b.reviewTrail[2], actionUuid: undefined }] })],
  ['ruecknahme-ohne-ziel', (b) => ({ ...b, reviewTrail: [b.reviewTrail[0], { ...b.reviewTrail[3], withdraws: { sequence: 2, actionUuid } }] })],
  ['rolle-ohne-inhalt', (b) => ({ ...b, reviewTrail: [b.reviewTrail[0], { ...b.reviewTrail[1], roleId: '' }] })],
  ['partei-doppelt', (b) => ({ ...b, reviewTrail: [b.reviewTrail[0], { ...b.reviewTrail[1], partyUuids: [partyUuid, partyUuid] }] })],
  ['begruendung-zu-lang', (b) => ({ ...b, reviewTrail: [b.reviewTrail[0], { ...b.reviewTrail[1], reason: 'x'.repeat(1001) }] })],
  ['baseline-ohne-pruefpunkt', (b) => ({ ...b, reviewBaseline: [{ ...b.reviewBaseline[0], sequence: 2 }] })],
  ['baseline-stand-abweichend', (b) => ({ ...b, reviewBaseline: [{ ...b.reviewBaseline[0], stand: { ...stand, version: '2.0' } }] })],
  ['baseline-quelle-passt-nicht', (b) => ({ ...b, reviewBaseline: [{ ...b.reviewBaseline[0], source: makeSchemaValidOscalDocument('catalog', '1.2.2') }] })],
  ['baseline-doppelt', (b) => ({ ...b, reviewBaseline: [b.reviewBaseline[0], b.reviewBaseline[0]] })],
  ['trail-fehlt', (b) => ({ ...b, reviewTrail: undefined })],
  ['baseline-fehlt', (b) => ({ ...b, reviewBaseline: undefined })],
];

describe('workspace backup structure v2', () => {
  it('akzeptiert Trail, Entscheidungen und Vergleichsbasis in Dokumentreihenfolge', () => {
    expect(validWorkspaceBackupStructure(bundle())).toBe(true);
  });

  it.each(rejected)('weist %s ab', (_name, mutate) => {
    expect(validWorkspaceBackupStructure(mutate(bundle()))).toBe(false);
  });

  it('validiert inkrementell in Abhängigkeitsreihenfolge', () => {
    const validator = createWorkspaceStructureValidator(2);
    const backup = bundle();
    for (const row of backup.verbuende) expect(validator.verbuende(row)).toBe(true);
    for (const row of backup.documents) expect(validator.documents(row)).toBe(true);
    for (const row of backup.drafts) expect(validator.drafts(row)).toBe(true);
    for (const row of backup.bindings) expect(validator.bindings(row)).toBe(true);
    for (const row of backup.reviewTrail) expect(validator.reviewTrail(row)).toBe(true);
    for (const row of backup.reviewBaseline) expect(validator.reviewBaseline(row)).toBe(true);
    for (const row of backup.workspaceMeta) expect(validator.workspaceMeta(row)).toBe(true);
    expect(validator.hasWorkspaceMeta).toBe(true);
    expect(validator.workspaceMeta(backup.workspaceMeta[0])).toBe(false);
  });

  it('akzeptiert ein v1-Verbundbündel ohne Historie und normalisiert es auf v2', () => {
    const present = bundle();
    const legacy = {
      format: 'gspp-workspace-verbund', storageSchemaVersion: 1, verbuende: present.verbuende,
      documents: [{ ...present.documents[0], storageSchemaVersion: 1 }], drafts: present.drafts, bindings: present.bindings,
    };
    const normalized = normalizeVerbundBackup(legacy);
    expect(normalized).toMatchObject({
      format: 'gspp-workspace-verbund', storageSchemaVersion: 2, reviewTrail: [], reviewBaseline: [],
      documents: [{ storageSchemaVersion: 2 }],
    });
    expect(normalizeWorkspaceBackup(legacy)).toBeNull();
  });
});
