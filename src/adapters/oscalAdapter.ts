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
  ParamMeta,
  SecurityLevel,
  EffortLevel,
  Modalverb,
  SecurityTargetRelevance,
} from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { SECURITY_TARGETS_NAMESPACE_URL } from '@/domain/vocabularyNamespaces';

export type { ParamMeta };

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

const TAXONOMY_PROP_NAMES = [
  'Taxonomy-L1',
  'Taxonomy-L2',
  'Taxonomy-L3',
  'Taxonomy-L4',
] as const;

function getTaxonomyProps(props: RawOscalProp[] | undefined): PropValue[] {
  return TAXONOMY_PROP_NAMES.flatMap((name) => (
    props
      ?.filter((prop) => prop.name === name)
      .map((prop) => ({ name: prop.name, value: prop.value, ns: prop.ns }))
    ?? []
  ));
}

/**
 * Schutzziel-Relevanz-Prop mit unveränderter Namensraum-Provenienz.
 *
 * `PropValue` führt `name`, `value` und `ns` — nicht die vollständige
 * OSCAL-Property. `uuid`, `class`, `group` und `remarks` erreichen das
 * Ansichtsmodell nicht; das gilt projektweit für jeden Prop und ist keine
 * Eigenheit der Schutzziele. Die Verlustfreiheit des Dokuments hängt nicht
 * daran: Sie wird über den No-op-Round-trip auf dem Rohdokument geführt
 * (ADR-2, `docs/OSCAL_ROUND_TRIP.md`), nicht über `Control`.
 *
 * Am Snapshot gemessen trägt kein Prop eines Controls eines dieser vier Felder
 * — die Projektion verliert hier also nichts. Auf Gruppenebene sieht das
 * anders aus: Dort tragen 20 `label`-Props die Beschreibungsprosa der
 * Praktiken als `remarks`, und die geht tatsächlich verloren (GSPP-393). Die
 * Modelllücke selbst ist als GSPP-392 erfasst.
 *
 * Die Zuordnung läuft über `name` **und** `ns`: `property` verlangt in OSCAL
 * nur `name` und `value` und führt `ns`, `class`, `group`, `uuid` und
 * `remarks` als optionale Unterscheider — belegt im gepinnten
 * `schemas/oscal/v1.1.3/oscal_catalog_schema.json`, wo
 * `oscal-catalog-oscal-metadata:property` genau `["name", "value"]` als
 * `required` führt. Dass zwei gleichnamige Props aus verschiedenen
 * Namensräumen verschiedene Eigenschaften sind, sagt dasselbe Schema
 * ausdrücklich in der Beschreibung von `ns`: „A namespace qualifying the
 * property's name. This allows different organizations to associate distinct
 * semantics with the same name." Ein `confidentiality`-Prop ohne oder mit
 * fremdem `ns` ist deshalb keine Schutzziel-Relevanz und wird nicht übernommen
 * (fail-closed).
 *
 * Ein gesetztes `class` oder `group` schließt hier ebenfalls aus. Das ist eine
 * **Projektentscheidung, keine OSCAL-Vorgabe**: Das Schema belegt nur, dass
 * beide Felder optional vorhanden sein dürfen, und definiert keinen
 * Identitätsschlüssel für Properties. Die Entscheidung ist fail-closed
 * begründet — ein `class` oder `group` kennzeichnet eine Spezialisierung,
 * deren Bedeutung dieses Projekt nicht kennt, und eine unbekannte
 * Spezialisierung als kanonische Relevanz zu führen hieße, ihr eine Bedeutung
 * zu geben, die im Dokument nicht steht. Im ausgelieferten Katalog tragen alle
 * vier Schutzziel-Props weder `class` noch `group`; die Regel greift dort also
 * nicht und ist reine Vorsorge.
 *
 * Der vollständige Normbeleg zu `prop.value` steht bei der Skala in
 * `domain/securityTargets.ts`; geprüft wird er in
 * `domain/securityTargets.catalog.node.test.ts`.
 *
 * Der vorgefundene `ns` bleibt unverändert erhalten; er zeigt auf
 * `security_targets.csv`. Ihn durch den Namensraum von
 * `security_targets_levels.csv` zu ersetzen, damit die Wertebedeutung generisch
 * über `prop.ns` auflösbar wäre, würde eine Herkunft behaupten, die im Dokument
 * nicht steht. Die Levels-Auflösung nennt ihren Namensraum stattdessen selbst
 * (`resolveSecurityTargetLevel` in `domain/vocabulary.ts`).
 */
function getSecurityTargetRelevanceProp(
  props: RawOscalProp[] | undefined,
  name: string,
): PropValue | undefined {
  const prop = props?.find(
    (candidate) =>
      candidate.name === name &&
      candidate.ns === SECURITY_TARGETS_NAMESPACE_URL &&
      candidate.class === undefined &&
      candidate.group === undefined,
  );

  return prop ? { name: prop.name, value: prop.value, ns: prop.ns } : undefined;
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
 * Maps param ID -> ParamMeta (resolved value plus whether a value is set).
 */
export function buildParamMap(
  params: RawOscalParam[] | undefined,
): Record<string, ParamMeta> {
  const map: Record<string, ParamMeta> = {};
  if (!params) return map;
  for (const p of params) {
    const value = p.values?.[0];
    map[p.id] = { value: value ?? p.label ?? '', hasValue: value !== undefined };
  }
  return map;
}

/** String-Sicht auf ParamMeta für resolveParams und reine Text-Konsumenten. */
export function paramValues(paramMap: Record<string, ParamMeta>): Record<string, string> {
  return Object.fromEntries(Object.entries(paramMap).map(([id, meta]) => [id, meta.value]));
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
  // Strip remaining {{ content }} choice brackets (BSI notation, not OSCAL params).
  // S8786: `[^{}]+` statt `[^}]*` — lineares Muster ohne überlappende
  // Potenzierung. Leere Klammern `{{}}` und innere geschweifte Klammern
  // kommen in der BSI-Notation nicht vor (Katalogdaten 2026-08-22 geprüft).
  return resolved.replace(/{{([^{}]+)}}/g, '$1');
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
 * Projektionshelfer für das alte `ControlLink`-Read-Model (z. B. "#GC.2.2").
 *
 * Er klassifiziert keine OSCAL-Referenzen und trifft keine Navigations- oder
 * Vertrauensentscheidung; dafür ist ausschließlich `referenceResolution.ts`
 * zuständig. Der Helfer entfernt nur einen möglichen Fragmentmarker.
 */
export function parseLinkHref(href: string): string {
  return href.replace(/^#/, '');
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
  groupId: string | undefined,
  practiceId: string | undefined,
  parentId?: string,
): Control {
  const paramMap = buildParamMap(raw.params);
  const stringParams = paramValues(paramMap);

  // Props
  const altIdentifier = getPropValue(raw.props, 'alt-identifier');
  const securityLevelProp = getPropWithMetadata(raw.props, 'sec_level');
  const effortLevelProp = getPropWithMetadata(raw.props, 'effort_level');
  const tagsProp = getPropWithMetadata(raw.props, 'tags');
  const taxonomy = getTaxonomyProps(raw.props);
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
  const statement = resolveParams(statementRaw, stringParams);
  const guidance = guidancePart?.prose ?? '';

  // Statement props
  const modalverbProp = getPropWithMetadata(statementPart?.props, 'modal_verb');
  const ergebnisProp = getPropWithMetadata(statementPart?.props, 'result', stringParams);
  const praezisierungProp = getPropWithMetadata(
    statementPart?.props,
    'result_specification',
    stringParams,
  );
  const handlungsworteProp = getPropWithMetadata(statementPart?.props, 'action_word');
  const dokumentationProp = getPropWithMetadata(
    statementPart?.props,
    'documentation',
    stringParams,
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
    taxonomy,
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
    // Zielarten und sichere Navigation werden ausschließlich durch die
    // zentrale Referenzauflösung klassifiziert. Die Dokumentprojektion ersetzt
    // diese leere Zwischenansicht vor der Veröffentlichung (GSPP-243/286).
    links: [],
    params: paramMap,
  };
}

/**
 * Recursively parse a control and all its nested sub-controls/enhancements.
 * Returns a flat array: [control, ...nestedControls].
 */
export function parseControlRecursive(
  raw: RawOscalControl,
  groupId: string | undefined,
  practiceId: string | undefined,
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
  practiceId: string | undefined,
): { topic: Topic; controls: Control[] } {
  const altIdentifier = getPropValue(raw.props, 'alt-identifier');
  const label = getPropValue(raw.props, 'label') ?? raw.id ?? raw.title;

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
  const label = getPropValue(raw.props, 'label') ?? raw.id ?? raw.title;

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
  // Erste Partei statt Auflösung der Herausgeberrolle über responsible-parties:
  // Die ausgelieferten Kataloge führen genau eine Partei (Rolle `creator`).
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

  // `groups` ist laut OSCAL 1.1.3 optional — ein Katalog ohne Gruppen und ohne
  // Controls ist schema-valide und muss einen Empty State erzeugen, keinen
  // Fehler (GSPP-242).
  if (!catalog?.uuid || !catalog.metadata) {
    throw new Error(
      'Invalid OSCAL catalog: missing uuid or metadata',
    );
  }

  const metadata = parseMetadata(catalog);
  const practices: Practice[] = [];
  const allControls: Control[] = [];

  // Controls am Katalog-Root sind schema-valide und gehören zu keiner Gruppe.
  // Sie werden projiziert statt verworfen: Der Empty State gilt nur für einen
  // Katalog, der weder `groups` noch `controls` führt. Ohne diesen Zweig
  // erzeugte ein Katalog mit ausschließlich Root-Controls stillen Datenverlust
  // (GSPP-242).
  for (const c of catalog.controls ?? []) {
    allControls.push(...parseControlRecursive(c, undefined, undefined));
  }

  for (const g of catalog.groups ?? []) {
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
  // Routen-Cutover (GSPP-235) nicht mehr adressierbar.
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
