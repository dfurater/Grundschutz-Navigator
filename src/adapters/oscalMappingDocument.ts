// =============================================================================
// Verlustfreier Dokumenteinstieg für Mapping Collections (GSPP-245)
//
// Dieselbe Aufteilung wie im Katalog-, Component- und Profilpfad:
// `oscalMappingAdapter.ts` leitet die Projektion aus dem Root-Körper ab, diese
// Datei hält `source`, Kontext und `view` als Dokument zusammen und führt den
// Root-Dispatch davor (ADR-2, GSPP-285).
//
// Sie ist auch der einzige Übergang nach Stufe 3. Die Schemazelle kommt aus dem
// Dispatch und damit aus `metadata.oscal-version`, nie aus einer
// Modellkonstante — im Bestand deklarieren die beiden BSI-Mappings **zwei
// verschiedene** Versionen (1.2.1 und 1.2.2), und ein Mapping unterhalb von
// 1.2.0 ist keine Frage der Freigabe, sondern eine Unmöglichkeit: Das Modell
// existierte dort noch nicht (`oscalVersionMatrix.mjs`).
// =============================================================================

import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  dispatchOscalDocumentOrThrow,
  OscalRootDispatchError,
  ROOT_DISPATCH_DIAGNOSTIC_CODES,
  ROOT_DISPATCH_STAGE,
  ROOT_DISPATCH_VALIDATOR,
} from '@/adapters/oscalRootDispatch';
import { deriveMappingCollection } from '@/adapters/oscalMappingAdapter';
import { MAPPING_COLLECTION_ROOT_TYPE } from '@/domain/mappingModel';
import type { MappingCollection } from '@/domain/mappingModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaPin, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { validateAgainstPinnedSchema } from '@/domain/oscalSchemaValidation';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';

/**
 * Ein geparstes Mapping-Dokument nach dem verlustfreien Vertrag.
 *
 * `source` ist die Wahrheit, `view` eine Projektion darauf. `pin` ist die in
 * Stufe 2 gewählte Matrixzelle und der einzige zulässige Eingang in Stufe 3.
 */
export interface MappingDocument {
  readonly source: unknown;
  readonly context: OscalDocumentContext;
  readonly view: MappingCollection;
  /** Die aus `metadata.oscal-version` gebundene Zelle — nie aus `$schema`. */
  readonly pin: OscalSchemaPin;
  readonly oscalVersion: PinnedOscalVersion;
  readonly artifactKey: string | null;
}

/**
 * Parst eine OSCAL Mapping Collection verlustfrei nach ADR-2.
 *
 * Der Root-Typ wird über den Dispatch bestimmt und nicht angenommen. Ein
 * schemawidriges Dokument wird hier **nicht** abgewiesen: Die Projektion bleibt
 * verlustfrei, und die Schemaaussage trifft Stufe 3 (ADR-7). Genau das ist der
 * Fall des ISO-Mappings, dessen `provenance` zwei im Schema nicht vorgesehene
 * Felder trägt.
 *
 * @throws OscalRootDispatchError wenn Root-Erkennung oder Versionsbindung
 *   fehlschlagen — dazu zählen eine nicht gepinnte und eine für dieses Modell
 *   unmögliche `oscal-version`
 */
export function parseMappingDocument(
  source: unknown,
  context: OscalDocumentContext,
): MappingDocument {
  const dispatch = dispatchOscalDocumentOrThrow(source, context);

  // Zweite Schranke neben dem Registry-Abgleich im Dispatch: Der greift nur bei
  // einem registrierten Upstream-Pfad. Dieser Einstieg liefert ein
  // `MappingDocument` und darf keinen fremden Root durchreichen.
  if (dispatch.rootType !== MAPPING_COLLECTION_ROOT_TYPE) {
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
        params: { expected: MAPPING_COLLECTION_ROOT_TYPE, found: dispatch.rootType },
      }),
    );
  }

  return {
    source,
    context,
    view: deriveMappingCollection(dispatch.body, context),
    pin: dispatch.pin,
    oscalVersion: dispatch.oscalVersion,
    artifactKey: dispatch.artifactKey,
  };
}

/**
 * Führt Stufe 3 für ein bereits geparstes Dokument aus.
 *
 * Der Schema-Pin kommt aus dem Dokument und damit aus
 * `getSchemaPin('mapping-collection', <deklarierte Version>)`. Es gibt keinen
 * Rückfall auf eine Nachbarversion: Ein Mapping mit `oscal-version: "1.1.3"`
 * wird nicht gegen 1.2.1 geprüft, sondern schon im Dispatch als unmögliche
 * Kombination abgewiesen.
 */
export function validateMappingSchema(
  document: MappingDocument,
): Promise<OscalSchemaValidationResult> {
  return validateAgainstPinnedSchema(document.source, document.pin, {
    artifactKey: document.artifactKey,
  });
}
