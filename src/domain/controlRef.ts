// =============================================================================
// ControlRef — kataloggescopte interne Control-Identität (ADR-0001)
//
// `catalogKey + controlId` ist die OSCAL-/Referenzidentität für Lookups und
// Relationen. Kanonische URLs verwenden stattdessen catalogKey + altIdentifier
// (siehe src/app/routes.ts).
// =============================================================================

import type { Catalog, Control, ControlRef } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

export function makeControlRef(catalogKey: CatalogKey, controlId: string): ControlRef {
  return { catalogKey, controlId };
}

export function controlRefEquals(left: ControlRef, right: ControlRef): boolean {
  return left.catalogKey === right.catalogKey && left.controlId === right.controlId;
}

/** Stable string form for logging and map keys, e.g. "gspp:GC.1.1" */
export function formatControlRef(ref: ControlRef): string {
  return `${ref.catalogKey}:${ref.controlId}`;
}

/**
 * Resolve a control strictly within its catalog. Identical control ids in
 * different catalogs never collide because each catalog carries its own
 * controlsById map.
 */
export function resolveControlRef(
  catalogsByKey: ReadonlyMap<CatalogKey, Catalog>,
  ref: ControlRef,
): Control | null {
  return catalogsByKey.get(ref.catalogKey)?.controlsById.get(ref.controlId) ?? null;
}
