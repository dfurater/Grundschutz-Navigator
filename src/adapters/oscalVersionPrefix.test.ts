// =============================================================================
// v-präfigierte metadata.oscal-version (GSPP-357)
//
// Für Klasse 2 entfernt die Matrix genau ein führendes kleines `v`, bevor sie
// die Zelle wählt. Geprüft wird hier, dass Root-Dispatch und Modelladapter
// daraus denselben Versionskontext ableiten: Der Dispatch bindet `v1.2.2` an
// die Zelle `1.2.2` und lässt die Quelle unverändert; die Adapter, die die
// Version für Diagnose- und Referenzkontext selbst lesen, melden dieselbe
// gepinnte Version, statt die Präfixform zu `null` zu verlieren oder roh
// durchzureichen. Klasse 1 bindet in beiden exakt.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { deriveComponentDefinition } from './oscalComponentAdapter';
import { deriveMappingCollection } from './oscalMappingAdapter';
import { deriveProfile } from './oscalProfileAdapter';
import { dispatchOscalDocument } from './oscalRootDispatch';
import type { OscalRootDispatchFailure } from './oscalRootDispatch';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDocumentContext } from '@/domain/models';
import {
  buildSchemaId,
  getSchemaPin,
  VERSION_MATRIX_DIAGNOSTIC_CODES,
} from '@/domain/oscalVersionMatrix';
import { makeOscalEnvelope as makeEnvelope } from '@/test/fixtures/oscalEnvelope';

const context: OscalDocumentContext = { trustClass: 'class-2-local-user' };
const CLASS_1_CONTEXTS: readonly OscalDocumentContext[] = [
  { trustClass: 'class-1-verified-public' },
  // Auch ein unverifiziertes BSI-Artefakt wird genutzt; es darf deshalb
  // ebenso wenig normalisiert werden.
  { trustClass: 'class-1-unverified-public' },
];

function expectFailure(result: ReturnType<typeof dispatchOscalDocument>): OscalRootDispatchFailure {
  expect(result.ok).toBe(false);
  return result as OscalRootDispatchFailure;
}

describe('dispatchOscalDocument — v-präfigierte oscal-version', () => {
  it('bindet eine v-präfigierte oscal-version an die exakte Zelle und lässt die Quelle unverändert', () => {
    const source = makeEnvelope('catalog', 'v1.2.2');
    const snapshot = structuredClone(source);

    const result = dispatchOscalDocument(source, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.oscalVersion).toBe('1.2.2');
    expect(result.pin).toEqual(getSchemaPin('catalog', '1.2.2'));
    expect(result.source).toBe(source);
    expect(source).toEqual(snapshot);
  });

  it.each([
    ['großes V', 'V1.2.2', VERSION_MATRIX_DIAGNOSTIC_CODES.VERSION_MALFORMED],
    ['doppeltes v', 'vv1.2.2', VERSION_MATRIX_DIAGNOSTIC_CODES.VERSION_MALFORMED],
    ['zweistellige Version', 'v1.2', VERSION_MATRIX_DIAGNOSTIC_CODES.VERSION_MALFORMED],
    ['nicht gepinnte Nachbarversion', 'v1.2.3', VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_UNSUPPORTED],
  ])('lehnt eine v-Variante fail-closed ab: %s', (_label, declared, code) => {
    const { diagnostic } = expectFailure(
      dispatchOscalDocument(makeEnvelope('catalog', declared), context),
    );

    expect(diagnostic.code).toBe(code);
    expect(diagnostic.path).toBe('/catalog/metadata/oscal-version');
    // Weder der Dokumentwert noch eine geratene Nachbarzelle erscheint.
    expect(diagnostic.artifact.oscalVersion).toBeNull();
    expect(JSON.stringify(diagnostic)).not.toContain(declared);
  });

  it('meldet für v1.1.3 denselben Versionskontext wie für 1.1.3', () => {
    const prefixed = expectFailure(
      dispatchOscalDocument(makeEnvelope('mapping-collection', 'v1.1.3'), context),
    ).diagnostic;
    const plain = expectFailure(
      dispatchOscalDocument(makeEnvelope('mapping-collection', '1.1.3'), context),
    ).diagnostic;

    expect(prefixed.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_IMPOSSIBLE);
    expect(prefixed).toEqual(plain);
  });

  it('lehnt eine v-präfigierte Version mit widersprechender Schema-Direktive ab', () => {
    const source = makeEnvelope('catalog', 'v1.2.2', {
      $schema: buildSchemaId('catalog', '1.2.1'),
    });

    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.SCHEMA_DIRECTIVE_CONFLICT);
    expect(diagnostic.path).toBe('/$schema');
    expect(diagnostic.artifact.oscalVersion).toBe('1.2.2');
    expect(diagnostic.params.expected).toBe(buildSchemaId('catalog', '1.2.2'));
  });

  it.each(CLASS_1_CONTEXTS)('bindet Klasse 1 exakt und lehnt v1.2.2 ab ($trustClass)', (class1Context) => {
    const { diagnostic } = expectFailure(
      dispatchOscalDocument(makeEnvelope('catalog', 'v1.2.2'), class1Context),
    );

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.VERSION_MALFORMED);
    expect(diagnostic.path).toBe('/catalog/metadata/oscal-version');
    expect(diagnostic.artifact.oscalVersion).toBeNull();
    // Die exakte Form bindet unverändert.
    expect(dispatchOscalDocument(makeEnvelope('catalog', '1.2.2'), class1Context).ok).toBe(true);
  });
});

type Derive = (body: unknown, context: OscalDocumentContext) => {
  readonly diagnostics: readonly OscalDiagnostic[];
};

/**
 * Je Adapter ein Körper, der mindestens eine Diagnose auslöst: Profil und
 * Mapping fehlen Pflichtteile; eine Component Definition ohne `components` ist
 * gültig, deshalb trägt sie ein vorhandenes Nicht-Array.
 */
const ADAPTERS: ReadonlyArray<readonly [string, Derive, Record<string, unknown>]> = [
  ['component-definition', deriveComponentDefinition, { components: 'kein Array' }],
  ['profile', deriveProfile, {}],
  ['mapping-collection', deriveMappingCollection, {}],
];

function versionsIn(diagnostics: readonly OscalDiagnostic[]): Set<string | null> {
  return new Set(diagnostics.map((diagnostic) => diagnostic.artifact.oscalVersion));
}

describe.each(ADAPTERS)('%s — Versionskontext des Adapters', (_rootType, derive, invalidPart) => {
  function bodyWithVersion(oscalVersion: string): Record<string, unknown> {
    return { metadata: { title: 'Versionskontext', 'oscal-version': oscalVersion }, ...invalidPart };
  }

  it('meldet für v1.2.2 die gebundene Version 1.2.2 und lässt den Körper unverändert', () => {
    const body = bodyWithVersion('v1.2.2');
    const snapshot = structuredClone(body);

    const { diagnostics } = derive(body, context);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(versionsIn(diagnostics)).toEqual(new Set(['1.2.2']));
    expect(body).toEqual(snapshot);
  });

  it.each(['V1.2.2', 'vv1.2.2', 'v1.2', 'v1.2.3'])(
    'übernimmt %s nicht in den Diagnosekontext',
    (declared) => {
      const { diagnostics } = derive(bodyWithVersion(declared), context);

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(versionsIn(diagnostics)).toEqual(new Set([null]));
      expect(JSON.stringify(diagnostics)).not.toContain(declared);
    },
  );

  it.each(CLASS_1_CONTEXTS)('übernimmt v1.2.2 für Klasse 1 nicht ($trustClass)', (class1Context) => {
    const { diagnostics } = derive(bodyWithVersion('v1.2.2'), class1Context);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(versionsIn(diagnostics)).toEqual(new Set([null]));
    expect(versionsIn(derive(bodyWithVersion('1.2.2'), class1Context).diagnostics))
      .toEqual(new Set(['1.2.2']));
  });
});
