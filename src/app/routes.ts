// =============================================================================
// Navigationsvertrag (ADR-0001) — kanonische Routen und URL-Builder
//
// Kanonische Control-URLs verwenden ausschließlich catalogKey + altIdentifier;
// catalogKey + controlId bleibt interne Referenzidentität (src/domain/controlRef.ts).
// Der Routen-Cutover in AppShell erfolgt in GRU-235; bis dahin sind diese
// Builder der ausführbare Vertrag.
// =============================================================================

import { isCatalogKey } from '@/domain/sourceRegistry';
import type { CatalogKey } from '@/domain/sourceRegistry';

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
