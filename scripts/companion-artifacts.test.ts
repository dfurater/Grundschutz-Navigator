import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  COMPANION_ROOT_TYPES,
  UNKNOWN_COMPANION_ROOT_TYPE,
  assignCompanionArtifactKeys,
  classifyCompanionArtifact,
  listCompanionTreePaths,
} from './companion-artifacts.mjs';
import { OSCAL_ROOT_KEYS } from '../src/domain/oscalVersionMatrix.mjs';
import { SOURCE_REGISTRY, ENTRY_CATALOG } from '../src/domain/sourceRegistry.mjs';

function json(value: unknown) {
  return Buffer.from(JSON.stringify(value));
}

const VALID_CATALOG = {
  catalog: {
    uuid: '44444444-4444-4444-8444-444444444444',
    metadata: { title: 'Begleitkatalog', 'last-modified': '2026-10-23T00:00:00Z', version: '1', 'oscal-version': '1.1.3' },
  },
};

describe('listCompanionTreePaths', () => {
  it('nimmt nur JSON-Dateien unter den Monitoring-Wurzeln, die kein Produktartefakt sind', () => {
    const treeFiles = [
      { path: ENTRY_CATALOG.upstreamPath },
      { path: 'control_layer/Kernel/Kernel-catalog.json' },
      { path: 'control_layer/Kernel/notes.md' },
      { path: 'documentation/namespaces/tags.csv' },
      { path: 'documentation/OSCAL.json' },
    ];

    expect(listCompanionTreePaths(treeFiles, SOURCE_REGISTRY)).toEqual([
      'control_layer/Kernel/Kernel-catalog.json',
    ]);
  });
});

describe('assignCompanionArtifactKeys', () => {
  const tracked = 'control_layer/Tracked/Tracked-catalog.json';

  it('übernimmt getrackte Schlüssel und leitet neue ab', () => {
    const keys = assignCompanionArtifactKeys([tracked, 'control_layer/New/New-catalog.json'], {
      trackedManifest: { files: [{ artifactKey: 'tracked-key', rootType: 'catalog', path: tracked }] },
      registryEntries: SOURCE_REGISTRY,
    });

    expect([...keys]).toEqual([
      [tracked, 'tracked-key'],
      ['control_layer/New/New-catalog.json', 'control-layer-new-new-catalog'],
    ]);
  });

  it('ignoriert Vokabular- und Produkteinträge des getrackten Manifests', () => {
    const keys = assignCompanionArtifactKeys([tracked], {
      trackedManifest: { files: [{ artifactKey: 'namespaces-bsi', rootType: 'vocabulary', path: tracked }] },
      registryEntries: SOURCE_REGISTRY,
    });

    expect(keys.get(tracked)).toBe('control-layer-tracked-tracked-catalog');
  });

  it('bricht bei einer Kollision zwischen zwei Begleitartefakten ab', () => {
    expect(() => assignCompanionArtifactKeys(
      ['control_layer/A/x.json', 'control_layer/a/x.json'],
      { trackedManifest: null, registryEntries: SOURCE_REGISTRY },
    )).toThrow('Schlüsselkollision für Begleitartefakt control_layer/a/x.json: control-layer-a-x');
  });

  it('bricht ab, wenn sich kein gültiger Schlüssel bilden lässt', () => {
    expect(() => assignCompanionArtifactKeys(['../escape.json'], {
      trackedManifest: null,
      registryEntries: SOURCE_REGISTRY,
    })).toThrow('Begleitartefakt hat keinen gültigen Schlüssel: ../escape.json');
  });
});

describe('classifyCompanionArtifact', () => {
  it('kennt jedes Root-Modell der Versionsmatrix', () => {
    expect(COMPANION_ROOT_TYPES).toEqual([...OSCAL_ROOT_KEYS, UNKNOWN_COMPANION_ROOT_TYPE]);
    expect(classifyCompanionArtifact(json({ 'system-security-plan': { uuid: 'x' } }))).toMatchObject({
      rootType: 'system-security-plan',
      lifecycle: 'blocked-by-upstream',
    });
  });

  it('stuft ein schemagültiges Dokument mit gepinnter Version als preview ein', () => {
    expect(classifyCompanionArtifact(json(VALID_CATALOG))).toMatchObject({
      rootType: 'catalog',
      lifecycle: 'preview',
      document: VALID_CATALOG,
    });
  });

  it.each([
    ['kein JSON', Buffer.from('{not json')],
    ['ein Array', json([VALID_CATALOG])],
    ['keine Wurzel', json({ metadata: {} })],
    ['zwei Wurzeln', json({ ...VALID_CATALOG, profile: {} })],
  ])('sperrt %s ohne Root-Typ', (_label, bytes) => {
    expect(classifyCompanionArtifact(bytes)).toEqual({
      rootType: UNKNOWN_COMPANION_ROOT_TYPE,
      lifecycle: 'blocked-by-upstream',
      document: null,
    });
  });

  it.each([
    ['eine nicht gepinnte Version', { catalog: { ...VALID_CATALOG.catalog, metadata: { ...VALID_CATALOG.catalog.metadata, 'oscal-version': '9.9.9' } } }],
    ['einen Schemaverstoß', { catalog: { uuid: 'kein-uuid', metadata: VALID_CATALOG.catalog.metadata } }],
    ['eine widersprüchliche $schema-Direktive', { $schema: 'https://example.org/schema.json', ...VALID_CATALOG }],
  ])('sperrt ein Dokument mit bekannter Wurzel bei %s', (_label, document) => {
    expect(classifyCompanionArtifact(json(document))).toMatchObject({
      rootType: 'catalog',
      lifecycle: 'blocked-by-upstream',
    });
  });
});

describe('gepinnte Schemabytes', () => {
  it('bricht ab, wenn die Schemadatei nicht zum Matrix-Hash passt', () => {
    // Native ESM imports need the builtin binding updated in a fresh process.
    const script = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const readFileSync = fs.readFileSync;
      fs.readFileSync = (path, ...args) => String(path).includes('/schemas/oscal/')
        ? Buffer.from('{}')
        : readFileSync(path, ...args);
      syncBuiltinESMExports();
      const { classifyCompanionArtifact } = await import('./scripts/companion-artifacts.mjs');
      classifyCompanionArtifact(Buffer.from(${JSON.stringify(JSON.stringify(VALID_CATALOG))}));
    `;
    expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      stdio: 'pipe',
    })).toThrow('Gepinntes OSCAL-Schema weicht vom Matrix-Hash ab');
  });
});
