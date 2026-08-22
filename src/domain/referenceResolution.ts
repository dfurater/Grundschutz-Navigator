// =============================================================================
// OSCAL-Referenzauflösung (GSPP-286)
//
// Diese Schicht klassifiziert Referenzen ausschließlich gegen einen expliziten
// Dokument- und Katalogkontext. Sie führt weder Netzwerk- noch Dateizugriffe
// aus und wertet eingebettete base64-Nutzlasten nicht aus.
// =============================================================================

import { makeControlRef, resolveControlRef } from '@/domain/controlRef';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type {
  Catalog,
  CatalogDocumentContext,
  Control,
  ControlLink,
  LinkRelationStatus,
  OscalDocumentContext,
} from '@/domain/models';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { CatalogKey } from '@/domain/sourceRegistry';

export const REFERENCE_RESOLUTION_VALIDATOR = Object.freeze({
  name: 'reference-resolution',
  version: '1',
});

/**
 * Das Catalog-Modell dokumentiert ausschließlich `reference`; sein
 * Token-Vokabular bleibt dennoch offen und `rel` ist optional.
 */
export function classifyCatalogLinkRelation(
  rel: string | undefined,
): LinkRelationStatus {
  if (rel === undefined) return 'missing';
  return rel === 'reference' ? 'documented' : 'custom';
}

const PROVENANCE_LINK_RELATIONS = new Set(['source-profile', 'source-profile-uuid']);

export interface ReferenceDocument {
  readonly source: unknown;
  /**
   * Nur die vom Resolver tatsächlich benötigten, vom Aufrufer bereitgestellten
   * Kontextwerte. Ein Adapter darf keine Vertrauensklasse erfinden, wenn er
   * lediglich eine interne Control-Projektion ableitet.
   */
  readonly context: Partial<OscalDocumentContext>;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
}

export function createReferenceDocument(input: ReferenceDocument): ReferenceDocument {
  return Object.freeze({ ...input, context: Object.freeze({ ...input.context }) });
}

export interface OscalReferenceInput {
  readonly href: string;
  readonly path: string;
  readonly rel?: string;
  readonly text?: string;
  readonly resourceFragment?: string;
}

export interface ReferenceResolutionContext {
  readonly document: ReferenceDocument;
  readonly catalogsByKey?: ReadonlyMap<CatalogKey, Catalog>;
  /**
   * Explizit bereitgestellte Dokumente, adressiert mit dem unveränderten href.
   * Es gibt bewusst keine Pfadnormalisierung oder Verzeichnisauflösung.
   */
  readonly documentsByHref?: ReadonlyMap<string, ReferenceDocument>;
}

interface IndexedResource {
  readonly resource: JsonObject;
  readonly index: number;
}

interface ResourceIndex {
  readonly entries: readonly IndexedResource[];
  readonly byUuid: ReadonlyMap<string, IndexedResource>;
}

interface PreparedReferenceResolutionContext extends ReferenceResolutionContext {
  readonly resourceIndex: ResourceIndex;
  readonly resourceIndexes: Map<ReferenceDocument, ResourceIndex>;
}

export interface ResolvedResourceLink {
  readonly href: string;
  readonly mediaType?: string;
  readonly hashes: readonly { readonly algorithm: string; readonly value: string }[];
  readonly integrity: 'declared' | 'missing';
  readonly target: {
    readonly kind: 'external' | 'resource' | 'unresolved';
    readonly href?: string;
    readonly resourceUuid?: string;
    readonly reason?: UnresolvedReferenceReason;
    readonly diagnostic?: OscalDiagnostic;
  };
}

export interface ResolvedResource {
  readonly uuid: string;
  readonly title?: string;
  readonly description?: string;
  readonly citation?: string;
  readonly rlinks: readonly ResolvedResourceLink[];
  /** Nur Metadaten; die base64-Nutzlast wird nie gelesen oder ausgegeben. */
  readonly embeddedContent?: {
    readonly filename?: string;
    readonly mediaType?: string;
  };
  readonly content: 'empty' | 'available';
}

export type UnresolvedReferenceReason =
  | 'document-not-provided'
  | 'fragment-not-found'
  | 'relative'
  | 'unsafe-protocol';

interface ReferenceBase {
  readonly href: string;
  readonly path: string;
  readonly rel?: string;
  readonly text?: string;
  readonly resourceFragment?: string;
}

export interface ResolvedResourceReference extends ReferenceBase {
  readonly kind: 'resource';
  readonly resource: ResolvedResource;
}

export interface ResolvedControlReference extends ReferenceBase {
  readonly kind: 'control';
  readonly catalogKey: CatalogKey;
  readonly control: Control;
}

export interface ExternalOscalReference extends ReferenceBase {
  readonly kind: 'external';
}

export interface CrossDocumentReference extends ReferenceBase {
  readonly kind: 'cross-document';
  readonly document: ReferenceDocument;
  readonly resource?: ResolvedResource;
}

export interface ProvenanceOscalReference extends ReferenceBase {
  readonly kind: 'provenance';
}

export interface UnresolvedOscalReference extends ReferenceBase {
  readonly kind: 'unresolved';
  readonly reason: UnresolvedReferenceReason;
  readonly diagnostic: OscalDiagnostic;
}

export type ResolvedOscalReference =
  | ResolvedResourceReference
  | ResolvedControlReference
  | ExternalOscalReference
  | CrossDocumentReference
  | ProvenanceOscalReference
  | UnresolvedOscalReference;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function getDocumentBody(document: ReferenceDocument): JsonObject | null {
  if (!isJsonObject(document.source)) return null;

  const body = document.source[document.rootType];
  return isJsonObject(body) ? body : null;
}

function getBackMatterResources(document: ReferenceDocument): readonly JsonObject[] {
  const body = getDocumentBody(document);
  if (!body || !isJsonObject(body['back-matter'])) return [];

  return readArray(body['back-matter'].resources).filter(isJsonObject);
}

function createResourceIndex(
  document: ReferenceDocument,
): ResourceIndex {
  const entries = getBackMatterResources(document).map((resource, index) => ({ resource, index }));
  const byUuid = new Map<string, IndexedResource>();
  for (const entry of entries) {
    const { resource } = entry;
    const uuid = readString(resource.uuid);
    if (uuid && !byUuid.has(uuid)) {
      byUuid.set(uuid, entry);
    }
  }
  return { entries, byUuid };
}

function prepareReferenceResolutionContext(
  input: ReferenceResolutionContext,
): PreparedReferenceResolutionContext {
  const resourceIndexes = new Map<ReferenceDocument, ResourceIndex>();
  resourceIndexes.set(input.document, createResourceIndex(input.document));

  return {
    ...input,
    resourceIndex: resourceIndexes.get(input.document) ?? { entries: [], byUuid: new Map() },
    resourceIndexes,
  };
}

function withReferenceDocument(
  context: PreparedReferenceResolutionContext,
  document: ReferenceDocument,
): PreparedReferenceResolutionContext {
  let resourceIndex = context.resourceIndexes.get(document);
  if (!resourceIndex) {
    resourceIndex = createResourceIndex(document);
    context.resourceIndexes.set(document, resourceIndex);
  }
  return {
    ...context,
    document,
    resourceIndex,
  };
}

function getReferenceInput(
  link: JsonObject,
  path: string,
): OscalReferenceInput | null {
  const href = readString(link.href);
  if (!href) return null;

  return {
    href,
    path: `${path}/href`,
    rel: readString(link.rel),
    text: readString(link.text),
    resourceFragment: readString(link['resource-fragment']),
  };
}

function unresolvedReference(
  input: OscalReferenceInput,
  context: ReferenceResolutionContext,
  reason: UnresolvedReferenceReason,
): UnresolvedOscalReference {
  return {
    ...input,
    kind: 'unresolved',
    reason,
    diagnostic: createOscalDiagnostic({
      code: `OSCAL_REFERENCE_${reason.toUpperCase().replaceAll('-', '_')}`,
      stage: 'reference',
      validator: REFERENCE_RESOLUTION_VALIDATOR,
      path: input.path,
      artifact: {
        key: context.document.context.catalogKey ?? null,
        rootType: context.document.rootType,
        oscalVersion: context.document.oscalVersion,
      },
      params: { reason },
    }),
  };
}

function getProtocol(href: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Prüft ausschließlich die Syntax eines externen Navigationsziels. Der
 * Originalwert wird weder normalisiert noch geladen. Zugangsdaten in URLs
 * werden fail-closed abgelehnt, damit sie nicht über Browsernavigation oder
 * Referrer-Metadaten weitergegeben werden.
 */
export function isSafeExternalHref(href: string): boolean {
  if (!/^https:\/\//iu.test(href)) return false;

  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:'
      && parsed.hostname.length > 0
      && parsed.username.length === 0
      && parsed.password.length === 0;
  } catch {
    return false;
  }
}

function getHrefFragment(href: string): string | null {
  const fragmentIndex = href.indexOf('#');
  return fragmentIndex >= 0 ? href.slice(fragmentIndex + 1) : null;
}

function resolveExplicitDocumentReference(
  input: OscalReferenceInput,
  document: ReferenceDocument,
  context: PreparedReferenceResolutionContext,
  resolveResourceLinks: boolean,
): ResolvedOscalReference {
  const fragment = getHrefFragment(input.href);
  if (!fragment) {
    return { ...input, kind: 'cross-document', document };
  }

  const documentContext = withReferenceDocument(context, document);
  const indexedResource = documentContext.resourceIndex.byUuid.get(fragment);
  if (!indexedResource) {
    return unresolvedReference(
      input,
      documentContext,
      'fragment-not-found',
    );
  }

  const resolvedResource = resolveResource(
    indexedResource.resource,
    `/${document.rootType}/back-matter/resources/${indexedResource.index}`,
    documentContext,
    resolveResourceLinks,
  );
  if (!resolvedResource) {
    return unresolvedReference(
      input,
      documentContext,
      'fragment-not-found',
    );
  }

  return { ...input, kind: 'cross-document', document, resource: resolvedResource };
}

function resolveResourceLink(
  link: JsonObject,
  path: string,
  context: PreparedReferenceResolutionContext,
): ResolvedResourceLink | null {
  const input = getReferenceInput(link, path);
  if (!input) return null;

  const hashes = readArray(link.hashes)
    .filter(isJsonObject)
    .flatMap((hash) => {
      const algorithm = readString(hash.algorithm);
      const value = readString(hash.value);
      return algorithm && value ? [{ algorithm, value }] : [];
    });
  const resolved = resolveOscalReferenceInternal(input, context, false);
  const target = (() => {
    switch (resolved.kind) {
      case 'external':
        return { kind: 'external' as const, href: resolved.href };
      case 'resource':
        return { kind: 'resource' as const, resourceUuid: resolved.resource.uuid };
      case 'unresolved':
        return {
          kind: 'unresolved' as const,
          href: resolved.href,
          reason: resolved.reason,
          diagnostic: resolved.diagnostic,
        };
      case 'control':
      case 'cross-document':
      case 'provenance':
        return {
          kind: 'unresolved' as const,
          href: input.href,
          reason: 'fragment-not-found' as const,
          diagnostic: unresolvedReference(input, context, 'fragment-not-found').diagnostic,
        };
    }
  })();

  return {
    href: input.href,
    mediaType: readString(link['media-type']),
    hashes,
    integrity: hashes.length > 0 ? 'declared' : 'missing',
    target,
  };
}

function resolveResource(
  resource: JsonObject,
  resourcePath: string,
  context: PreparedReferenceResolutionContext,
  resolveResourceLinks = true,
): ResolvedResource | null {
  const uuid = readString(resource.uuid);
  if (!uuid) return null;

  const sourceRlinks = readArray(resource.rlinks).filter(isJsonObject);
  const rlinks = resolveResourceLinks
    ? sourceRlinks.flatMap((rlink, index) => {
      const resolved = resolveResourceLink(rlink, `${resourcePath}/rlinks/${index}`, context);
      return resolved ? [resolved] : [];
    })
    : [];
  const citation = isJsonObject(resource.citation)
    ? readString(resource.citation.text)
    : undefined;
  const base64 = isJsonObject(resource.base64) ? resource.base64 : null;
  const embeddedContent = base64
    ? {
      filename: readString(base64.filename),
      mediaType: readString(base64['media-type']),
    }
    : undefined;

  return {
    uuid,
    title: readString(resource.title),
    description: readString(resource.description),
    citation,
    rlinks,
    embeddedContent,
    content: citation || readString(resource.description) || sourceRlinks.length > 0 || embeddedContent
      ? 'available'
      : 'empty',
  };
}

function resolveFragmentReference(
  input: OscalReferenceInput,
  context: PreparedReferenceResolutionContext,
  resolveResourceLinks: boolean,
): ResolvedOscalReference {
  const target = input.href.slice(1);
  if (!target) return unresolvedReference(input, context, 'fragment-not-found');

  const indexedResource = context.resourceIndex.byUuid.get(target);
  if (indexedResource) {
    const resolvedResource = resolveResource(
      indexedResource.resource,
      `/${context.document.rootType}/back-matter/resources/${indexedResource.index}`,
      context,
      resolveResourceLinks,
    );
    if (resolvedResource) {
      return { ...input, kind: 'resource', resource: resolvedResource };
    }
  }

  const catalogKey = context.document.context.catalogKey;
  const control = catalogKey && context.catalogsByKey
    ? resolveControlRef(context.catalogsByKey, makeControlRef(catalogKey, target))
    : null;
  if (control && catalogKey) {
    return { ...input, kind: 'control', catalogKey, control };
  }

  return unresolvedReference(input, context, 'fragment-not-found');
}

function resolveOscalReferenceInternal(
  input: OscalReferenceInput,
  context: PreparedReferenceResolutionContext,
  resolveResourceLinks: boolean,
): ResolvedOscalReference {
  if (input.rel && PROVENANCE_LINK_RELATIONS.has(input.rel)) {
    return { ...input, kind: 'provenance' };
  }

  const explicitDocument = context.documentsByHref?.get(input.href);
  if (explicitDocument) {
    return resolveExplicitDocumentReference(
      input,
      explicitDocument,
      context,
      resolveResourceLinks,
    );
  }

  if (input.href.startsWith('#')) {
    return resolveFragmentReference(input, context, resolveResourceLinks);
  }

  const protocol = getProtocol(input.href);
  if (isSafeExternalHref(input.href)) {
    return { ...input, kind: 'external' };
  }
  if (protocol) {
    return unresolvedReference(input, context, 'unsafe-protocol');
  }

  return unresolvedReference(
    input,
    context,
    input.href.includes('#') ? 'document-not-provided' : 'relative',
  );
}

/**
 * Der einzige href-Klassifikator des Navigators. Er arbeitet rein auf Daten:
 * kein fetch, keine URL-Normalisierung gegen eine Basis und kein Dateizugriff.
 */
export function resolveOscalReference(
  input: OscalReferenceInput,
  context: ReferenceResolutionContext,
): ResolvedOscalReference {
  return resolveOscalReferenceInternal(input, prepareReferenceResolutionContext(context), true);
}

function visitCatalogControls(
  document: ReferenceDocument,
  visitor: (control: JsonObject, path: string) => void,
): void {
  if (document.rootType !== 'catalog') return;
  const catalog = getDocumentBody(document);
  if (!catalog) return;

  const visitControls = (controls: readonly unknown[], path: string): void => {
    for (const [index, candidate] of controls.entries()) {
      if (!isJsonObject(candidate)) continue;
      const controlPath = `${path}/${index}`;
      visitor(candidate, controlPath);
      visitControls(readArray(candidate.controls), `${controlPath}/controls`);
    }
  };
  const visitGroups = (groups: readonly unknown[], path: string): void => {
    for (const [index, candidate] of groups.entries()) {
      if (!isJsonObject(candidate)) continue;
      const groupPath = `${path}/${index}`;
      visitControls(readArray(candidate.controls), `${groupPath}/controls`);
      visitGroups(readArray(candidate.groups), `${groupPath}/groups`);
    }
  };

  // Controls am Katalog-Root sind schema-valide (OSCAL 1.1.3) und gehören zu
  // keiner Gruppe. Ohne diesen Durchlauf blieben ihre Links unaufgelöst —
  // dieselbe Lücke wie im Adapter (GSPP-242).
  visitControls(readArray(catalog.controls), '/catalog/controls');
  visitGroups(readArray(catalog.groups), '/catalog/groups');
}

interface CatalogControlReferenceResolutionInput {
  readonly document: ReferenceDocument;
  readonly catalogsByKey?: ReadonlyMap<CatalogKey, Catalog>;
  readonly documentsByHref?: ReadonlyMap<string, ReferenceDocument>;
}

/** Löst alle Control-Links in genau einem Durchlauf über den Quellgraphen auf. */
export function resolveCatalogControlReferences(
  input: CatalogControlReferenceResolutionInput,
): ReadonlyMap<string, readonly ResolvedOscalReference[]> {
  const context = prepareReferenceResolutionContext({
    document: input.document,
    catalogsByKey: input.catalogsByKey,
    documentsByHref: input.documentsByHref,
  });
  const referencesByControlId = new Map<string, ResolvedOscalReference[]>();

  visitCatalogControls(input.document, (control, path) => {
    const controlId = readString(control.id);
    if (!controlId) return;
    const references = readArray(control.links)
      .filter(isJsonObject)
      .flatMap((link, index) => {
        const reference = getReferenceInput(link, `${path}/links/${index}`);
        return reference ? [resolveOscalReferenceInternal(reference, context, true)] : [];
      });
    const existing = referencesByControlId.get(controlId) ?? [];
    referencesByControlId.set(controlId, [...existing, ...references]);
  });

  return referencesByControlId;
}

/**
 * Schlanke Projektion für Read-Model-Konsumenten: Sie übernimmt nur bereits
 * klassifizierte interne Control-Ziele und hält weder Ressourcen noch
 * Diagnosen im Katalog-View fest.
 */
export function resolveCatalogControlLinks(
  input: CatalogControlReferenceResolutionInput,
): ReadonlyMap<string, readonly ControlLink[]> {
  const context = prepareReferenceResolutionContext({
    document: input.document,
    catalogsByKey: input.catalogsByKey,
    documentsByHref: input.documentsByHref,
  });
  const linksByControlId = new Map<string, ControlLink[]>();

  visitCatalogControls(input.document, (control, path) => {
    const controlId = readString(control.id);
    if (!controlId) return;
    const links = readArray(control.links)
      .filter(isJsonObject)
      .flatMap((link, index) => {
        const reference = getReferenceInput(link, `${path}/links/${index}`);
        if (!reference) return [];

        const resolved = resolveOscalReferenceInternal(reference, context, false);
        return resolved.kind === 'control'
          ? [{
            targetId: resolved.control.id,
            href: resolved.href,
            rel: resolved.rel,
            relStatus: classifyCatalogLinkRelation(resolved.rel),
            resourceFragment: resolved.resourceFragment,
          }]
          : [];
      });
    linksByControlId.set(controlId, links);
  });

  return linksByControlId;
}

export function resolveControlReferences(input: CatalogControlReferenceResolutionInput & {
  readonly controlId: string;
}): readonly ResolvedOscalReference[] {
  return resolveCatalogControlReferences(input).get(input.controlId) ?? [];
}

export function resolveCatalogMetadataReferences(input: {
  readonly document: ReferenceDocument;
  readonly catalogsByKey?: ReadonlyMap<CatalogKey, Catalog>;
  readonly documentsByHref?: ReadonlyMap<string, ReferenceDocument>;
}): readonly ResolvedOscalReference[] {
  const body = getDocumentBody(input.document);
  const metadata = body && isJsonObject(body.metadata) ? body.metadata : null;
  if (!metadata) return [];

  const context = prepareReferenceResolutionContext({
    document: input.document,
    catalogsByKey: input.catalogsByKey,
    documentsByHref: input.documentsByHref,
  });
  return readArray(metadata.links)
    .filter(isJsonObject)
    .flatMap((link, index) => {
      const reference = getReferenceInput(
        link,
        `/${input.document.rootType}/metadata/links/${index}`,
      );
      return reference ? [resolveOscalReferenceInternal(reference, context, true)] : [];
    });
}

export function resolveCatalogResources(input: {
  readonly document: ReferenceDocument;
  readonly catalogsByKey?: ReadonlyMap<CatalogKey, Catalog>;
  readonly documentsByHref?: ReadonlyMap<string, ReferenceDocument>;
}): readonly ResolvedResource[] {
  const context = prepareReferenceResolutionContext({
    document: input.document,
    catalogsByKey: input.catalogsByKey,
    documentsByHref: input.documentsByHref,
  });
  return context.resourceIndex.entries.flatMap(({ resource, index }) => {
    const resolved = resolveResource(
      resource,
      `/${input.document.rootType}/back-matter/resources/${index}`,
      context,
    );
    return resolved ? [resolved] : [];
  });
}

/** Adapter für den bestehenden verlustfreien Katalogpfad ohne Zugriff auf view. */
export function referenceDocumentFromCatalog(input: {
  readonly source: unknown;
  readonly context: CatalogDocumentContext;
}): ReferenceDocument {
  const catalog = isJsonObject(input.source) ? input.source.catalog : null;
  const metadata = isJsonObject(catalog) && isJsonObject(catalog.metadata)
    ? catalog.metadata
    : null;
  const oscalVersion = metadata ? readString(metadata['oscal-version']) : undefined;

  return createReferenceDocument({
    source: input.source,
    context: input.context,
    rootType: 'catalog',
    oscalVersion: oscalVersion ?? 'unknown',
  });
}
