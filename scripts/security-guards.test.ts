import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_BSI_REPO,
  OFFICIAL_BSI_REPOSITORY_URL,
  OFFICIAL_CATALOG_PATH,
  OFFICIAL_NAMESPACE_DIRECTORY,
  assertAllowedUpstreamRepoPath,
  assertOfficialBsiRepository,
  assertRegisteredUpstreamRepoPath,
} from './security-guards.mjs';

/**
 * Verhaltensmatrix für die Upstream-Allowlist. Der Registry-Umbau (ADR-0001)
 * darf die erlaubte Menge nicht verändern: genau der Grundschutz++-Katalog
 * plus direkte Namespace-CSVs, alles andere fail-closed.
 */
describe('security-guards', () => {
  it('keeps the official constants stable', () => {
    expect(OFFICIAL_BSI_REPO).toBe('BSI-Bund/Stand-der-Technik-Bibliothek');
    expect(OFFICIAL_BSI_REPOSITORY_URL).toBe(
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    );
    expect(OFFICIAL_CATALOG_PATH).toBe('control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json');
    expect(OFFICIAL_NAMESPACE_DIRECTORY).toBe('documentation/namespaces');
  });

  it('normalizes only the official BSI repository slug or exact URL', () => {
    expect(assertOfficialBsiRepository(OFFICIAL_BSI_REPO)).toBe(OFFICIAL_BSI_REPO);
    expect(assertOfficialBsiRepository(OFFICIAL_BSI_REPOSITORY_URL)).toBe(OFFICIAL_BSI_REPO);
  });

  it.each([
    'https://example.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    'https://github.com/attacker/Stand-der-Technik-Bibliothek',
    'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek.evil',
    'http://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main',
    'BSI-Bund/anderes-repository',
  ])('rejects non-official or external repository %s', (repository) => {
    expect(() => assertOfficialBsiRepository(repository)).toThrow(
      `must be ${OFFICIAL_BSI_REPOSITORY_URL}`,
    );
  });

  it('allows the official catalog path', () => {
    expect(assertAllowedUpstreamRepoPath(OFFICIAL_CATALOG_PATH)).toBe(OFFICIAL_CATALOG_PATH);
  });

  it('allows direct namespace CSV files only', () => {
    expect(assertAllowedUpstreamRepoPath('documentation/namespaces/tags.csv')).toBe(
      'documentation/namespaces/tags.csv',
    );
    expect(() => assertAllowedUpstreamRepoPath('documentation/namespaces/nested/tags.csv')).toThrow(
      'outside the allowed BSI contract',
    );
    expect(() => assertAllowedUpstreamRepoPath('documentation/namespaces/readme.md')).toThrow(
      'outside the allowed BSI contract',
    );
  });

  it('rejects registered preview artifacts for fetching', () => {
    expect(() =>
      assertAllowedUpstreamRepoPath(
        'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json',
      ),
    ).toThrow('outside the allowed BSI contract');
    expect(() =>
      assertAllowedUpstreamRepoPath('control_layer/WLAN/sources/profiles/WLAN-profile.json'),
    ).toThrow('outside the allowed BSI contract');
  });

  it('allows exact preview OSCAL paths for read-only registry inspection', () => {
    const previewCatalog =
      'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json';
    const previewProfile = 'control_layer/WLAN/sources/profiles/WLAN-profile.json';

    expect(assertRegisteredUpstreamRepoPath(previewCatalog)).toBe(previewCatalog);
    expect(assertRegisteredUpstreamRepoPath(previewProfile)).toBe(previewProfile);
  });

  it('requires explicit materialization before inspecting a vocabulary member', () => {
    const materializedNamespacePath = 'documentation/namespaces/tags.csv';
    const unmaterializedNamespacePath =
      'documentation/namespaces/security_targets_levels.csv';

    expect(() => assertRegisteredUpstreamRepoPath(materializedNamespacePath)).toThrow(
      'not a materialized registry artifact',
    );
    expect(
      assertRegisteredUpstreamRepoPath(materializedNamespacePath, {
        materializedNamespacePaths: [materializedNamespacePath],
      }),
    ).toBe(materializedNamespacePath);
    expect(() =>
      assertRegisteredUpstreamRepoPath(unmaterializedNamespacePath, {
        materializedNamespacePaths: [materializedNamespacePath],
      }),
    ).toThrow('not a materialized registry artifact');
  });

  it('rejects unknown, nested, inexact, and traversing inspection paths', () => {
    expect(() =>
      assertRegisteredUpstreamRepoPath('documentation/namespaces/nested/tags.csv', {
        materializedNamespacePaths: ['documentation/namespaces/nested/tags.csv'],
      }),
    ).toThrow('not a materialized registry artifact');
    expect(() =>
      assertRegisteredUpstreamRepoPath(
        'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json.bak',
      ),
    ).toThrow('not a materialized registry artifact');
    expect(() =>
      assertRegisteredUpstreamRepoPath(
        'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json',
      ),
    ).toThrow('not a materialized registry artifact');
    expect(() =>
      assertRegisteredUpstreamRepoPath('control_layer/../secret.json'),
    ).toThrow('Unsafe upstream repository path');
  });

  it('rejects unknown and unsafe paths', () => {
    expect(() => assertAllowedUpstreamRepoPath('Dokumentation/readme.md')).toThrow(
      'outside the allowed BSI contract',
    );
    expect(() => assertAllowedUpstreamRepoPath('../secret.txt')).toThrow(
      'Unsafe upstream repository path',
    );
    expect(() => assertAllowedUpstreamRepoPath('/etc/passwd')).toThrow(
      'Unsafe upstream repository path',
    );
    expect(() => assertAllowedUpstreamRepoPath('a\\b.json')).toThrow(
      'Unsafe upstream repository path',
    );
    expect(() => assertAllowedUpstreamRepoPath('Dokumentation//namespaces/tags.csv')).toThrow(
      'Unsafe upstream repository path',
    );
    expect(() => assertAllowedUpstreamRepoPath('')).toThrow('must not be empty');
  });
});
