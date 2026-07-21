import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_BSI_REPO,
  OFFICIAL_CATALOG_PATH,
  OFFICIAL_NAMESPACE_DIRECTORY,
  assertAllowedUpstreamRepoPath,
} from './security-guards.mjs';

/**
 * Verhaltensmatrix für die Upstream-Allowlist. Der Registry-Umbau (ADR-0001)
 * darf die erlaubte Menge nicht verändern: genau der Grundschutz++-Katalog
 * plus direkte Namespace-CSVs, alles andere fail-closed.
 */
describe('security-guards', () => {
  it('keeps the official constants stable', () => {
    expect(OFFICIAL_BSI_REPO).toBe('BSI-Bund/Stand-der-Technik-Bibliothek');
    expect(OFFICIAL_CATALOG_PATH).toBe('Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json');
    expect(OFFICIAL_NAMESPACE_DIRECTORY).toBe('Dokumentation/namespaces');
  });

  it('allows the official catalog path', () => {
    expect(assertAllowedUpstreamRepoPath(OFFICIAL_CATALOG_PATH)).toBe(OFFICIAL_CATALOG_PATH);
  });

  it('allows direct namespace CSV files only', () => {
    expect(assertAllowedUpstreamRepoPath('Dokumentation/namespaces/tags.csv')).toBe(
      'Dokumentation/namespaces/tags.csv',
    );
    expect(() => assertAllowedUpstreamRepoPath('Dokumentation/namespaces/nested/tags.csv')).toThrow(
      'outside the allowed BSI contract',
    );
    expect(() => assertAllowedUpstreamRepoPath('Dokumentation/namespaces/readme.md')).toThrow(
      'outside the allowed BSI contract',
    );
  });

  it('rejects registered preview artifacts for fetching', () => {
    expect(() =>
      assertAllowedUpstreamRepoPath(
        'Anwenderkataloge/Lieferkettensicherheit/Lieferkettensicherheit-catalog.json',
      ),
    ).toThrow('outside the allowed BSI contract');
    expect(() =>
      assertAllowedUpstreamRepoPath('Quellkataloge/WLAN/WLAN-profile.json'),
    ).toThrow('outside the allowed BSI contract');
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
