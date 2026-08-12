import {
  dispatchOscalDocument,
  type OscalRootDispatchSuccess,
} from '@/adapters/oscalRootDispatch';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  parseClass2OscalInput,
  CLASS_2_IMPORT_VALIDATOR,
} from '@/domain/oscalImportProcessing';
import type { OscalDocumentContext } from '@/domain/models';

export type Class2OscalDocumentContext = Omit<OscalDocumentContext, 'trustClass'> & {
  readonly trustClass: 'class-2-local-user';
};

export interface Class2OscalImportedDocument {
  readonly source: unknown;
  readonly context: Class2OscalDocumentContext;
  readonly rootType: OscalRootDispatchSuccess['rootType'];
  readonly oscalVersion: OscalRootDispatchSuccess['oscalVersion'];
}

export type Class2OscalImportResult =
  | { readonly ok: true; readonly document: Class2OscalImportedDocument }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

/**
 * Worker-interne Pipeline für Klasse-2-Bytes. Der öffentliche Einstieg bleibt
 * `importClass2OscalDocument()` im Adapter; diese Funktion ist für den
 * Worker und deterministische Unit-Tests ausgelagert.
 */
export function processClass2OscalBytes(
  bytes: Uint8Array,
  context: Class2OscalDocumentContext,
): Class2OscalImportResult {
  if (context.trustClass !== 'class-2-local-user') {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_IMPORT_CONTEXT_INVALID',
        stage: 'domain',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: '/',
      }),
    };
  }

  const input = parseClass2OscalInput(bytes);
  if (!input.ok) return input;

  const dispatch = dispatchOscalDocument(input.source, context);
  if (!dispatch.ok) return dispatch;

  return {
    ok: true,
    document: {
      source: dispatch.source,
      context,
      rootType: dispatch.rootType,
      oscalVersion: dispatch.oscalVersion,
    },
  };
}
