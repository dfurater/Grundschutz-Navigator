// @vitest-environment node
// =============================================================================
// Klasse-2-Lesepfad lokaler Component Definitions (GSPP-322)
//
// Der vorgesehene Weg einer lokalen Datei: Bytes → `processClass2OscalBytes()`
// (Stufen 1–3, derselbe Domainteil wie im Import-Worker) →
// `parseComponentDefinitionDocument()` mit `source` und `context` des
// Erfolgsergebnisses. Alle Fixtures sind synthetisch.
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseComponentDefinitionDocument } from './oscalComponentDocument';
import { COMPONENT_TYPE_VALUES } from '@/domain/componentDefinitionModel';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';
import {
  LOCAL_COMPONENT_EXTERNAL_HREFS,
  makeCapabilityOnlyComponentDefinition,
  makeComponentDefinitionWithoutComponents,
  makeLocalComponentDefinition,
} from '@/test/fixtures/componentDefinitions';
import { makeFullSsp } from '@/test/fixtures/systemSecurityPlans';

type JsonObject = Record<string, unknown>;

const context = { trustClass: 'class-2-local-user' } as const;

afterEach(() => vi.unstubAllGlobals());

async function importLocal(source: unknown) {
  const result = await processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(source)), context);
  if (!result.ok) return { result, document: undefined };
  return { result, document: parseComponentDefinitionDocument(result.document.source, result.document.context) };
}

function withBody(source: JsonObject, mutate: (body: JsonObject) => void): JsonObject {
  const copy = structuredClone(source);
  mutate(copy['component-definition'] as JsonObject);
  return copy;
}

function first(value: unknown, key: string): JsonObject {
  return ((value as JsonObject)[key] as JsonObject[])[0];
}

describe('Minimaldokument aus uuid und metadata', () => {
  it.each(PINNED_OSCAL_VERSIONS)('wird unter %s angenommen und ohne Diagnose abgeleitet', async (version) => {
    const { result, document } = await importLocal(makeComponentDefinitionWithoutComponents(version));

    expect(result).toMatchObject({ ok: true, document: { rootType: 'component-definition', oscalVersion: version } });
    expect(document?.view).toMatchObject({ components: [], capabilities: [], importComponentDefinitions: [], diagnostics: [] });
  });
});

describe('Zuordnungen ausschließlich auf capabilities', () => {
  it('führt alle implemented requirements im Dokument und im Quellindex', async () => {
    const { document } = await importLocal(makeCapabilityOnlyComponentDefinition());
    const view = document!.view;

    expect(view.components).toEqual([]);
    expect(view.implementedRequirements.map((requirement) => requirement.controlId)).toEqual(['GC.1.1', 'GC.1.2']);
    expect(view.implementationsBySource.get(LOCAL_COMPONENT_EXTERNAL_HREFS.source)?.[0]?.implementedRequirements).toHaveLength(2);
  });
});

describe('Pflicht-description, die das Schema der Component Definition trägt', () => {
  it('lehnt incorporates-component ohne description in Stufe json-schema ab', async () => {
    const source = withBody(makeLocalComponentDefinition(), (body) => {
      Reflect.deleteProperty(first(first(body, 'capabilities'), 'incorporates-components'), 'description');
    });

    expect((await importLocal(source)).result).toMatchObject({ ok: false, diagnostic: { stage: 'json-schema' } });
  });

  it('lehnt ein statement ohne description in der Component Definition ab, im SSP nicht', async () => {
    const component = withBody(makeLocalComponentDefinition(), (body) => {
      const implementation = first(first(body, 'components'), 'control-implementations');
      Reflect.deleteProperty(first(first(implementation, 'implemented-requirements'), 'statements'), 'description');
    });
    const ssp = makeFullSsp();
    const sspControlImplementation = (ssp['system-security-plan'] as JsonObject)['control-implementation'] as JsonObject;
    const sspStatement = (sspControlImplementation['implemented-requirements'] as JsonObject[])
      .flatMap((requirement) => (requirement.statements ?? []) as JsonObject[])[0];

    expect(sspStatement).not.toHaveProperty('description');
    expect((await importLocal(component)).result).toMatchObject({ ok: false, diagnostic: { stage: 'json-schema' } });
    expect(await processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(ssp)), context)).toMatchObject({ ok: true });
  });
});

describe('Offenes Vokabular defined-component.type', () => {
  it('nimmt einen unbekannten Typ an, erhält ihn und kennzeichnet ihn ohne Diagnose', async () => {
    const source = makeLocalComponentDefinition('quantum-appliance');
    const { result, document } = await importLocal(source);

    expect(result.ok).toBe(true);
    expect(first((document!.source as JsonObject)['component-definition'], 'components').type).toBe('quantum-appliance');
    expect(document!.view.components[0]).toMatchObject({ type: 'quantum-appliance', typeVocabulary: 'unknown' });
    // Ohne Katalogbindung bleibt die control-id unaufgelöst; der Typ fügt keinen Befund hinzu.
    const documented = await importLocal(makeLocalComponentDefinition('software'));
    expect(document!.view.diagnostics).toEqual(documented.document!.view.diagnostics);
  });

  it('kennzeichnet jeden dokumentierten Wert als documented', async () => {
    for (const type of COMPONENT_TYPE_VALUES) {
      const { document } = await importLocal(makeLocalComponentDefinition(type));
      expect(document!.view.components[0]?.typeVocabulary, type).toBe('documented');
    }
  });
});

describe('Fremdinhalte, protocols und externe Referenzen', () => {
  it('verarbeitet das Dokument ohne Netzzugriff, klassifiziert extern und erhält die Quelle', async () => {
    const network = stubNoNetwork();
    const source = makeLocalComponentDefinition();
    const { document } = await importLocal(source);

    expectNoNetworkCalls(network);
    expect(document!.view.importComponentDefinitions[0]?.reference.kind).toBe('external');
    expect(document!.view.controlImplementations[0]?.source?.reference.kind).toBe('external');
    expect(JSON.stringify(document!.source)).toBe(JSON.stringify(source));
  });
});
