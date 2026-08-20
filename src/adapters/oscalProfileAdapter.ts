// =============================================================================
// Modelladapter `profile` — Control Layer (GSPP-240)
//
// Rein lesend und verlustfrei nach ADR-2: Die Wahrheit ist der unveränderte
// `source`, `view` ist die Projektion darauf. Der Adapter **löst nichts auf**.
// Ein Profile ist eine Auswahl-, Merge- und Änderungsanweisung; ihr Ergebnis
// entsteht erst in der Profile Resolution (GSPP-291). Alles, was dieser Slice
// liefert, trägt deshalb einen expliziten `not-resolved`-Marker.
//
// Drei Eigenheiten des Modells prägen den Adapter:
//
//  1. **Selektion ist eine Variante, kein Feld.** `include-all` und
//     `include-controls` schließen sich ab OSCAL 1.2.1 schemaseitig aus; unter
//     1.1.2/1.1.3 tun sie das nicht. Der Adapter bildet den Befund ab —
//     `include-all`, `include-controls`, `ambiguous` oder `none` — und
//     überlässt die Versionsaussage der Stufe 3.
//  2. **`matching` ist ein zweiter Selektionsweg.** Glob-Muster werden hier
//     erhalten, aber nie ausgewertet; sie bleiben von `with-ids` getrennt.
//  3. **Mehrere `alter`-Einträge auf derselben `control-id` sind normal.** Im
//     WLAN-Profil sind es bis zu fünf. Weder Verwerfen noch Überschreiben:
//     `alters` bleibt eine Liste, `altersByControlId` gruppiert sie.
//
// Referenzen werden ausschließlich über `src/domain/referenceResolution.ts`
// klassifiziert (GSPP-286). Dieser Adapter verzweigt an keiner Stelle selbst
// auf die Form eines `href`, normalisiert keinen Pfad und lädt nichts nach —
// insbesondere behandelt er ein `../`-Segment nicht als Angriff, sondern als
// das, was es ist: eine relative Referenz ohne Verzeichniskontext.
//
// Es gibt hier **keine** Profile-Versionskonstante: Welche Schemazelle gilt,
// entscheidet allein `metadata.oscal-version` über den Root-Dispatch (Stufe 2).
// Die Versionsunterschiede der Raw-Typen stehen in `src/domain/oscalProfile.ts`
// und hängen dort am Schema.
// =============================================================================

import {
  createReferenceDocument,
  resolveOscalReference,
} from '@/domain/referenceResolution';
import {
  diagnose,
  isJsonObject,
  PROFILE_ADAPTER_DIAGNOSTIC_CODES,
  readBoolean,
  readLinks,
  readObjectArrayField,
  readParams,
  readParts,
  readProps,
  readString,
  readStringArrayField,
} from '@/adapters/oscalProfileReaders';
import type { DeriveState, JsonObject } from '@/adapters/oscalProfileReaders';
import { PROFILE_RESOLUTION_STATE, PROFILE_ROOT_TYPE } from '@/domain/profileModel';
import type {
  Profile,
  ProfileAddition,
  ProfileAlteration,
  ProfileCombine,
  ProfileControlSelector,
  ProfileCustomGrouping,
  ProfileGroup,
  ProfileImport,
  ProfileInsertControls,
  ProfileMerge,
  ProfileMergeStructure,
  ProfileMetadata,
  ProfileModify,
  ProfileRemoval,
  ProfileSelection,
  ProfileSetParameter,
} from '@/domain/profileModel';
import type { OscalDocumentContext } from '@/domain/models';
import { isPinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { getArtifactByUpstreamPath } from '@/domain/sourceRegistry';

export { PROFILE_RESOLUTION_STATE, PROFILE_ROOT_TYPE } from '@/domain/profileModel';
export {
  PROFILE_ADAPTER_DIAGNOSTIC_CODES,
  PROFILE_ADAPTER_STAGE,
  PROFILE_ADAPTER_VALIDATOR,
} from '@/adapters/oscalProfileReaders';
export type * from '@/domain/profileModel';

const codes = PROFILE_ADAPTER_DIAGNOSTIC_CODES;

/* ------------------------------------------------------------------ */
/*  Selektion                                                          */
/* ------------------------------------------------------------------ */

function readSelectors(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): readonly ProfileControlSelector[] {
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
 * Bestimmt, welche Selektionsform ein `import` oder ein `insert-controls`
 * trägt.
 *
 * Maßgeblich ist die **Anwesenheit** des Schlüssels, nicht sein Wert:
 * `include-all` ist ein bedeutungstragendes leeres Objekt, und eine Prüfung
 * auf Wahrheitswert würde es verlieren.
 */
function readSelection(node: JsonObject, path: string, state: DeriveState): ProfileSelection {
  const hasIncludeAll = Object.hasOwn(node, 'include-all');
  const hasIncludeControls = Object.hasOwn(node, 'include-controls');

  if (hasIncludeAll && hasIncludeControls) {
    return {
      kind: 'ambiguous',
      includeControls: readSelectors(node, 'include-controls', path, state),
      diagnostic: diagnose(state, codes.SELECTION_AMBIGUOUS, path),
    };
  }
  if (hasIncludeAll) {
    return { kind: 'include-all' };
  }
  if (hasIncludeControls) {
    return {
      kind: 'include-controls',
      includeControls: readSelectors(node, 'include-controls', path, state),
    };
  }
  return { kind: 'none', diagnostic: diagnose(state, codes.SELECTION_MISSING, path) };
}

/* ------------------------------------------------------------------ */
/*  Imports                                                            */
/* ------------------------------------------------------------------ */

function deriveImports(body: JsonObject, state: DeriveState): readonly ProfileImport[] {
  const basePath = `/${PROFILE_ROOT_TYPE}`;
  const entries = readObjectArrayField(body, 'imports', basePath, state);

  const declared = body.imports;
  if (!Array.isArray(declared) || declared.length === 0) {
    // `imports` ist Pflichtfeld mit `minItems: 1` über alle vier gepinnten
    // Versionen. Ohne es ist das Dokument keine Tailoring-Anweisung mehr.
    //
    // Die Bedingung prüft bewusst die Form und nicht nur die Anwesenheit:
    // `imports: null` und `imports: {}` sind sonst still durchgelaufen, weil
    // die Leser einen Nullwert als „nicht vorhanden" behandeln. Bei einem
    // formfremden Wert entstehen zwei Befunde — der strukturelle und dieser —,
    // und beide sind zutreffend.
    diagnose(state, codes.IMPORTS_MISSING, `${basePath}/imports`);
  }

  return entries.map(({ node: entry, path }) => {
    const href = readString(entry.href);
    if (href === undefined) {
      // Erhalten, nicht verworfen: Der Knoten bleibt in der Projektion, aber
      // ohne erfundene Quelle.
      diagnose(state, codes.IMPORT_HREF_MISSING, `${path}/href`);
    }

    return {
      href,
      // Einziger Klassifikationsweg (GSPP-286): kein Netzzugriff, keine
      // Normalisierung gegen eine Basis, keine eigene href-Verzweigung hier.
      reference: href === undefined
        ? null
        : resolveOscalReference(
          { href, path: `${path}/href` },
          { document: state.referenceDocument },
        ),
      selection: readSelection(entry, path, state),
      excludeControls: readSelectors(entry, 'exclude-controls', path, state),
      path,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Merge                                                              */
/* ------------------------------------------------------------------ */

function readInsertControls(
  owner: JsonObject,
  ownerPath: string,
  state: DeriveState,
): readonly ProfileInsertControls[] {
  return readObjectArrayField(owner, 'insert-controls', ownerPath, state).map(
    ({ node: insert, path }) => ({
      order: readString(insert.order),
      selection: readSelection(insert, path, state),
      excludeControls: readSelectors(insert, 'exclude-controls', path, state),
      path,
    }),
  );
}

function readGroups(
  owner: JsonObject,
  ownerPath: string,
  state: DeriveState,
): readonly ProfileGroup[] {
  return readObjectArrayField(owner, 'groups', ownerPath, state).map(
    ({ node: group, path }) => ({
      id: readString(group.id),
      class: readString(group.class),
      title: readString(group.title),
      params: readParams(group, path, state),
      props: readProps(group, path, state),
      links: readLinks(group, path, state),
      parts: readParts(group, path, state),
      groups: readGroups(group, path, state),
      insertControls: readInsertControls(group, path, state),
      path,
    }),
  );
}

function readCustomGrouping(
  value: unknown,
  path: string,
  state: DeriveState,
): ProfileCustomGrouping {
  if (!isJsonObject(value)) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, path);
    return { groups: [], insertControls: [] };
  }
  return {
    groups: readGroups(value, path, state),
    insertControls: readInsertControls(value, path, state),
  };
}

/** Die drei Strukturdirektiven, in der Reihenfolge des Schemas. */
const MERGE_STRUCTURE_KEYS = ['flat', 'as-is', 'custom'] as const;

function readMergeStructure(
  merge: JsonObject,
  path: string,
  state: DeriveState,
): ProfileMergeStructure {
  const declared = MERGE_STRUCTURE_KEYS.filter((key) => Object.hasOwn(merge, key));
  const readCustom = () => readCustomGrouping(merge.custom, `${path}/custom`, state);

  if (declared.length > 1) {
    return {
      kind: 'ambiguous',
      declared,
      custom: declared.includes('custom') ? readCustom() : undefined,
      diagnostic: diagnose(state, codes.MERGE_STRUCTURE_AMBIGUOUS, path),
    };
  }
  if (declared.length === 0) {
    return { kind: 'none', diagnostic: diagnose(state, codes.MERGE_STRUCTURE_MISSING, path) };
  }

  switch (declared[0]) {
    case 'flat':
      return { kind: 'flat' };
    case 'as-is': {
      const asIs = readBoolean(merge['as-is']);
      if (asIs === undefined) {
        diagnose(state, codes.STRUCTURE_UNEXPECTED, `${path}/as-is`);
      }
      return { kind: 'as-is', asIs };
    }
    default:
      return { kind: 'custom', custom: readCustom() };
  }
}

/**
 * Liest `combine`. Ein vorhandenes, aber formfremdes `combine` wird
 * diagnostiziert und bleibt als leerer Knoten sichtbar — sonst wäre in der
 * Projektion nicht mehr erkennbar, dass die Anweisung überhaupt da war.
 */
function readCombine(
  merge: JsonObject,
  path: string,
  state: DeriveState,
): ProfileCombine | undefined {
  if (!Object.hasOwn(merge, 'combine')) return undefined;

  const combine = merge.combine;
  if (!isJsonObject(combine)) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, `${path}/combine`);
    return {};
  }
  return { method: readString(combine.method) };
}

function deriveMerge(body: JsonObject, state: DeriveState): ProfileMerge | null {
  const path = `/${PROFILE_ROOT_TYPE}/merge`;
  if (!Object.hasOwn(body, 'merge')) return null;

  const merge = body.merge;
  if (!isJsonObject(merge)) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, path);
    return null;
  }

  return {
    structure: readMergeStructure(merge, path, state),
    combine: readCombine(merge, path, state),
    // Erhalten, nicht ausgeführt: Diese Anweisung sagt, wie ein Resolver
    // gruppieren soll — dieser Slice ist kein Resolver.
    resolution: PROFILE_RESOLUTION_STATE,
    path,
  };
}

/* ------------------------------------------------------------------ */
/*  Modify                                                             */
/* ------------------------------------------------------------------ */

function readAdditions(
  alter: JsonObject,
  alterPath: string,
  state: DeriveState,
): readonly ProfileAddition[] {
  return readObjectArrayField(alter, 'adds', alterPath, state).map(({ node: add, path }) => ({
    // Alle vier Positionen des Schemas werden unverändert übernommen; im
    // BSI-Bestand kommt nur `starting` vor, das Modell kennt aber auch
    // `before`, `after` und `ending`.
    position: readString(add.position),
    byId: readString(add['by-id']),
    title: readString(add.title),
    params: readParams(add, path, state),
    props: readProps(add, path, state),
    links: readLinks(add, path, state),
    parts: readParts(add, path, state),
    path,
  }));
}

function readRemovals(
  alter: JsonObject,
  alterPath: string,
  state: DeriveState,
): readonly ProfileRemoval[] {
  return readObjectArrayField(alter, 'removes', alterPath, state).map(
    ({ node: remove, path }) => ({
      byName: readString(remove['by-name']),
      byClass: readString(remove['by-class']),
      byId: readString(remove['by-id']),
      byItemName: readString(remove['by-item-name']),
      byNs: readString(remove['by-ns']),
      path,
    }),
  );
}

function readSetParameters(
  modify: JsonObject,
  modifyPath: string,
  state: DeriveState,
): readonly ProfileSetParameter[] {
  return readObjectArrayField(modify, 'set-parameters', modifyPath, state).flatMap(
    ({ node: parameter, path }) => {
      const paramId = readString(parameter['param-id']);
      if (paramId === undefined) {
        diagnose(state, codes.STRUCTURE_UNEXPECTED, path);
        return [];
      }
      return [{
        paramId,
        class: readString(parameter.class),
        dependsOn: readString(parameter['depends-on']),
        label: readString(parameter.label),
        usage: readString(parameter.usage),
        values: readStringArrayField(parameter, 'values', path, state),
        props: readProps(parameter, path, state),
        links: readLinks(parameter, path, state),
        path,
      }];
    },
  );
}

/**
 * Gruppiert die Änderungsanweisungen nach ihrer `control-id`.
 *
 * Der Wert ist eine Liste und keine einzelne Anweisung: Ein `Map.set()` je
 * `control-id` verlöre im WLAN-Profil 232 der 290 Einträge.
 */
function groupAltersByControlId(
  alters: readonly ProfileAlteration[],
): ReadonlyMap<string, readonly ProfileAlteration[]> {
  const index = new Map<string, ProfileAlteration[]>();
  for (const alter of alters) {
    if (alter.controlId === undefined) continue;
    const existing = index.get(alter.controlId);
    if (existing) {
      existing.push(alter);
      continue;
    }
    index.set(alter.controlId, [alter]);
  }
  return index;
}

function deriveModify(body: JsonObject, state: DeriveState): ProfileModify | null {
  const path = `/${PROFILE_ROOT_TYPE}/modify`;
  if (!Object.hasOwn(body, 'modify')) return null;

  const modify = body.modify;
  if (!isJsonObject(modify)) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, path);
    return null;
  }

  // Reihenfolge wie im Dokument: `set-parameters` steht vor `alters`, und
  // Diagnosen sollen in Quellreihenfolge entstehen.
  const setParameters = readSetParameters(modify, path, state);
  const alters = readObjectArrayField(modify, 'alters', path, state).map(
    ({ node: alter, path: alterPath }) => {
      const controlId = readString(alter['control-id']);
      if (controlId === undefined) {
        // Der Eintrag bleibt erhalten; ohne Ziel ist er nur nicht gruppierbar.
        diagnose(state, codes.ALTER_CONTROL_ID_MISSING, `${alterPath}/control-id`);
      }
      return {
        controlId,
        adds: readAdditions(alter, alterPath, state),
        removes: readRemovals(alter, alterPath, state),
        path: alterPath,
      };
    },
  );

  return {
    setParameters,
    alters,
    altersByControlId: groupAltersByControlId(alters),
    resolution: PROFILE_RESOLUTION_STATE,
    path,
  };
}

/* ------------------------------------------------------------------ */
/*  Ableitung                                                          */
/* ------------------------------------------------------------------ */

function deriveMetadata(body: JsonObject): ProfileMetadata {
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

/**
 * Leitet die Projektion eines Profile aus seinem Root-Körper ab.
 *
 * Wirft **nicht**: Ein schemawidriges Dokument wird diagnostiziert, nicht
 * verworfen (ADR-7). Verworfen wird nur vorher, im Root-Dispatch.
 *
 * @param body Der unveränderte Root-Körper aus dem Dispatch
 * @param context Ableitungskontext; trägt Vertrauensklasse und Upstream-Pfad
 */
export function deriveProfile(body: unknown, context: OscalDocumentContext): Profile {
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
      source: { [PROFILE_ROOT_TYPE]: rootBody },
      context,
      rootType: PROFILE_ROOT_TYPE,
      oscalVersion: oscalVersion ?? 'unknown',
    }),
  };

  if (!isJsonObject(body)) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, `/${PROFILE_ROOT_TYPE}`);
  }

  return {
    uuid: readString(rootBody.uuid),
    metadata: deriveMetadata(rootBody),
    imports: deriveImports(rootBody, state),
    merge: deriveMerge(rootBody, state),
    modify: deriveModify(rootBody, state),
    // Der Slice liest; er löst nicht auf. Kein Feld dieser Projektion behauptet
    // ein aufgelöstes Control-Set (GSPP-291).
    resolution: PROFILE_RESOLUTION_STATE,
    // Eingefroren: Die Sammelphase ist mit der Rückgabe beendet, und ein
    // nachgereichter Befund wäre keiner.
    diagnostics: Object.freeze(state.diagnostics),
  };
}
