// =============================================================================
// OSCAL Adapter — Parses an OSCAL catalog body into domain models
//
// Central function: parseCatalog(catalogBody, { catalogKey }) -> Catalog
// =============================================================================

import type {
  RawOscalCatalog,
  RawOscalGroup,
  RawOscalControl,
  RawOscalProp,
  RawOscalPart,
  RawOscalParam,
  Catalog,
  CatalogMetadataInfo,
  CatalogResource,
  CatalogParty,
  PropValue,
  Practice,
  Topic,
  Control,
  ControlLink,
  SecurityLevel,
  EffortLevel,
  Modalverb,
  LinkRelation,
  SecurityTargetRelevance,
} from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { SECURITY_TARGET_LEVELS_NAMESPACE_URL } from '@/domain/vocabularyNamespaces';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Extract a named prop value from an array of OSCAL props. */
function findProp(
  props: RawOscalProp[] | undefined,
  name: string,
): RawOscalProp | undefined {
  return props?.find((p) => p.name === name);
}

/**
 * Extract a named prop with its namespace provenance.
 */
function getPropWithMetadata(
  props: RawOscalProp[] | undefined,
  name: string,
  paramMap?: Record<string, string>,
): PropValue | undefined {
  const prop = findProp(props, name);
  if (!prop) {
    return undefined;
  }

  return {
    name: prop.name,
    value: paramMap ? resolveParams(prop.value, paramMap) : prop.value,
    ns: prop.ns,
  };
}

function getSecurityTargetRelevanceProp(
  props: RawOscalProp[] | undefined,
  name: string,
): PropValue | undefined {
  const prop = getPropWithMetadata(props, name);
  return prop
    ? { ...prop, ns: SECURITY_TARGET_LEVELS_NAMESPACE_URL }
    : undefined;
}

/**
 * Extract a named prop value from an array of OSCAL props.
 */
export function getPropValue(
  props: RawOscalProp[] | undefined,
  name: string,
): string | undefined {
  return findProp(props, name)?.value;
}

/**
 * Extract all values for a named prop (handles multiple occurrences).
 */
export function getPropValues(
  props: RawOscalProp[] | undefined,
  name: string,
): string[] {
  return props?.filter((p) => p.name === name).map((p) => p.value) ?? [];
}

/**
 * Find a part by name within a control's parts array.
 */
export function findPart(
  parts: RawOscalPart[] | undefined,
  name: string,
): RawOscalPart | undefined {
  return parts?.find((p) => p.name === name);
}

/**
 * Build a parameter map from OSCAL params.
 * Maps param ID -> first value (or label as fallback).
 */
export function buildParamMap(
  params: RawOscalParam[] | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!params) return map;
  for (const p of params) {
    map[p.id] = p.values?.[0] ?? p.label ?? '';
  }
  return map;
}

/**
 * Resolve parameter insertions in prose text.
 * Pattern: {{ insert: param, <param-id> }}
 *
 * Also strips BSI-specific inline choice brackets: {{choice text}} → choice text.
 * These appear in prop values (e.g. result/ergebnis) as pre-resolved choices but
 * are still wrapped in {{ }} and must not be shown verbatim to users.
 */
export function resolveParams(
  prose: string,
  paramMap: Record<string, string>,
): string {
  const resolved = prose.replace(
    /\{\{\s*insert:\s*param,\s*([^}\s]+)\s*\}\}/g,
    (_match, paramId: string) => {
      return paramMap[paramId] ?? `[${paramId}]`;
    },
  );
  // Strip remaining {{ content }} choice brackets (BSI notation, not OSCAL params)
  return resolved.replace(/\{\{([^}]*)\}\}/g, '$1');
}

/**
 * Parse tags from a comma-separated prop value.
 * Handles multi-value tags like "BCM, Privilegierte Rechte".
 */
export function parseTags(tagValue: string | undefined): string[] {
  if (!tagValue) return [];
  return tagValue
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Parse a control link href (e.g., "#GC.2.2") into a target ID.
 */
export function parseLinkHref(href: string): string {
  return href.startsWith('#') ? href.slice(1) : href;
}

/**
 * Validate and narrow a string to SecurityLevel.
 */
export function toSecurityLevel(value: string | undefined): SecurityLevel | undefined {
  if (value === 'normal-SdT' || value === 'erhöht') return value;
  return undefined;
}

/**
 * Validate and narrow a string to EffortLevel.
 */
export function toEffortLevel(value: string | undefined): EffortLevel | undefined {
  if (value && ['0', '1', '2', '3', '4', '5'].includes(value)) {
    return value as EffortLevel;
  }
  return undefined;
}

/**
 * Validate and narrow a string to SecurityTargetRelevance.
 */
export function toSecurityTargetRelevance(
  value: string | undefined,
): SecurityTargetRelevance | undefined {
  if (value === '0' || value === '1' || value === '2') return value;
  return undefined;
}

/**
 * Validate and narrow a string to Modalverb.
 */
export function toModalverb(value: string | undefined): Modalverb | undefined {
  if (value === 'MUSS' || value === 'SOLLTE' || value === 'KANN') return value;
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Parse a single OSCAL control into a domain Control.
 */
export function parseControl(
  raw: RawOscalControl,
  groupId: string,
  practiceId: string,
  parentId?: string,
): Control {
  const paramMap = buildParamMap(raw.params);

  // Props
  const altIdentifier = getPropValue(raw.props, 'alt-identifier');
  const securityLevelProp = getPropWithMetadata(raw.props, 'sec_level');
  const effortLevelProp = getPropWithMetadata(raw.props, 'effort_level');
  const tagsProp = getPropWithMetadata(raw.props, 'tags');
  const confidentialityProp = getSecurityTargetRelevanceProp(
    raw.props,
    'confidentiality',
  );
  const integrityProp = getSecurityTargetRelevanceProp(raw.props, 'integrity');
  const availabilityProp = getSecurityTargetRelevanceProp(
    raw.props,
    'availability',
  );
  const authenticityProp = getSecurityTargetRelevanceProp(
    raw.props,
    'authenticity',
  );
  const threatsProp = getPropWithMetadata(raw.props, 'threats');
  const securityLevel = toSecurityLevel(securityLevelProp?.value);
  const effortLevel = toEffortLevel(effortLevelProp?.value);
  const tags = parseTags(tagsProp?.value);
  const confidentiality = toSecurityTargetRelevance(confidentialityProp?.value);
  const integrity = toSecurityTargetRelevance(integrityProp?.value);
  const availability = toSecurityTargetRelevance(availabilityProp?.value);
  const authenticity = toSecurityTargetRelevance(authenticityProp?.value);
  const threats = parseTags(threatsProp?.value);

  // Parts
  const statementPart = findPart(raw.parts, 'statement');
  const guidancePart = findPart(raw.parts, 'guidance');

  const statementRaw = statementPart?.prose ?? '';
  const statement = resolveParams(statementRaw, paramMap);
  const guidance = guidancePart?.prose ?? '';

  // Statement props
  const modalverbProp = getPropWithMetadata(statementPart?.props, 'modal_verb');
  const ergebnisProp = getPropWithMetadata(statementPart?.props, 'result', paramMap);
  const praezisierungProp = getPropWithMetadata(
    statementPart?.props,
    'result_specification',
    paramMap,
  );
  const handlungsworteProp = getPropWithMetadata(statementPart?.props, 'action_word');
  const dokumentationProp = getPropWithMetadata(
    statementPart?.props,
    'documentation',
    paramMap,
  );
  const zielobjektKategorienProp = getPropWithMetadata(
    statementPart?.props,
    'target_object_categories',
  );
  const modalverb = toModalverb(modalverbProp?.value);
  const ergebnis = ergebnisProp?.value || undefined;
  const praezisierung = praezisierungProp?.value || undefined;
  const handlungsworte = handlungsworteProp?.value;
  const dokumentation = dokumentationProp?.value || undefined;
  const zielobjektKategorien = parseTags(zielobjektKategorienProp?.value);

  // Links
  const links: ControlLink[] = (raw.links ?? []).map((l) => ({
    targetId: parseLinkHref(l.href),
    relation: (l.rel === 'required' ? 'required' : 'related') as LinkRelation,
  }));

  return {
    id: raw.id,
    title: raw.title,
    altIdentifier,
    parentId,
    groupId,
    practiceId,
    securityLevel,
    securityLevelProp,
    effortLevel,
    effortLevelProp,
    modalverb,
    modalverbProp,
    tags,
    tagsProp,
    confidentiality,
    confidentialityProp,
    integrity,
    integrityProp,
    availability,
    availabilityProp,
    authenticity,
    authenticityProp,
    threats,
    threatsProp,
    statement,
    statementRaw,
    guidance,
    statementProps: {
      ergebnis,
      ergebnisProp,
      praezisierung,
      praezisierungProp,
      handlungsworte,
      handlungsworteProp,
      dokumentation,
      dokumentationProp,
      zielobjektKategorien,
      zielobjektKategorienProp,
    },
    links,
    params: paramMap,
  };
}

/**
 * Recursively parse a control and all its nested sub-controls/enhancements.
 * Returns a flat array: [control, ...nestedControls].
 */
export function parseControlRecursive(
  raw: RawOscalControl,
  groupId: string,
  practiceId: string,
  parentId?: string,
): Control[] {
  const control = parseControl(raw, groupId, practiceId, parentId);
  const nested = (raw.controls ?? []).flatMap((child) =>
    parseControlRecursive(child, groupId, practiceId, raw.id),
  );
  return [control, ...nested];
}

/**
 * Parse a subgroup (Thema/Topic) into a domain Topic + its controls.
 */
export function parseTopic(
  raw: RawOscalGroup,
  practiceId: string,
): { topic: Topic; controls: Control[] } {
  const altIdentifier = getPropValue(raw.props, 'alt-identifier');
  const label = getPropValue(raw.props, 'label') ?? raw.id;

  const controls = (raw.controls ?? []).flatMap((c) =>
    parseControlRecursive(c, raw.id, practiceId),
  );

  const topic: Topic = {
    id: raw.id,
    title: raw.title,
    label,
    altIdentifier,
    practiceId,
    controlCount: controls.length,
    controlIds: controls.map((c) => c.id),
  };

  return { topic, controls };
}

/**
 * Parse a top-level group (Praktik/Practice).
 */
export function parsePractice(
  raw: RawOscalGroup,
): { practice: Practice; controls: Control[] } {
  const altIdentifier = getPropValue(raw.props, 'alt-identifier');
  const label = getPropValue(raw.props, 'label') ?? raw.id;

  const topics: Topic[] = [];
  const allControls: Control[] = [];

  // Direct controls on practice level (if any)
  for (const c of raw.controls ?? []) {
    allControls.push(...parseControlRecursive(c, raw.id, raw.id));
  }

  // Subgroups = Topics
  for (const sg of raw.groups ?? []) {
    const { topic, controls } = parseTopic(sg, raw.id);
    topics.push(topic);
    allControls.push(...controls);
  }

  const practice: Practice = {
    id: raw.id,
    title: raw.title,
    label,
    altIdentifier,
    topics,
    controlCount: allControls.length,
  };

  return { practice, controls: allControls };
}

/**
 * Parse catalog metadata.
 */
export function parseMetadata(raw: RawOscalCatalog): CatalogMetadataInfo {
  const meta = raw.metadata;
  const parties: CatalogParty[] = (meta.parties ?? []).map((party) => ({
    uuid: party.uuid,
    type: party.type,
    name: party.name,
    email: party['email-addresses']?.[0],
  }));
  const firstParty = parties[0];

  return {
    title: meta.title,
    lastModified: meta['last-modified'],
    version: meta.version,
    oscalVersion: meta['oscal-version'],
    remarks: meta.remarks,
    publisherName: firstParty?.name,
    publisherEmail: firstParty?.email,
    props: (meta.props ?? []).map((prop) => ({
      name: prop.name,
      value: prop.value,
      ns: prop.ns,
    })),
    links: (meta.links ?? []).map((link) => ({
      href: link.href,
      rel: link.rel,
      text: link.text,
    })),
    roles: (meta.roles ?? []).map((role) => ({
      id: role.id,
      title: role.title,
    })),
    parties,
    responsibleParties: (meta['responsible-parties'] ?? []).map((entry) => ({
      roleId: entry['role-id'],
      // Eigenes Array: Der Quellgraph bleibt neben dem Domänenmodell erhalten
      // (ADR-2 §1), und eine Mutation hier dürfte ihn nicht verändern.
      // Die enthaltenen Strings bleiben geteilt — sie sind unveränderlich.
      partyUuids: [...entry['party-uuids']],
    })),
  };
}

function parseBackMatter(
  raw: RawOscalCatalog['back-matter'],
): CatalogResource[] {
  if (!raw?.resources) {
    return [];
  }

  return raw.resources.map((resource) => ({
    uuid: resource.uuid,
    title: resource.title,
    rlinks: (resource.rlinks ?? []).map((link) => ({
      href: link.href,
      // Eigenes Array **und** eigene Hash-Objekte: Ein neues Array allein
      // würde die Elemente weiterhin mit dem Quellgraphen teilen (ADR-2 §1).
      hashes: (link.hashes ?? []).map((hash) => ({
        algorithm: hash.algorithm,
        value: hash.value,
      })),
    })),
  }));
}

/* ------------------------------------------------------------------ */
/*  Main Entry Point                                                   */
/* ------------------------------------------------------------------ */

/** Options for parseCatalog */
export interface ParseCatalogOptions {
  /**
   * Source-registry catalog key (ADR-1). **Pflicht**: Die Identität steht
   * nicht im Dokument; ein Default würde sie erfinden — ein WLAN-Katalog käme
   * sonst als `gspp` heraus, sobald ein Aufrufer sie vergisst.
   */
  catalogKey: CatalogKey;
}

/**
 * Parse the body of an OSCAL catalog root into an enriched Catalog.
 *
 * Nimmt den **Katalogkörper** entgegen, nicht das Gesamtdokument: Den Root-Typ
 * bestimmt allein der Root-Dispatch (`oscalRootDispatch.ts`, GSPP-285); der
 * Fallback `doc.catalog ? doc.catalog : doc` ist ersatzlos entfallen.
 *
 * @param raw - Der Katalogkörper aus dem Envelope `{ catalog: … }`
 * @param options - Catalog scope; identity per ADR-1
 * @throws Error if the input structure is invalid or alt-identifiers collide
 */
export function parseCatalog(raw: unknown, options: ParseCatalogOptions): Catalog {
  const { catalogKey } = options;
  const catalog = raw as RawOscalCatalog;

  if (!catalog?.uuid || !catalog.metadata || !catalog.groups) {
    throw new Error(
      'Invalid OSCAL catalog: missing uuid, metadata, or groups',
    );
  }

  const metadata = parseMetadata(catalog);
  const practices: Practice[] = [];
  const allControls: Control[] = [];

  for (const g of catalog.groups) {
    const { practice, controls } = parsePractice(g);
    practices.push(practice);
    allControls.push(...controls);
  }

  const controlsById = new Map<string, Control>();
  for (const c of allControls) {
    controlsById.set(c.id, c);
  }

  // Kanonische URL-Identität (ADR-1): pro Katalog vollständig und
  // eindeutig, fail-closed — ein Control ohne alt-identifier wäre nach dem
  // Routen-Cutover (GRU-235) nicht mehr adressierbar.
  const controlsByAltIdentifier = new Map<string, Control>();
  for (const c of allControls) {
    if (!c.altIdentifier) {
      throw new Error(
        `Missing alt-identifier for control "${c.id}" in catalog "${catalogKey}"`,
      );
    }
    if (controlsByAltIdentifier.has(c.altIdentifier)) {
      throw new Error(
        `Duplicate alt-identifier "${c.altIdentifier}" in catalog "${catalogKey}"`,
      );
    }
    controlsByAltIdentifier.set(c.altIdentifier, c);
  }

  return {
    catalogKey,
    uuid: catalog.uuid,
    metadata,
    practices,
    controlsById,
    controlsByAltIdentifier,
    controls: allControls,
    backMatter: parseBackMatter(catalog['back-matter']),
    totalControls: allControls.length,
  };
}
