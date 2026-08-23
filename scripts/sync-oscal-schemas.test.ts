import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  assertAllowedRedirectTarget,
  assertOfficialSchemaUrl,
  fetchSchemaWithValidatedRedirects,
  resolveSchemaVendorTarget,
  syncOscalSchemas,
} from './sync-oscal-schemas.mjs';
import { readBodyWithLimit } from './security-guards.mjs';
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
  describe('Bauzeitgarantie: kein Schemabezug von einer fremden Origin', () => {
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

  describe('Redirect-Validierung', () => {
    /** Der am 2026-08-01 beobachtete echte Zielhost von GitHub-Release-Assets. */
    const REAL_ASSET_URL =
      'https://release-assets.githubusercontent.com/github-production-release-asset/68406934/abc?sig=x&jwt=y';

    function redirectResponse(location: string, status = 302) {
      return new Response('', { status, headers: location ? { location } : {} });
    }

    it('accepts the real GitHub release-asset redirect target with its signed query', () => {
      expect(assertAllowedRedirectTarget(REAL_ASSET_URL)).toBe(REAL_ASSET_URL);
      expect(() =>
        assertAllowedRedirectTarget('https://objects.githubusercontent.com/x?sig=y'),
      ).not.toThrow();
    });

    it.each([
      'https://foreign.invalid/redirected/oscal_catalog_schema.json',
      'https://raw.githubusercontent.com/usnistgov/OSCAL/main/oscal_catalog_schema.json',
      'https://githubusercontent.com.evil.example/x',
      'http://release-assets.githubusercontent.com/x',
      'https://user:pass@release-assets.githubusercontent.com/x',
    ])('rejects the redirect target %s', (url) => {
      expect(() => assertAllowedRedirectTarget(url)).toThrow();
    });

    it('follows the real two-hop chain github.com to the asset host', async () => {
      const fetchImpl = vi.fn(async (url: string) =>
        url === CATALOG_PIN.releaseUrl ? redirectResponse(REAL_ASSET_URL) : responseOf('{}'),
      );

      const { finalUrl, response } = await fetchSchemaWithValidatedRedirects(
        CATALOG_PIN.releaseUrl,
        fetchImpl,
      );

      expect(finalUrl).toBe(REAL_ASSET_URL);
      expect(response.status).toBe(200);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      // Jeder Hop wird ohne automatisches Folgen ausgeführt.
      for (const call of fetchImpl.mock.calls) {
        expect(call[1]).toEqual({ redirect: 'manual' });
      }
    });

    it('rejects a redirect to a foreign host even when the bytes match the pins', async () => {
      // Reproduziert den Greptile-Befund: die Hashprüfung schützt den Inhalt,
      // nicht die Netzgrenze. Der Lauf muss vor dem Lesen der Bytes abbrechen.
      const foreignUrl = 'https://foreign.invalid/redirected/oscal_catalog_schema.json';
      const fetchImpl = vi.fn(async (url: string) =>
        url === CATALOG_PIN.releaseUrl
          ? redirectResponse(foreignUrl)
          : responseOf(JSON.stringify({ $id: CATALOG_PIN.schemaId })),
      );

      await expect(syncOscalSchemas({ pins: [CATALOG_PIN], fetchImpl, logger: { log: () => {} } }))
        .rejects.toThrow(/nicht freigegebenen Host: foreign\.invalid/);
      // Der fremde Host wurde nie kontaktiert.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith(CATALOG_PIN.releaseUrl, { redirect: 'manual' });
    });

    it('rejects a redirect chain that never terminates', async () => {
      const fetchImpl = vi.fn(async () => redirectResponse(REAL_ASSET_URL));

      await expect(
        fetchSchemaWithValidatedRedirects(CATALOG_PIN.releaseUrl, fetchImpl),
      ).rejects.toThrow(/überschreitet 5 Redirects/);
    });

    it('rejects a redirect without a location header', async () => {
      const fetchImpl = vi.fn(async () => redirectResponse('', 302));

      await expect(
        fetchSchemaWithValidatedRedirects(CATALOG_PIN.releaseUrl, fetchImpl),
      ).rejects.toThrow(/Redirect 302 ohne Ziel/);
    });
  });

  describe('Größenlimit', () => {
    /**
     * Baut eine Antwort, die ihren Körper in Blöcken liefert und mitzählt,
     * wie viele Bytes tatsächlich abgeflossen sind. So lässt sich belegen,
     * dass der Abbruch früh erfolgt und nicht erst nach vollem Puffern.
     */
    function streamingResponse(totalBytes: number, chunkSize = 64 * 1024) {
      const emitted = { bytes: 0 };
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emitted.bytes >= totalBytes) {
            controller.close();
            return;
          }
          const size = Math.min(chunkSize, totalBytes - emitted.bytes);
          emitted.bytes += size;
          controller.enqueue(new Uint8Array(size));
        },
      });
      return { response: new Response(stream), emitted };
    }

    it('aborts an oversized response before the whole body is transferred', async () => {
      const oversized = 8 * 1024 * 1024;
      const { response, emitted } = streamingResponse(oversized);

      await expect(readBodyWithLimit(response, { maxBytes: 1024 * 1024, label: 'Schema' }))
        .rejects.toThrow(/überschreitet das Limit von 1048576 Bytes/);

      // Entscheidend: nicht alle 8 MiB sind geflossen.
      expect(emitted.bytes).toBeLessThan(oversized);
      expect(emitted.bytes).toBeLessThanOrEqual(1024 * 1024 + 64 * 1024);
    });

    it('accepts a response exactly at the limit', async () => {
      const { response } = streamingResponse(1024, 256);
      const buffer = await readBodyWithLimit(response, { maxBytes: 1024, label: 'Schema' });
      expect(buffer).toHaveLength(1024);
    });

    it('rejects a response one byte over the limit', async () => {
      const { response } = streamingResponse(1025, 256);
      await expect(readBodyWithLimit(response, { maxBytes: 1024, label: 'Schema' }))
        .rejects.toThrow(/überschreitet das Limit/);
    });

    it('preserves the exact bytes of a streamed body', async () => {
      const payload = JSON.stringify({ $id: CATALOG_PIN.schemaId });
      const buffer = await readBodyWithLimit(responseOf(payload), { maxBytes: 1024 });
      expect(buffer.toString('utf8')).toBe(payload);
    });

    it('still enforces the limit when no stream is available', async () => {
      const bodyless = {
        body: null,
        arrayBuffer: async () => new ArrayBuffer(2048),
      } as unknown as Response;

      await expect(readBodyWithLimit(bodyless, { maxBytes: 1024, label: 'Schema' }))
        .rejects.toThrow(/überschreitet das Limit/);
    });

    it('rejects an oversized schema through the full sync flow', async () => {
      const { response } = streamingResponse(4 * 1024 * 1024);
      const fetchImpl = vi.fn(async () => response);

      await expect(syncOscalSchemas({ pins: [CATALOG_PIN], fetchImpl, logger: { log: () => {} } }))
        .rejects.toThrow(/Schema catalog @ 1\.2\.2 überschreitet das Limit/);
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
      expect(fetchImpl).toHaveBeenCalledWith(CATALOG_PIN.releaseUrl, { redirect: 'manual' });
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
