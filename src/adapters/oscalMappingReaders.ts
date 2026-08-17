// =============================================================================
// Knotenleser und Diagnosesammler des Mapping-Adapters (GSPP-245)
//
// Dieselbe Leserregel wie im Profile- (GSPP-240) und im Component-Adapter
// (GSPP-248): Ein **vorhandener** Wert der falschen Form wird diagnostiziert,
// statt still zu verschwinden. Normalisiert wird nichts — aus einem
// Einzelobjekt wird kein Array, und der Quellgraph bleibt, wie er ist (ADR-2).
//
// Neu gegenüber den beiden ist die **Vokabularprüfung**. Sie steht hier, weil
// sie beim Mapping-Modell kein Komfort, sondern eine Lücke im Schema schließt:
// `map/relationship` ist im JSON-Schema nur `TokenDatatype` ohne Enum, weil das
// Metaschema-Constraint an `has-oscal-namespace(…)` hängt und deshalb nicht in
// das JSON-Schema übernommen wird. Eine reine Schemaprüfung akzeptiert damit
// einen frei erfundenen Beziehungstyp — und mit ihm eine Aussage, die niemand
// lesen kann. Dieselbe Konstruktion trägt `mapping-resource-reference/type`,
// dort zusätzlich mit `allow-other="yes"`.
//
// Die Prüftiefe ist deshalb **feldweise verschieden**, und der Adapter macht
// das sichtbar statt es zu vereinheitlichen:
//
// | Feld | JSON-Schema | Diese Schicht |
// | --- | --- | --- |
// | `method`, `status`, `matching-rationale` | `allOf` mit Enum — bindet | prüft zusätzlich, damit die Projektion typisiert ist |
// | `mapping-item/type` | `allOf` mit Enum — bindet | dito |
// | `qualifier/subject`, `/predicate`, `/category` | `allOf` mit Enum — bindet | dito |
// | `map/relationship` | `TokenDatatype`, **kein** Enum | **einzige** Prüfung |
// | `mapping-resource-reference/type` | `anyOf` mit `allow-other` — bindet nicht | **einzige** Prüfung |
// =============================================================================

import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDiagnostic, OscalDiagnosticValidator } from '@/domain/oscalDiagnostics';
import type { ReferenceDocument } from '@/domain/referenceResolution';
import {
  MAPPING_COLLECTION_ROOT_TYPE,
  OSCAL_NAMESPACE,
} from '@/domain/mappingModel';
import type {
  MappingLink,
  MappingProp,
  MappingVocabularyBinding,
} from '@/domain/mappingModel';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

/** Stufe der modellinternen Befunde dieses Adapters. */
export const MAPPING_ADAPTER_STAGE = 'domain' as const;

/**
 * Vertragsversion des Adapters; sie geht in jede Diagnosesignatur ein und wird
 * erhöht, wenn sich Codes, Pfade oder Parameter einer bestehenden Diagnose
 * ändern.
 */
export const MAPPING_ADAPTER_VALIDATOR: OscalDiagnosticValidator = Object.freeze({
  name: 'gspp-mapping-adapter',
  version: '1',
});

export const MAPPING_ADAPTER_DIAGNOSTIC_CODES = Object.freeze({
  /** `mappings` fehlt oder hat weder Objekt- noch Arrayform. */
  MAPPINGS_MISSING: 'OSCAL_MAPPING_MAPPINGS_MISSING',
  /** `provenance` fehlt — sie ist Pflichtfeld der Sammlung, kein Extra. */
  PROVENANCE_MISSING: 'OSCAL_MAPPING_PROVENANCE_MISSING',
  /** `mapping` ohne `maps`; schemaseitig ist mindestens einer verlangt. */
  MAPS_MISSING: 'OSCAL_MAPPING_MAPS_MISSING',
  /** `source-resource` oder `target-resource` fehlt — eine Seite ist unbenannt. */
  RESOURCE_MISSING: 'OSCAL_MAPPING_RESOURCE_MISSING',
  /** Ressourcenreferenz ohne `href`. */
  RESOURCE_HREF_MISSING: 'OSCAL_MAPPING_RESOURCE_HREF_MISSING',
  /** Ressourcentyp außerhalb von `catalog`/`profile` im OSCAL-Namensraum. */
  RESOURCE_TYPE_INVALID: 'OSCAL_MAPPING_RESOURCE_TYPE_INVALID',
  /** `map` ohne `relationship` — die Aussage des Eintrags fehlt. */
  RELATIONSHIP_MISSING: 'OSCAL_MAPPING_RELATIONSHIP_MISSING',
  /** Beziehungstyp außerhalb des Vokabulars im OSCAL-Namensraum. */
  RELATIONSHIP_INVALID: 'OSCAL_MAPPING_RELATIONSHIP_INVALID',
  /** `mapping-item/type` außerhalb von `control`/`statement`. */
  ITEM_TYPE_INVALID: 'OSCAL_MAPPING_ITEM_TYPE_INVALID',
  /** `mapping-item` ohne `id-ref` — das Subjekt fehlt. */
  ITEM_ID_REF_MISSING: 'OSCAL_MAPPING_ITEM_ID_REF_MISSING',
  /** `sources` oder `targets` fehlt oder ist leer; verlangt sind 1..n. */
  ITEM_SET_EMPTY: 'OSCAL_MAPPING_ITEM_SET_EMPTY',
  /**
   * Der Ressourcenkontext einer Seite ist nicht aufgelöst; die `id-ref`-Werte
   * dieser Seite bleiben damit uninterpretiert.
   */
  ID_REF_CONTEXT_UNRESOLVED: 'OSCAL_MAPPING_ID_REF_CONTEXT_UNRESOLVED',
  /** `method` außerhalb von `human`/`automation`/`hybrid`. */
  METHOD_INVALID: 'OSCAL_MAPPING_METHOD_INVALID',
  /** `status` außerhalb des fünfwertigen Dokumentstatus. */
  STATUS_INVALID: 'OSCAL_MAPPING_STATUS_INVALID',
  /** `matching-rationale` außerhalb von `syntactic`/`semantic`/`functional`. */
  MATCHING_RATIONALE_INVALID: 'OSCAL_MAPPING_MATCHING_RATIONALE_INVALID',
  /** `qualifier`-Wert außerhalb seines Vokabulars; der Pfad nennt das Feld. */
  QUALIFIER_VALUE_INVALID: 'OSCAL_MAPPING_QUALIFIER_VALUE_INVALID',
  /** `mapping` oder `map` ohne `uuid` — die Identität des Knotens fehlt. */
  UUID_MISSING: 'OSCAL_MAPPING_UUID_MISSING',
  /** Dieselbe `uuid` an mehr als einer Stelle des Dokuments. */
  UUID_DUPLICATE: 'OSCAL_MAPPING_UUID_DUPLICATE',
  /** Knoten hat nicht die vom Modell erwartete Form (z. B. Objekt statt Array). */
  STRUCTURE_UNEXPECTED: 'OSCAL_MAPPING_STRUCTURE_UNEXPECTED',
});

const codes = MAPPING_ADAPTER_DIAGNOSTIC_CODES;

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface DeriveState {
  readonly diagnostics: OscalDiagnostic[];
  readonly artifactKey: string | null;
  readonly oscalVersion: PinnedOscalVersion | null;
  readonly referenceDocument: ReferenceDocument;
  /** Erstfundort je `uuid`; der zweite Fundort erzeugt den Duplikatbefund. */
  readonly uuidOrigins: Map<string, string>;
}

export function diagnose(state: DeriveState, code: string, path: string): OscalDiagnostic {
  const diagnostic = createOscalDiagnostic({
    code,
    stage: MAPPING_ADAPTER_STAGE,
    validator: MAPPING_ADAPTER_VALIDATOR,
    path,
    artifact: {
      key: state.artifactKey,
      rootType: MAPPING_COLLECTION_ROOT_TYPE,
      oscalVersion: state.oscalVersion,
    },
  });
  state.diagnostics.push(diagnostic);
  return diagnostic;
}

/* ------------------------------------------------------------------ */
/*  Identitäten                                                        */
/* ------------------------------------------------------------------ */

/**
 * Liest eine `uuid` und meldet sie zur Eindeutigkeitsprüfung an.
 *
 * Doppelte Identitäten sind kein Schönheitsfehler: `mapping` und `map` sind
 * über ihre `uuid` dokumentübergreifend adressierbar, und zwei Knoten unter
 * derselben Adresse machen jede spätere Referenz mehrdeutig. Der Befund hängt
 * am **zweiten** Fundort — der erste ist für sich genommen unauffällig.
 */
export function readIdentity(
  node: JsonObject,
  path: string,
  state: DeriveState,
  { required }: { required: boolean },
): string | undefined {
  const uuid = readString(node.uuid);
  if (uuid === undefined) {
    if (required) diagnose(state, codes.UUID_MISSING, `${path}/uuid`);
    return undefined;
  }

  if (state.uuidOrigins.has(uuid)) {
    diagnose(state, codes.UUID_DUPLICATE, `${path}/uuid`);
    return uuid;
  }
  state.uuidOrigins.set(uuid, path);
  return uuid;
}

/* ------------------------------------------------------------------ */
/*  Vokabularbindung                                                   */
/* ------------------------------------------------------------------ */

function unknownBinding<T extends string>(
  state: DeriveState,
  code: string,
  path: string,
  declared?: string,
): MappingVocabularyBinding<T> {
  // Der Rohwert bleibt in der Projektion und erscheint **nicht** in der
  // Diagnose: Er ist unvertrauenswürdige Eingabe (Redaction-Regel).
  return { kind: 'unknown', declared, diagnostic: diagnose(state, code, path) };
}

/**
 * Bindet einen Wert an ein kontrolliertes Vokabular ohne Namensraumbezug.
 *
 * Liefert `undefined`, wenn der Schlüssel fehlt — ob das zulässig ist, weiß nur
 * die Aufrufstelle. Ein vorhandener Nicht-String ist dagegen nie zulässig.
 */
export function readVocabulary<T extends string>(
  allowed: readonly T[],
  value: unknown,
  options: { readonly path: string; readonly code: string; readonly state: DeriveState },
): MappingVocabularyBinding<T> | undefined {
  if (value === undefined || value === null) return undefined;

  const declared = readString(value);
  if (declared === undefined) {
    return unknownBinding(options.state, options.code, options.path);
  }
  if ((allowed as readonly string[]).includes(declared)) {
    return { kind: 'known', value: declared as T, declared };
  }
  return unknownBinding(options.state, options.code, options.path, declared);
}

/**
 * Wie `readVocabulary`, aber für die beiden Felder, deren Vokabular das
 * Metaschema an `has-oscal-namespace(…)` bindet.
 *
 * Ein `ns`, der einen fremden Namensraum benennt, hebt die Bindung auf: Dort
 * darf eine Organisation eigene Beziehungs- oder Ressourcentypen einführen, und
 * ein Befund wäre dann eine Fehlmeldung. Fehlt `ns`, gilt laut Metaschema der
 * OSCAL-Namensraum, und das Vokabular bindet.
 *
 * Ein bekannter Wert unter fremdem `ns` bleibt bewusst `extension`: Er sieht
 * nur aus wie der OSCAL-Wert, seine Bedeutung stammt aus dem fremden
 * Namensraum.
 */
export function readNamespacedVocabulary<T extends string>(
  allowed: readonly T[],
  value: unknown,
  ns: string | undefined,
  options: { readonly path: string; readonly code: string; readonly state: DeriveState },
): MappingVocabularyBinding<T> | undefined {
  if (value === undefined || value === null) return undefined;

  const declared = readString(value);
  if (declared === undefined) {
    return unknownBinding(options.state, options.code, options.path);
  }
  if (ns !== undefined && ns !== OSCAL_NAMESPACE) {
    return { kind: 'extension', declared, ns };
  }
  if ((allowed as readonly string[]).includes(declared)) {
    return { kind: 'known', value: declared as T, declared };
  }
  return unknownBinding(options.state, options.code, options.path, declared);
}

/** Eine Pflicht-Vokabularbindung, deren Wert ganz fehlt. */
export function missingVocabulary<T extends string>(
  state: DeriveState,
  code: string,
  path: string,
): MappingVocabularyBinding<T> {
  return unknownBinding(state, code, path);
}

/* ------------------------------------------------------------------ */
/*  Strukturleser                                                      */
/* ------------------------------------------------------------------ */

/**
 * Liest ein Arrayfeld. Ein **vorhandener** Nicht-Array-Wert wird diagnostiziert
 * statt still zu `[]` zu werden — sonst verschwände eine
 * Kardinalitätsverletzung spurlos aus der Projektion.
 */
export function readArrayField(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): readonly unknown[] {
  const value = node[key];
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;

  diagnose(state, codes.STRUCTURE_UNEXPECTED, `${path}/${key}`);
  return [];
}

/** Wie `readArrayField`, liefert aber nur die Objekteinträge und diagnostiziert den Rest. */
export function readObjectArrayField(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): readonly { readonly node: JsonObject; readonly path: string }[] {
  return readArrayField(node, key, path, state).flatMap((entry, index) => {
    const entryPath = `${path}/${key}/${index}`;
    if (!isJsonObject(entry)) {
      diagnose(state, codes.STRUCTURE_UNEXPECTED, entryPath);
      return [];
    }
    return [{ node: entry, path: entryPath }];
  });
}

export function readStringArrayField(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): readonly string[] {
  return readArrayField(node, key, path, state).flatMap((entry, index) => {
    if (typeof entry !== 'string') {
      diagnose(state, codes.STRUCTURE_UNEXPECTED, `${path}/${key}/${index}`);
      return [];
    }
    return [entry];
  });
}

export function readProps(
  node: JsonObject,
  path: string,
  state: DeriveState,
): readonly MappingProp[] {
  return readObjectArrayField(node, 'props', path, state).flatMap(
    ({ node: prop, path: propPath }) => {
      const name = readString(prop.name);
      const value = readString(prop.value);
      if (name === undefined || value === undefined) {
        diagnose(state, codes.STRUCTURE_UNEXPECTED, propPath);
        return [];
      }
      return [{ name, value, ns: readString(prop.ns), class: readString(prop.class) }];
    },
  );
}

export function readLinks(
  node: JsonObject,
  path: string,
  state: DeriveState,
): readonly MappingLink[] {
  return readObjectArrayField(node, 'links', path, state).flatMap(
    ({ node: link, path: linkPath }) => {
      const href = readString(link.href);
      if (href === undefined) {
        diagnose(state, codes.STRUCTURE_UNEXPECTED, linkPath);
        return [];
      }
      return [{ href, rel: readString(link.rel), text: readString(link.text) }];
    },
  );
}

/**
 * Liest einen optionalen Objektknoten. Ein vorhandener, aber formfremder Knoten
 * wird diagnostiziert und als `null` zurückgegeben — er verschwindet damit aus
 * der Projektion, aber nicht aus den Befunden.
 */
export function readOptionalObject(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): JsonObject | null {
  if (!Object.hasOwn(node, key)) return null;

  const value = node[key];
  if (!isJsonObject(value)) {
    diagnose(state, codes.STRUCTURE_UNEXPECTED, `${path}/${key}`);
    return null;
  }
  return value;
}
