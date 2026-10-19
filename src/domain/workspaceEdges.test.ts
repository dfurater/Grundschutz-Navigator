import { describe, expect, it } from 'vitest';
import { readWorkspaceDocumentEdges } from '@/domain/workspaceEdges';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';

describe('readWorkspaceDocumentEdges', () => {
  it('preserves profile imports without a source and the exact href pointer', () => {
    expect(readWorkspaceDocumentEdges({ profile: { imports: [{ href: '#resource' }, { 'include-all': {} }] } }, 'profile')).toEqual([
      { kind: 'profile-import', path: '/profile/imports/0/href', href: '#resource', allowedRoots: ['catalog', 'profile'] },
      { kind: 'profile-import', path: '/profile/imports/1/href', href: undefined, allowedRoots: ['catalog', 'profile'] },
    ]);
  });

  it('reads SSP imports and only leveraged links with the normative relation', () => {
    const source = { 'system-security-plan': {
      'import-profile': { href: 'baseline' },
      'import-component-definitions': [{ href: 'phantom' }],
      'system-implementation': { 'leveraged-authorizations': [{ links: [
        { rel: 'other', href: 'ignored' }, { rel: 'system-security-plan', href: 'ssp' },
      ] }] },
    } };
    expect(readWorkspaceDocumentEdges(source, 'system-security-plan')).toEqual([
      { kind: 'ssp-import-profile', path: '/system-security-plan/import-profile/href', href: 'baseline', allowedRoots: ['catalog', 'profile'] },
      { kind: 'ssp-leveraged-authorization', path: '/system-security-plan/system-implementation/leveraged-authorizations/0/links/1/href', href: 'ssp', allowedRoots: ['system-security-plan'] },
    ]);
  });

  it('reads component and capability sources plus component imports without changing source', () => {
    const source = { 'component-definition': {
      components: [{ 'control-implementations': [{ source: 'component-source' }] }],
      capabilities: [{ 'control-implementations': [{ source: 'capability-source' }] }],
      'import-component-definitions': [{ href: 'import' }],
    } };
    const before = structuredClone(source);
    expect(readWorkspaceDocumentEdges(source, 'component-definition')).toEqual([
      { kind: 'component-source', path: '/component-definition/components/0/control-implementations/0/source', href: 'component-source', allowedRoots: ['catalog', 'profile'] },
      { kind: 'component-source', path: '/component-definition/capabilities/0/control-implementations/0/source', href: 'capability-source', allowedRoots: ['catalog', 'profile'] },
      { kind: 'component-import', path: '/component-definition/import-component-definitions/0/href', href: 'import', allowedRoots: ['component-definition'] },
    ]);
    expect(source).toEqual(before);
  });

  it.each([
    ['assessment-plan', 'import-ssp', 'ap-import-ssp', 'system-security-plan'],
    ['assessment-results', 'import-ap', 'ar-import-ap', 'assessment-plan'],
    ['plan-of-action-and-milestones', 'import-ssp', 'poam-import-ssp', 'system-security-plan'],
  ] as const)('reads only the document import of %s', (root, field, kind, target) => {
    expect(readWorkspaceDocumentEdges({ [root]: { [field]: { href: 'target' }, 'import-ar': { href: 'phantom' } } }, root)).toEqual([
      { kind, path: `/${root}/${field}/href`, href: 'target', allowedRoots: [target] },
    ]);
  });

  it.each<OscalRootKey>(['catalog', 'mapping-collection', 'plan-of-action-and-milestones'])('does not invent imports for %s', root => {
    expect(readWorkspaceDocumentEdges({ [root]: { 'import-ar': { href: 'phantom' }, links: [{ href: 'phantom' }] } }, root)).toEqual([]);
  });

  it('ignores malformed structures and retains raw reference strings', () => {
    expect(readWorkspaceDocumentEdges(null, 'profile')).toEqual([]);
    expect(readWorkspaceDocumentEdges({ profile: [] }, 'profile')).toEqual([]);
    expect(readWorkspaceDocumentEdges({ profile: { imports: [null, [], { href: 42 }, { href: ' ../raw#value ' }] } }, 'profile').map(edge => edge.href)).toEqual([undefined, ' ../raw#value ']);
    expect(readWorkspaceDocumentEdges({ 'component-definition': { components: [null, { 'control-implementations': 'invalid' }], capabilities: 'invalid' } }, 'component-definition')).toEqual([]);
  });
});
