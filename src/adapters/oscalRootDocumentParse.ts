// =============================================================================
// Gemeinsamer Dokumenteinstieg der Root-Modelladapter
//
// `dispatchRootDocumentOrThrow` führt den Root-Dispatch und die zweite
// Root-Typ-Schranke aus; `parseCatalogDocument` ruft es direkt.
// `parseProfileDocument`, `parseMappingDocument` und
// `parseComponentDefinitionDocument` laufen über `parseRootDocument`, das
// zusätzlich projiziert und `source`, Kontext, `view` und die im Dispatch
// gebundene Schemazelle zusammenhält (ADR-2, GSPP-285).
//
// Daneben liegt `openRootDerive`, der gemeinsame Auftakt jeder
// `derive…`-Funktion der drei Modellslices (GSPP-566). Die Stufe-3-Prüfung
// liegt bewusst nicht hier, sondern in `oscalRootDocumentSchema.ts`: Der
// Katalogpfad importiert dieses Modul und soll den Schema-Validator nicht
// mitladen.
// =============================================================================

import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  artifactKeyForContext,
  dispatchOscalDocumentOrThrow,
  OscalRootDispatchError,
  ROOT_DISPATCH_DIAGNOSTIC_CODES,
  ROOT_DISPATCH_STAGE,
  readPinnedOscalVersion,
  ROOT_DISPATCH_VALIDATOR,
} from '@/domain/oscalRootDispatch';
import type { OscalRootDispatchSuccess } from '@/domain/oscalRootDispatch';
import { isJsonObject, type JsonObject } from '@/domain/jsonGuards';
import type { OscalDocumentContext } from '@/domain/models';
import { createReferenceDocument } from '@/domain/referenceResolution';
import type { ReferenceDocument } from '@/domain/referenceResolution';
import type {
  OscalRootKey,
  OscalSchemaPin,
  PinnedOscalVersion,
} from '@/domain/oscalVersionMatrix';

/** Ein verlustfrei geparstes Root-Dokument: `source` ist die Wahrheit, `view` eine Projektion. */
export interface ParsedRootDocument<TView> {
  readonly source: unknown;
  readonly context: OscalDocumentContext;
  readonly view: TView;
  /** Die aus `metadata.oscal-version` gebundene Zelle — nie aus `$schema`. */
  readonly pin: OscalSchemaPin;
  readonly oscalVersion: PinnedOscalVersion;
  readonly artifactKey: string | null;
}

export interface RootDocumentParseOptions<TView> {
  /** Der einzige Root-Typ, den dieser Einstieg durchlässt. */
  readonly rootType: OscalRootKey;
  /** Leitet die Projektion aus dem Wurzelkörper (`dispatch.body`) ab. */
  readonly derive: (body: unknown) => TView;
}

/**
 * Führt den Root-Dispatch aus und lässt nur `rootType` durch.
 *
 * @throws OscalRootDispatchError wenn Root-Erkennung oder Versionsbindung
 *   fehlschlagen oder das Dokument einen anderen Root als `rootType` trägt
 */
export function dispatchRootDocumentOrThrow(
  source: unknown,
  context: OscalDocumentContext,
  rootType: OscalRootKey,
): OscalRootDispatchSuccess {
  const dispatch = dispatchOscalDocumentOrThrow(source, context);

  // Zweite Schranke neben dem Registry-Abgleich im Dispatch: Der greift nur bei
  // einem registrierten Upstream-Pfad. Ein Einstieg für ein bestimmtes Modell
  // darf keinen fremden Root durchreichen.
  if (dispatch.rootType !== rootType) {
    throw new OscalRootDispatchError(
      createOscalDiagnostic({
        code: ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_TYPE_MISMATCH,
        stage: ROOT_DISPATCH_STAGE,
        validator: ROOT_DISPATCH_VALIDATOR,
        path: '/',
        artifact: {
          key: dispatch.artifactKey,
          rootType: dispatch.rootType,
          oscalVersion: dispatch.oscalVersion,
        },
        params: { expected: rootType, found: dispatch.rootType },
      }),
    );
  }

  return dispatch;
}

/**
 * Parst ein OSCAL-Root-Dokument verlustfrei und projiziert es mit `derive`.
 *
 * @throws OscalRootDispatchError wenn Root-Erkennung oder Versionsbindung
 *   fehlschlagen oder das Dokument einen anderen Root als `rootType` trägt
 */
export function parseRootDocument<TView>(
  source: unknown,
  context: OscalDocumentContext,
  { rootType, derive }: RootDocumentParseOptions<TView>,
): ParsedRootDocument<TView> {
  const dispatch = dispatchRootDocumentOrThrow(source, context, rootType);

  return {
    source,
    context,
    view: derive(dispatch.body),
    pin: dispatch.pin,
    oscalVersion: dispatch.oscalVersion,
    artifactKey: dispatch.artifactKey,
  };
}

/** Der gemeinsame Ableitungskontext, mit dem jede `derive…`-Funktion beginnt. */
export interface RootDeriveFrame {
  /** Der Root-Körper, oder ein leeres Objekt, wenn er keines ist. */
  readonly rootBody: JsonObject;
  /**
   * `false`, wenn der Root-Körper kein Objekt ist. Die Diagnose dazu stellt
   * der Adapter selbst, mit seinem eigenen Code.
   */
  readonly bodyIsObject: boolean;
  readonly oscalVersion: PinnedOscalVersion | null;
  readonly artifactKey: string | null;
  readonly referenceDocument: ReferenceDocument;
}

/**
 * Baut den Auftakt einer Root-Ableitung: Version und Artefaktschlüssel nach
 * der Redaction-Regel sowie den Envelope für die Referenzschicht.
 *
 * @param body Der unveränderte Root-Körper aus dem Dispatch
 * @param context Ableitungskontext; trägt Vertrauensklasse und Upstream-Pfad
 * @param rootType Der Root-Typ, unter dem der Körper eingehüllt wird
 */
export function openRootDerive(
  body: unknown,
  context: OscalDocumentContext,
  rootType: OscalRootKey,
): RootDeriveFrame {
  const bodyIsObject = isJsonObject(body);
  const rootBody = bodyIsObject ? body : {};
  const oscalVersion = readPinnedOscalVersion(rootBody, context);
  return {
    rootBody,
    bodyIsObject,
    oscalVersion,
    artifactKey: artifactKeyForContext(context),
    // Der Referenzschicht wird der Envelope gereicht, den sie erwartet. Die
    // Hülle ist neu, der Körper bleibt dasselbe Objekt — es wird nichts kopiert
    // und nichts verändert.
    referenceDocument: createReferenceDocument({
      source: { [rootType]: rootBody },
      context,
      rootType,
      oscalVersion: oscalVersion ?? 'unknown',
    }),
  };
}
