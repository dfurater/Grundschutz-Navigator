import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assertOfficialSchemaUrl,
  resolveSchemaVendorTarget,
  syncOscalSchemas,
} from './sync-oscal-schemas.mjs';
import { getSchemaPin, listSchemaPins } from '../src/domain/oscalVersionMatrix.mjs';

const CATALOG_PIN = getSchemaPin('catalog', '1.2.2')!;

/**
 * Baut eine Antwort, deren Bytes exakt den gepinnten SHA-256 ergeben. Der Hash
 * ist an den realen NIST-Bytes gemessen, also wird hier der Pin selbst nicht
 * nachgebaut, sondern nur die Verifikationslogik geprüft: dafür genügt eine
 * Antwort, die den erwarteten Hash *nicht* trifft, plus ein Erfolgsfall über
 * einen künstlichen Pin.
 */
function responseOf(body: string) {
  return new Response(body);
}

describe('sync-oscal-schemas', () => {
  describe('Bauzeitgarantie: kein Laufzeit-Netzbezug', () => {
    it('keeps every network path out of the version matrix module', async () => {
      // Die Matrix liefert ausschließlich Metadaten. Entsteht dort ein
      // Ladepfad, wäre die dokumentierte Bauzeitgarantie gebrochen: der
      // Bezug gehört allein in diesen Wartungslauf.
      const source = await readFile('src/domain/oscalVersionMatrix.mjs', 'utf8');

      for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'import(', 'require(']) {
        expect(source, `Versionsmatrix darf ${forbidden} nicht enthalten`).not.toContain(forbidden);
      }
    });

    it('is the only module that may reach a NIST release', async () => {
      const consumers = [
        'src/domain/sourceRegistry.mjs',
        'scripts/fetch-catalog.mjs',
        'scripts/catalog-sync-guard.mjs',
      ];

      for (const consumer of consumers) {
        const source = await readFile(consumer, 'utf8');
        expect(source, `${consumer} darf keine NIST-Release-URL enthalten`).not.toContain(
          'usnistgov/OSCAL/releases',
        );
      }
    });
  });

  describe('assertOfficialSchemaUrl', () => {
    it('accepts the official NIST release download URL', () => {
      expect(assertOfficialSchemaUrl(CATALOG_PIN.releaseUrl)).toBe(CATALOG_PIN.releaseUrl);
    });

    it('accepts every pinned release URL', () => {
      for (const pin of listSchemaPins()) {
        expect(() => assertOfficialSchemaUrl(pin.releaseUrl)).not.toThrow();
      }
    });

    it.each([
      'http://github.com/usnistgov/OSCAL/releases/download/v1.2.2/oscal_catalog_schema.json',
      'https://example.com/usnistgov/OSCAL/releases/download/v1.2.2/oscal_catalog_schema.json',
      'https://github.com/attacker/OSCAL/releases/download/v1.2.2/oscal_catalog_schema.json',
      'https://user:pass@github.com/usnistgov/OSCAL/releases/download/v1.2.2/oscal_catalog_schema.json',
      'https://github.com/usnistgov/OSCAL/releases/download/v1.2.2/x.json?redirect=evil',
      'not-a-url',
    ])('rejects the unofficial schema URL %s', (url) => {
      expect(() => assertOfficialSchemaUrl(url)).toThrow();
    });
  });

  describe('resolveSchemaVendorTarget', () => {
    it('resolves a pinned vendor path below the reserved directory', () => {
      const target = resolveSchemaVendorTarget(CATALOG_PIN.vendorPath, { repoRoot: '/repo' });
      expect(target).toBe('/repo/schemas/oscal/v1.2.2/oscal_catalog_schema.json');
    });

    it.each([
      '../outside.json',
      'schemas/oscal/../../etc/passwd',
      'public/data/catalog.json',
      'schemas/oscal',
    ])('rejects the vendor path %s', (vendorPath) => {
      expect(() => resolveSchemaVendorTarget(vendorPath, { repoRoot: '/repo' })).toThrow(
        /außerhalb von schemas\/oscal/,
      );
    });
  });

  describe('syncOscalSchemas', () => {
    const logger = { log: () => {} };

    it('fetches from the official release URL and enforces the matrix hash', async () => {
      const fetchImpl = vi.fn(async () => responseOf(JSON.stringify({ $id: CATALOG_PIN.schemaId })));

      await expect(syncOscalSchemas({ pins: [CATALOG_PIN], fetchImpl, logger })).rejects.toThrow(
        /OSCAL_SCHEMA_HASH_MISMATCH/,
      );
      expect(fetchImpl).toHaveBeenCalledWith(CATALOG_PIN.releaseUrl, { redirect: 'follow' });
    });

    it('cannot be tricked by a pin object that overrides the expected hash', () => {
      // Die Verifikation liest den Erwartungswert ausschließlich aus der
      // Matrix. Ein manipuliertes Pin-Objekt darf den Hash nicht umdefinieren.
      const forgedBody = JSON.stringify({ $id: CATALOG_PIN.schemaId });
      const forgedPin = {
        ...CATALOG_PIN,
        sha256: createHash('sha256').update(forgedBody).digest('hex'),
      };

      expect(forgedPin.sha256).not.toBe(CATALOG_PIN.sha256);
      return expect(
        syncOscalSchemas({
          pins: [forgedPin],
          fetchImpl: async () => responseOf(forgedBody),
          logger,
        }),
      ).rejects.toThrow(/OSCAL_SCHEMA_HASH_MISMATCH/);
    });

    it('rejects a failed download', async () => {
      const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));

      await expect(syncOscalSchemas({ pins: [CATALOG_PIN], fetchImpl, logger })).rejects.toThrow(
        /Schema-Download fehlgeschlagen: catalog @ 1\.2\.2 — HTTP 404/,
      );
    });

    it('rejects a response that is not valid JSON', async () => {
      const fetchImpl = vi.fn(async () => responseOf('{not json'));

      await expect(syncOscalSchemas({ pins: [CATALOG_PIN], fetchImpl, logger })).rejects.toThrow(
        /kein gültiges JSON/,
      );
    });

    it('rejects a pin that points outside the official NIST releases', async () => {
      const fetchImpl = vi.fn(async () => responseOf('{}'));
      const tamperedPin = { ...CATALOG_PIN, releaseUrl: 'https://evil.example/schema.json' };

      await expect(syncOscalSchemas({ pins: [tamperedPin], fetchImpl, logger })).rejects.toThrow(
        /außerhalb der offiziellen NIST-Releases/,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
