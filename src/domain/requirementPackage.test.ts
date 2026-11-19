import { describe, expect, it } from 'vitest';
import { buildRequirementPackage, requirementPackageState } from '@/domain/requirementPackage';
import type { DocumentSnapshot, LocalId } from '@/domain/workspaceModel';

const localId = '11111111-1111-4111-8111-111111111111' as LocalId;
const stand: DocumentSnapshot = {
  rootType: 'profile', uuid: 'u', lastModified: '2026-11-12T10:41:00Z', version: '3', oscalVersion: '1.1.3',
  contentHash: { version: 1, algorithm: 'sha-256', value: 'a'.repeat(64) },
};
const derivedFrom = { artifactKey: 'catalog-gspp', contentSha256: 'b'.repeat(64), snapshotCommit: 'c'.repeat(40) };

describe('buildRequirementPackage', () => {
  it('pinnt die lokale Baseline und eine BSI-Quelle nur aus vollständigem derivedFrom', () => {
    expect(buildRequirementPackage('p', { localId }, stand).sourcePins).toEqual([{ kind: 'local', localId, stand }]);
    expect(buildRequirementPackage('p', { localId, derivedFrom }, stand).sourcePins).toEqual([
      { kind: 'local', localId, stand },
      { kind: 'class-1', artifactKey: 'catalog-gspp', snapshotCommit: 'c'.repeat(40), contentSha256: 'b'.repeat(64) },
    ]);
    const partial = { ...derivedFrom, snapshotCommit: '' };
    expect(buildRequirementPackage('p', { localId, derivedFrom: partial }, stand).sourcePins).toHaveLength(1);
  });

  it('teilt kein Objekt zwischen Baseline und Pin', () => {
    const built = buildRequirementPackage('p', { localId }, stand);
    expect((built.sourcePins[0] as { stand: DocumentSnapshot }).stand).not.toBe(built.baseline.stand);
  });
});

describe('requirementPackageState', () => {
  const requirementPackage = buildRequirementPackage('p', { localId }, stand);

  it('unterscheidet fehlt, festgelegt, überholt und nicht auflösbar', () => {
    expect(requirementPackageState(undefined, undefined)).toEqual({ kind: 'missing' });
    expect(requirementPackageState(requirementPackage, undefined)).toEqual({ kind: 'unresolvable', requirementPackage });
    expect(requirementPackageState(requirementPackage, { title: 'T', current: stand })).toEqual({ kind: 'set', requirementPackage, title: 'T' });
    const changed = { ...stand, contentHash: { ...stand.contentHash, value: 'd'.repeat(64) } };
    expect(requirementPackageState(requirementPackage, { current: changed })).toMatchObject({ kind: 'stale', current: changed });
    const { contentHash: _hash, ...stamp } = { ...stand, lastModified: '2026-11-14T09:12:00Z' };
    expect(requirementPackageState(requirementPackage, { current: stamp })).toMatchObject({ kind: 'stale', current: stamp });
    expect(requirementPackageState(requirementPackage, {})).toEqual({ kind: 'stale', requirementPackage });
  });
});
