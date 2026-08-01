import { describe, expect, it } from 'vitest';
import {
  OSCAL_ROOT_KEYS,
  PINNED_OSCAL_VERSIONS,
  SCHEMA_VENDOR_DIRECTORY,
  VERSION_MATRIX_DIAGNOSTIC_CODES,
  buildSchemaId,
  buildSchemaReleaseUrl,
  buildSchemaVendorPath,
  getModelIntroducedIn,
  getSchemaPin,
  isImpossibleCombination,
  isKnownOscalRootKey,
  isPinnedOscalVersion,
  listSchemaPins,
  resolveSchemaBinding,
  validateVersionMatrix,
  verifySchemaArtifact,
  type OscalRootKey,
  type PinnedOscalVersion,
} from '@/domain/oscalVersionMatrix';

/** Muss mit der OscalRootKey-Union in oscalVersionMatrix.d.mts übereinstimmen. */
const EXPECTED_ROOT_KEYS = [
  'catalog',
  'profile',
  'mapping-collection',
  'component-definition',
  'system-security-plan',
  'assessment-plan',
  'assessment-results',
  'plan-of-action-and-milestones',
] as const satisfies readonly OscalRootKey[];

/** Muss mit der PinnedOscalVersion-Union in oscalVersionMatrix.d.mts übereinstimmen. */
const EXPECTED_VERSIONS = [
  '1.1.2',
  '1.1.3',
  '1.2.1',
  '1.2.2',
] as const satisfies readonly PinnedOscalVersion[];

describe('oscalVersionMatrix', () => {
  it('validates the shipped matrix without errors', () => {
    expect(() => validateVersionMatrix()).not.toThrow();
  });

  it('covers all eight OSCAL root models across all three layers', () => {
    expect([...OSCAL_ROOT_KEYS]).toEqual([...EXPECTED_ROOT_KEYS]);
    expect(OSCAL_ROOT_KEYS).toHaveLength(8);
    expect(Object.isFrozen(OSCAL_ROOT_KEYS)).toBe(true);
  });

  it('pins exactly the four versions found in the BSI corpus', () => {
    expect([...PINNED_OSCAL_VERSIONS]).toEqual([...EXPECTED_VERSIONS]);
    expect(Object.isFrozen(PINNED_OSCAL_VERSIONS)).toBe(true);
  });

  it('pins 30 cells: eight roots over four versions minus the two impossible mapping cells', () => {
    expect(listSchemaPins()).toHaveLength(8 * 4 - 2);
  });

  it('records file name, release tag, $id, vendor path, hash and size for every cell', () => {
    for (const pin of listSchemaPins()) {
      expect(pin.schemaFileName).toMatch(/^oscal_[a-z-]+_schema\.json$/);
      expect(pin.releaseTag).toBe(`v${pin.oscalVersion}`);
      expect(pin.releaseUrl).toBe(
        `https://github.com/usnistgov/OSCAL/releases/download/v${pin.oscalVersion}/${pin.schemaFileName}`,
      );
      expect(pin.schemaId).toMatch(
        new RegExp(`^http://csrc\\.nist\\.gov/ns/oscal/${pin.oscalVersion}/oscal-[a-z-]+-schema\\.json$`),
      );
      expect(pin.vendorPath).toBe(
        `${SCHEMA_VENDOR_DIRECTORY}/v${pin.oscalVersion}/${pin.schemaFileName}`,
      );
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pin.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('pins a distinct hash for every cell', () => {
    const hashes = listSchemaPins().map((pin) => pin.sha256);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('does not derive the $id slug from the asset file name', () => {
    // NIST verwendet für diese drei Root-Typen im Asset-Namen einen anderen
    // Bezeichner als in der $id. Eine abgeleitete Prüfung wäre falsch.
    expect(buildSchemaId('component-definition', '1.2.2')).toBe(
      'http://csrc.nist.gov/ns/oscal/1.2.2/oscal-component-definition-schema.json',
    );
    expect(getSchemaPin('component-definition', '1.2.2')!.schemaFileName).toBe(
      'oscal_component_schema.json',
    );
    expect(buildSchemaId('assessment-plan', '1.1.3')).toBe(
      'http://csrc.nist.gov/ns/oscal/1.1.3/oscal-ap-schema.json',
    );
    expect(buildSchemaId('assessment-results', '1.1.3')).toBe(
      'http://csrc.nist.gov/ns/oscal/1.1.3/oscal-ar-schema.json',
    );
  });

  it('narrows root keys and versions', () => {
    expect(isKnownOscalRootKey('catalog')).toBe(true);
    expect(isKnownOscalRootKey('system-security-plan')).toBe(true);
    expect(isKnownOscalRootKey('Catalog')).toBe(false);
    expect(isKnownOscalRootKey('plan')).toBe(false);
    expect(isPinnedOscalVersion('1.2.2')).toBe(true);
    expect(isPinnedOscalVersion('1.2.0')).toBe(false);
  });

  it('returns null for unknown roots and versions instead of guessing', () => {
    expect(getSchemaPin('plan', '1.2.2')).toBeNull();
    expect(getSchemaPin('catalog', '1.0.4')).toBeNull();
    expect(buildSchemaId('plan', '1.2.2')).toBeNull();
    expect(buildSchemaReleaseUrl('plan', '1.2.2')).toBeNull();
    expect(buildSchemaVendorPath('plan', '1.2.2')).toBeNull();
  });

  describe('verbotene Zellen', () => {
    it('marks mapping-collection as introduced in OSCAL 1.2.0', () => {
      expect(getModelIntroducedIn('mapping-collection')).toBe('1.2.0');
      expect(getModelIntroducedIn('catalog')).toBeNull();
    });

    it('treats mapping-collection below 1.2.0 as impossible', () => {
      expect(isImpossibleCombination('mapping-collection', '1.1.2')).toBe(true);
      expect(isImpossibleCombination('mapping-collection', '1.1.3')).toBe(true);
      expect(isImpossibleCombination('mapping-collection', '1.0.4')).toBe(true);
      expect(isImpossibleCombination('mapping-collection', '1.2.0')).toBe(false);
      expect(isImpossibleCombination('mapping-collection', '1.2.1')).toBe(false);
      expect(isImpossibleCombination('catalog', '1.1.2')).toBe(false);
    });

    it('pins no schema for the two impossible mapping cells', () => {
      expect(getSchemaPin('mapping-collection', '1.1.2')).toBeNull();
      expect(getSchemaPin('mapping-collection', '1.1.3')).toBeNull();
      expect(getSchemaPin('mapping-collection', '1.2.1')).not.toBeNull();
      expect(getSchemaPin('mapping-collection', '1.2.2')).not.toBeNull();
    });

    it('rejects an impossible combination with its own diagnostic', () => {
      const result = resolveSchemaBinding({
        rootType: 'mapping-collection',
        oscalVersion: '1.1.3',
      });

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({
        code: VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_IMPOSSIBLE,
        rootType: 'mapping-collection',
        oscalVersion: '1.1.3',
        expected: '>= 1.2.0',
      });
    });

    it('prefers the impossibility diagnostic over the unpinned one', () => {
      // 1.0.4 ist weder gepinnt noch existierte das Modell; die inhaltlich
      // stärkere Aussage muss gewinnen.
      expect(resolveSchemaBinding({
        rootType: 'mapping-collection',
        oscalVersion: '1.0.4',
      })).toMatchObject({
        code: VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_IMPOSSIBLE,
      });
    });
  });

  describe('resolveSchemaBinding fail-closed', () => {
    it('binds a valid root and version to its pinned schema', () => {
      const result = resolveSchemaBinding({ rootType: 'catalog', oscalVersion: '1.1.3' });

      expect(result.ok).toBe(true);
      expect(result.ok && result.pin.schemaFileName).toBe('oscal_catalog_schema.json');
      expect(result.ok && result.pin.releaseTag).toBe('v1.1.3');
    });

    it('rejects a missing oscal-version', () => {
      for (const oscalVersion of [undefined, null, '', '   ']) {
        expect(resolveSchemaBinding({ rootType: 'catalog', oscalVersion: oscalVersion as never }))
          .toMatchObject({ code: VERSION_MATRIX_DIAGNOSTIC_CODES.VERSION_MISSING });
      }
      expect(resolveSchemaBinding()).toMatchObject({
        code: VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_TYPE_UNKNOWN,
      });
    });

    it('rejects a malformed version without guessing a neighbour', () => {
      for (const oscalVersion of ['1.1', 'v1.1.3', '1.1.3-rc1', '01.1.3', 'gsmap-oscal-export-v1']) {
        expect(resolveSchemaBinding({ rootType: 'catalog', oscalVersion })).toMatchObject({
          code: VERSION_MATRIX_DIAGNOSTIC_CODES.VERSION_MALFORMED,
        });
      }
    });

    it('rejects an unpinned version and never falls back to a neighbouring one', () => {
      const result = resolveSchemaBinding({ rootType: 'catalog', oscalVersion: '1.0.4' });

      expect(result).toMatchObject({
        code: VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_UNSUPPORTED,
        oscalVersion: '1.0.4',
        expected: '1.1.2, 1.1.3, 1.2.1, 1.2.2',
      });
      expect(result.ok).toBe(false);
      expect('pin' in result).toBe(false);
    });

    it('rejects an unknown root type', () => {
      expect(resolveSchemaBinding({ rootType: 'plan', oscalVersion: '1.1.3' })).toMatchObject({
        code: VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_TYPE_UNKNOWN,
      });
    });

    it('accepts a known root type that has no adapter yet', () => {
      // „bekannt, aber noch nicht registriert" ist kein Fehler der Matrix.
      for (const rootKey of [
        'system-security-plan',
        'assessment-plan',
        'assessment-results',
        'plan-of-action-and-milestones',
      ]) {
        expect(resolveSchemaBinding({ rootType: rootKey, oscalVersion: '1.2.2' }).ok).toBe(true);
      }
    });

    describe('$schema-Direktive', () => {
      it('accepts a document without a $schema directive', () => {
        expect(resolveSchemaBinding({
          rootType: 'mapping-collection',
          oscalVersion: '1.2.1',
          schemaDirective: undefined,
        }).ok).toBe(true);
      });

      it('accepts a directive that agrees with the declared version', () => {
        // Realer Wert aus dem BSI-Artefakt mapping-itgs2023-zu-gspp.
        expect(resolveSchemaBinding({
          rootType: 'mapping-collection',
          oscalVersion: '1.2.1',
          schemaDirective: 'http://csrc.nist.gov/ns/oscal/1.2.1/oscal-mapping-schema.json',
        }).ok).toBe(true);
      });

      it('never lets the directive select the schema against oscal-version', () => {
        const result = resolveSchemaBinding({
          rootType: 'mapping-collection',
          oscalVersion: '1.2.2',
          schemaDirective: 'http://csrc.nist.gov/ns/oscal/1.2.1/oscal-mapping-schema.json',
        });

        expect(result).toMatchObject({
          code: VERSION_MATRIX_DIAGNOSTIC_CODES.SCHEMA_DIRECTIVE_CONFLICT,
          oscalVersion: '1.2.2',
          expected: 'http://csrc.nist.gov/ns/oscal/1.2.2/oscal-mapping-schema.json',
        });
      });

      it('rejects a non-string or empty directive', () => {
        for (const schemaDirective of ['', '   ', 42 as never, 0 as never, {} as never]) {
          expect(resolveSchemaBinding({
            rootType: 'catalog',
            oscalVersion: '1.1.3',
            schemaDirective,
          })).toMatchObject({
            code: VERSION_MATRIX_DIAGNOSTIC_CODES.SCHEMA_DIRECTIVE_CONFLICT,
          });
        }
      });

      it('treats a present null directive as invalid, not as absent', () => {
        // {"$schema": null} ist im Dokument vorhanden, aber nach
        // URIReferenceDatatype ungültig. Nur `undefined` ist Abwesenheit.
        const parsed = JSON.parse('{"$schema": null, "catalog": {}}');
        expect(Object.hasOwn(parsed, '$schema')).toBe(true);

        expect(resolveSchemaBinding({
          rootType: 'catalog',
          oscalVersion: '1.1.3',
          schemaDirective: parsed.$schema,
        })).toMatchObject({
          code: VERSION_MATRIX_DIAGNOSTIC_CODES.SCHEMA_DIRECTIVE_CONFLICT,
        });

        // Gegenprobe: der fehlende Key liefert undefined und wird akzeptiert.
        const absent = JSON.parse('{"catalog": {}}');
        expect(resolveSchemaBinding({
          rootType: 'catalog',
          oscalVersion: '1.1.3',
          schemaDirective: absent.$schema,
        }).ok).toBe(true);
      });
    });

    it('does not read metadata.version as a model version', () => {
      // Reale BSI-Dokumentversionen; keine davon darf die Auswahl beeinflussen.
      for (const documentVersion of ['gsmap-oscal-export-v1', '1.0.1-qa', '2026-07-29T06:42:34Z']) {
        expect(resolveSchemaBinding({ rootType: 'catalog', oscalVersion: documentVersion }).ok)
          .toBe(false);
      }
      expect(resolveSchemaBinding({ rootType: 'catalog', oscalVersion: '1.1.3' }).ok).toBe(true);
    });
  });

  describe('verifySchemaArtifact', () => {
    const catalogPin = getSchemaPin('catalog', '1.2.2')!;

    it('accepts a schema whose hash and $id match the pin', () => {
      expect(verifySchemaArtifact({
        rootKey: 'catalog',
        version: '1.2.2',
        sha256: catalogPin.sha256,
        schemaId: catalogPin.schemaId,
      }).ok).toBe(true);
    });

    it('rejects a tampered schema hash', () => {
      expect(verifySchemaArtifact({
        rootKey: 'catalog',
        version: '1.2.2',
        sha256: 'f'.repeat(64),
        schemaId: catalogPin.schemaId,
      })).toMatchObject({
        code: VERSION_MATRIX_DIAGNOSTIC_CODES.SCHEMA_HASH_MISMATCH,
        expected: catalogPin.sha256,
      });
    });

    it('rejects a tampered schema $id even when the hash matches', () => {
      expect(verifySchemaArtifact({
        rootKey: 'catalog',
        version: '1.2.2',
        sha256: catalogPin.sha256,
        schemaId: 'http://csrc.nist.gov/ns/oscal/1.2.1/oscal-catalog-schema.json',
      })).toMatchObject({
        code: VERSION_MATRIX_DIAGNOSTIC_CODES.SCHEMA_ID_MISMATCH,
        expected: catalogPin.schemaId,
      });
    });

    it('rejects verification for a cell that does not exist', () => {
      expect(verifySchemaArtifact({
        rootKey: 'mapping-collection',
        version: '1.1.3',
        sha256: 'a'.repeat(64),
        schemaId: 'x',
      })).toMatchObject({
        code: VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_VERSION_UNSUPPORTED,
      });
    });
  });

  it('keeps 1.2.1 and 1.2.2 apart despite identical byte sizes', () => {
    // Beide Releases erzeugen gleich große Dateien; nur der Hash trennt sie.
    for (const rootKey of OSCAL_ROOT_KEYS) {
      const first = getSchemaPin(rootKey, '1.2.1');
      const second = getSchemaPin(rootKey, '1.2.2');
      expect(first!.sizeBytes).toBe(second!.sizeBytes);
      expect(first!.sha256).not.toBe(second!.sha256);
    }
  });

  it('exposes stable diagnostic codes', () => {
    expect(VERSION_MATRIX_DIAGNOSTIC_CODES).toEqual({
      ROOT_TYPE_UNKNOWN: 'OSCAL_ROOT_TYPE_UNKNOWN',
      VERSION_MISSING: 'OSCAL_VERSION_MISSING',
      VERSION_MALFORMED: 'OSCAL_VERSION_MALFORMED',
      ROOT_VERSION_IMPOSSIBLE: 'OSCAL_ROOT_VERSION_IMPOSSIBLE',
      ROOT_VERSION_UNSUPPORTED: 'OSCAL_ROOT_VERSION_UNSUPPORTED',
      SCHEMA_ID_MISMATCH: 'OSCAL_SCHEMA_ID_MISMATCH',
      SCHEMA_HASH_MISMATCH: 'OSCAL_SCHEMA_HASH_MISMATCH',
      SCHEMA_DIRECTIVE_CONFLICT: 'OSCAL_SCHEMA_DIRECTIVE_CONFLICT',
    });
    expect(Object.isFrozen(VERSION_MATRIX_DIAGNOSTIC_CODES)).toBe(true);
  });
});
