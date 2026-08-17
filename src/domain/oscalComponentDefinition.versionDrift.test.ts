// @vitest-environment node
// =============================================================================
// Versionsdrift des Component-Modells (GSPP-248)
//
// Die Raw-Typen in `oscalComponentDefinition.ts` tragen drei Versionsliterale.
// Sie sind Feldprädikate, keine Modellversionskonstante — und genau deshalb
// müssen sie am Schema hängen und nicht am Gedächtnis. Dieser Test liest alle
// vier gepinnten `oscal_component_schema.json` und weist die **vollständige**
// Menge der Definitionsunterschiede nach.
//
// Kommt upstream ein weiterer Unterschied dazu, wird er hier rot, bevor die
// Typen ihn stillschweigend verschlucken.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

interface DefinitionShape {
  readonly props: readonly string[];
  readonly required: readonly string[];
}

/** Repo-relativ; das Arbeitsverzeichnis des Testlaufs ist die Projektwurzel. */
function readComponentSchema(version: PinnedOscalVersion): Record<string, unknown> {
  return JSON.parse(
    readFileSync(`schemas/oscal/v${version}/oscal_component_schema.json`, 'utf8'),
  ) as Record<string, unknown>;
}

/**
 * Reduziert ein Schema auf `<Assembly-Name> → { props, required }`. Der
 * Namensraumpräfix vor dem Doppelpunkt wandert je Modell und ist deshalb
 * abgeschnitten.
 */
function shapeOf(version: PinnedOscalVersion): ReadonlyMap<string, DefinitionShape> {
  const definitions = readComponentSchema(version).definitions as Record<string, {
    properties?: Record<string, unknown>;
    required?: string[];
  }>;

  return new Map(
    Object.entries(definitions).map(([key, definition]) => [
      key.split(':').pop() ?? key,
      {
        props: Object.keys(definition.properties ?? {}).sort(),
        required: [...(definition.required ?? [])].sort(),
      },
    ]),
  );
}

const shapes = new Map(
  PINNED_OSCAL_VERSIONS.map((version) => [version, shapeOf(version)] as const),
);

function signature(version: PinnedOscalVersion, name: string): string {
  const shape = shapes.get(version)?.get(name);
  return shape === undefined ? 'ABSENT' : JSON.stringify(shape);
}

function propsOf(version: PinnedOscalVersion, name: string): readonly string[] {
  return shapes.get(version)?.get(name)?.props ?? [];
}

function requiredOf(version: PinnedOscalVersion, name: string): readonly string[] {
  return shapes.get(version)?.get(name)?.required ?? [];
}

describe('oscal_component_schema — Unterschiede über die vier gepinnten Versionen', () => {
  it('führt genau die bekannten abweichenden Definitionen', () => {
    const names = new Set(
      PINNED_OSCAL_VERSIONS.flatMap((version) => [...(shapes.get(version)?.keys() ?? [])]),
    );
    const differing = [...names]
      .filter((name) => new Set(
        PINNED_OSCAL_VERSIONS.map((version) => signature(version, name)),
      ).size > 1)
      .sort();

    // Erhoben am vendorierten Bestand. Die ersten drei sind parserrelevant und
    // in `oscalComponentDefinition.ts` als Feldprädikate abgebildet; die
    // übrigen sind Umbauten der Datentyp- und Selektionsdefinitionen, die der
    // Component-Root nicht anders erreichbar macht.
    expect(differing).toEqual([
      'MarkupLineDatatype',
      'MarkupMultilineDatatype',
      'import-component-definition',
      'matching',
      'parameter',
      'port-range',
      'protocol',
      'select-control-by-id',
      'with-id',
    ]);
  });

  it('deklariert import-component-definition.remarks erst ab 1.2.1', () => {
    expect(propsOf('1.1.2', 'import-component-definition')).toEqual(['href']);
    expect(propsOf('1.1.3', 'import-component-definition')).toEqual(['href']);
    expect(propsOf('1.2.1', 'import-component-definition')).toEqual(['href', 'remarks']);
    expect(propsOf('1.2.2', 'import-component-definition')).toEqual(['href', 'remarks']);
  });

  it('deklariert port-range.remarks erst ab 1.2.1', () => {
    expect(propsOf('1.1.2', 'port-range')).not.toContain('remarks');
    expect(propsOf('1.1.3', 'port-range')).not.toContain('remarks');
    expect(propsOf('1.2.1', 'port-range')).toContain('remarks');
    expect(propsOf('1.2.2', 'port-range')).toContain('remarks');
  });

  it('verlangt protocol.name ausschließlich in 1.1.2', () => {
    expect(requiredOf('1.1.2', 'protocol')).toEqual(['name']);
    expect(requiredOf('1.1.3', 'protocol')).toEqual([]);
    expect(requiredOf('1.2.1', 'protocol')).toEqual([]);
    expect(requiredOf('1.2.2', 'protocol')).toEqual([]);
  });

  it('hält die Pflichtfelder des Definitionskörpers über alle vier Versionen konstant', () => {
    for (const version of PINNED_OSCAL_VERSIONS) {
      expect(requiredOf(version, 'component-definition'), version).toEqual(['metadata', 'uuid']);
      // `components`, `capabilities`, `import-component-definitions` und
      // `back-matter` sind ausdrücklich **nicht** dabei: Eine Definition ohne
      // Komponenten ist gültig.
      expect(propsOf(version, 'component-definition'), version).toEqual([
        'back-matter',
        'capabilities',
        'components',
        'import-component-definitions',
        'metadata',
        'uuid',
      ]);
      expect(requiredOf(version, 'control-implementation'), version).toEqual([
        'description',
        'implemented-requirements',
        'source',
        'uuid',
      ]);
      expect(requiredOf(version, 'implemented-requirement'), version).toEqual([
        'control-id',
        'description',
        'uuid',
      ]);
      expect(requiredOf(version, 'capability'), version).toEqual([
        'description',
        'name',
        'uuid',
      ]);
    }
  });
});
