import { describe, expect, it } from 'vitest';
import { buildScopeBoundary, scopeBoundaryInput } from '@/domain/scopeBoundary';
import type { LocalId, ScopeId, VerbundId, WorkspaceBackup, WorkspaceScope } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import {
  adoptAnyBackup,
  createWorkspaceStructureValidator,
  validVerbundBackupStructure,
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

/** Bündel der aktuellen Version mit Prüfpunkt, Entscheidungen und Vergleichsbasis. */
function bundle(): WorkspaceBackup {
  return {
    format: 'gspp-workspace', methodikScopes: [],
    storageSchemaVersion: 6,
    verbuende: [{ verbundId, name: 'Test', createdAt: timestamp, savedAt: timestamp }],
    documents: [{
      localId, verbundId, storageSchemaVersion: 6, rootType: 'catalog', oscalVersion: '1.1.3',
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
    workspaceMeta: [{ id: 'workspace', databaseId: '66666666-6666-4666-8666-666666666666', storageSchemaVersion: 6, createdAt: timestamp, savedAt: timestamp }],
  };
}

type Mutation = (backup: WorkspaceBackup) => unknown;
const rejected: readonly (readonly [string, Mutation])[] = [
  ['baseline-stand-fremder-root', (b) => ({
    ...b,
    reviewTrail: [{ ...(b.reviewTrail[0] as object), stand: { ...stand, rootType: 'profile' } }],
    reviewBaseline: [{ ...b.reviewBaseline[0], stand: { ...stand, rootType: 'profile' } }],
  })],
  ['hash-version-unbekannt', (b) => ({ ...b, reviewTrail: [b.reviewTrail[0], { ...b.reviewTrail[1], stand: { ...stand, contentHash: { ...stand.contentHash, version: 999 } } }], reviewBaseline: [] })],
  ['hash-algorithmus-unbekannt', (b) => ({ ...b, reviewTrail: [b.reviewTrail[0], { ...b.reviewTrail[1], stand: { ...stand, contentHash: { ...stand.contentHash, algorithm: 'sha-1' } } }], reviewBaseline: [] })],
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

describe('workspace backup structure v6', () => {
  it('akzeptiert Trail, Entscheidungen und Vergleichsbasis in Dokumentreihenfolge', () => {
    expect(validWorkspaceBackupStructure(bundle())).toBe(true);
  });

  it('wählt den Validator nach format und lehnt jede andere Art ab', () => {
    const whole = bundle();
    const single: Record<string, unknown> = { ...whole, format: 'gspp-workspace-verbund' };
    delete single.workspaceMeta;
    delete single.methodikScopes;
    expect(adoptAnyBackup(whole)).toBe(whole);
    expect(adoptAnyBackup(single)).toBe(single);
    // Eine Verbundsicherung mit Metadaten ist weder die eine noch die andere Art.
    expect(adoptAnyBackup({ ...whole, format: 'gspp-workspace-verbund' })).toBeNull();
    for (const value of [{ ...whole, format: 'gspp-other' }, { ...whole, storageSchemaVersion: 7 }, null, []]) expect(adoptAnyBackup(value)).toBeNull();
  });

  it.each(rejected)('weist %s ab', (_name, mutate) => {
    expect(validWorkspaceBackupStructure(mutate(bundle()))).toBe(false);
  });

  it('akzeptiert historische Stände mit eigenem Root-Typ nach einem Root-Wechsel', () => {
    const backup = bundle();
    const historic = { ...stand, rootType: 'profile' as const };
    const trail = [
      { ...backup.reviewTrail[0], stand: historic, diff: { version: 1, baseSequence: null, entries: [], truncated: false } },
      { ...backup.reviewTrail[1], sequence: 2, stand: historic },
      { ...backup.reviewTrail[0], sequence: 3 },
    ];
    expect(validWorkspaceBackupStructure({ ...backup, reviewTrail: trail, reviewBaseline: [{ ...backup.reviewBaseline[0], sequence: 3 }] })).toBe(true);
  });

  it('validiert inkrementell in Abhängigkeitsreihenfolge', () => {
    const validator = createWorkspaceStructureValidator(6);
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

  it.each([1, 2])('weist Sicherungsdateien der Speicherversion %i ab', version => {
    const backup = bundle();
    const old = { ...backup, storageSchemaVersion: version };
    expect(validWorkspaceBackupStructure(old)).toBe(false);
    const { workspaceMeta, ...verbund } = old;
    expect(workspaceMeta).toHaveLength(1);
    expect(validVerbundBackupStructure({ ...verbund, format: 'gspp-workspace-verbund' })).toBe(false);
  });
});

describe('requirementPackage im Verbund (v5)', () => {
  const packageId = '77777777-7777-4777-8777-777777777777';
  const otherVerbund = '88888888-8888-4888-8888-888888888888';
  const profileStand = { ...stand, rootType: 'profile' as const };
  const withPackage = (requirementPackage: unknown, extra: (backup: WorkspaceBackup) => WorkspaceBackup = (backup) => backup) => {
    const backup = bundle();
    return extra({ ...backup, verbuende: [{ ...backup.verbuende[0], requirementPackage } as never] });
  };
  const valid = { packageId, baseline: { localId, stand: profileStand }, sourcePins: [{ kind: 'local', localId, stand: profileStand }] };

  it('akzeptiert ein Paket mit lokalem und vollständigem BSI-Pin sowie ein nicht auflösbares Paket', () => {
    expect(validWorkspaceBackupStructure(withPackage(valid))).toBe(true);
    const classOne = { kind: 'class-1', artifactKey: 'catalog-gspp', snapshotCommit: 'c'.repeat(40), contentSha256: 'b'.repeat(64) };
    expect(validWorkspaceBackupStructure(withPackage({ ...valid, sourcePins: [...valid.sourcePins, classOne] }))).toBe(true);
    const gone = '99999999-9999-4999-8999-999999999999';
    expect(validWorkspaceBackupStructure(withPackage({ ...valid, baseline: { localId: gone, stand: profileStand }, sourcePins: [{ kind: 'local', localId: gone, stand: profileStand }] }))).toBe(true);
  });

  it.each([
    ['einen SSP-Stand als Baseline', { ...valid, baseline: { localId, stand: { ...stand, rootType: 'system-security-plan' } } }],
    ['einen abweichenden lokalen Pin', { ...valid, sourcePins: [{ kind: 'local', localId, stand: { ...profileStand, version: '2' } }] }],
    ['einen unvollständigen BSI-Pin', { ...valid, sourcePins: [...valid.sourcePins, { kind: 'class-1', artifactKey: 'catalog-gspp', snapshotCommit: '', contentSha256: 'b'.repeat(64) }] }],
    ['eine ungültige packageId', { ...valid, packageId: 'P1' }],
    ['ein zusätzliches Feld', { ...valid, title: 'TITLE' }],
  ])('weist %s ab', (_name, requirementPackage) => {
    expect(validWorkspaceBackupStructure(withPackage(requirementPackage))).toBe(false);
  });

  it('weist eine Baseline aus einem anderen Verbund und eine doppelte packageId ab', () => {
    const foreign = withPackage(valid, (backup) => ({
      ...backup,
      verbuende: [...backup.verbuende, { verbundId: otherVerbund as VerbundId, name: 'VB', createdAt: timestamp, savedAt: timestamp }],
      documents: backup.documents.map((row) => ({ ...row, verbundId: otherVerbund as VerbundId })),
      drafts: [], bindings: [], reviewTrail: [], reviewBaseline: [],
    }));
    expect(validWorkspaceBackupStructure(foreign)).toBe(false);
    const twin = withPackage(valid, (backup) => ({
      ...backup,
      verbuende: [...backup.verbuende, { ...backup.verbuende[0], verbundId: otherVerbund as VerbundId, requirementPackage: { ...valid, baseline: { localId: otherVerbund, stand: profileStand }, sourcePins: [{ kind: 'local', localId: otherVerbund, stand: profileStand }] } as never }],
    }));
    expect(validWorkspaceBackupStructure(twin)).toBe(false);
  });

  it('kennt das Feld erst ab Speicherversion 5', () => {
    const validator = createWorkspaceStructureValidator(4);
    expect(validator.verbuende({ ...bundle().verbuende[0], requirementPackage: valid })).toBe(false);
  });
});

describe('Abgrenzung im Anwendungsbereich (v6)', () => {
  const scopeId = '77777777-7777-4777-8777-777777777777' as ScopeId;
  const item = buildScopeBoundary('88888888-8888-4888-8888-888888888888', { ...scopeBoundaryInput(undefined), organization: 'Verwaltung', sourceLabel: 'Abgrenzung v2', sourceIssuedAt: '2026-10-22', role: 'ISB', party: 'SiOrg' });
  const scope = { scopeId, name: 'Bereich', createdAt: timestamp, savedAt: timestamp, items: [item], evidence: [] } as unknown as WorkspaceScope;
  const withScope = (row: unknown): WorkspaceBackup => {
    const backup = bundle();
    return { ...backup, methodikScopes: [row as WorkspaceScope], verbuende: [{ ...backup.verbuende[0], scopeId }] };
  };

  it('nimmt genau einen geschlossenen Abgrenzungseintrag im Gesamt- und Verbundbündel an', () => {
    expect(validWorkspaceBackupStructure(withScope(scope))).toBe(true);
    const verbund: Record<string, unknown> = { ...withScope(scope), format: 'gspp-workspace-verbund' };
    delete verbund.workspaceMeta;
    expect(validVerbundBackupStructure(verbund)).toBe(true);
  });

  it('lehnt zweiten Eintrag, fremde Kategorie, Fremdfelder, nicht normalisierten Text und ungültiges Datum ab', () => {
    const invalid = [
      { ...scope, items: [item, { ...item, itemId: '99999999-9999-4999-8999-999999999999' }] },
      { ...scope, items: [{ ...item, category: 'context' }] },
      { ...scope, items: [{ ...item, extra: true }] },
      { ...scope, items: [{ ...item, details: { ...item?.details, extra: '' } }] },
      { ...scope, items: [{ ...item, details: { ...item?.details, organization: ' Verwaltung' } }] },
      { ...scope, items: [{ ...item, source: { label: 'Abgrenzung', issuedAt: '2026-02-30' } }] },
      { ...scope, items: [{ ...item, evidenceIds: ['x'] }] },
    ];
    for (const row of invalid) expect(validWorkspaceBackupStructure(withScope(row))).toBe(false);
  });

  it('kennt Einträge erst ab Speicherversion 6', () => {
    expect(createWorkspaceStructureValidator(5).methodikScopes(scope)).toBe(false);
    expect(createWorkspaceStructureValidator(5).methodikScopes({ ...scope, items: [] })).toBe(true);
    const v5 = { ...withScope({ ...scope, items: [] }), storageSchemaVersion: 5 };
    expect(adoptAnyBackup({ ...v5, documents: v5.documents.map((row) => ({ ...row, storageSchemaVersion: 5 })), workspaceMeta: v5.workspaceMeta.map((row) => ({ ...row, storageSchemaVersion: 5 })) })).not.toBeNull();
  });
});
