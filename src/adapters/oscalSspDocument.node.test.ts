// @vitest-environment node
// =============================================================================
// Dokumenteinstieg und Klasse-2-Importgrenze für SSPs (GSPP-293)
//
// Der vorgesehene Weg eines SSP: Bytes → `processClass2OscalBytes()` (Stufen
// 1–3, derselbe Domainteil wie im Import-Worker) → `parseSspDocument()` mit
// `source` und `context` des Erfolgsergebnisses.
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSspDocument } from './oscalSspDocument';
import { SSP_ADAPTER_DIAGNOSTIC_CODES, SspTrustClassError } from './oscalSspAdapter';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { OSCAL_NAMESPACE } from '@/domain/mappingModel';
import { OscalRootDispatchError } from '@/domain/oscalRootDispatch';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { PROJECT_PROPS_NAMESPACE } from '@/domain/projectProps';
import type { TrustClass } from '@/domain/models';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';
import { makeFullSsp, makeMinimalSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';

const context = { trustClass: 'class-2-local-user' } as const;

function encode(source: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(source));
}

describe('parseSspDocument', () => {
  it.each(PINNED_OSCAL_VERSIONS)('liefert für ein valides SSP %s das verlustfreie Dokument', (version) => {
    const source = makeMinimalSsp(version);
    const document = parseSspDocument(source, context);

    expect(document.source).toBe(source);
    expect(document.context).toBe(context);
    expect(document.oscalVersion).toBe(version);
    expect(document.pin).toMatchObject({
      rootKey: 'system-security-plan',
      oscalVersion: version,
      vendorPath: `schemas/oscal/v${version}/oscal_ssp_schema.json`,
    });
    expect(document.view.systemCharacteristics?.systemName).toBe('Beispielsystem');
    expect(document.view.diagnostics).toEqual([]);
  });

  it.each<TrustClass>(['class-1-verified-public', 'class-1-unverified-public'])(
    'weist den Kontext %s ohne Dokument ab',
    (trustClass) => {
      const attempt = () => parseSspDocument(makeMinimalSsp('1.2.2'), { trustClass });

      expect(attempt).toThrow(SspTrustClassError);
      try {
        attempt();
      } catch (error) {
        expect((error as SspTrustClassError).diagnostic).toMatchObject({
          code: SSP_ADAPTER_DIAGNOSTIC_CODES.TRUST_CLASS_REJECTED,
          stage: 'domain',
          path: '/',
        });
      }
    },
  );

  it.each([
    ['ohne oscal-version', undefined],
    ['mit nicht gepinnter oscal-version', '1.0.0'],
  ])('weist ein SSP %s im Root-Dispatch ab', async (_case, declared) => {
    const source = withSspBody(makeMinimalSsp('1.2.2'), (body) => {
      if (declared === undefined) Reflect.deleteProperty(body.metadata, 'oscal-version');
      else body.metadata['oscal-version'] = declared;
    });

    const result = await processClass2OscalBytes(encode(source), context);
    expect(result).toMatchObject({ ok: false, diagnostic: { stage: 'root-dispatch' } });
    expect(() => parseSspDocument(source, context)).toThrow(OscalRootDispatchError);
  });
});

describe('Props-Namespaces zwischen source und view', () => {
  it('behält Props fremder Namespaces im Quellgraphen und lässt sie aus dem view', () => {
    const foreignNamespace = 'https://example.vendor.invalid/ns/oscal';
    const source = makeFullSsp();
    const before = structuredClone(source);
    const document = parseSspDocument(source, context);

    expect(document.source).toEqual(before);
    expect(JSON.stringify(document.source)).toContain(foreignNamespace);
    expect(JSON.stringify(document.view)).not.toContain(foreignNamespace);
    expect(document.view.systemCharacteristics?.props).toEqual([
      { name: 'cloud-deployment-model', value: 'private-cloud', ns: undefined, class: undefined },
    ]);
  });

  it('projiziert nur Props ohne ns oder mit exakt dem OSCAL-Namespace', () => {
    const source = withSspBody(makeFullSsp(), (body) => {
      Object.assign(body['system-characteristics'], {
        props: [
          { name: 'ohne-ns', value: 'a' },
          { name: 'oscal-ns', value: 'b', ns: OSCAL_NAMESPACE },
          { name: 'oscal-xml-ns', value: 'c', ns: `${OSCAL_NAMESPACE}/1.0` },
          { name: 'projekt-ns', value: 'd', ns: PROJECT_PROPS_NAMESPACE },
          { name: 'ns-kein-string', value: 'e', ns: 42 },
        ],
      });
    });
    const { view } = parseSspDocument(source, context);

    expect(view.systemCharacteristics?.props.map((prop) => prop.name)).toEqual(['ohne-ns', 'oscal-ns']);
    expect(view.diagnostics).toEqual([]);
  });
});

describe('Klasse-2-Importgrenze vor dem SSP-Einstieg', () => {
  it('reicht ein valides Vollfixture an das Read-Model weiter', async () => {
    const result = await processClass2OscalBytes(encode(makeFullSsp()), context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const document = parseSspDocument(result.document.source, result.document.context);
    expect(document.view.controlImplementation?.implementedRequirements).toHaveLength(2);
    expect(document.view.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: 'ohne import-profile',
      source: () => withSspBody(makeFullSsp(), (body) => Reflect.deleteProperty(body, 'import-profile')),
    },
    {
      name: 'mit leerem system-implementation.components',
      source: () => withSspBody(makeFullSsp(), (body) => {
        body['system-implementation'].components = [];
      }),
    },
    {
      name: 'der Version 1.1.3 ohne system-implementation.users',
      source: () => withSspBody(makeMinimalSsp('1.1.3'), (body) => {
        Reflect.deleteProperty(body['system-implementation'], 'users');
      }),
    },
  ])('lehnt ein SSP $name mit einer json-schema-Diagnose ab', async ({ source }) => {
    const result = await processClass2OscalBytes(encode(source()), context);
    expect(result).toMatchObject({ ok: false, diagnostic: { stage: 'json-schema' } });
  });

  it('nimmt ein SSP der Version 1.2.2 ohne system-implementation.users an', async () => {
    const source = withSspBody(makeMinimalSsp('1.2.2'), (body) => {
      Reflect.deleteProperty(body['system-implementation'], 'users');
    });

    const result = await processClass2OscalBytes(encode(source), context);
    expect(result).toMatchObject({ ok: true, document: { rootType: 'system-security-plan' } });
  });
});

describe('Kein Netzwerkzugriff', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('löst absolute, relative und Fragment-hrefs ohne fetch oder XMLHttpRequest auf', () => {
    const stubs = stubNoNetwork();
    const source = withSspBody(makeFullSsp(), (body) => {
      body['import-profile'].href = 'https://example.invalid/baseline-profile.json';
      body['system-characteristics']['network-architecture'] = {
        description: 'Mit Links.',
        links: [{ href: './netzplan.json' }, { href: 'https://example.invalid/netzplan' }],
      };
    });

    const document = parseSspDocument(source, context);

    expect(document.view.importProfile?.reference.kind).toBe('external');
    expectNoNetworkCalls(stubs);
  });
});

describe('NIST-Orakel — usnistgov/oscal-content @ v1.5.0', () => {
  const directory = 'src/test/fixtures/oscal-content-v1.5.0';
  const manifest = JSON.parse(readFileSync(join(directory, 'ORACLE_MANIFEST.json'), 'utf8')) as {
    source: { commit: string };
    files: { artifactKey: string; role: string; fileName: string; sha256: string; sizeBytes: number }[];
  };
  const examples = manifest.files.filter((file) => file.role === 'example' && file.artifactKey.startsWith('nist-ssp-'));

  function load(fileName: string): unknown {
    return JSON.parse(readFileSync(join(directory, fileName), 'utf8'));
  }

  it('führt genau die drei SSP-Beispiele am gepinnten Commit', () => {
    expect(manifest.source.commit).toBe('78650f02ad9321bb7b817846f8fbd4f2bcd620de');
    expect(examples.map((file) => file.fileName)).toEqual([
      'ssp-example.json',
      'ssp-leveraged-example.json',
      'ssp-leveraging-example.json',
    ]);
    for (const file of examples) {
      const bytes = readFileSync(join(directory, file.fileName));
      expect(createHash('sha256').update(bytes).digest('hex'), file.fileName).toBe(file.sha256);
      expect(bytes.length, file.fileName).toBe(file.sizeBytes);
    }
  });

  it.each(['ssp-example.json', 'ssp-leveraged-example.json', 'ssp-leveraging-example.json'])(
    '%s besteht Stufe 3 und wird ohne Modelldiagnose projiziert',
    async (fileName) => {
      const result = await processClass2OscalBytes(encode(load(fileName)), context);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const document = parseSspDocument(result.document.source, result.document.context);
      expect(document.view.diagnostics).toEqual([]);
      expect(document.view.importProfile?.reference.kind).toBe('resource');
    },
  );

  it('führt export im geleasten und inherited/satisfied im nutzenden System', () => {
    const leveraged = parseSspDocument(load('ssp-leveraged-example.json'), context).view;
    const leveraging = parseSspDocument(load('ssp-leveraging-example.json'), context).view;

    const exported = leveraged.controlImplementation?.implementedRequirements
      .flatMap((requirement) => [
        ...requirement.byComponents,
        ...requirement.statements.flatMap((statement) => statement.byComponents),
      ])
      .filter((byComponent) => byComponent.export !== null);
    expect(exported?.length).toBeGreaterThan(0);

    const inheriting = leveraging.controlImplementation?.implementedRequirements
      .flatMap((requirement) => [
        ...requirement.byComponents,
        ...requirement.statements.flatMap((statement) => statement.byComponents),
      ]);
    expect(inheriting?.some((byComponent) => byComponent.inherited.length > 0)).toBe(true);
    expect(inheriting?.some((byComponent) => byComponent.satisfied.length > 0)).toBe(true);
  });
});
