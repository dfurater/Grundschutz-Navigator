import { describe, expect, it } from 'vitest';
import {
  addSspItem, createSspSource, moveSspItem, readSspValue, removeSspComponent, removeSspItem, setBaselineTitle,
  setSspValue, sspBaselineBindable, SspPatchError,
} from '@/domain/sspAuthoring';
import { missingSspStructure } from '@/domain/sspRequirements';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { makeFullSsp, makeMinimalSsp, SSP_FIXTURE_IDS, withSspBody } from '@/test/fixtures/systemSecurityPlans';

const ROOT = '/system-security-plan';

function created() {
  return createSspSource({
    uuid: '77777777-0000-4000-8000-000000000001',
    resourceUuid: '77777777-0000-4000-8000-000000000002',
    title: ' Neues SSP ',
    baselineTitle: 'Baseline',
    lastModified: '2026-10-22T00:00:00.000Z',
  });
}

describe('Neuanlage', () => {
  it('trägt Root-UUID, 1.2.2-Metadaten, import-profile mit Back-matter-Ressource und leere Rahmenstrukturen', () => {
    const { source, href } = created();
    expect(href).toBe('#77777777-0000-4000-8000-000000000002');
    expect(source).toEqual({
      'system-security-plan': {
        uuid: '77777777-0000-4000-8000-000000000001',
        metadata: { title: 'Neues SSP', 'last-modified': '2026-10-22T00:00:00.000Z', version: '1.0', 'oscal-version': '1.2.2' },
        'import-profile': { href },
        'system-characteristics': {},
        'system-implementation': {},
        'control-implementation': {},
        'back-matter': { resources: [{ uuid: '77777777-0000-4000-8000-000000000002', title: 'Baseline' }] },
      },
    });
  });

  it('lehnt einen leeren Titel ab', () => {
    expect(() => createSspSource({ ...{ uuid: 'a', resourceUuid: 'b', baselineTitle: 'B', lastModified: 'c' }, title: '  ' })).toThrow(SspPatchError);
  });

  it('führt die offene Pflichtstruktur eines neuen SSP mit OSCAL-Pfad', () => {
    expect(missingSspStructure(created().source)).toEqual([
      `${ROOT}/system-characteristics/system-ids`,
      `${ROOT}/system-characteristics/system-name`,
      `${ROOT}/system-characteristics/description`,
      `${ROOT}/system-characteristics/system-information/information-types`,
      `${ROOT}/system-characteristics/status/state`,
      `${ROOT}/system-characteristics/authorization-boundary/description`,
      `${ROOT}/system-implementation/components`,
      `${ROOT}/control-implementation/description`,
      `${ROOT}/control-implementation/implemented-requirements`,
    ]);
  });
});

describe('Patches', () => {
  it('ändert genau den adressierten Wert und bewahrt alle übrigen Inhalte', () => {
    const full = makeFullSsp();
    const next = setSspValue(full, ['system-characteristics', 'system-name'], 'Neuer Name');
    expect(readSspValue(next, ['system-characteristics', 'system-name'])).toBe('Neuer Name');
    expect(withSspBody(next as Record<string, unknown>, (body) => { body['system-characteristics']['system-name'] = 'Beispielsystem'; })).toEqual(full);
    expect(full).toEqual(makeFullSsp());
  });

  it('entfernt einen Wert, der nur aus Leerraum besteht, und legt fehlende Objekte entlang des Pfads an', () => {
    const { source } = created();
    const withState = setSspValue(source, ['system-characteristics', 'status', 'state'], 'operational');
    expect(readSspValue(withState, ['system-characteristics', 'status'])).toEqual({ state: 'operational' });
    expect(readSspValue(setSspValue(withState, ['system-characteristics', 'status', 'state'], ' '), ['system-characteristics', 'status'])).toEqual({});
  });

  it('hängt Zeilen an, verschiebt sie und lässt eine geleerte Liste entfallen', () => {
    const path = ['metadata', 'roles'];
    const two = addSspItem(addSspItem(created().source, path, { id: 'a', title: 'A' }), path, { id: 'b', title: 'B' });
    expect(readSspValue(moveSspItem(two, path, 1, 0), path)).toEqual([{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }]);
    expect(readSspValue(removeSspItem(removeSspItem(two, path, 0), path, 0), ['metadata'])).not.toHaveProperty('roles');
    expect(() => removeSspItem(two, path, 2)).toThrow(SspPatchError);
  });

  it('weist Pfade mit Prototyp-Schlüsseln und unpassender Form ab', () => {
    const { source } = created();
    expect(() => setSspValue(source, ['__proto__', 'polluted'], 'x')).toThrow(SspPatchError);
    expect(() => setSspValue(source, ['metadata', 'title', 'x'], 'x')).toThrow(SspPatchError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('entfernt eine Komponente nur, wenn keine component-uuid auf sie zeigt', () => {
    const full = makeFullSsp();
    expect(() => removeSspComponent(full, 0)).toThrow(expect.objectContaining({ code: 'SSP_COMPONENT_REFERENCED' }));
    const free = addSspItem(full, ['system-implementation', 'components'], { uuid: '77777777-0000-4000-8000-0000000000aa' });
    expect(readSspValue(removeSspComponent(free, 2), ['system-implementation', 'components'])).toHaveLength(2);
  });

  it('erkennt eine component-uuid in anderer Schreibweise als Verweis, wie der Adapter', () => {
    const upper = withSspBody(makeFullSsp(), (body) => {
      body['system-implementation'].components[0].uuid = SSP_FIXTURE_IDS.thisSystem.toUpperCase();
    });
    expect(() => removeSspComponent(upper, 0)).toThrow(expect.objectContaining({ code: 'SSP_COMPONENT_REFERENCED' }));
  });

  it('bindet eine Baseline nur an einen nicht externen Verweis', () => {
    expect(sspBaselineBindable(makeFullSsp())).toBe(true);
    expect(sspBaselineBindable(setSspValue(makeFullSsp(), ['import-profile', 'href'], 'https://example.invalid/profile.json'))).toBe(false);
  });

  it('schreibt den Titel der Baseline-Ressource und lässt die übrigen Ressourcen unverändert', () => {
    const next = setBaselineTitle(makeFullSsp(), 'Neue Baseline');
    const resources = readSspValue(next, ['back-matter', 'resources']) as { uuid: string; title: string }[];
    expect(resources.find((resource) => resource.uuid === SSP_FIXTURE_IDS.baselineResource)?.title).toBe('Neue Baseline');
    expect(resources.find((resource) => resource.uuid === SSP_FIXTURE_IDS.embeddedResource)?.title).toBe('Grenzdiagramm');
  });
});

describe('Versionsabhängige Pflichtführung', () => {
  it('meldet eine fehlende SSP-Wurzel als offene Pflichtstruktur', () => {
    expect(missingSspStructure({ profile: {} })).toEqual(['/system-security-plan']);
  });

  it.each(PINNED_OSCAL_VERSIONS)('%s: das minimale SSP hat keine offene Pflichtstruktur', (version) => {
    expect(missingSspStructure(makeMinimalSsp(version))).toEqual([]);
  });

  it.each(PINNED_OSCAL_VERSIONS)('%s: users ist nur in 1.1.x Pflicht', (version) => {
    const withoutUsers = withSspBody(makeMinimalSsp(version), (body) => { Reflect.deleteProperty(body['system-implementation'], 'users'); });
    const expected = version.startsWith('1.1.') ? [`${ROOT}/system-implementation/users`] : [];
    expect(missingSspStructure(withoutUsers)).toEqual(expected);
  });

  it('liest die Version wie der Root-Dispatch: v1.1.2 bindet 1.1.2', () => {
    const prefixed = withSspBody(makeMinimalSsp('1.1.2'), (body) => {
      body.metadata['oscal-version'] = 'v1.1.2';
      Reflect.deleteProperty(body['system-implementation'], 'users');
    });
    expect(missingSspStructure(prefixed)).toEqual([`${ROOT}/system-implementation/users`]);
  });

  it.each(PINNED_OSCAL_VERSIONS)('%s: protocol.name ist nur in 1.1.2 Pflicht', (version) => {
    const withProtocol = withSspBody(makeMinimalSsp(version), (body) => {
      Object.assign(body['system-implementation'].components[0], { protocols: [{ uuid: '77777777-0000-4000-8000-0000000000bb' }] });
    });
    const expected = version === '1.1.2' ? [`${ROOT}/system-implementation/components/0/protocols/0/name`] : [];
    expect(missingSspStructure(withProtocol)).toEqual(expected);
  });
});
