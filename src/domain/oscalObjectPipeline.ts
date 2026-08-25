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
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
  createClass2ByteLimitDiagnostic,
} from '@/domain/oscalImportContract';
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
 * Ergebnis des Belegdurchlaufs: ob jeder Container belegt ist und ob die
 * kumulierte Nutzlast innerhalb der Byte-Zulassungsgrenze bleibt.
 */
type ProvenanceVerdict = {
  readonly provenanced: boolean;
  readonly withinByteBudget: boolean;
};

/** Misst Strings in UTF-8-Bytes — derselben Einheit wie der Byteeintritt. */
const utf8Encoder = new TextEncoder();

/**
 * Prüft die Herkunft der Wurzel und aller Container in einem eigenen,
 * rein identitätsbasierten Durchlauf vor jeder Reflexion. Er läuft über
 * denselben gemeinsamen Helper wie die Registrierung am Byte-Eintrittspunkt
 * und kann sich von ihr deshalb nicht auseinanderleben; der frühe Abbruch
 * endet beim ersten Container ohne Beleg.
 *
 * Derselbe Lauf summiert eine Untergrenze der serialisierten UTF-8-Größe:
 * Schlüsselnamen von Objekten sowie String-, endliche Zahlen-, Boolean- und
 * null-Werte in exakt ihrer UTF-8-Bytegröße. Nicht gezählt wird alles, was
 * in der Serialisierung fehlt oder sie nur vergrößern kann — Arrayindizes
 * samt `length`, Symbol-Schlüssel samt Werten, Anführungszeichen, Trenner
 * und Escape-Erweiterungen; Accessor-Werte werden nie gelesen. Übersteigt
 * die Summe die Byte-Zulassungsgrenze, so hätte derselbe Inhalt auch den
 * öffentlichen Byteeintritt nicht passiert — Nachbeladung über den Wertpfad
 * umgeht die Importgröße damit nicht mehr (Greptile-Befund zu 6f39e72,
 * UTF-8-Parität zu cb5f960).
 */
function verifyProvenance(root: unknown): ProvenanceVerdict {
  let provenanced = true;
  let payloadBytes = 0;
  walkOwnContainers(root, (container) => {
    if (!isParserProducedRoot(container)) {
      provenanced = false;
      return false;
    }
    const isArray = Array.isArray(container);
    for (const key of Reflect.ownKeys(container)) {
      // Symbole erscheinen nicht in der Serialisierung; ihre Buchhaltung
      // überlässt die Diagnose der Strukturinvariante.
      if (typeof key !== 'string') continue;
      if (!isArray) payloadBytes += utf8Encoder.encode(key).length;

      const descriptor = Object.getOwnPropertyDescriptor(container, key);
      if (descriptor === undefined || !('value' in descriptor)) continue;
      const value: unknown = descriptor.value;
      if (typeof value === 'string') {
        payloadBytes += utf8Encoder.encode(value).length;
      } else if (typeof value === 'number') {
        payloadBytes += Number.isFinite(value) ? String(value).length : 4;
      } else if (typeof value === 'boolean') {
        payloadBytes += value ? 4 : 5;
      } else if (value === null) {
        payloadBytes += 4;
      }
    }
    return payloadBytes <= CLASS_2_IMPORT_LIMITS.maxBytes;
  });
  return { provenanced, withinByteBudget: payloadBytes <= CLASS_2_IMPORT_LIMITS.maxBytes };
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
  // scheitern hier bzw. an der anschließenden Invariantenprüfung. Für am
  // Byteeintritt belegte Wurzeln gilt zusätzlich dieselbe Importgrößengrenze
  // wie dort — Nachbeladung über den Wertpfad umgeht sie nicht.
  const admission = verifyProvenance(source);
  if (!admission.provenanced) {
    return { ok: false, diagnostic: createClass2UnprovenancedDiagnostic() };
  }
  if (
    typeof source === 'object' &&
    source !== null &&
    isParserProducedRoot(source) &&
    !admission.withinByteBudget
  ) {
    return { ok: false, diagnostic: createClass2ByteLimitDiagnostic() };
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
