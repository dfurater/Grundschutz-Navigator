// =============================================================================
// Verlustfreier Dokumenteinstieg für Profile (GSPP-240)
//
// Dieselbe Aufteilung wie im Katalog- und im Component-Pfad:
// `oscalProfileAdapter.ts` leitet die Projektion aus dem Root-Körper ab, diese
// Datei hält `source`, Kontext und `view` als Dokument zusammen und führt den
// Root-Dispatch davor (ADR-2, GSPP-285).
//
// Sie ist auch der einzige Übergang nach Stufe 3: Die Schemazelle kommt aus dem
// Dispatch, nicht aus einer Modellkonstante. Das ist beim Profile nicht
// theoretisch — `import` und `merge` haben zwischen 1.1.3 und 1.2.1 ihre
// Struktur geändert, und derselbe Knoten ist unter der einen Version gültig und
// unter der anderen ein Befund.
// =============================================================================

import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  dispatchOscalDocumentOrThrow,
  OscalRootDispatchError,
  ROOT_DISPATCH_DIAGNOSTIC_CODES,
  ROOT_DISPATCH_STAGE,
  ROOT_DISPATCH_VALIDATOR,
} from '@/adapters/oscalRootDispatch';
import { deriveProfile } from '@/adapters/oscalProfileAdapter';
import { PROFILE_ROOT_TYPE } from '@/domain/profileModel';
import type { Profile } from '@/domain/profileModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaPin, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { validateAgainstPinnedSchema } from '@/domain/oscalSchemaValidation';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';

/**
 * Ein geparstes Profile-Dokument nach dem verlustfreien Vertrag.
 *
 * `source` ist die Wahrheit, `view` eine Projektion darauf. `pin` ist die in
 * Stufe 2 gewählte Matrixzelle und der einzige zulässige Eingang in Stufe 3.
 */
export interface ProfileDocument {
  readonly source: unknown;
  readonly context: OscalDocumentContext;
  readonly view: Profile;
  /** Die aus `metadata.oscal-version` gebundene Zelle — nie aus `$schema`. */
  readonly pin: OscalSchemaPin;
  readonly oscalVersion: PinnedOscalVersion;
  readonly artifactKey: string | null;
}

/**
 * Parst ein OSCAL-Profile-Dokument verlustfrei nach ADR-2.
 *
 * Der Root-Typ wird über den Dispatch bestimmt und nicht angenommen. Ein
 * schemawidriges Profil wird hier **nicht** abgewiesen: Die Projektion bleibt
 * verlustfrei, und die Schemaaussage trifft Stufe 3 (ADR-7).
 *
 * @throws OscalRootDispatchError wenn Root-Erkennung oder Versionsbindung
 *   fehlschlagen — dazu zählt eine nicht gepinnte `oscal-version`
 */
export function parseProfileDocument(
  source: unknown,
  context: OscalDocumentContext,
): ProfileDocument {
  const dispatch = dispatchOscalDocumentOrThrow(source, context);

  // Zweite Schranke neben dem Registry-Abgleich im Dispatch: Der greift nur bei
  // einem registrierten Upstream-Pfad. Dieser Einstieg liefert ein
  // `ProfileDocument` und darf keinen fremden Root durchreichen.
  if (dispatch.rootType !== PROFILE_ROOT_TYPE) {
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
        params: { expected: PROFILE_ROOT_TYPE, found: dispatch.rootType },
      }),
    );
  }

  return {
    source,
    context,
    view: deriveProfile(dispatch.body, context),
    pin: dispatch.pin,
    oscalVersion: dispatch.oscalVersion,
    artifactKey: dispatch.artifactKey,
  };
}

/**
 * Führt Stufe 3 für ein bereits geparstes Dokument aus.
 *
 * Der Schema-Pin kommt aus dem Dokument und damit aus
 * `getSchemaPin('profile', <deklarierte Version>)`. Es gibt keinen Rückfall auf
 * eine Nachbarversion und keine Modellversionskonstante: derselbe `import` mit
 * `include-all` **und** `include-controls` ist unter 1.1.3 gültig und ab 1.2.1
 * ein Schemabefund.
 */
export function validateProfileSchema(
  document: ProfileDocument,
): Promise<OscalSchemaValidationResult> {
  return validateAgainstPinnedSchema(document.source, document.pin, {
    artifactKey: document.artifactKey,
  });
}
