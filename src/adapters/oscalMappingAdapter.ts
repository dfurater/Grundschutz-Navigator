// =============================================================================
// Modelladapter `mapping-collection` — Control Layer (GSPP-245)
//
// Rein lesend und verlustfrei nach ADR-2: Die Wahrheit ist der unveränderte
// `source`, `view` ist die Projektion darauf. Der Adapter **löst nichts auf**
// und leitet aus einem Mapping keine Compliance- oder Auditaussage ab.
//
// Vier Eigenheiten des Modells prägen ihn:
//
//  1. **Die Lücke ist eine Aussage.** `relationship: "no-relationship"` sagt
//     „diese beiden Controls haben nichts miteinander zu tun"; ein fehlender
//     `map`-Eintrag sagt nur, dass niemand etwas ausgesagt hat. Die Projektion
//     hält beides getrennt, und es gibt keinen Zustand „nicht abgedeckt"
//     (`MappingCoverageState`).
//  2. **Das Beziehungsvokabular steht nicht im JSON-Schema.** `relationship`
//     ist dort nur `TokenDatatype`; das kontrollierte Vokabular hängt im
//     Metaschema an `has-oscal-namespace(…)` und wird nicht übernommen. Ohne
//     die eigene Prüfung in `oscalMappingReaders.ts` wäre ein erfundener
//     Beziehungstyp schemavalide — und die Gap-Semantik ungesichert.
//  3. **`mappings` hat zwei schemazulässige Formen.** Das Schema führt ein
//     `anyOf` aus einem Mapping-Objekt und einem Array. Ein Adapter, der nur
//     `Array.isArray` prüft, parst ein gültiges Dokument der Einzelform leer.
//  4. **Eine `id-ref` ohne Ressourcenkontext ist ein Bezeichner ohne
//     Bedeutung.** Da im Bestand keine der sechs Ressourcen auflösbar ist,
//     trägt jedes Item den Marker `MAPPING_ID_REF_UNRESOLVED`, und je Seite
//     benennt eine Diagnose den Grund. Gegen einen beliebigen geladenen Katalog
//     aufgelöst würde sie geraten, nicht ermittelt.
//
// Referenzen werden ausschließlich über `src/domain/referenceResolution.ts`
// klassifiziert (GSPP-286). Dieser Adapter verzweigt an keiner Stelle selbst
// auf die Form eines `href`, normalisiert keinen Pfad und lädt nichts nach.
//
// Es gibt hier **keine** Mapping-Versionskonstante: Welche Schemazelle gilt,
// entscheidet allein `metadata.oscal-version` über den Root-Dispatch (Stufe 2).
// =============================================================================

import {
  createReferenceDocument,
  resolveOscalReference,
} from '@/domain/referenceResolution';
import {
  diagnose,
  isJsonObject,
  MAPPING_ADAPTER_DIAGNOSTIC_CODES,
  missingVocabulary,
  readIdentity,
  readLinks,
  readNamespacedVocabulary,
  readNumber,
  readObjectArrayField,
  readOptionalObject,
  readProps,
  readString,
  readStringArrayField,
  readVocabulary,
} from '@/adapters/oscalMappingReaders';
import type { DeriveState, JsonObject } from '@/adapters/oscalMappingReaders';
import {
  MAPPING_COLLECTION_ROOT_TYPE,
  MAPPING_ID_REF_UNRESOLVED,
  MAPPING_ITEM_TYPES,
  MAPPING_MATCHING_RATIONALES,
  MAPPING_METHODS,
  MAPPING_QUALIFIER_CATEGORIES,
  MAPPING_QUALIFIER_PREDICATES,
  MAPPING_QUALIFIER_SUBJECTS,
  MAPPING_RELATIONSHIPS,
  MAPPING_RESOURCE_TYPES,
  MAPPING_STATUSES,
} from '@/domain/mappingModel';
import type {
  Mapping,
  MappingCollection,
  MappingCollectionMetadata,
  MappingConfidenceScore,
  MappingControlSelector,
  MappingCoverage,
  MappingEntry,
  MappingGapSummary,
  MappingItem,
  MappingMatchingRationale,
  MappingProvenance,
  MappingQualifier,
  MappingResourceReference,
  MappingsDeclaredForm,
} from '@/domain/mappingModel';
import type { OscalDocumentContext } from '@/domain/models';
import { isPinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { getArtifactByUpstreamPath } from '@/domain/sourceRegistry';

export {
  MAPPING_ADAPTER_DIAGNOSTIC_CODES,
  MAPPING_ADAPTER_STAGE,
  MAPPING_ADAPTER_VALIDATOR,
} from '@/adapters/oscalMappingReaders';
export {
  coverageForSourceIdRef,
  coverageForTargetIdRef,
  MAPPING_COLLECTION_ROOT_TYPE,
  MAPPING_ID_REF_UNRESOLVED,
  MAPPING_RELATIONSHIP_GAP,
} from '@/domain/mappingModel';
export type * from '@/domain/mappingModel';

const codes = MAPPING_ADAPTER_DIAGNOSTIC_CODES;

const ROOT_PATH = `/${MAPPING_COLLECTION_ROOT_TYPE}`;

/* ------------------------------------------------------------------ */
/*  Gemeinsame Knoten                                                  */
/* ------------------------------------------------------------------ */

function readMatchingRationale(
  node: JsonObject,
  path: string,
  state: DeriveState,
): MappingEntry['matchingRationale'] {
  return readVocabulary<MappingMatchingRationale>(
    MAPPING_MATCHING_RATIONALES,
    node['matching-rationale'],
    { path: `${path}/matching-rationale`, code: codes.MATCHING_RATIONALE_INVALID, state },
  );
}

/**
 * Liest `confidence-score`. Ein vorhandener, aber formfremder Knoten bleibt als
 * leerer Knoten sichtbar — sonst wäre in der Projektion nicht mehr erkennbar,
 * dass die Aussage überhaupt da war.
 */
function readConfidenceScore(
  node: JsonObject,
  path: string,
  state: DeriveState,
): MappingConfidenceScore | undefined {
  if (!Object.hasOwn(node, 'confidence-score')) return undefined;

  const scorePath = `${path}/confidence-score`;
  const score = readOptionalObject(node, 'confidence-score', path, state);
  if (score === null) return { path: scorePath };

  const category = readString(score.category);
  const percentage = readNumber(score.percentage);
  if (score.category !== undefined && category === undefined) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, `${scorePath}/category`);
  }
  if (score.percentage !== undefined && percentage === undefined) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, `${scorePath}/percentage`);
  }
  return { category, percentage, path: scorePath };
}

function readCoverage(
  node: JsonObject,
  path: string,
  state: DeriveState,
): MappingCoverage | undefined {
  if (!Object.hasOwn(node, 'coverage')) return undefined;

  const coveragePath = `${path}/coverage`;
  const coverage = readOptionalObject(node, 'coverage', path, state);
  if (coverage === null) return { path: coveragePath };

  const targetCoverage = readNumber(coverage['target-coverage']);
  if (targetCoverage === undefined) {
    // Pflichtfeld des Knotens: Ohne Wert sagt eine Abdeckungsangabe nichts.
    diagnose(state, codes.STRUCTURE_UNEXPECTED, `${coveragePath}/target-coverage`);
  }
  return {
    generationMethod: readString(coverage['generation-method']),
    targetCoverage,
    path: coveragePath,
  };
}

function readSelectors(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): readonly MappingControlSelector[] {
  return readObjectArrayField(node, key, path, state).map(
    ({ node: selector, path: selectorPath }) => ({
      withChildControls: readString(selector['with-child-controls']),
      withIds: readStringArrayField(selector, 'with-ids', selectorPath, state),
      // Getrennt von `with-ids`: Ein Muster ist keine Aufzählung, und dieser
      // Slice wertet es ausdrücklich nicht aus.
      matching: readObjectArrayField(selector, 'matching', selectorPath, state).map(
        ({ node: matcher }) => ({
          pattern: readString(matcher.pattern),
          remarks: readString(matcher.remarks),
        }),
      ),
      path: selectorPath,
    }),
  );
}

/**
 * Liest eine Gap-Summary — die **zweite** Ausdrucksform der Lücke neben
 * `no-relationship`. Sie zählt Controls auf, für die ausdrücklich keine
 * Abbildung existiert, und ist damit ebenfalls eine Aussage und keine
 * Abwesenheit.
 */
function readGapSummary(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): MappingGapSummary | undefined {
  if (!Object.hasOwn(node, key)) return undefined;

  const summary = readOptionalObject(node, key, path, state);
  const summaryPath = `${path}/${key}`;
  if (summary === null) return { unmappedControls: [], path: summaryPath };

  return {
    uuid: readIdentity(summary, summaryPath, state, { required: false }),
    unmappedControls: readSelectors(summary, 'unmapped-controls', summaryPath, state),
    path: summaryPath,
  };
}

/* ------------------------------------------------------------------ */
/*  Ressourcen und Items                                               */
/* ------------------------------------------------------------------ */

/**
 * Liest eine Quell- oder Zielressource und klassifiziert ihren `href`.
 *
 * Der Ressourcenkontext gilt nur dann als aufgelöst, wenn die Referenzschicht
 * ein **anderes Dokument** liefert (`cross-document`). Eine `back-matter`-
 * Ressource ist ein Eintrag über eine Datei, kein geladener Katalog; auf ihrer
 * Grundlage bliebe jede `id-ref` genauso uninterpretierbar.
 */
function readResourceReference(
  mapping: JsonObject,
  key: 'source-resource' | 'target-resource',
  mappingPath: string,
  state: DeriveState,
): MappingResourceReference | null {
  const path = `${mappingPath}/${key}`;
  if (!Object.hasOwn(mapping, key)) {
    diagnose(state, codes.RESOURCE_MISSING, path);
    return null;
  }

  const resource = readOptionalObject(mapping, key, mappingPath, state);
  if (resource === null) return null;

  const ns = readString(resource.ns);
  const href = readString(resource.href);
  if (href === undefined) {
    // Erhalten, nicht verworfen: Der Knoten bleibt in der Projektion, aber
    // ohne erfundene Quelle.
    diagnose(state, codes.RESOURCE_HREF_MISSING, `${path}/href`);
  }

  const reference = href === undefined
    ? null
    // Einziger Klassifikationsweg (GSPP-286): kein Netzzugriff, keine
    // Normalisierung gegen eine Basis, keine eigene href-Verzweigung hier.
    : resolveOscalReference(
      { href, path: `${path}/href` },
      { document: state.referenceDocument },
    );

  if (reference?.kind !== 'cross-document') {
    // Fail-closed: Solange die Gegenseite nicht vorliegt, bleibt jede `id-ref`
    // dieser Seite ein Bezeichner ohne Kontext.
    diagnose(state, codes.ID_REF_CONTEXT_UNRESOLVED, path);
  }

  return {
    type: readNamespacedVocabulary(MAPPING_RESOURCE_TYPES, resource.type, ns, {
      path: `${path}/type`,
      code: codes.RESOURCE_TYPE_INVALID,
      state,
    }) ?? missingVocabulary(state, codes.RESOURCE_TYPE_INVALID, `${path}/type`),
    href,
    reference,
    ns,
    props: readProps(resource, path, state),
    links: readLinks(resource, path, state),
    remarks: readString(resource.remarks),
    path,
  };
}

function readItems(
  map: JsonObject,
  key: 'sources' | 'targets',
  mapPath: string,
  state: DeriveState,
): readonly MappingItem[] {
  const declared = map[key];
  if (!Array.isArray(declared) || declared.length === 0) {
    // `minItems: 1` auf beiden Seiten: Ein Eintrag ohne Subjekt oder ohne
    // Objekt ist keine Beziehung mehr.
    diagnose(state, codes.ITEM_SET_EMPTY, `${mapPath}/${key}`);
  }

  return readObjectArrayField(map, key, mapPath, state).map(({ node: item, path }) => {
    const idRef = readString(item['id-ref']);
    if (idRef === undefined) {
      diagnose(state, codes.ITEM_ID_REF_MISSING, `${path}/id-ref`);
    }

    return {
      type: readVocabulary(MAPPING_ITEM_TYPES, item.type, {
        path: `${path}/type`,
        code: codes.ITEM_TYPE_INVALID,
        state,
      }) ?? missingVocabulary(state, codes.ITEM_TYPE_INVALID, `${path}/type`),
      idRef,
      // Unveränderlich `unresolved`: Dieser Slice interpretiert keine `id-ref`
      // ohne aufgelösten Ressourcenkontext.
      resolution: MAPPING_ID_REF_UNRESOLVED,
      props: readProps(item, path, state),
      links: readLinks(item, path, state),
      remarks: readString(item.remarks),
      path,
    };
  });
}

function readQualifiers(
  map: JsonObject,
  mapPath: string,
  state: DeriveState,
): readonly MappingQualifier[] {
  return readObjectArrayField(map, 'qualifiers', mapPath, state).map(
    ({ node: qualifier, path }) => ({
      subject: readVocabulary(MAPPING_QUALIFIER_SUBJECTS, qualifier.subject, {
        path: `${path}/subject`,
        code: codes.QUALIFIER_VALUE_INVALID,
        state,
      }) ?? missingVocabulary(state, codes.QUALIFIER_VALUE_INVALID, `${path}/subject`),
      predicate: readVocabulary(MAPPING_QUALIFIER_PREDICATES, qualifier.predicate, {
        path: `${path}/predicate`,
        code: codes.QUALIFIER_VALUE_INVALID,
        state,
      }) ?? missingVocabulary(state, codes.QUALIFIER_VALUE_INVALID, `${path}/predicate`),
      category: readVocabulary(MAPPING_QUALIFIER_CATEGORIES, qualifier.category, {
        path: `${path}/category`,
        code: codes.QUALIFIER_VALUE_INVALID,
        state,
      }) ?? missingVocabulary(state, codes.QUALIFIER_VALUE_INVALID, `${path}/category`),
      // Markup bleibt Text; gerendert wird es nie als HTML.
      description: readString(qualifier.description),
      remarks: readString(qualifier.remarks),
      path,
    }),
  );
}

/* ------------------------------------------------------------------ */
/*  Einträge                                                           */
/* ------------------------------------------------------------------ */

function readMaps(
  mapping: JsonObject,
  mappingPath: string,
  state: DeriveState,
): readonly MappingEntry[] {
  const declared = mapping.maps;
  if (!Array.isArray(declared) || declared.length === 0) {
    diagnose(state, codes.MAPS_MISSING, `${mappingPath}/maps`);
  }

  return readObjectArrayField(mapping, 'maps', mappingPath, state).map(
    ({ node: map, path }) => {
      // Der Namensraum qualifiziert genau den Beziehungswert; fehlt er, gilt
      // laut Metaschema der OSCAL-Namensraum und das Vokabular bindet.
      const ns = readString(map.ns);

      return {
        uuid: readIdentity(map, path, state, { required: true }),
        relationship: readNamespacedVocabulary(MAPPING_RELATIONSHIPS, map.relationship, ns, {
          path: `${path}/relationship`,
          code: codes.RELATIONSHIP_INVALID,
          state,
        }) ?? missingVocabulary(state, codes.RELATIONSHIP_MISSING, `${path}/relationship`),
        ns,
        matchingRationale: readMatchingRationale(map, path, state),
        sources: readItems(map, 'sources', path, state),
        targets: readItems(map, 'targets', path, state),
        qualifiers: readQualifiers(map, path, state),
        confidenceScore: readConfidenceScore(map, path, state),
        coverage: readCoverage(map, path, state),
        props: readProps(map, path, state),
        links: readLinks(map, path, state),
        remarks: readString(map.remarks),
        path,
      };
    },
  );
}

/**
 * Indiziert die Einträge nach den `id-ref`-Werten **einer** Seite.
 *
 * Der Index ist pro Mapping Set gebildet, weil erst das Set die Ressource
 * benennt, in der eine ID etwas bedeutet. Ein Eintrag, der dieselbe ID mehrfach
 * führt, erscheint trotzdem nur einmal je Schlüssel — sonst zählte die
 * Abdeckung Wiederholungen als zusätzliche Aussagen.
 */
function indexByIdRef(
  entries: readonly MappingEntry[],
  side: 'sources' | 'targets',
): ReadonlyMap<string, readonly MappingEntry[]> {
  const index = new Map<string, MappingEntry[]>();

  for (const entry of entries) {
    const seen = new Set<string>();
    for (const item of entry[side]) {
      if (item.idRef === undefined || seen.has(item.idRef)) continue;
      seen.add(item.idRef);

      const existing = index.get(item.idRef);
      if (existing) {
        existing.push(entry);
        continue;
      }
      index.set(item.idRef, [entry]);
    }
  }

  return index;
}

/**
 * Sammelt die **namentlich** aufgezählten IDs einer Gap-Summary.
 *
 * Nur `with-ids`: Ein `matching`-Muster wird in diesem Slice nirgends
 * ausgewertet, und `with-child-controls` ließe sich ohne geladenen Katalog
 * ohnehin nicht auflösen. Eine gemusterte Aufzählung bleibt deshalb in der
 * Projektion erhalten, ohne die Abdeckungsaussage zu verändern — sonst würde
 * hier ein Glob-Matcher entstehen, den das Modell ausdrücklich nicht hat.
 */
function collectGapIdRefs(summary: MappingGapSummary | undefined): ReadonlySet<string> {
  const identifiers = new Set<string>();
  for (const selector of summary?.unmappedControls ?? []) {
    for (const identifier of selector.withIds) identifiers.add(identifier);
  }
  return identifiers;
}

/* ------------------------------------------------------------------ */
/*  Mapping Sets                                                       */
/* ------------------------------------------------------------------ */

function deriveMapping(mapping: JsonObject, path: string, state: DeriveState): Mapping {
  // Reihenfolge wie im Modell deklariert: Identität, Methodik, beide Seiten,
  // dann die Einträge. Diagnosen sollen in Quellreihenfolge entstehen, und ein
  // vorgezogenes `readMaps` würde die Befunde der Einträge vor die des
  // umgebenden Mapping Sets schieben.
  const uuid = readIdentity(mapping, path, state, { required: true });
  const method = readVocabulary(MAPPING_METHODS, mapping.method, {
    path: `${path}/method`,
    code: codes.METHOD_INVALID,
    state,
  });
  const matchingRationale = readMatchingRationale(mapping, path, state);
  const status = readVocabulary(MAPPING_STATUSES, mapping.status, {
    path: `${path}/status`,
    code: codes.STATUS_INVALID,
    state,
  });
  const sourceResource = readResourceReference(mapping, 'source-resource', path, state);
  const targetResource = readResourceReference(mapping, 'target-resource', path, state);
  const maps = readMaps(mapping, path, state);
  const mappingDescription = readString(mapping['mapping-description']);
  const sourceGapSummary = readGapSummary(mapping, 'source-gap-summary', path, state);
  const targetGapSummary = readGapSummary(mapping, 'target-gap-summary', path, state);

  return {
    uuid,
    method,
    matchingRationale,
    status,
    sourceResource,
    targetResource,
    maps,
    mapsBySourceIdRef: indexByIdRef(maps, 'sources'),
    mapsByTargetIdRef: indexByIdRef(maps, 'targets'),
    mappingDescription,
    sourceGapSummary,
    targetGapSummary,
    // Die zweite Ausdrucksform der Lücke — ohne sie läse die Abdeckungsabfrage
    // eine ausgesprochene Lücke als „nichts ausgesagt".
    sourceGapIdRefs: collectGapIdRefs(sourceGapSummary),
    targetGapIdRefs: collectGapIdRefs(targetGapSummary),
    confidenceScore: readConfidenceScore(mapping, path, state),
    coverage: readCoverage(mapping, path, state),
    props: readProps(mapping, path, state),
    links: readLinks(mapping, path, state),
    remarks: readString(mapping.remarks),
    path,
  };
}

interface DeclaredMappings {
  readonly form: MappingsDeclaredForm;
  readonly entries: readonly { readonly node: JsonObject; readonly path: string }[];
}

/**
 * Bestimmt, in welcher der beiden schemazulässigen Formen `mappings` vorliegt.
 *
 * Die Einzelform ist kein Sonderfall zur Bequemlichkeit: Das Schema führt
 * `mappings` als `anyOf` aus einem Mapping-Objekt und einem Array mit
 * `minItems: 1`. Wer nur die Arrayform liest, parst ein gültiges Dokument leer
 * und meldet dabei nichts.
 */
function readDeclaredMappings(body: JsonObject, state: DeriveState): DeclaredMappings {
  const path = `${ROOT_PATH}/mappings`;
  const declared = body.mappings;

  if (Array.isArray(declared)) {
    if (declared.length === 0) diagnose(state, codes.MAPPINGS_MISSING, path);
    return { form: 'array', entries: readObjectArrayField(body, 'mappings', ROOT_PATH, state) };
  }
  if (isJsonObject(declared)) {
    return { form: 'single', entries: [{ node: declared, path }] };
  }

  diagnose(state, codes.MAPPINGS_MISSING, path);
  return { form: 'missing', entries: [] };
}

/* ------------------------------------------------------------------ */
/*  Provenance und Metadaten                                           */
/* ------------------------------------------------------------------ */

/**
 * Liest `provenance`.
 *
 * Sie ist **Pflichtfeld** der Sammlung und trägt die global gültige Methodik,
 * die einzelne Mapping Sets lokal überschreiben. Ihre unbekannten Zusatzfelder
 * — im ISO-Mapping real `qa-reviewed` und `qa-note` — bleiben im `source`
 * erhalten; die Projektion liest sie nicht, wirft sie aber auch nicht weg
 * (ADR-2, ADR-7).
 */
function deriveProvenance(body: JsonObject, state: DeriveState): MappingProvenance | null {
  const path = `${ROOT_PATH}/provenance`;
  if (!Object.hasOwn(body, 'provenance')) {
    diagnose(state, codes.PROVENANCE_MISSING, path);
    return null;
  }

  const provenance = readOptionalObject(body, 'provenance', ROOT_PATH, state);
  if (provenance === null) return null;

  return {
    method: readVocabulary(MAPPING_METHODS, provenance.method, {
      path: `${path}/method`,
      code: codes.METHOD_INVALID,
      state,
    }),
    matchingRationale: readMatchingRationale(provenance, path, state),
    status: readVocabulary(MAPPING_STATUSES, provenance.status, {
      path: `${path}/status`,
      code: codes.STATUS_INVALID,
      state,
    }),
    // Markup bleibt Text; gerendert wird es nie als HTML.
    mappingDescription: readString(provenance['mapping-description']),
    confidenceScore: readConfidenceScore(provenance, path, state),
    coverage: readCoverage(provenance, path, state),
    props: readProps(provenance, path, state),
    links: readLinks(provenance, path, state),
    remarks: readString(provenance.remarks),
    path,
  };
}

function deriveMetadata(body: JsonObject): MappingCollectionMetadata {
  const metadata = isJsonObject(body.metadata) ? body.metadata : {};
  return {
    title: readString(metadata.title),
    lastModified: readString(metadata['last-modified']),
    version: readString(metadata.version),
    oscalVersion: readString(metadata['oscal-version']),
  };
}

/**
 * Die Version für den Referenz- und Diagnosekontext.
 *
 * Nur ein Wert aus der gepinnten Menge wird übernommen; alles andere wird
 * `null`. Der Dispatch hat die Bindung vor dem Aufruf bereits geprüft — dieser
 * Filter hält die Redaction-Regel auch dann ein, wenn jemand `derive` direkt
 * aufruft.
 */
function readPinnedOscalVersion(body: JsonObject): PinnedOscalVersion | null {
  const metadata = isJsonObject(body.metadata) ? body.metadata : null;
  const declared = metadata ? readString(metadata['oscal-version']) : undefined;
  return declared !== undefined && isPinnedOscalVersion(declared) ? declared : null;
}

/* ------------------------------------------------------------------ */
/*  Ableitung                                                          */
/* ------------------------------------------------------------------ */

/**
 * Leitet die Projektion einer Mapping Collection aus ihrem Root-Körper ab.
 *
 * Wirft **nicht**: Ein schemawidriges Dokument wird diagnostiziert, nicht
 * verworfen (ADR-7). Verworfen wird nur vorher, im Root-Dispatch.
 *
 * @param body Der unveränderte Root-Körper aus dem Dispatch
 * @param context Ableitungskontext; trägt Vertrauensklasse und Upstream-Pfad
 */
export function deriveMappingCollection(
  body: unknown,
  context: OscalDocumentContext,
): MappingCollection {
  const rootBody = isJsonObject(body) ? body : {};
  const oscalVersion = readPinnedOscalVersion(rootBody);
  const state: DeriveState = {
    diagnostics: [],
    // Der Registry-Schlüssel, nie der Upstream-Pfad: Diagnosen tragen nur
    // Werte aus geschlossenen Mengen.
    artifactKey: context.upstreamPath
      ? (getArtifactByUpstreamPath(context.upstreamPath)?.artifactKey ?? null)
      : null,
    oscalVersion,
    // Der Referenzschicht wird der Envelope gereicht, den sie erwartet. Die
    // Hülle ist neu, der Körper bleibt dasselbe Objekt — es wird nichts kopiert
    // und nichts verändert.
    referenceDocument: createReferenceDocument({
      source: { [MAPPING_COLLECTION_ROOT_TYPE]: rootBody },
      context,
      rootType: MAPPING_COLLECTION_ROOT_TYPE,
      oscalVersion: oscalVersion ?? 'unknown',
    }),
    uuidOrigins: new Map(),
  };

  if (!isJsonObject(body)) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, ROOT_PATH);
  }

  // Reihenfolge wie im Dokument: Identität, Provenance, dann die Mapping Sets.
  // Diagnosen sollen in Quellreihenfolge entstehen.
  //
  // Die Sammlungs-`uuid` wird registriert, aber nicht eingefordert: Ihr Fehlen
  // ist ein reiner Schemaverstoß, den Stufe 3 nennt, und macht die Projektion
  // nicht mehrdeutig. Bei `mapping` und `map` ist das anders — dort hängen
  // Adressierbarkeit und Eindeutigkeit der Einträge daran.
  const uuid = readIdentity(rootBody, ROOT_PATH, state, { required: false });
  const metadata = deriveMetadata(rootBody);
  const provenance = deriveProvenance(rootBody, state);
  const declaredMappings = readDeclaredMappings(rootBody, state);

  return {
    uuid,
    metadata,
    provenance,
    mappings: declaredMappings.entries.map(({ node, path }) =>
      deriveMapping(node, path, state),
    ),
    declaredMappingsForm: declaredMappings.form,
    // Eingefroren: Die Sammelphase ist mit der Rückgabe beendet, und ein
    // nachgereichter Befund wäre keiner.
    diagnostics: Object.freeze(state.diagnostics),
  };
}
