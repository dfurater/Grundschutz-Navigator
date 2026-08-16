// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EXPECTED_JSON_SCHEMA_DRAFT,
  assertPinnedSchemaDraft,
  verifyOscalSchemas,
} from './verify-oscal-schemas.mjs';
import { getSchemaPin, listSchemaPins } from '../src/domain/oscalVersionMatrix.mjs';

const logger = { log: () => {} };
const CATALOG_PIN = getSchemaPin('catalog', '1.2.2')!;
const temporaryRoots: string[] = [];

/**
 * Baut einen Repo-Abzug, der nur die gepinnten Schemadateien enthält. Die
 * Bytes stammen aus dem echten Repository, damit die Hashprüfung gegen die
 * realen NIST-Assets läuft und nicht gegen einen nachgebauten Pin.
 */
async function createSchemaFixtureRoot(pins = listSchemaPins()): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'gspp-schema-verify-'));
  temporaryRoots.push(root);

  for (const pin of pins) {
    const target = path.join(root, pin.vendorPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(pin.vendorPath));
  }

  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('verify-oscal-schemas', () => {
  it('verifiziert alle 30 eingecheckten Schemas gegen Hash, $id und draft-07', async () => {
    const results = await verifyOscalSchemas({ logger });

    expect(results).toHaveLength(30);
    expect(results.reduce((sum, result) => sum + result.sizeBytes, 0)).toBe(2_967_207);
  });

  it('nimmt kein fetch in die Hand', async () => {
    // Der Netzbezug gehört ausschließlich dem Wartungslauf. Ein Aufruf hier
    // wäre eine stille Lieferkettenerweiterung.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('verify-oscal-schemas darf kein fetch aufrufen');
    });

    await verifyOscalSchemas({ logger });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enthält im Quelltext keinen Netzpfad', async () => {
    const source = await readFile('scripts/verify-oscal-schemas.mjs', 'utf8');

    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'https://']) {
      expect(source, `Verify-Lauf darf ${forbidden} nicht enthalten`).not.toContain(forbidden);
    }
  });

  it('schlägt bei einer fehlenden Datei fehl', async () => {
    const root = await createSchemaFixtureRoot();
    await rm(path.join(root, CATALOG_PIN.vendorPath));

    await expect(verifyOscalSchemas({ repoRoot: root, logger })).rejects.toThrow(
      /Gepinntes Schema fehlt: catalog @ 1\.2\.2/,
    );
  });

  it('schlägt bei einem manipulierten Byte fehl', async () => {
    const root = await createSchemaFixtureRoot();
    const target = path.join(root, CATALOG_PIN.vendorPath);
    const document = JSON.parse(await readFile(target, 'utf8'));
    document.title = `${document.title} `;

    const tampered = JSON.stringify(document);
    expect(createHash('sha256').update(tampered).digest('hex')).not.toBe(CATALOG_PIN.sha256);
    await writeFile(target, tampered);

    await expect(verifyOscalSchemas({ repoRoot: root, logger })).rejects.toThrow(
      /OSCAL_SCHEMA_HASH_MISMATCH.*catalog @ 1\.2\.2/s,
    );
  });

  it('schlägt bei einer überzähligen Datei fehl', async () => {
    // Genau so würde eine der beiden unmöglichen `mapping-collection`-Zellen
    // untergeschoben: als Datei ohne Pin in der Matrix.
    const root = await createSchemaFixtureRoot();
    await writeFile(
      path.join(root, 'schemas/oscal/v1.1.3/oscal_mapping_schema.json'),
      JSON.stringify({ $schema: EXPECTED_JSON_SCHEMA_DRAFT }),
    );

    await expect(verifyOscalSchemas({ repoRoot: root, logger })).rejects.toThrow(
      /ohne Pin in der Versionsmatrix: schemas\/oscal\/v1\.1\.3\/oscal_mapping_schema\.json/,
    );
  });

  describe('assertPinnedSchemaDraft', () => {
    it('akzeptiert die deklarierte draft-07-Fassung', async () => {
      const document = JSON.parse(await readFile(CATALOG_PIN.vendorPath, 'utf8'));

      expect(document.$schema).toBe(EXPECTED_JSON_SCHEMA_DRAFT);
      expect(() => assertPinnedSchemaDraft(document, CATALOG_PIN)).not.toThrow();
    });

    it.each([
      'https://json-schema.org/draft/2020-12/schema',
      'https://json-schema.org/draft/2019-09/schema',
      undefined,
    ])('lehnt die Fassung %s ab', ($schema) => {
      expect(() => assertPinnedSchemaDraft({ $schema }, CATALOG_PIN)).toThrow(
        /deklariert nicht draft-07: catalog @ 1\.2\.2/,
      );
    });
  });

  it('lehnt eine Datei ab, deren JSON nicht lesbar ist', async () => {
    const root = await createSchemaFixtureRoot([CATALOG_PIN]);
    await writeFile(path.join(root, CATALOG_PIN.vendorPath), '{kein json');

    await expect(verifyOscalSchemas({ repoRoot: root, pins: [CATALOG_PIN], logger })).rejects.toThrow(
      /kein gültiges JSON: catalog @ 1\.2\.2/,
    );
  });
});
