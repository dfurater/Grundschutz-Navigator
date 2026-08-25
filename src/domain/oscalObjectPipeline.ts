// =============================================================================
// Gemeinsame, objektorientierte Klasse-2-Prüfkette (ADR-8 Festlegung 1)
//
// Der Schnitt verläuft zwischen Stufe 1 (Bytes) und Stufe 2 (Objekt): Alles,
// was auf dem geparsten Objekt arbeitet — Ressourcenlimits, Strukturinvariante,
// Root-Dispatch und Schemastufe — gilt für jedes Dokument unabhängig von seiner
// Entstehung und läuft durch genau diese exportierte Einheit.
//
// Herkunftsnachweis (ADR-8 Festlegung 3): Die Herkunft ist an den
// Byte-Eintrittspunkt gebunden. parseClass2OscalInput() führt Stufe 1 aus,
// parst und registriert dann Wurzel samt jedes Containers des Parse-Produkts;
// es gibt keinen importierbaren Weg, einen Beleg zu erzeugen. Die Kette prüft
// die Herkunft der Wurzel UND aller Container, bevor sie irgendetwas davon
// beobachtet. Der Ableitungsweg tritt mit Commit B über ein eigenes, ebenso
// geschlossen verwaltetes Handle-Register hier ein.
// =============================================================================

import { dispatchOscalDocument, type OscalRootDispatchSuccess } from '@/adapters/oscalRootDispatch';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportContract';
import { createClass2UnprovenancedDiagnostic } from '@/domain/oscalObjectProvenance';
import { isParserProducedRoot } from '@/domain/oscalImportProcessing';
import { walkOwnContainers } from '@/domain/oscalObjectWalk';
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
 * Prüft die Herkunft der Wurzel und aller Container in einem eigenen,
 * rein identitätsbasierten Durchlauf vor jeder Reflexion. Er läuft über
 * denselben gemeinsamen Helper wie die Registrierung am Byte-Eintrittspunkt
 * und kann sich von ihr deshalb nicht auseinanderleben; der frühe Abbruch
 * endet beim ersten Container ohne Beleg.
 */
function verifyProvenance(root: unknown): boolean {
  // Derselbe Durchlauf wie bei der Registrierung (gemeinsamer Helper); der
  // frühe Abbruch endet beim ersten Container ohne Beleg.
  let allProvenanced = true;
  walkOwnContainers(root, (container) => {
    const provenanced = isParserProducedRoot(container);
    if (!provenanced) allProvenanced = false;
    return provenanced;
  });
  return allProvenanced;
}

/**
 * Gemeinsame objektorientierte Prüfkette: Ein Wert mit belegter Herkunft plus
 * Kontext durchlaufen in dieser Reihenfolge Herkunftsprüfung (Wurzel und jeder
 * Container), Strukturinvariante samt Ressourcenlimits (ein Durchlauf),
 * `dispatchOscalDocument()` und die gepinnte Schemastufe. Es entsteht bewusst
 * keine zweite Root-, Versions-, Limit- oder Referenzlogik.
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

  // Herkunft vor Reflexion: Wurzel und jeder Container müssen belegt sein.
  // Rohobjekte, Proxy-Hüllen, eingetauschte Teilbäume und Accessor-Einschübe
  // scheitern hier bzw. an der anschließenden Invariantenprüfung.
  if (!verifyProvenance(source)) {
    return { ok: false, diagnostic: createClass2UnprovenancedDiagnostic() };
  }

  const structuralFailure = enforceClass2ObjectGraphInvariants(source);
  if (structuralFailure !== null) {
    return { ok: false, diagnostic: structuralFailure };
  }

  const dispatch = dispatchOscalDocument(source, context);
  if (!dispatch.ok) return dispatch;

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
