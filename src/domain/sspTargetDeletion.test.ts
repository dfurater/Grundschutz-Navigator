import { describe, expect, it } from 'vitest';
import { targetDeletionUses, sspDeletionBlocked } from '@/domain/sspTargetDeletion';
import { addSspItem, removeSspItem, setSspValue } from '@/domain/sspAuthoring';
import { makeFullSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import type { LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';

const localId = 'ssp' as LocalId;
const path = ['system-implementation', 'components', 0];
const list = path.slice(0, -1);
const member = (id: string, source: unknown): WorkspaceEnvelope => ({ localId: id as LocalId, source } as WorkspaceEnvelope);

describe('Zielobjekt-Löschschutz', () => {
  it('nennt lokale Verwendungen und sperrt entfernte referenzierte Komponenten', () => {
    const source = makeFullSsp();
    expect(targetDeletionUses(source, path, localId, [], [])).toContain('/system-security-plan/control-implementation/implemented-requirements/0/by-components/0/component-uuid');
    expect(sspDeletionBlocked(source, removeSspItem(source, list, 0), localId, [], [])).toBe(true);
    const free = addSspItem(source, list, { uuid: 'aaaaaaaa-0000-4000-8000-000000000001' });
    expect(sspDeletionBlocked(free, removeSspItem(free, list, 2), localId, [], [])).toBe(false);
    const duplicate = addSspItem(source, list, (source['system-security-plan'] as { 'system-implementation': { components: unknown[] } })['system-implementation'].components[0]);
    expect(sspDeletionBlocked(duplicate, removeSspItem(duplicate, list, 2), localId, [], [])).toBe(true);
  });
  it('prüft direkte und transitive explizite Bindungen, ignoriert ungebundene UUID-Gleichheit', () => {
    const source = makeFullSsp();
    const target = ['system-characteristics', 'system-information', 'information-types', 0];
    const ap = { 'assessment-plan': { 'import-ssp': { href: '#source' } } };
    const ar = { 'assessment-results': { 'import-ap': { href: '#ap' } } };
    const members = [member('ap', ap), member('ar', ar), member('unbound', source)];
    const bindings: WorkspaceBinding[] = [
      { fromLocalId: 'ap' as LocalId, pointer: '/assessment-plan/import-ssp/href', href: '#source', target: { kind: 'local', localId } },
      { fromLocalId: 'ar' as LocalId, pointer: '/assessment-results/import-ap/href', href: '#ap', target: { kind: 'local', localId: 'ap' as LocalId } },
    ];
    expect(targetDeletionUses(source, target, localId, members, bindings)).toHaveLength(2);
    expect(targetDeletionUses(source, target, localId, members, [])).toEqual([]);
    expect(targetDeletionUses(source, target, localId, [], bindings)).toContain('Verwendung nicht vollständig prüfbar');
  });
  it('behandelt uuidlose Informationsarten ohne Identitätsnachrüstung', () => {
    const source = withSspBody(makeFullSsp(), body => { delete body['system-characteristics']['system-information']!['information-types']![0].uuid; });
    const info = ['system-characteristics', 'system-information', 'information-types'];
    const binding = { fromLocalId: 'ap' as LocalId, pointer: '/assessment-plan/import-ssp/href', href: '#source', target: { kind: 'local', localId } } as const;
    const members = [member('ap', { 'assessment-plan': { 'import-ssp': { href: '#source' } } })];
    expect(sspDeletionBlocked(source, removeSspItem(source, info, 0), localId, members, [binding])).toBe(true);
    expect(sspDeletionBlocked(source, setSspValue(source, [...info, 0, 'title'], 'Geändert'), localId, members, [binding])).toBe(false);
  });
});
