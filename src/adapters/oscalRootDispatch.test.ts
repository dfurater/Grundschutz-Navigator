// =============================================================================
// Negativkorpus und Diagnosevertrag der Root-Erkennung (GSPP-285)
//
// Geprüft wird Stufe 2 aus docs/OSCAL_VALIDATION.md: fail-closed abweisen statt
// bestmöglich deuten, und dabei nichts Unvertrauenswürdiges in die Diagnose
// schreiben. Der registry-getriebene Positivkorpus liegt in
// `oscalRootDispatch.corpus.test.ts`.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  dispatchOscalDocument,
  dispatchOscalDocumentOrThrow,
  OscalRootDispatchError,
  ROOT_DISPATCH_DIAGNOSTIC_CODES,
  ROOT_DISPATCH_VALIDATOR,
} from './oscalRootDispatch';
import type { OscalRootDispatchFailure } from './oscalRootDispatch';
import type { OscalDocumentContext } from '@/domain/models';
import { buildSchemaId, VERSION_MATRIX_DIAGNOSTIC_CODES } from '@/domain/oscalVersionMatrix';
import { makeOscalEnvelope as makeEnvelope } from '@/test/fixtures/oscalEnvelope';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };

function expectFailure(result: ReturnType<typeof dispatchOscalDocument>): OscalRootDispatchFailure {
  expect(result.ok).toBe(false);
  return result as OscalRootDispatchFailure;
}

/* ------------------------------------------------------------------ */
/*  Root-Erkennung, fail-closed                                        */
/* ------------------------------------------------------------------ */

describe('dispatchOscalDocument — Top-Level', () => {
  it.each([
    ['null', null],
    ['Array', [{ catalog: {} }]],
    ['String', '{"catalog":{}}'],
    ['Zahl', 42],
    ['undefined', undefined],
  ])('lehnt ein Top-Level ab, das kein JSON-Objekt ist: %s', (_label, source) => {
    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    expect(diagnostic.code).toBe(ROOT_DISPATCH_DIAGNOSTIC_CODES.DOCUMENT_NOT_OBJECT);
    expect(diagnostic.path).toBe('/');
  });

  it('lehnt ein Dokument ohne Root-Key ab', () => {
    const { diagnostic } = expectFailure(dispatchOscalDocument({}, context));

    expect(diagnostic.code).toBe(ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_KEY_MISSING);
  });

  it('lehnt ein Dokument ab, das nur die Schema-Direktive trägt', () => {
    const source = { $schema: buildSchemaId('catalog', '1.1.3') };

    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    expect(diagnostic.code).toBe(ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_KEY_MISSING);
  });

  it('lehnt mehrere Root-Keys ab, auch wenn einer davon catalog ist', () => {
    const source = {
      ...makeEnvelope('catalog', '1.1.3'),
      ...makeEnvelope('profile', '1.1.3'),
    };

    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    expect(diagnostic.code).toBe(ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_KEY_AMBIGUOUS);
    expect(diagnostic.params).toEqual({ rootKeyCount: 2 });
  });

  it('lehnt einen unbekannten Root-Key ab und deutet ihn nie als Katalog', () => {
    const source = makeEnvelope('geheimes-modell', '1.1.3');

    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_TYPE_UNKNOWN);
    expect(diagnostic.artifact.rootType).toBeNull();
  });

  it('toleriert eine passende Schema-Direktive als zusätzliche Property', () => {
    const source = makeEnvelope('catalog', '1.1.3', {
      $schema: buildSchemaId('catalog', '1.1.3'),
    });

    const result = dispatchOscalDocument(source, context);

    expect(result.ok).toBe(true);
    expect(result.ok && result.rootType).toBe('catalog');
  });
});

/* ------------------------------------------------------------------ */
/*  Versionsbindung                                                    */
/* ------------------------------------------------------------------ */

describe('dispatchOscalDocument — Versionsbindung', () => {
  it('bindet Root und Version gemeinsam an den gepinnten Schema-Vertrag', () => {
    const result = dispatchOscalDocument(makeEnvelope('catalog', '1.1.3'), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.oscalVersion).toBe('1.1.3');
    expect(result.pin.schemaId).toBe(buildSchemaId('catalog', '1.1.3'));
    expect(result.pin.vendorPath).toContain('v1.1.3');
  });

  it('lehnt mapping-collection unter 1.2.0 als unmöglich ab', () => {
    const { diagnostic } = expectFailure(
      dispatchOscalDocument(makeEnvelope('mapping-collection', '1.1.3'), context),
    );

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_IMPOSSIBLE);
    expect(diagnostic.code).not.toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_UNSUPPORTED);
    expect(diagnostic.params.expected).toBe('>= 1.2.0');
    // 1.1.3 ist Mitglied von PINNED_OSCAL_VERSIONS — kein Dokumentwert, sondern
    // eine projekteigene Konstante, die die Redaction-Regel nicht betrifft.
    expect(diagnostic.artifact.oscalVersion).toBe('1.1.3');
  });

  it('redigiert eine nicht gepinnte Version bei einer unmöglichen Kombination', () => {
    const { diagnostic } = expectFailure(
      dispatchOscalDocument(makeEnvelope('mapping-collection', '0.5.0'), context),
    );

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_IMPOSSIBLE);
    expect(diagnostic.artifact.oscalVersion).toBeNull();
    expect(JSON.stringify(diagnostic)).not.toContain('0.5.0');
  });

  it('unterscheidet die nicht gepinnte Version von der unmöglichen Kombination', () => {
    const { diagnostic } = expectFailure(
      dispatchOscalDocument(makeEnvelope('catalog', '1.0.4'), context),
    );

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_UNSUPPORTED);
  });

  it('reicht eine nicht gepinnte oscal-version nie roh in die Diagnose durch', () => {
    // Belegt exakt das im Review genannte Beispiel: syntaktisch gültig gegen
    // die Versionsform, aber kein Mitglied von PINNED_OSCAL_VERSIONS.
    const rawVersion = '123456789012345678901234567890.0.0';
    const { diagnostic } = expectFailure(
      dispatchOscalDocument(makeEnvelope('catalog', rawVersion), context),
    );

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_UNSUPPORTED);
    expect(diagnostic.artifact.oscalVersion).toBeNull();
    expect(JSON.stringify(diagnostic)).not.toContain(rawVersion);
  });

  it.each([
    ['Root-Körper ist null', { catalog: null }],
    ['Root-Körper ist ein String', { catalog: 'Anwenderkatalog' }],
    ['fehlendes metadata', { catalog: { uuid: 'x' } }],
    ['metadata ist kein Objekt', { catalog: { uuid: 'x', metadata: '1.1.3' } }],
    ['fehlende oscal-version', { catalog: { uuid: 'x', metadata: { title: 'T' } } }],
    ['nicht-String als Version', { catalog: { metadata: { 'oscal-version': 113 } } }],
  ])('lehnt ein Dokument ohne verwertbare oscal-version ab: %s', (_label, source) => {
    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.VERSION_MISSING);
    expect(diagnostic.path).toBe('/catalog/metadata/oscal-version');
  });

  it('lehnt eine fehlgeformte oscal-version ab, ohne sie auszugeben', () => {
    const { diagnostic } = expectFailure(
      dispatchOscalDocument(makeEnvelope('catalog', '1.1.3-BSI-Sonderfassung'), context),
    );

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.VERSION_MALFORMED);
    expect(diagnostic.artifact.oscalVersion).toBeNull();
  });

  it('lehnt eine widersprüchliche Schema-Direktive ab', () => {
    const source = makeEnvelope('catalog', '1.1.3', {
      $schema: buildSchemaId('catalog', '1.2.2'),
    });

    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    expect(diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.SCHEMA_DIRECTIVE_CONFLICT);
    expect(diagnostic.path).toBe('/$schema');
    expect(diagnostic.params.expected).toBe(buildSchemaId('catalog', '1.1.3'));
  });
});

/* ------------------------------------------------------------------ */
/*  Kontext, Diagnosevertrag und Redaction                             */
/* ------------------------------------------------------------------ */

describe('dispatchOscalDocument — Kontext und Diagnosevertrag', () => {
  it('führt die Vertrauensklasse unverändert mit und leitet sie nie ab', () => {
    const localContext: OscalDocumentContext = { trustClass: 'class-2-local-user' };
    const source = makeEnvelope('catalog', '1.1.3', { trustClass: undefined });
    delete source.trustClass;

    const result = dispatchOscalDocument(source, localContext);

    expect(result.ok).toBe(true);
    expect(result.ok && result.context.trustClass).toBe('class-2-local-user');
    expect(result.ok && result.context).toBe(localContext);
  });

  it('erfüllt das Pflichtfeldschema des Diagnostic-Vertrags', () => {
    const { diagnostic } = expectFailure(dispatchOscalDocument({}, context));

    expect(diagnostic).toMatchObject({
      code: ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_KEY_MISSING,
      severity: 'error',
      stage: 'root-dispatch',
      path: '/',
      messageKey: 'oscal.rootDispatch.rootKeyMissing',
      validator: ROOT_DISPATCH_VALIDATOR,
    });
    expect(diagnostic.signature).toBe(
      `${ROOT_DISPATCH_VALIDATOR.name}@${ROOT_DISPATCH_VALIDATOR.version}|OSCAL_ROOT_KEY_MISSING|/`,
    );
    expect(diagnostic.artifact).toEqual({ key: null, rootType: null, oscalVersion: null });
  });

  it('gibt weder den unbekannten Root-Key noch Dokumentwerte im Klartext aus', () => {
    const source = {
      'geheimes-modell': {
        metadata: {
          title: 'STRENG-VERTRAULICH',
          'oscal-version': '1.1.3',
        },
      },
    };

    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain('geheimes-modell');
    expect(serialized).not.toContain('STRENG-VERTRAULICH');
  });

  it('nennt bei mehreren Root-Keys nur die Anzahl, nicht die Keys', () => {
    const source = {
      ...makeEnvelope('catalog', '1.1.3'),
      'schatten-modell': { metadata: { 'oscal-version': '1.1.3' } },
    };

    const { diagnostic } = expectFailure(dispatchOscalDocument(source, context));

    expect(JSON.stringify(diagnostic)).not.toContain('schatten-modell');
  });
});

describe('dispatchOscalDocumentOrThrow', () => {
  it('wirft einen Fehler, dessen Meldung nur den stabilen Code nennt', () => {
    let thrown: unknown;
    try {
      dispatchOscalDocumentOrThrow(makeEnvelope('geheimes-modell', '1.1.3'), context);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OscalRootDispatchError);
    const error = thrown as OscalRootDispatchError;
    expect(error.message).toContain(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_TYPE_UNKNOWN);
    expect(error.message).not.toContain('geheimes-modell');
    expect(error.diagnostic.stage).toBe('root-dispatch');
  });

  it('reicht das Erfolgsergebnis unverändert durch', () => {
    const source = makeEnvelope('catalog', '1.1.3');

    const result = dispatchOscalDocumentOrThrow(source, context);

    expect(result.source).toBe(source);
    expect(result.body).toBe(source.catalog);
  });
});
