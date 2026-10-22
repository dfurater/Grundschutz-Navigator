// =============================================================================
// Beobachtungsreferenzen des Evidenz-Read-Models (GSPP-297)
//
// In Assessment Results ist `observation-uuid` dokumentintern — der Kontext
// darf ein fehlendes Ziel nicht verdecken. Im POA&M ist sie eine fachliche
// UUID-Übernahme aus den ausdrücklich gebundenen Assessment Results; fehlende,
// mehrdeutige und typfalsche Ziele werden getrennt gemeldet.
// =============================================================================

import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import type { EvidenceRootType, UuidReference, UuidReferenceState } from '@/domain/evidenceReadModel';

export interface ObjectAt {
  readonly node: JsonObject;
  readonly path: string;
}

export function objectsAt(parent: JsonObject, key: string, path: string): ObjectAt[] {
  return readArray(parent[key]).flatMap((node, index) =>
    isJsonObject(node) ? [{ node, path: `${path}/${key}/${index}` }] : [],
  );
}

/** OSCAL-UUIDs erlauben beide Schreibweisen der Hexziffern. */
export function lowerCaseSet(uuids: Iterable<string>): ReadonlySet<string> {
  return new Set(Array.from(uuids, (uuid) => uuid.toLowerCase()));
}

/** `missingCode` gesetzt: das Ziel muss im Dokument liegen, sein Fehlen ist ein Datenbefund. */
export function classifyLocalReference(
  uuid: string,
  path: string,
  local: ReadonlySet<string>,
  context: ReadonlySet<string>,
  missingCode: string | null,
  diagnose: (code: string, path: string) => void,
): UuidReferenceState {
  const key = uuid.toLowerCase();
  if (local.has(key)) return 'resolved';
  if (context.has(key)) return 'resolved-in-context';
  if (missingCode === null) return 'not-resolvable-in-context';
  diagnose(missingCode, path);
  return 'missing-in-document';
}

export interface ObservationReferenceParams {
  readonly rootType: EvidenceRootType;
  /** In AR liegen die Beobachtungsbezugsstellen je `result`; im POA&M am Root. */
  readonly containers: ReadonlyArray<ObjectAt>;
  /** Normalisierte Trefferzahlen der Beobachtungs-UUIDs im Dokument. */
  readonly observationCounts: ReadonlyMap<string, number>;
  /** Beobachtungs-UUIDs des Dokuments. */
  readonly observationUuids: ReadonlySet<string>;
  /** Ressourcen-UUIDs des Dokuments (Back-Matter). */
  readonly resourceUuids: ReadonlySet<string>;
  /** Normalisierte Häufigkeiten aller lokalen UUID-Identitäten für typisierte POA&M-Verweise. */
  readonly documentUuidCounts?: ReadonlyMap<string, number>;
  /** Typisierte AR-Trefferzahlen mit explizitem Bindungszustand. */
  readonly observationContext?: { readonly counts: ReadonlyMap<string, number>, readonly available: boolean };
  /** UUIDs, die der Aufrufer aus anderen Workspace-Dokumenten bereitstellt. */
  readonly contextUuids: ReadonlySet<string>;
  /** Diagnosecode für ein im Dokument fehlendes AR-Beobachtungsziel. */
  readonly missingObservationCode: string;
  readonly diagnose: (code: string, path: string) => void;
}

/** Liest alle `related-observations`-Verweise der Risiken, Findings und POA&M-Items und klassifiziert sie. */
export function deriveObservationReferences(params: ObservationReferenceParams): UuidReference[] {
  const isAssessmentResults = params.rootType === 'assessment-results';
  const contextCounts = new Map<string, number>();
  for (const [uuid, count] of params.observationContext?.counts ?? []) {
    const key = uuid.toLowerCase();
    contextCounts.set(key, (contextCounts.get(key) ?? 0) + count);
  }
  const observationContext = isAssessmentResults
    ? new Set<string>()
    : lowerCaseSet(params.observationContext?.counts.keys() ?? params.contextUuids);
  // Lokale Nicht-Beobachtungs-UUIDs belegen einen POA&M-Verweis als Typfehler, bevor der AR-Kontext ihn füttert.
  const nonObservationUuids = lowerCaseSet([
    ...params.resourceUuids,
    ...params.containers.flatMap(({ node, path }) => ['risks', 'findings', 'poam-items'].flatMap((key) => objectsAt(node, key, path).flatMap(({ node: item }) => readString(item.uuid) ?? []))),
    ...(params.observationContext === undefined ? [] : [...params.contextUuids].filter((uuid) => !observationContext.has(uuid))),
  ]);
  const resolveLocal = (uuid: string, path: string): UuidReferenceState =>
    classifyLocalReference(
      uuid,
      path,
      params.observationUuids,
      observationContext,
      isAssessmentResults ? params.missingObservationCode : null,
      params.diagnose,
    );
  const referrerKeys = isAssessmentResults ? ['findings', 'risks'] : ['poam-items', 'findings', 'risks'];
  return params.containers.flatMap((container) =>
    referrerKeys.flatMap((key) =>
      objectsAt(container.node, key, container.path).flatMap((referrer) =>
        objectsAt(referrer.node, 'related-observations', referrer.path).flatMap(({ node, path }): UuidReference[] => {
          const uuid = readString(node['observation-uuid']);
          if (uuid === undefined) return [];
          const uuidPath = `${path}/observation-uuid`;
          const key = uuid.toLowerCase();
          if ((params.documentUuidCounts?.get(key) ?? params.observationCounts.get(key) ?? 0) > 1) {
            params.diagnose('OSCAL_EVIDENCE_OBSERVATION_AMBIGUOUS', uuidPath);
            return [{ path: uuidPath, uuid, state: 'ambiguous-in-document' }];
          }
          if (!isAssessmentResults && !params.observationUuids.has(key) && (nonObservationUuids.has(key) || params.documentUuidCounts?.has(key))) {
            params.diagnose('OSCAL_EVIDENCE_OBSERVATION_TYPE_MISMATCH', uuidPath);
            return [{ path: uuidPath, uuid, state: 'type-mismatch' }];
          }
          if (!isAssessmentResults && !params.observationUuids.has(key) && params.observationContext?.available === true) {
            const count = contextCounts.get(key) ?? 0;
            if (count === 1) return [{ path: uuidPath, uuid, state: 'resolved-in-context' }];
            const ambiguous = count > 1;
            params.diagnose(ambiguous ? 'OSCAL_EVIDENCE_OBSERVATION_AMBIGUOUS_IN_CONTEXT' : 'OSCAL_EVIDENCE_OBSERVATION_NOT_FOUND_IN_CONTEXT', uuidPath);
            return [{ path: uuidPath, uuid, state: ambiguous ? 'ambiguous-in-context' : 'missing-in-context' }];
          }
          return [{ path: uuidPath, uuid, state: resolveLocal(uuid, uuidPath) }];
        }),
      ),
    ),
  );
}
