// @vitest-environment node
// Pfadbasierter Schemaabgleich, einschließlich Inline-Objekten und anyOf-Zweigen.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PINNED_OSCAL_VERSIONS, type PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
interface SchemaNode {
  $ref?: string;
  $id?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  anyOf?: SchemaNode[];
  items?: SchemaNode;
}
interface Shape {
  properties: string[];
  required: string[];
  additionalProperties: boolean | null;
  variants: {
    properties: string[];
    required: string[];
    additionalProperties: boolean | null;
  }[];
}
function shapes(version: PinnedOscalVersion): Map<string, Shape> {
  const schema = JSON.parse(
    readFileSync(`schemas/oscal/v${version}/oscal_assessment-plan_schema.json`, 'utf8'),
  ) as SchemaNode & { definitions: Record<string, SchemaNode> };
  const definitions = schema.definitions;
  const anchors = new Map(
    Object.entries(definitions).flatMap(([key, value]) =>
      value.$id === undefined ? [] : [[value.$id, key]],
    ),
  );
  const result = new Map<string, Shape>();
  function walk(node: SchemaNode, path: string, stack: readonly string[]): void {
    if (node.$ref !== undefined) {
      const key = anchors.get(node.$ref) ?? node.$ref.split('/').at(-1)!;
      expect(definitions[key], key).toBeDefined();
      // Rekursive tasks/parts: dieselbe Definition wird nur einmal pro Pfad entfaltet.
      if (!stack.includes(key)) walk(definitions[key], path, [...stack, key]);
      return;
    }
    if (node.items !== undefined) {
      walk(node.items, `${path}[]`, stack);
      return;
    }
    const variants = node.anyOf ?? [node];
    const properties = Object.assign({}, ...variants.map((v) => v.properties ?? {})) as Record<
      string,
      SchemaNode
    >;
    if (Object.keys(properties).length === 0) return;
    result.set(path, {
      properties: Object.keys(properties).sort(),
      required: [...(node.required ?? [])].sort(),
      additionalProperties: node.additionalProperties ?? null,
      variants: (node.anyOf ?? []).map((v) => ({
        properties: Object.keys(v.properties ?? {}).sort(),
        required: [...(v.required ?? [])].sort(),
        additionalProperties: v.additionalProperties ?? null,
      })),
    });
    for (const [key, child] of Object.entries(properties)) walk(child, `${path}/${key}`, stack);
  }
  walk(schema.properties!['assessment-plan'], '/assessment-plan', []);
  return result;
}
const all = new Map(PINNED_OSCAL_VERSIONS.map((version) => [version, shapes(version)]));
const shape = (v: PinnedOscalVersion, path: string) => all.get(v)!.get(`/assessment-plan${path}`)!;

describe('Assessment-Plan-Versionsdrift', () => {
  it('erfasst die vollständigen Unterschiede an jedem erreichbaren Objektpfad', () => {
    const paths = [...new Set([...all.values()].flatMap((map) => [...map.keys()]))].sort();
    const differences = paths.flatMap((path) => {
      const versions = PINNED_OSCAL_VERSIONS.map((v) => all.get(v)!.get(path) ?? null);
      return new Set(versions.map((v) => JSON.stringify(v))).size > 1 ? [{ path, versions }] : [];
    });
    // Gruppiert gleiche Formen, behält aber sämtliche betroffenen Pfade.
    const groups = new Map<string, { paths: string[]; versions: (Shape | null)[] }>();
    for (const difference of differences) {
      const key = JSON.stringify(difference.versions);
      const group = groups.get(key) ?? {
        paths: [],
        versions: difference.versions,
      };
      group.paths.push(difference.path);
      groups.set(key, group);
    }
    expect(
      [...groups.values()].map((group) => ({
        paths: group.paths,
        versions: group.versions.map((value) => JSON.stringify(value)),
      })),
    ).toMatchSnapshot();
  });
  it('verifiziert die sieben fachlich relevanten Driftzeilen ausdrücklich', () => {
    for (const v of PINNED_OSCAL_VERSIONS) {
      const legacy = v === '1.1.2' || v === '1.1.3';
      const subject = shape(v, '/assessment-subjects[]');
      expect(subject.required).toEqual(legacy ? ['type'] : []);
      expect(subject.variants.map((x) => x.required)).toEqual(
        legacy ? [] : [['include-all'], ['include-subjects']],
      );
      expect(
        shape(v, '/reviewed-controls/control-selections[]').variants.map((x) => x.required),
      ).toEqual(legacy ? [] : [['include-all'], ['include-controls']]);
      expect(
        shape(v, '/reviewed-controls/control-objective-selections[]').variants.map(
          (x) => x.required,
        ),
      ).toEqual(legacy ? [] : [['include-all'], ['include-objectives']]);
      expect(shape(v, '/tasks[]/timing').variants.map((x) => x.required)).toEqual(
        legacy ? [] : [['on-date'], ['within-date-range'], ['at-frequency']],
      );
      for (const path of [
        '/tasks[]/timing/on-date',
        '/tasks[]/timing/within-date-range',
        '/tasks[]/timing/at-frequency',
        '/reviewed-controls/control-objective-selections[]/include-objectives[]',
        '/local-definitions/components[]/protocols[]/port-ranges[]',
      ]) {
        expect(shape(v, path).properties.includes('remarks'), `${v}/${path}`).toBe(!legacy);
      }
      expect(shape(v, '/local-definitions/components[]/protocols[]').required).toEqual(
        v === '1.1.2' ? ['name'] : [],
      );
      expect(shape(v, '/metadata/parties[]').required).toEqual(legacy ? ['type', 'uuid'] : []);
    }
    expect([...all.get('1.2.1')!]).toEqual([...all.get('1.2.2')!]);
  });
});
