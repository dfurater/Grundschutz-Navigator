// =============================================================================
// Gemeinsame, objektorientierte Klasse-2-Prüfkette (ADR-8 Festlegung 1)
//
// Der Schnitt verläuft zwischen Stufe 1 (Bytes) und Stufe 2 (Objekt): Alles,
// was auf dem geparsten Objekt arbeitet — Ressourcenlimits, Strukturinvariante,
// Root-Dispatch und Schemastufe — gilt für jedes Dokument unabhängig von seiner
// Entstehung und läuft durch genau diese exportierte Einheit. Der Byte-Eintrittspunkt
// (`processClass2OscalBytes`) ruft sie mit dem unmittelbaren Ergebnis seines eigenen
// `JSON.parse` auf; der Ableitungsweg tritt ausschließlich über ein privat
// registriertes `DerivedJsonTree`-Handle hier ein (GSPP-291 Commit B).
// =============================================================================

import { dispatchOscalDocument, type OscalRootDispatchSuccess } from '@/adapters/oscalRootDispatch';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportContract';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { validateAgainstPinnedSchema } from '@/domain/oscalSchemaValidation';
import type { OscalDocumentContext } from '@/domain/models';

/**
 * Kontext der gemeinsamen Kette: Die Vertrauensklasse ist auf Klasse 2
 * festgelegt und wird entgegengenommen, nie aus dem Dokument abgeleitet
 * (ADR-2 §10, ADR-8 Festlegung 5).
 */
export type Class2ObjectPipelineContext = Omit<OscalDocumentContext, 'trustClass'> & {
  readonly trustClass: 'class-2-local-user';
};

export interface Class2OscalValueDocument {
  readonly source: unknown;
  readonly context: Class2ObjectPipelineContext;
  readonly rootType: OscalRootDispatchSuccess['rootType'];
  readonly oscalVersion: OscalRootDispatchSuccess['oscalVersion'];
}

export type Class2OscalValueResult =
  | { readonly ok: true; readonly document: Class2OscalValueDocument }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

/**
 * Gemeinsame objektorientierte Prüfkette: Ein geparster Wert plus Kontext
 * durchlaufen in dieser Reihenfolge Strukturinvariante samt Ressourcenlimits
 * (ein Durchlauf), `dispatchOscalDocument()` und die gepinnte Schemastufe.
 * Es entsteht bewusst keine zweite Root-, Versions-, Limit- oder Referenzlogik.
 *
 * `async`, weil die Schemastufe die Schema-Zelle als eigenen Chunk nachlädt.
 */
export async function processClass2OscalValue(
  source: unknown,
  context: Class2ObjectPipelineContext,
): Promise<Class2OscalValueResult> {
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

  const structuralFailure = enforceClass2ObjectGraphInvariants(source);
  if (structuralFailure !== null) {
    return { ok: false, diagnostic: structuralFailure };
  }

  const dispatch = dispatchOscalDocument(source, context);
  if (!dispatch.ok) return dispatch;

  // Die Schemastufe läuft ausschließlich mit der vom Dispatch gelieferten
  // Zelle; eine nicht existierende Zelle hat den Dispatch bereits fail-closed
  // beendet und erreicht diese Stelle nie.
  const schema = await validateAgainstPinnedSchema(dispatch.source, dispatch.pin, {
    artifactKey: dispatch.artifactKey,
  });
  if (!schema.ok) return schema;

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
