// =============================================================================
// Vergleichsorakel-Helfer des Bauzeitlaufs (GSPP-291, Commit B)
//
// Zweigeteilter Referenznachweis, Seite 1: Die Resolver-Ergebnisse werden
// nach Entfernung ausschließlich dokumentierter volatiler Felder semantisch
// gegen die BSI-resolved_catalog-Dokumente verglichen. Bekannte
// Quelldifferenzen sind die Provenienzträger — die BSI-Artefakte tragen sie
// nicht, unsere Ergebnisse schon; beide Seiten werden symmetrisch
// herausgerechnet und getrennt geprüft.
//
// Volatile Felder (dokumentiert): metadata/last-modified ist
// werkzeugspezifisch; die Dokument-UUID am Körper wird vom erzeugenden
// Werkzeug gemint und ist nicht ableitbar; prop[@name='resolution-tool']
// und link[@rel='source-profile'] sind unsere Träger. Alles andere zählt.
// =============================================================================

interface JsonObjectLike {
  [key: string]: unknown;
}

function isJsonObject(value: unknown): value is JsonObjectLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Filtert eine Trägerliste heraus; ohne Array passiert nichts, nach dem
 * Filter verschwindet ein leerer Rest samt Mitglied — es entstehen keine
 * Phantom-Schlüssel.
 */
function stripCarrierList(
  metadata: JsonObjectLike,
  key: string,
  matches: (entry: JsonObjectLike) => boolean,
): void {
  const value = metadata[key];
  if (!Array.isArray(value)) return;
  const kept = value.filter((entry) => !(isJsonObject(entry) && matches(entry)));
  if (kept.length === 0) delete metadata[key];
  else metadata[key] = kept;
}

/** Entfernt die volatilen Mitglieder eines Metadatenknotens in-place. */
function stripMetadataVolatiles(metadata: JsonObjectLike): void {
  delete metadata['last-modified'];
  stripCarrierList(metadata, 'props', (entry) => entry['name'] === 'resolution-tool');
  stripCarrierList(metadata, 'links', (entry) => entry['rel'] === 'source-profile');
}

/** Tiefe Kopie ohne die dokumentierten volatilen Felder. */
export function stripVolatileFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (!isJsonObject(value)) return value;

  const copy: JsonObjectLike = {};
  for (const key of Object.keys(value)) {
    copy[key] = stripVolatileFields(value[key]);
  }
  if ('metadata' in copy) {
    const metadata = copy['metadata'];
    if (isJsonObject(metadata)) stripMetadataVolatiles(metadata);
  }
  if ('uuid' in copy && 'metadata' in copy) {
    // Dokument-UUID am Körper: werkzeuggeneriert, symmetrisch entfernt.
    delete copy['uuid'];
  }
  return copy;
}

/** Kanonische Form mit sortierten Schlüsseln — Arrayordnung bleibt Bedeutung. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isJsonObject(value)) {
    const members = Object.keys(value)
      .sort(byCodeUnit)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function firstArrayDivergence(
  actual: readonly unknown[],
  expected: readonly unknown[],
  path: string,
): string | null {
  if (actual.length !== expected.length) {
    return `${path} (Länge ${actual.length} ≠ ${expected.length})`;
  }
  for (let index = 0; index < actual.length; index += 1) {
    const found = firstDivergence(actual[index], expected[index], `${path}[${index}]`);
    if (found !== null) return found;
  }
  return null;
}

function firstObjectDivergence(
  actual: JsonObjectLike,
  expected: JsonObjectLike,
  path: string,
): string | null {
  for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
    if (!(key in actual)) return `${path}/${key}`;
    if (!(key in expected)) return `${path}/${key}`;
    const found = firstDivergence(actual[key], expected[key], `${path}/${key}`);
    if (found !== null) return found;
  }
  return null;
}

/** Erste semantische Divergenz als Pfadangabe für die Fehlermeldung. */
export function firstDivergence(actual: unknown, expected: unknown, path = '$'): string | null {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return path;
    return firstArrayDivergence(actual, expected, path);
  }
  if (isJsonObject(actual) || isJsonObject(expected)) {
    if (!isJsonObject(actual) || !isJsonObject(expected)) return path;
    return firstObjectDivergence(actual, expected, path);
  }
  return actual === expected ? null : `${path} (${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)})`;
}


/**
 * NIST-Werkzeug-Artefakt (dokumentiert): Der resolved-Output trägt an
 * assemble-berührten String-Werten (prose, param-choice, citation/text) umgebende
 * Leerzeichen, die die Quelle nicht hat (XML-Konvertierungsrest, z. B.
 * " {{ insert: param, ac-01_odp.03 }} " vs "{{ insert: param, ac-01_odp.03 }}").
 * Diese Normalisierung entfernt umgebende Leerzeichen aus solchen Strings
 * sowie Leerzeichen nach doppelten Zeilenumbrüchen vor Referenzen
 * (z. B. "\n\n [SP" vs "\n\n[SP") und wird ausschließlich im
 * NIST-Harniss auf BEIDE Seiten angewandt.
 */
export function normalizeProseLeadingSpace(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => normalizeProseLeadingSpace(child, parentKey));
  }
  if (typeof value === 'string') {
    return parentKey === 'prose' ||
      parentKey === 'select.choice' ||
      parentKey === 'citation.text'
      ? normalizeOracleProse(value)
      : value;
  }
  if (!isJsonObject(value)) return value;
  const copy: JsonObjectLike = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    let memberKey = key;
    if (parentKey === 'select' && key === 'choice') {
      memberKey = 'select.choice';
    } else if (parentKey === 'citation' && key === 'text') {
      memberKey = 'citation.text';
    }
    copy[key] = normalizeProseLeadingSpace(child, memberKey);
  }
  return copy;
}

function normalizeOracleProse(value: string): string {
  let normalized = value.replace(/^ +/, '');
  if (normalized.includes('\n\n ')) normalized = normalized.replace(/\n\n +/g, '\n\n');
  if (normalized.includes('{{ insert:')) normalized = normalized.trim().replace(/^ +/, '');
  return normalized;
}

/**
 * Navigiert einen Divergenz-Pfad (`$/a/b/0/c`) in beiden Dokumenten und
 * liefert die beiden Knoten für die Fehlermeldung.
 */
export function nodesAtDivergence(actual: unknown, expected: unknown, divergence: string): { readonly actual: unknown; readonly expected: unknown } {
  const tokens = divergence.replace(/^\$\/?/, '').split('/').flatMap((part) => part.match(/[^[\]]+/g) ?? []);
  let nodeA = actual;
  let nodeE = expected;
  for (const token of tokens) {
    nodeA = nodeAtPathToken(nodeA, token);
    nodeE = nodeAtPathToken(nodeE, token);
  }
  return { actual: nodeA, expected: nodeE };
}

function nodeAtPathToken(node: unknown, token: string): unknown {
  if (/^\d+$/.test(token)) {
    return Array.isArray(node) ? node[Number(token)] : undefined;
  }
  return isJsonObject(node) ? node[token] : undefined;
}

/* ------------------------------------------------------------------ */
/* Korpus-Politik: interne Links                                       */
/* ------------------------------------------------------------------ */

/**
 * Werkzeugwiderspruch BSI ↔ NIST (GSPP-291), dokumentiert statt versteckt:
 * Das NIST-Orakel BEWAHRT interne Fragment-Links auf nicht aufgelöste
 * Ziele (pm-9/pm-24 in der LOW-Baseline fehlen im resolved-Katalog, die
 * Verweise bleiben); das BSI-Werkzeug ENTFERNT dieselbe Konstruktion
 * (#SENS.8.6 in lieferkette, #ASST.2.1 und #DEV.* in wlan). Kein Regel-
 * werk erfüllt beide. Der Resolver folgt dem unabhängigeren NIST-Orakel
 * und ADR-2-Verlustlosigkeit. Für den BSI-Vergleich beschreibt die feste
 * Differenzregistry jede Werkzeugbeschneidung und die zwei belegten
 * Positionsabweichungen vollständig; das erwartete Dokument steuert die
 * Rekonziliation nicht.
 */

function documentBody(document: unknown): JsonObjectLike | undefined {
  if (!isJsonObject(document)) return undefined;
  const body = Object.values(document)[0];
  return isJsonObject(body) ? body : undefined;
}

function pushHierarchyChildren(node: JsonObjectLike, stack: JsonObjectLike[]): void {
  for (const listKey of ['controls', 'groups'] as const) {
    const value = node[listKey];
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (isJsonObject(child)) stack.push(child);
    }
  }
}

function cloneJsonWithoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => child === undefined ? null : cloneJsonWithoutUndefined(child));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (!isJsonObject(value)) return value;
  const clone: JsonObjectLike = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child !== undefined) clone[key] = cloneJsonWithoutUndefined(child);
  }
  return clone;
}

export type BsiCorpusDifference =
  | {
    readonly corpusKey: 'lieferkette' | 'wlan';
    readonly controlId: string;
    readonly member: 'links';
    readonly href: string;
    readonly reason: string;
  }
  | {
    readonly corpusKey: 'lieferkette' | 'wlan';
    readonly controlId: string;
    readonly member: 'controls';
    readonly position: 'end';
    readonly reason: string;
  };

const LINK_REASON = 'BSI entfernt internen Fragment-Link; NIST-Orakel bewahrt ihn.';
const ORDER_REASON = 'BSI stellt hochgeleveltes Control ans Ende; NIST bewahrt die Quellposition des Ahnen.';

/** Vollständiges, festes Differenzregister aus der Owner-Konfliktregel. */
export const BSI_PROFILE_RESOLUTION_DIFFERENCES: readonly BsiCorpusDifference[] = Object.freeze([
  { corpusKey: 'lieferkette', controlId: 'DEV.4.3', member: 'links', href: '#TEST.3.1.8', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'DEV.4.2', member: 'links', href: '#DET.5.10.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'DEV.4.2', member: 'links', href: '#TEST.3.1.2', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'KONF.12.1', member: 'links', href: '#DEV.2.6.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'DLS.4.1.2', member: 'links', href: '#BER.1.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.7.4.4.1', member: 'links', href: '#TEST.3.1.8', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.7.4.3', member: 'links', href: '#KONF.2.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.7.4.3', member: 'links', href: '#KONF.10.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.7.2', member: 'links', href: '#TEST.1.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.6.2.1', member: 'links', href: '#ASST.7.3.2', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.5.9.1', member: 'links', href: '#TEST.4.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.4.9', member: 'links', href: '#PERS.3.6.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.4.5', member: 'links', href: '#DEV.1.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'BES.4.5', member: 'links', href: '#DEV.2.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'ASST.5.6', member: 'links', href: '#SENS.8.6', reason: LINK_REASON },
  { corpusKey: 'wlan', controlId: 'DET.4.11.2', member: 'links', href: '#DET.4.10', reason: LINK_REASON },
  { corpusKey: 'wlan', controlId: 'ARCH.5.1.10', member: 'links', href: '#KONF.12.1.7', reason: LINK_REASON },
  { corpusKey: 'wlan', controlId: 'ARCH.4.1', member: 'links', href: '#DET.4.4', reason: LINK_REASON },
  { corpusKey: 'wlan', controlId: 'ARCH.4.1', member: 'links', href: '#DET.3.1.8', reason: LINK_REASON },
  { corpusKey: 'wlan', controlId: 'ARCH.2.2.8', member: 'links', href: '#TEST.3.1.5', reason: LINK_REASON },
  { corpusKey: 'wlan', controlId: 'ARCH.2.4', member: 'links', href: '#ASST.2.1', reason: LINK_REASON },
  { corpusKey: 'lieferkette', controlId: 'KONF.2.4.2', member: 'controls', position: 'end', reason: ORDER_REASON },
  { corpusKey: 'wlan', controlId: 'BES.2.1.4.2', member: 'controls', position: 'end', reason: ORDER_REASON },
]);

function differenceKey(difference: BsiCorpusDifference): string {
  return difference.member === 'links'
    ? `${difference.corpusKey}:${difference.controlId}:links:${difference.href}`
    : `${difference.corpusKey}:${difference.controlId}:controls:${difference.position}`;
}

type LinkDifference = Extract<BsiCorpusDifference, { member: 'links' }>;
type OrderDifference = Extract<BsiCorpusDifference, { member: 'controls' }>;

interface BsiDifferenceIndex {
  readonly linksByControlId: ReadonlyMap<string, ReadonlyMap<string, LinkDifference>>;
  readonly ordersByControlId: ReadonlyMap<string, readonly OrderDifference[]>;
}

function indexBsiDifferences(differences: readonly BsiCorpusDifference[]): BsiDifferenceIndex {
  const linksByControlId = new Map<string, Map<string, LinkDifference>>();
  const ordersByControlId = new Map<string, OrderDifference[]>();
  for (const difference of differences) {
    if (difference.member === 'links') {
      const linksByHref = linksByControlId.get(difference.controlId) ?? new Map();
      linksByHref.set(difference.href, difference);
      linksByControlId.set(difference.controlId, linksByHref);
      continue;
    }
    const orders = ordersByControlId.get(difference.controlId) ?? [];
    orders.push(difference);
    ordersByControlId.set(difference.controlId, orders);
  }
  return { linksByControlId, ordersByControlId };
}

function reconcileRegisteredLinks(
  node: JsonObjectLike,
  differences: BsiDifferenceIndex,
  applied: Set<string>,
): void {
  const controlId = typeof node['id'] === 'string' ? node['id'] : '';
  const registered = differences.linksByControlId.get(controlId);
  if (registered === undefined || !Array.isArray(node['links'])) return;
  const kept = node['links'].filter((link) => {
    if (!isJsonObject(link) || typeof link['href'] !== 'string') return true;
    const match = registered.get(link['href']);
    if (match === undefined) return true;
    applied.add(differenceKey(match));
    return false;
  });
  if (kept.length === 0) delete node['links'];
  else node['links'] = kept;
}

function reconcileRegisteredOrder(
  controls: unknown[],
  differences: BsiDifferenceIndex,
  applied: Set<string>,
): void {
  const kept: unknown[] = [];
  const postponed: unknown[] = [];
  for (const control of controls) {
    const controlId = isJsonObject(control) && typeof control['id'] === 'string'
      ? control['id']
      : undefined;
    const registered = controlId === undefined
      ? undefined
      : differences.ordersByControlId.get(controlId);
    if (registered === undefined) {
      kept.push(control);
      continue;
    }
    postponed.push(control);
    for (const difference of registered) applied.add(differenceKey(difference));
  }
  if (postponed.length > 0) controls.splice(0, controls.length, ...kept, ...postponed);
}

/** Wendet ausschließlich die fest registrierten BSI-Abweichungen an. */
export function reconcileBsiKnownDifferences(
  corpusKey: string,
  strippedActual: unknown,
): {
  readonly cleaned: unknown;
  readonly applied: readonly string[];
  readonly missing: readonly string[];
} {
  const differences = BSI_PROFILE_RESOLUTION_DIFFERENCES.filter(
    (difference) => difference.corpusKey === corpusKey,
  );
  const differenceIndex = indexBsiDifferences(differences);
  const clonedValue = cloneJsonWithoutUndefined(strippedActual);
  const applied = new Set<string>();
  const body = documentBody(clonedValue);
  if (body !== undefined) {
    reconcileRegisteredLinks(body, differenceIndex, applied);
    const rootControls = body['controls'];
    if (Array.isArray(rootControls)) reconcileRegisteredOrder(rootControls, differenceIndex, applied);
    const stack: JsonObjectLike[] = [];
    pushHierarchyChildren(body, stack);
    while (stack.length > 0) {
      const node = stack.pop()!;
      reconcileRegisteredLinks(node, differenceIndex, applied);
      const controls = node['controls'];
      if (Array.isArray(controls)) reconcileRegisteredOrder(controls, differenceIndex, applied);
      pushHierarchyChildren(node, stack);
    }
  }
  const registered = differences.map(differenceKey);
  return {
    cleaned: clonedValue,
    applied: registered.filter((key) => applied.has(key)),
    missing: registered.filter((key) => !applied.has(key)),
  };
}
