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
import { isWorkspaceStation, type WorkspaceStation } from '@/domain/workspaceStations';

export const CATALOG_ROUTE_PATTERN = '/katalog/:catalogKey';
export const GROUP_ROUTE_PATTERN = '/katalog/:catalogKey/:groupId';
export const CONTROL_ROUTE_PATTERN = '/katalog/:catalogKey/kontrolle/:altIdentifier';
export const VOCABULARY_DETAIL_ROUTE_PATTERN = '/vokabular/:namespaceId';

const VOCABULARY_INDEX_PATH = '/vokabular';

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

export function buildVocabularyIndexPath(): string {
  return VOCABULARY_INDEX_PATH;
}

export function buildVocabularyNamespacePath(routeId: string): string {
  return `${VOCABULARY_INDEX_PATH}/${routeId}`;
}

export function buildVocabularyEntryPath(
  routeId: string,
  value?: string,
): string {
  const namespacePath = buildVocabularyNamespacePath(routeId);

  if (value === undefined) {
    return namespacePath;
  }

  return `${namespacePath}?wert=${encodeURIComponent(value)}`;
}

// =============================================================================
// Arbeitsroutenraum (ADR-11 §2) — Bereich Informationsverbünde
//
// Arbeitsrouten tragen ausschließlich die vom Speicher vergebenen lokalen
// Identitäten (`verbundId`, `localId`, docs/PERSISTENCE.md §5) und einen
// Stationswert aus einer geschlossenen Menge. Dokumentinhalte, Namen und
// Dokument-UUIDs erreichen weder Pfad noch Query.
// =============================================================================

export const WORKSPACE_INDEX_PATH = '/informationsverbuende';
export const VERBUND_ROUTE_PATTERN = '/informationsverbuende/:verbundId';
export const STATION_ROUTE_PATTERN = '/informationsverbuende/:verbundId/station/:station';
export const WORKSPACE_DOCUMENT_ROUTE_PATTERN = '/informationsverbuende/:verbundId/dokument/:localId';

// Die Form, die `crypto.randomUUID()` im Speicher und die Backup-Prüfung vergeben.
const LOCAL_IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLocalIdentity(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_IDENTITY.test(value);
}

function assertLocalIdentity(value: string, label: string): void {
  if (!isLocalIdentity(value)) throw new Error(`${label} is not a local identity`);
}

/** Der Bereich zu einem Pfad: alles unterhalb des Arbeitsroutenraums gehört zu den Informationsverbünden. */
export type ProductArea = 'katalog' | 'informationsverbuende';

export function areaForPath(pathname: string): ProductArea {
  return pathname === WORKSPACE_INDEX_PATH || pathname.startsWith(`${WORKSPACE_INDEX_PATH}/`)
    ? 'informationsverbuende'
    : 'katalog';
}

export function buildWorkspaceIndexUrl(): string {
  return WORKSPACE_INDEX_PATH;
}

export function buildVerbundUrl(verbundId: string): string {
  assertLocalIdentity(verbundId, 'verbundId');
  return `${WORKSPACE_INDEX_PATH}/${verbundId}`;
}

export function buildStationUrl(verbundId: string, station: WorkspaceStation): string {
  if (!isWorkspaceStation(station)) throw new Error('station is not a workspace station');
  return `${buildVerbundUrl(verbundId)}/station/${station}`;
}

export function buildWorkspaceDocumentUrl(verbundId: string, localId: string): string {
  assertLocalIdentity(localId, 'localId');
  return `${buildVerbundUrl(verbundId)}/dokument/${localId}`;
}
