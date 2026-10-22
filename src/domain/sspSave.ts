// =============================================================================
// Explizites Speichern eines SSP: Root-UUID per-subject (GSPP-609)
//
// `system-security-plan/@uuid` bezeichnet dasselbe Subjekt über alle
// Revisionen; kein Schreibvorgang vergibt sie neu (docs/PERSISTENCE.md §5).
// `metadata.last-modified` ist der Zeitpunkt des Speicherns (§9): Ein
// Speichern mit geändertem Inhalt setzt ihn, ein Speichern ohne
// Inhaltsänderung, der Autosave und jede Serialisierung lassen ihn unverändert.
//
// Die Referenzprüfung liest die Diagnosen des SSP-Read-Models
// (`oscalSspAdapter.ts`): Eine `component-uuid` ohne Komponente verhindert
// jedes Speichern; eine unauflösbare `component-uuid`, `role-id` oder
// Party-UUID verhindert den Zustand `export-ready`.
// =============================================================================

import { parseSspDocument } from '@/adapters/oscalSspDocument';
import { SSP_ADAPTER_DIAGNOSTIC_CODES } from '@/adapters/oscalSspReaders';
import { documentBody, sameDocumentContent } from '@/domain/documentContent';
import { isJsonObject } from '@/domain/jsonGuards';

export function sameSspContent(a: unknown, b: unknown): boolean {
  return sameDocumentContent(a, b, 'system-security-plan');
}

/**
 * Die Quelle, die ein explizites Speichern schreibt. `changed: false` heißt:
 * Der Inhalt entspricht dem gespeicherten Stand, `last-modified` bleibt.
 */
export function commitSspSave(stored: unknown, working: unknown, lastModified: string): { source: unknown; changed: boolean } {
  if (sameSspContent(stored, working)) return { source: structuredClone(stored), changed: false };
  const next = structuredClone(working);
  const metadata = documentBody(next, 'system-security-plan')?.metadata;
  if (isJsonObject(metadata)) metadata['last-modified'] = lastModified;
  return { source: next, changed: true };
}

export interface SspReferenceFailure {
  readonly code: string;
  readonly path: string;
}

const SAVE_BLOCKERS: ReadonlySet<string> = new Set([SSP_ADAPTER_DIAGNOSTIC_CODES.COMPONENT_REFERENCE_UNRESOLVED]);

const READINESS_BLOCKERS: ReadonlySet<string> = new Set([
  SSP_ADAPTER_DIAGNOSTIC_CODES.COMPONENT_REFERENCE_UNRESOLVED,
  SSP_ADAPTER_DIAGNOSTIC_CODES.ROLE_REFERENCE_UNRESOLVED,
  SSP_ADAPTER_DIAGNOSTIC_CODES.PARTY_REFERENCE_UNRESOLVED,
  SSP_ADAPTER_DIAGNOSTIC_CODES.ROLE_ID_DUPLICATE,
  SSP_ADAPTER_DIAGNOSTIC_CODES.PARTY_UUID_DUPLICATE,
]);

function firstFailure(source: unknown, codes: ReadonlySet<string>): SspReferenceFailure | undefined {
  let diagnostics;
  try {
    diagnostics = parseSspDocument(source, { trustClass: 'class-2-local-user' }).view.diagnostics;
  } catch {
    // Ohne bindbare Version oder Root gibt es kein Read-Model; das Schema weist ab.
    return undefined;
  }
  const found = diagnostics.find((diagnostic) => codes.has(diagnostic.code));
  return found ? { code: found.code, path: found.path } : undefined;
}

/** Erste lokale `component-uuid` ohne Ziel; sie verhindert jedes Speichern. */
export function sspSaveBlocker(source: unknown): SspReferenceFailure | undefined {
  return firstFailure(source, SAVE_BLOCKERS);
}

/** Erste unauflösbare `component-uuid`, `role-id` oder Party-UUID oder ein mehrdeutiges Rollen- oder Parteiziel; sie verhindert `export-ready`. */
export function sspReadinessBlocker(source: unknown): SspReferenceFailure | undefined {
  return firstFailure(source, READINESS_BLOCKERS);
}
