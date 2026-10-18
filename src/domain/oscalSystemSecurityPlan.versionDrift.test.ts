// @vitest-environment node
// =============================================================================
// Versionsdrift des SSP-Modells (GSPP-293)
//
// Die Raw-Typen in `oscalSystemSecurityPlan.ts` tragen ein Versionsliteral
// (`users` Pflicht in 1.1.x) und übernehmen `protocol`/`port-range` aus dem
// Implementation-Common-Modell. Dieser Test liest alle vier gepinnten
// `oscal_ssp_schema.json` und weist die vollständige Menge der
// Definitionsunterschiede nach. Kommt upstream ein weiterer dazu, wird er hier
// rot, bevor die Typen ihn stillschweigend verschlucken.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

interface DefinitionShape {
  readonly props: readonly string[];
  readonly required: readonly string[];
  readonly anyOf: boolean;
}

interface SchemaDefinition {
  properties?: Record<string, { minItems?: number }>;
  required?: string[];
  anyOf?: unknown[];
}

/** Repo-relativ; das Arbeitsverzeichnis des Testlaufs ist die Projektwurzel. */
function readDefinitions(version: PinnedOscalVersion): Record<string, SchemaDefinition> {
  const schema = JSON.parse(
    readFileSync(`schemas/oscal/v${version}/oscal_ssp_schema.json`, 'utf8'),
  ) as { definitions: Record<string, SchemaDefinition> };
  return schema.definitions;
}

/** `<Assembly-Name> → Form`; der wandernde Namensraumpräfix ist abgeschnitten. */
function shapeOf(version: PinnedOscalVersion): ReadonlyMap<string, DefinitionShape> {
  return new Map(
    Object.entries(readDefinitions(version)).map(([key, definition]) => [
      key.split(':').pop() ?? key,
      {
        props: Object.keys(definition.properties ?? {}).sort(),
        required: [...(definition.required ?? [])].sort(),
        anyOf: Array.isArray(definition.anyOf),
      },
    ]),
  );
}

const shapes = new Map(PINNED_OSCAL_VERSIONS.map((version) => [version, shapeOf(version)] as const));

function signature(version: PinnedOscalVersion, name: string): string {
  const shape = shapes.get(version)?.get(name);
  return shape === undefined ? 'ABSENT' : JSON.stringify(shape);
}

function shape(version: PinnedOscalVersion, name: string): DefinitionShape | undefined {
  return shapes.get(version)?.get(name);
}

describe('oscal_ssp_schema — Unterschiede über die vier gepinnten Versionen', () => {
  it('führt genau die bekannten abweichenden Definitionen', () => {
    const names = new Set(
      PINNED_OSCAL_VERSIONS.flatMap((version) => [...(shapes.get(version)?.keys() ?? [])]),
    );
    const differing = [...names]
      .filter((name) => new Set(PINNED_OSCAL_VERSIONS.map((version) => signature(version, name))).size > 1)
      .sort();

    // `system-implementation`, `protocol` und `port-range` sind vom SSP-Root
    // aus erreichbar und in den Raw-Typen abgebildet. Die übrigen sind
    // Datentyp- und Selektionsdefinitionen, die der SSP-Root nicht erreicht.
    expect(differing).toEqual([
      'MarkupLineDatatype',
      'MarkupMultilineDatatype',
      'matching',
      'parameter',
      'port-range',
      'protocol',
      'select-control-by-id',
      'system-implementation',
      'with-id',
    ]);
  });

  it('verlangt system-implementation.users ausschließlich in 1.1.2 und 1.1.3', () => {
    expect(shape('1.1.2', 'system-implementation')?.required).toEqual(['components', 'users']);
    expect(shape('1.1.3', 'system-implementation')?.required).toEqual(['components', 'users']);
    expect(shape('1.2.1', 'system-implementation')?.required).toEqual(['components']);
    expect(shape('1.2.2', 'system-implementation')?.required).toEqual(['components']);

    for (const version of PINNED_OSCAL_VERSIONS) {
      const definition = Object.entries(readDefinitions(version))
        .find(([key]) => key.endsWith(':system-implementation'))?.[1];
      expect(definition?.properties?.users?.minItems, version).toBe(1);
      expect(definition?.properties?.components?.minItems, version).toBe(1);
    }
  });

  it('verlangt protocol.name ausschließlich in 1.1.2', () => {
    expect(shape('1.1.2', 'protocol')?.required).toEqual(['name']);
    expect(shape('1.1.3', 'protocol')?.required).toEqual([]);
    expect(shape('1.2.1', 'protocol')?.required).toEqual([]);
    expect(shape('1.2.2', 'protocol')?.required).toEqual([]);
  });

  it('deklariert port-range.remarks erst ab 1.2.1', () => {
    expect(shape('1.1.2', 'port-range')?.props).not.toContain('remarks');
    expect(shape('1.1.3', 'port-range')?.props).not.toContain('remarks');
    expect(shape('1.2.1', 'port-range')?.props).toContain('remarks');
    expect(shape('1.2.2', 'port-range')?.props).toContain('remarks');
  });

  it('macht parameter erst ab 1.2.1 zur anyOf-Auswahl', () => {
    expect(shape('1.1.2', 'parameter')?.anyOf).toBe(false);
    expect(shape('1.1.3', 'parameter')?.anyOf).toBe(false);
    expect(shape('1.2.1', 'parameter')?.anyOf).toBe(true);
    expect(shape('1.2.2', 'parameter')?.anyOf).toBe(true);
  });

  it('hält die übrigen Pflichtstrukturen über alle vier Versionen konstant', () => {
    for (const version of PINNED_OSCAL_VERSIONS) {
      expect(shape(version, 'system-security-plan')?.required, version).toEqual([
        'control-implementation',
        'import-profile',
        'metadata',
        'system-characteristics',
        'system-implementation',
        'uuid',
      ]);
      expect(shape(version, 'import-profile')?.required, version).toEqual(['href']);
      expect(shape(version, 'system-characteristics')?.required, version).toEqual([
        'authorization-boundary',
        'description',
        'status',
        'system-ids',
        'system-information',
        'system-name',
      ]);
      expect(shape(version, 'control-implementation')?.required, version).toEqual([
        'description',
        'implemented-requirements',
      ]);
      expect(shape(version, 'implemented-requirement')?.required, version).toEqual(['control-id', 'uuid']);
      expect(shape(version, 'statement')?.required, version).toEqual(['statement-id', 'uuid']);
      expect(shape(version, 'by-component')?.required, version).toEqual([
        'component-uuid',
        'description',
        'uuid',
      ]);
      // `implementation-status` hängt an `by-component`, nicht an der Anforderung.
      expect(shape(version, 'by-component')?.props, version).toContain('implementation-status');
      expect(shape(version, 'implemented-requirement')?.props, version).not.toContain('implementation-status');
      expect(shape(version, 'statement')?.props, version).not.toContain('implementation-status');
    }
  });
});
