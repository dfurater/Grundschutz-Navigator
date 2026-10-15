// =============================================================================
// Gemeinsamer Dokumenteinstieg der Root-Modelladapter
//
// `dispatchRootDocumentOrThrow` führt den Root-Dispatch und die zweite
// Root-Typ-Schranke aus; `parseCatalogDocument` ruft es direkt.
// `parseProfileDocument`, `parseMappingDocument` und
// `parseComponentDefinitionDocument` laufen über `parseRootDocument`, das
// zusätzlich projiziert und `source`, Kontext, `view` und die im Dispatch
// gebundene Schemazelle zusammenhält (ADR-2, GSPP-285).
// =============================================================================

import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  dispatchOscalDocumentOrThrow,
  OscalRootDispatchError,
  ROOT_DISPATCH_DIAGNOSTIC_CODES,
  ROOT_DISPATCH_STAGE,
  ROOT_DISPATCH_VALIDATOR,
} from '@/adapters/oscalRootDispatch';
import type { OscalRootDispatchSuccess } from '@/adapters/oscalRootDispatch';
import type { OscalDocumentContext } from '@/domain/models';
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
