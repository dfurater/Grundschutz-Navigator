// =============================================================================
// Navigationsvertrag (ADR-1) — kanonische Routen und URL-Builder
//
// Kanonische Control-URLs verwenden ausschließlich catalogKey + altIdentifier;
// catalogKey + controlId bleibt interne Referenzidentität (src/domain/controlRef.ts).
// Diese Builder und der strikt kataloggebundene Resolver sind der ausführbare
// Navigationsvertrag.
// =============================================================================

import { isCatalogKey } from '@/domain/sourceRegistry';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { Catalog, Control } from '@/domain/models';

export const CATALOG_ROUTE_PATTERN = '/katalog/:catalogKey';
export const GROUP_ROUTE_PATTERN = '/katalog/:catalogKey/:groupId';
export const CONTROL_ROUTE_PATTERN = '/katalog/:catalogKey/kontrolle/:altIdentifier';

function assertCatalogKey(catalogKey: CatalogKey): void {
  if (!isCatalogKey(catalogKey)) {
    throw new Error(`Unknown catalogKey for navigation: ${catalogKey}`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

export function buildCatalogUrl(catalogKey: CatalogKey): string {
  assertCatalogKey(catalogKey);
  return `/katalog/${encodeURIComponent(catalogKey)}`;
}

export function buildGroupUrl(catalogKey: CatalogKey, groupId: string): string {
  assertNonEmpty(groupId, 'groupId');
  return `${buildCatalogUrl(catalogKey)}/${encodeURIComponent(groupId)}`;
}

export function buildControlUrl(catalogKey: CatalogKey, altIdentifier: string): string {
  assertNonEmpty(altIdentifier, 'altIdentifier');
  return `${buildCatalogUrl(catalogKey)}/kontrolle/${encodeURIComponent(altIdentifier)}`;
}

/**
 * Build a canonical route from a parsed control without ever falling back to
 * its mutable OSCAL ID. Parsed catalogs guarantee the alt-identifier, but the
 * explicit guard keeps synthetic and partially constructed inputs fail-closed.
 */
export function buildControlUrlForControl(
  catalogKey: CatalogKey,
  control: Pick<Control, 'id' | 'altIdentifier'>,
): string {
  if (!control.altIdentifier) {
    throw new Error(
      `Cannot navigate to control "${control.id}" without an alt-identifier`,
    );
  }

  return buildControlUrl(catalogKey, control.altIdentifier);
}

/**
 * Resolve a canonical control route strictly inside the supplied catalog.
 * Deliberately no global index, control-ID fallback, redirect, or legacy path.
 */
export function resolveControlRoute(
  catalog: Pick<Catalog, 'catalogKey' | 'controlsByAltIdentifier'> | null,
  catalogKey: string | undefined,
  altIdentifier: string | undefined,
): Control | null {
  if (
    !catalog ||
    !catalogKey ||
    !altIdentifier ||
    !isCatalogKey(catalogKey) ||
    catalog.catalogKey !== catalogKey
  ) {
    return null;
  }

  return catalog.controlsByAltIdentifier.get(altIdentifier) ?? null;
}
