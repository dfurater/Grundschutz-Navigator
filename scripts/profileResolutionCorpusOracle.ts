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
// Volatile Felder (dokumentiert): metadata/uuid und metadata/last-modified
// sind werkzeugspezifisch; die Dokument-UUID am Körper wird vom erzeugenden
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
  delete metadata['uuid'];
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
 * assemble-berührten String-Werten (prose, param-choice) umgebende
 * Leerzeichen, die die Quelle nicht hat (XML-Konvertierungsrest, z. B.
 * " {{ insert: param, ac-01_odp.03 }} " vs "{{ insert: param, ac-01_odp.03 }}").
 * Diese Normalisierung entfernt umgebende Leerzeichen aus solchen Strings
 * sowie Leerzeichen nach doppelten Zeilenumbrüchen vor Referenzen
 * (z. B. "\n\n [SP" vs "\n\n[SP") und wird ausschließlich im
 * NIST-Harniss auf BEIDE Seiten angewandt.
 */
export function normalizeProseLeadingSpace(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeProseLeadingSpace);
  if (!isJsonObject(value)) {
    if (typeof value === 'string' && value.includes('{{ insert:')) {
      return value.trim();
    }
    if (typeof value === 'string' && value.includes('\n\n ')) {
      return value.replace(/\n\n +/g, '\n\n');
    }
    return value;
  }
  const copy: JsonObjectLike = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (key === 'prose' && typeof child === 'string') {
      let normalized: string = child.replace(/^ +/, '');
      if (normalized.includes('\n\n ')) {
        normalized = normalized.replace(/\n\n +/g, '\n\n');
      }
      if (normalized.includes('{{ insert:')) {
        normalized = normalized.trim();
        normalized = normalized.replace(/^ +/, '');
      }
      copy[key] = normalized;
    } else if (typeof child === 'string' && child.includes('{{ insert:')) {
      copy[key] = child.trim();
    } else if (typeof child === 'string' && child.includes('\n\n ')) {
      copy[key] = child.replace(/\n\n +/g, '\n\n');
    } else {
      copy[key] = normalizeProseLeadingSpace(child);
    }
  }
  return copy;
}

function sortControlsById(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortControlsById);
  if (!isJsonObject(value)) return value;
  const copy: JsonObjectLike = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    if ((key === 'controls' || key === 'groups') && Array.isArray(child)) {
      const sorted = [...(child as unknown[])].map(sortControlsById);
      if (key === 'controls') {
        sorted.sort((a, b) => {
          const aId = isJsonObject(a) ? String(a['id'] ?? '') : '';
          const bId = isJsonObject(b) ? String(b['id'] ?? '') : '';
          return aId < bId ? -1 : aId > bId ? 1 : 0;
        });
      }
      copy[key] = sorted;
    } else {
      copy[key] = sortControlsById(child);
    }
  }
  return copy;
}

export function normalizeAsIsControlOrder(value: unknown): unknown {
  return sortControlsById(value);
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
    if (/^\d+$/.test(token)) {
      nodeA = Array.isArray(nodeA) ? nodeA[Number(token)] : undefined;
      nodeE = Array.isArray(nodeE) ? nodeE[Number(token)] : undefined;
    } else {
      nodeA = isJsonObject(nodeA) ? nodeA[token] : undefined;
      nodeE = isJsonObject(nodeE) ? nodeE[token] : undefined;
    }
  }
  return { actual: nodeA, expected: nodeE };
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
 * und ADR-2-Verlustlosigkeit; für den BSI-Vergleich rekonstruiert diese
 * Funktion die Werkzeugbeschneidung transparent gegen die ID-Menge des
 * erwarteten Dokuments und zählt jeden Eingriff laut mit.
 */

/** Sammelt alle Control- und Gruppen-IDs eines gestripften Dokuments. */
function collectDocumentIds(document: unknown): Set<string> {
  const ids = new Set<string>();
  const stack: JsonObjectLike[] = [];
  const body = isJsonObject(document) ? (Object.values(document)[0] as unknown) : undefined;
  if (!isJsonObject(body)) return ids;
  stack.push(body);
  while (stack.length > 0) {
    const node = stack.pop()!;
    const id = node['id'];
    if (typeof id === 'string') ids.add(id);
    for (const listKey of ['controls', 'groups'] as const) {
      const value = node[listKey];
      if (!Array.isArray(value)) continue;
      for (const child of value) {
        if (isJsonObject(child)) stack.push(child);
      }
    }
  }
  return ids;
}

/**
 * Entfernt aus ACTUAL die internen Fragment-Links (`#<id>`), deren Ziel
 * nicht Teil DES ERWARTETEN Dokuments ist, und meldet jeden Eingriff.
 */
export function reconcileBsiInternalLinks(
  strippedActual: unknown,
  strippedExpected: unknown,
): { readonly cleaned: unknown; readonly removed: readonly string[] } {
  const placedIds = collectDocumentIds(strippedExpected);
  // JSON-Rundlauf klont tief und verwirft zugleich eventuelle
  // undefined-Phantomschlüssel.
  const clone = JSON.parse(JSON.stringify(strippedActual)) as JsonObjectLike;
  const removed: string[] = [];

  const body = Object.values(clone)[0];
  if (!isJsonObject(body)) return { cleaned: clone, removed };

  // Ausschließlich über die Kontrollhierarchie absteigen — metadata und
  // ihre Ressourcenverweise bleiben unangetastet.
  const stack: JsonObjectLike[] = [];
  for (const listKey of ['groups', 'controls'] as const) {
    const value = body[listKey];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isJsonObject(child)) stack.push(child);
      }
    }
  }

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (Array.isArray(node['links'])) {
      const controlId = typeof node['id'] === 'string' ? node['id'] : '?';
      const kept = (node['links'] as unknown[]).filter((link) => {
        if (!isJsonObject(link)) return true;
        const href = link['href'];
        if (typeof href !== 'string' || !href.startsWith('#')) return true;
        if (placedIds.has(href.slice(1))) return true;
        removed.push(`${controlId} → ${href}`);
        return false;
      });
      if (kept.length === 0) delete node['links'];
      else node['links'] = kept;
    }
    for (const listKey of ['controls', 'groups'] as const) {
      const value = node[listKey];
      if (!Array.isArray(value)) continue;
      for (const child of value) {
        if (isJsonObject(child)) stack.push(child);
      }
    }
  }

  return { cleaned: clone, removed };
}
