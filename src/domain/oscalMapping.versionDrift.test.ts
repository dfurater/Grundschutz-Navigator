// @vitest-environment node
// =============================================================================
// Versionsdrift des Mapping-Modells (GSPP-245)
//
// Die Raw-Typen in `oscalMapping.ts` sind **nicht** über `PinnedOscalVersion`
// parametrisiert — anders als beim Profile (GSPP-240) und beim Component-Modell
// (GSPP-248). Das ist eine Aussage über die vendorierten Schemas und darf
// deshalb nicht am Gedächtnis hängen: Dieser Test liest die gepinnten
// `oscal_mapping_schema.json` und weist nach, dass sie sich in **keiner**
// Definition unterscheiden.
//
// Er hat zwei weitere Aufgaben, die über die Drift hinausgehen:
//
//  * Er misst die Modellexistenz. Vor OSCAL 1.2.0 gibt es kein
//    Mapping-Schema — die Matrix modelliert das als Unmöglichkeit, und hier
//    wird gegengeprüft, dass genau die unmöglichen Zellen kein vendoriertes
//    Asset haben.
//  * Er misst die **Prüftiefe je Feld**. Dass `relationship` kein Enum trägt
//    und `mapping-resource-reference/type` ein `allow-other`-`anyOf` ist, ist
//    die Begründung für die eigene Vokabularprüfung im Adapter. Eine Prosa-
//    Behauptung darüber wäre beim nächsten Schemarelease unbemerkt falsch.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getSchemaPin,
  isImpossibleCombination,
  PINNED_OSCAL_VERSIONS,
} from '@/domain/oscalVersionMatrix';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import {
  MAPPING_ITEM_TYPES,
  MAPPING_METHODS,
  MAPPING_QUALIFIER_CATEGORIES,
  MAPPING_QUALIFIER_PREDICATES,
  MAPPING_QUALIFIER_SUBJECTS,
  MAPPING_RELATIONSHIP_GAP,
  MAPPING_RELATIONSHIPS,
  MAPPING_RESOURCE_TYPES,
  MAPPING_STATUSES,
} from '@/domain/mappingModel';

interface SchemaNode {
  properties?: Record<string, SchemaNode>;
  required?: string[];
  anyOf?: SchemaNode[];
  allOf?: SchemaNode[];
  enum?: string[];
  $ref?: string;
}

interface MappingSchema {
  $id: string;
  definitions: Record<string, SchemaNode>;
}

/** Die Versionen mit einer existierenden Mapping-Zelle — aus der Matrix. */
const MAPPED_VERSIONS = PINNED_OSCAL_VERSIONS.filter(
  (version) => getSchemaPin('mapping-collection', version) !== null,
);

/**
 * Liest das für `mapping-collection` × `version` gepinnte Schema.
 *
 * Der Pfad kommt aus der Versionsmatrix und wird hier nicht zweitgepflegt: Ein
 * eigenes Pfadmuster würde nach einer Pin-Aktualisierung entweder rot oder,
 * schlimmer, weiter das alte Asset lesen.
 */
function readMappingSchema(version: PinnedOscalVersion): MappingSchema {
  const pin = getSchemaPin('mapping-collection', version);
  if (!pin) throw new Error(`Die Versionsmatrix pinnt mapping-collection@${version} nicht`);

  return JSON.parse(readFileSync(pin.vendorPath, 'utf8')) as MappingSchema;
}

const schemas = new Map(
  MAPPED_VERSIONS.map((version) => [version, readMappingSchema(version)] as const),
);

function definitionOf(version: PinnedOscalVersion, name: string): SchemaNode {
  const definitions = schemas.get(version)?.definitions ?? {};
  const key = Object.keys(definitions).find((entry) => entry.split(':').pop() === name);
  if (!key) throw new Error(`Das Mapping-Schema ${version} kennt keine Definition "${name}"`);

  return definitions[key]!;
}

/** Die im Schema gebundene Aufzählung eines Feldes, sofern sie bindet. */
function bindingEnumOf(node: SchemaNode | undefined): readonly string[] | null {
  // `allOf` bindet: Jeder Zweig muss gelten. `anyOf` mit einem freien Datentyp
  // ist genau das Muster, das Metaschema für `allow-other="yes"` erzeugt — es
  // bindet nicht.
  const branch = node?.allOf?.find((entry) => Array.isArray(entry.enum));
  return branch?.enum ?? null;
}

describe('Modellexistenz erst ab OSCAL 1.2.0', () => {
  it('pinnt genau die Versionen, in denen es das Modell gibt', () => {
    for (const version of PINNED_OSCAL_VERSIONS) {
      const pinned = getSchemaPin('mapping-collection', version) !== null;

      expect(pinned, version).toBe(!isImpossibleCombination('mapping-collection', version));
    }
    // Ohne diese Schranke liefe der Vergleich unten trivial durch, sobald nur
    // noch eine Zelle existierte.
    expect(MAPPED_VERSIONS.length).toBeGreaterThan(1);
  });

  it('trägt in jedem gepinnten Asset die $id seiner eigenen Version', () => {
    for (const version of MAPPED_VERSIONS) {
      expect(schemas.get(version)?.$id, version)
        .toBe(getSchemaPin('mapping-collection', version)?.schemaId);
    }
  });
});

describe('oscal_mapping_schema — Unterschiede über die gepinnten Versionen', () => {
  it('führt keine einzige abweichende Definition', () => {
    const [reference, ...others] = MAPPED_VERSIONS;
    const referenceDefinitions = schemas.get(reference!)?.definitions ?? {};

    for (const version of others) {
      const definitions = schemas.get(version)?.definitions ?? {};

      expect(Object.keys(definitions).sort(), version)
        .toEqual(Object.keys(referenceDefinitions).sort());

      const differing = Object.keys(definitions).filter((name) =>
        JSON.stringify(definitions[name]) !== JSON.stringify(referenceDefinitions[name]),
      );
      // Genau deshalb sind die Raw-Typen in `oscalMapping.ts` nicht
      // versionsparametrisiert: Es gibt keine Partition zu beschreiben.
      expect(differing, version).toEqual([]);
    }
  });

  it('hält die Pflichtfelder der Sammlung über alle gepinnten Versionen konstant', () => {
    for (const version of MAPPED_VERSIONS) {
      expect([...(definitionOf(version, 'mapping-collection').required ?? [])].sort(), version)
        .toEqual(['mappings', 'metadata', 'provenance', 'uuid']);
      // `provenance` ist Pflichtfeld und selbst geschlossen — daran hängt der
      // ADR-7-Befund des ISO-Mappings.
      expect([...(definitionOf(version, 'mapping-provenance').required ?? [])].sort(), version)
        .toEqual(['mapping-description', 'matching-rationale', 'method', 'status']);
      expect([...(definitionOf(version, 'map').required ?? [])].sort(), version)
        .toEqual(['relationship', 'sources', 'targets', 'uuid']);
      expect([...(definitionOf(version, 'mapping').required ?? [])].sort(), version)
        .toEqual(['maps', 'source-resource', 'target-resource', 'uuid']);
    }
  });

  it('führt mappings als anyOf aus Einzelobjekt und Liste', () => {
    for (const version of MAPPED_VERSIONS) {
      const mappings = definitionOf(version, 'mapping-collection').properties?.mappings;

      expect(mappings?.anyOf, version).toHaveLength(2);
      // Die Einzelform ist schemavalide; ein Adapter, der nur `Array.isArray`
      // prüft, parst ein gültiges Dokument leer.
      expect(mappings?.anyOf?.[0]?.$ref, version).toContain('mapping');
      expect(mappings?.anyOf?.[1]?.required, version).toBeUndefined();
    }
  });
});

describe('Prüftiefe je Feld — was das JSON-Schema bindet und was nicht', () => {
  it('bindet relationship nicht: kein Enum im JSON-Schema', () => {
    for (const version of MAPPED_VERSIONS) {
      const relationship = definitionOf(version, 'map').properties?.relationship;

      // Das kontrollierte Vokabular steht ausschließlich als
      // Metaschema-`allowed-values` mit `has-oscal-namespace(…)`-Prädikat und
      // wird deshalb nicht in das JSON-Schema übernommen.
      expect(bindingEnumOf(relationship), version).toBeNull();
      expect(relationship?.enum, version).toBeUndefined();
      expect(relationship?.$ref, version).toContain('TokenDatatype');
    }
  });

  it('bindet den Ressourcentyp nicht: anyOf mit freiem Datentyp', () => {
    for (const version of MAPPED_VERSIONS) {
      const type = definitionOf(version, 'mapping-resource-reference').properties?.type;

      expect(bindingEnumOf(type), version).toBeNull();
      // Das Muster für `allow-other="yes"`: Der freie Datentyp erfüllt das
      // `anyOf` allein, die Aufzählung ist dann wirkungslos.
      expect(type?.anyOf?.some((branch) => branch.$ref?.includes('TokenDatatype')), version)
        .toBe(true);
      // Die Aufzählung selbst bleibt der normative Wortlaut des Modells.
      expect(type?.anyOf?.find((branch) => branch.enum)?.enum, version)
        .toEqual([...MAPPING_RESOURCE_TYPES]);
    }
  });

  it('bindet dagegen Methode, Status, Rationale, Item- und Qualifier-Werte', () => {
    for (const version of MAPPED_VERSIONS) {
      const mapping = definitionOf(version, 'mapping').properties;
      const qualifier = definitionOf(version, 'qualifier-item').properties;

      expect(bindingEnumOf(mapping?.method), version).toEqual([...MAPPING_METHODS]);
      expect(bindingEnumOf(mapping?.status), version).toEqual([...MAPPING_STATUSES]);
      expect(bindingEnumOf(definitionOf(version, 'mapping-item').properties?.type), version)
        .toEqual([...MAPPING_ITEM_TYPES]);
      expect(bindingEnumOf(qualifier?.subject), version)
        .toEqual([...MAPPING_QUALIFIER_SUBJECTS]);
      expect(bindingEnumOf(qualifier?.predicate), version)
        .toEqual([...MAPPING_QUALIFIER_PREDICATES]);
      expect(bindingEnumOf(qualifier?.category), version)
        .toEqual([...MAPPING_QUALIFIER_CATEGORIES]);
    }
  });

  it('hält die sechs Beziehungstypen des Modells vollständig', () => {
    // Das Vokabular selbst steht nicht im JSON-Schema; geprüft wird deshalb,
    // dass das Domänenmodell die im Metaschema geführten sechs Werte trägt und
    // `no-relationship` nicht darunter fehlt.
    expect([...MAPPING_RELATIONSHIPS].sort()).toEqual([
      'equal-to',
      'equivalent-to',
      'intersects-with',
      'no-relationship',
      'subset-of',
      'superset-of',
    ]);
    expect(MAPPING_RELATIONSHIPS).toContain(MAPPING_RELATIONSHIP_GAP);
  });
});
