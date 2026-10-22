// =============================================================================
// Explizites Speichern eines Profils: change-on-write (GSPP-292)
//
// `profile/@uuid` trägt `identifier-persistence="change-on-write"`, und
// `metadata.last-modified` ist der Zeitpunkt des Speicherns
// (docs/PERSISTENCE.md §9). Ein Speichern mit geändertem Inhalt vergibt
// deshalb eine neue Dokument-UUID und setzt `last-modified`; ein Speichern
// ohne Inhaltsänderung und jede reine Serialisierung lassen beide unverändert.
// Inhalt ist der Quellgraph ohne genau diese beiden Felder, unabhängig von der
// Reihenfolge der Objektschlüssel.
// =============================================================================

import { documentBody, sameDocumentContent } from '@/domain/documentContent';
import { isJsonObject } from '@/domain/jsonGuards';

function profileBody(source: unknown): ReturnType<typeof documentBody> {
  return documentBody(source, 'profile');
}

/** Gleichheit der Quellgraphen ohne `profile.uuid` und `profile.metadata.last-modified`. */
export function sameProfileContent(a: unknown, b: unknown): boolean {
  return sameDocumentContent(a, b, 'profile');
}

export interface ExplicitSaveStamp {
  readonly uuid: string;
  /** ISO 8601 mit Zeitzone. */
  readonly lastModified: string;
}

/**
 * Die Quelle, die ein explizites Speichern schreibt. `changed: false` heißt:
 * Der Inhalt entspricht dem gespeicherten Stand; Dokument-UUID und
 * `last-modified` bleiben, wie sie gespeichert sind.
 */
export function commitExplicitSave(stored: unknown, working: unknown, stamp: ExplicitSaveStamp): { source: unknown; changed: boolean } {
  if (sameProfileContent(stored, working)) return { source: structuredClone(stored), changed: false };
  const next = structuredClone(working);
  const profile = profileBody(next);
  if (!profile || !isJsonObject(profile.metadata)) return { source: next, changed: true };
  profile.uuid = stamp.uuid;
  profile.metadata['last-modified'] = stamp.lastModified;
  return { source: next, changed: true };
}

/**
 * Prüft einen Schreibvorgang gegen change-on-write: Hat sich der Inhalt
 * geändert, müssen Dokument-UUID und `last-modified` neu sein; ohne
 * Inhaltsänderung müssen beide gleich bleiben.
 */
export function respectsChangeOnWrite(previous: unknown, next: unknown): boolean {
  const before = profileBody(previous);
  const after = profileBody(next);
  if (!before || !after || !isJsonObject(before.metadata) || !isJsonObject(after.metadata)) return false;
  const uuidKept = before.uuid === after.uuid;
  const stampKept = before.metadata['last-modified'] === after.metadata['last-modified'];
  return sameProfileContent(previous, next) ? uuidKept && stampKept : !uuidKept && !stampKept;
}
