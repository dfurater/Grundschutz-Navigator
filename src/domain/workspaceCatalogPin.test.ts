import { describe, expect, it } from 'vitest';
import { PROJECT_PROPS_NAMESPACE } from '@/domain/projectProps';
import { applyCatalogPins, catalogPinStatus, readCatalogPins, withCatalogPins, type CatalogDelivery } from '@/domain/workspaceCatalogPin';
import { WORKSPACE_DIAGNOSTIC_CODES } from '@/domain/workspaceDiagnostics';
import type { LocalId, WorkspaceBinding } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const ID = 'doc-1' as LocalId;

const catalogBinding = (artifactKey = 'catalog-gspp', fromLocalId = ID): WorkspaceBinding => ({
  fromLocalId, pointer: '/profile/imports/0/href', href: 'katalog.json', target: { kind: 'class-1', artifactKey },
});
const delivered = (commit: string, verified = true): CatalogDelivery => new Map([['catalog-gspp', { commit, verified }]]);

function profile(props?: unknown[]) {
  const source = makeSchemaValidOscalDocument('profile', '1.2.2') as { profile: { metadata: Record<string, unknown> } };
  if (props) source.profile.metadata.props = props;
  return source;
}

const pin = (catalogKey: string, commit: string) => [
  { name: 'assessed-against-catalog-key', value: catalogKey, ns: PROJECT_PROPS_NAMESPACE, group: catalogKey },
  { name: 'assessed-against-catalog-commit', value: commit, ns: PROJECT_PROPS_NAMESPACE, group: catalogKey },
];

describe('catalogPinStatus', () => {
  it('prüft nichts, wenn das Dokument auf keinen BSI-Katalog verweist', () => {
    const local: WorkspaceBinding = { ...catalogBinding(), target: { kind: 'local', localId: 'x' as LocalId } };
    expect(catalogPinStatus(profile(), 'profile', [local], delivered(NEW))).toBeUndefined();
  });

  it.each([
    ['bound', pin('gspp', NEW), delivered(NEW), undefined, []],
    ['pending', pin('gspp', NEW), new Map(), undefined, []],
    ['unpinned', undefined, delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinMissing, ['gspp']],
    ['not-delivered', pin('gspp', OLD), delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered, ['gspp']],
    ['unverified', pin('gspp', NEW), delivered(NEW, false), WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified, []],
    ['invalid', pin('gspp', NEW).slice(1), delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid, []],
    ['invalid', pin('unbekannt', NEW), delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid, []],
  ] as const)('meldet %s', (state, props, delivery, code, offers) => {
    expect(catalogPinStatus(profile(props ? [...props] : undefined), 'profile', [catalogBinding()], delivery))
      .toEqual({ state, code, offers });
  });

  it('enthält weder Commit noch Katalogschlüssel in der Diagnose', () => {
    const status = catalogPinStatus(profile(pin('gspp', OLD)), 'profile', [catalogBinding()], delivered(NEW));
    expect(status?.code).not.toContain(OLD);
    expect(status?.code).not.toContain('gspp');
  });
});

describe('withCatalogPins', () => {
  it('schreibt für einen gebundenen Katalog genau ein gültiges Paar auf metadata.props', () => {
    const result = withCatalogPins(profile(), 'profile', [catalogBinding()], delivered(NEW));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readCatalogPins(result.source, 'profile')).toEqual(new Map([['gspp', NEW]]));
    expect(catalogPinStatus(result.source, 'profile', [catalogBinding()], delivered(NEW))?.state).toBe('bound');
  });

  it('trägt mehrere Quellkataloge in getrennten Gruppen', () => {
    const delivery: CatalogDelivery = new Map([['catalog-gspp', { commit: NEW, verified: true }], ['catalog-wlan', { commit: OLD, verified: true }]]);
    const result = withCatalogPins(profile(), 'profile', [catalogBinding(), { ...catalogBinding('catalog-wlan'), pointer: '/profile/imports/1/href' }], delivery);
    expect(result.ok && readCatalogPins(result.source, 'profile')).toEqual(new Map([['gspp', NEW], ['wlan', OLD]]));
  });

  it('lässt ein passendes Paar und fremde Props unverändert', () => {
    const foreign = { name: 'x', value: 'y' };
    const source = profile([foreign, ...pin('gspp', NEW)]);
    const result = withCatalogPins(source, 'profile', [catalogBinding()], delivered(NEW));
    expect(result).toEqual({ ok: true, source });
  });

  it.each([
    ['einen anderen Stand', profile(pin('gspp', OLD)), delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered],
    ['einen nicht verifizierten Stand', profile(), delivered(NEW, false), WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified],
    ['einen nicht geladenen Stand', profile(), new Map(), WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified],
    ['ein unvollständiges Paar', profile(pin('gspp', NEW).slice(0, 1)), delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid],
  ])('verweigert %s, statt still zu migrieren', (_label, source, delivery, code) => {
    expect(withCatalogPins(source, 'profile', [catalogBinding()], delivery)).toEqual({ ok: false, code });
  });
});

describe('applyCatalogPins', () => {
  it('hält nur die Katalogbindungen gesperrter Dokumente zurück', () => {
    const other = 'doc-2' as LocalId;
    const members = [
      { localId: ID, rootType: 'profile' as const, source: profile(pin('gspp', NEW)) },
      { localId: other, rootType: 'profile' as const, source: profile(pin('gspp', OLD)) },
    ];
    const bound = catalogBinding();
    const stale = catalogBinding('catalog-gspp', other);
    const local: WorkspaceBinding = { fromLocalId: other, pointer: '/profile/imports/1/href', href: '#x', target: { kind: 'local', localId: ID } };
    const result = applyCatalogPins(members, [bound, stale, local], delivered(NEW));
    expect(result.bindings).toEqual([bound, local]);
    expect(result.withheld).toEqual([stale]);
    expect(result.pins.get(ID)?.state).toBe('bound');
    expect(result.pins.get(other)?.state).toBe('not-delivered');
  });
});
