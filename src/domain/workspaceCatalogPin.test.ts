import { describe, expect, it } from 'vitest';
import { PROJECT_PROPS_NAMESPACE } from '@/domain/projectProps';
import {
  applyCatalogPins, catalogPinStatus, catalogPinsForSave, editLocked, readCatalogPins, reviewLocked, withCatalogPins, type CatalogDelivery,
} from '@/domain/workspaceCatalogPin';
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

  const all = ['catalog-gspp'];
  it.each([
    ['bound', pin('gspp', NEW), delivered(NEW), undefined, [], [], []],
    ['pending', pin('gspp', NEW), new Map(), undefined, [], [], ['gspp']],
    ['unpinned', undefined, delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinMissing, ['gspp'], all, []],
    ['not-delivered', pin('gspp', OLD), delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered, ['gspp'], all, []],
    ['unverified', pin('gspp', NEW), delivered(NEW, false), WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified, [], [], []],
    ['invalid', pin('gspp', NEW).slice(1), delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid, [], all, []],
    ['invalid', pin('unbekannt', NEW), delivered(NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid, [], all, []],
  ] as const)('meldet %s', (state, props, delivery, code, offers, withheld, pending) => {
    expect(catalogPinStatus(profile(props ? [...props] : undefined), 'profile', [catalogBinding()], delivery))
      .toEqual({ state, code, offers, withheld, pending });
  });

  // Ein importiertes Dokument hat noch keine Bindung; sein Paar ist trotzdem die Bewertungsgrundlage.
  it.each([
    ['bound', pin('gspp', NEW), delivered(NEW)],
    ['pending', pin('gspp', NEW), new Map()],
    ['not-delivered', pin('gspp', OLD), delivered(NEW)],
    ['unverified', pin('gspp', NEW), delivered(NEW, false)],
    ['invalid', pin('gspp', NEW).slice(1), delivered(NEW)],
    ['invalid', pin('unbekannt', NEW), delivered(NEW)],
  ] as const)('prüft ein vorhandenes Paar ohne Katalogbindung: %s', (state, props, delivery) => {
    expect(catalogPinStatus(profile([...props]), 'profile', [], delivery)?.state).toBe(state);
  });

  it('prüft nichts bei einem Dokument ohne Paar und ohne Katalogbindung', () => {
    expect(catalogPinStatus(profile([{ name: 'x', value: 'y' }]), 'profile', [], delivered(NEW))).toBeUndefined();
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

  it.each([
    ['einen anderen Stand', pin('gspp', OLD), WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered],
    ['einen unbekannten Katalog', pin('unbekannt', NEW), WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid],
  ])('verweigert ein Paar auf %s auch ohne Katalogbindung', (_label, props, code) => {
    expect(withCatalogPins(profile([...props]), 'profile', [], delivered(NEW))).toEqual({ ok: false, code });
  });
});

describe('catalogPinsForSave', () => {
  const saved = (props?: unknown[]) => ({ source: profile(props), rootType: 'profile', bindings: [catalogBinding()] });

  it('gibt ein gesperrtes Dokument nicht frei, auch wenn der Arbeitsstand ein Paar hätte', () => {
    expect(catalogPinsForSave(saved(pin('gspp', OLD)), profile(), [catalogBinding()], delivered(NEW)))
      .toEqual({ ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered });
    expect(catalogPinsForSave(saved(), profile(), [catalogBinding()], delivered(NEW)))
      .toEqual({ ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinMissing });
    expect(catalogPinsForSave(saved(pin('gspp', NEW)), profile(), [catalogBinding()], new Map()))
      .toEqual({ ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified });
  });

  it('bindet ein Dokument ohne Paar nur bestätigt an den ausgelieferten Stand', () => {
    const result = catalogPinsForSave(saved(), profile(), [catalogBinding()], delivered(NEW), true);
    expect(result.ok && readCatalogPins(result.source, 'profile')).toEqual(new Map([['gspp', NEW]]));
    expect(catalogPinsForSave(saved(pin('gspp', OLD)), profile(), [catalogBinding()], delivered(NEW), true).ok).toBe(false);
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

  describe('über lokale Referenzen', () => {
    const SSP = 'ssp' as LocalId;
    const PROFILE = 'profile' as LocalId;
    const sspSource = () => makeSchemaValidOscalDocument('system-security-plan', '1.2.2');
    const toLocal = (fromLocalId: LocalId, localId: LocalId): WorkspaceBinding => ({
      fromLocalId, pointer: '/x', href: `${localId}.json`, target: { kind: 'local', localId },
    });

    it('überträgt die Sperre des Profils auf das SSP, das es importiert', () => {
      const members = [
        { localId: SSP, rootType: 'system-security-plan' as const, source: sspSource() },
        { localId: PROFILE, rootType: 'profile' as const, source: profile(pin('gspp', OLD)) },
      ];
      const { pins } = applyCatalogPins(members, [toLocal(SSP, PROFILE), catalogBinding('catalog-gspp', PROFILE)], delivered(NEW));
      expect(pins.get(SSP)).toMatchObject({ state: 'not-delivered', code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered, inherited: true });
      expect(reviewLocked(pins.get(SSP))).toBe(true);
      expect(editLocked(pins.get(SSP))).toBe(false);
      expect(editLocked(pins.get(PROFILE))).toBe(true);
    });

    it('lässt das SSP frei, solange das Profil gebunden ist', () => {
      const members = [
        { localId: SSP, rootType: 'system-security-plan' as const, source: sspSource() },
        { localId: PROFILE, rootType: 'profile' as const, source: profile(pin('gspp', NEW)) },
      ];
      const { pins } = applyCatalogPins(members, [toLocal(SSP, PROFILE), catalogBinding('catalog-gspp', PROFILE)], delivered(NEW));
      expect(pins.has(SSP)).toBe(false);
      expect(reviewLocked(pins.get(SSP))).toBe(false);
    });

    it('folgt mehrstufigen Ketten und endet in einem Zyklus', () => {
      const MIDDLE = 'middle' as LocalId;
      const members = [
        { localId: SSP, rootType: 'system-security-plan' as const, source: sspSource() },
        { localId: MIDDLE, rootType: 'profile' as const, source: profile() },
        { localId: PROFILE, rootType: 'profile' as const, source: profile(pin('gspp', OLD)) },
      ];
      const bindings = [toLocal(SSP, MIDDLE), toLocal(MIDDLE, SSP), toLocal(MIDDLE, PROFILE), catalogBinding('catalog-gspp', PROFILE)];
      const { pins } = applyCatalogPins(members, bindings, delivered(NEW));
      expect(pins.get(SSP)?.state).toBe('not-delivered');
      expect(pins.get(MIDDLE)?.state).toBe('not-delivered');
      expect(pins.get(PROFILE)?.inherited).toBeUndefined();
    });

    it('behält den eigenen schwereren Zustand eines Dokuments', () => {
      const members = [
        { localId: ID, rootType: 'profile' as const, source: profile(pin('unbekannt', NEW)) },
        { localId: PROFILE, rootType: 'profile' as const, source: profile(pin('gspp', OLD)) },
      ];
      const { pins } = applyCatalogPins(members, [toLocal(ID, PROFILE), catalogBinding('catalog-gspp', PROFILE)], delivered(NEW));
      expect(pins.get(ID)).toMatchObject({ state: 'invalid' });
      expect(pins.get(ID)?.inherited).toBeUndefined();
    });
  });

  it('hält eine falsch gebundene Katalogbindung auch zurück, wenn ein anderer Katalog nicht verifiziert ist', () => {
    const wlan: WorkspaceBinding = { ...catalogBinding('catalog-wlan'), pointer: '/profile/imports/1/href' };
    const delivery: CatalogDelivery = new Map([['catalog-gspp', { commit: NEW, verified: true }], ['catalog-wlan', { commit: null, verified: false }]]);
    const members = [{ localId: ID, rootType: 'profile' as const, source: profile([...pin('gspp', OLD), ...pin('wlan', NEW)]) }];
    const result = applyCatalogPins(members, [catalogBinding(), wlan], delivery);
    expect(result.pins.get(ID)?.state).toBe('unverified');
    expect(result.withheld).toEqual([catalogBinding()]);
    expect(result.bindings).toEqual([wlan]);
  });
});
