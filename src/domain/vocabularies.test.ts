import { describe, expect, it } from 'vitest';
import type { VocabularyRegistryData } from './models';
import {
  buildVocabularyRegistry,
  getVocabularyNamespaceByRouteId,
  resolvePropVocabularyEntry,
  resolveVocabularyEntries,
  resolveVocabularyEntry,
} from './vocabularies';

function makeRegistryData(): VocabularyRegistryData {
  return {
    sourceCommitSha: 'snapshot-123',
    namespaces: [
      {
        source: {
          namespace:
            'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
          repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
          path: 'Dokumentation/namespaces/security_level.csv',
          fileName: 'security_level.csv',
          routeId: 'dokumentation-namespaces-security-level',
          gitBlobSha: 'blob-security',
        },
        columnOrder: ['Begriff', 'Definition'],
        valueColumn: 'Begriff',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'normal-SdT',
            definition: 'Standard-Sicherheitsstufe',
            columns: {
              Begriff: 'normal-SdT',
              Definition: 'Standard-Sicherheitsstufe',
            },
          },
        ],
      },
      {
        source: {
          namespace:
            'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/tags.csv',
          repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
          path: 'Dokumentation/namespaces/tags.csv',
          fileName: 'tags.csv',
          routeId: 'dokumentation-namespaces-tags',
          gitBlobSha: 'blob-tags',
        },
        columnOrder: ['Begriff', 'Definition'],
        valueColumn: 'Begriff',
        definitionColumn: 'Definition',
        entries: [
          {
            value: 'Governance',
            definition: 'Governance-Definition',
            columns: {
              Begriff: 'Governance',
              Definition: 'Governance-Definition',
            },
          },
          {
            value: 'BCM',
            definition: 'BCM-Definition',
            columns: {
              Begriff: 'BCM',
              Definition: 'BCM-Definition',
            },
          },
        ],
      },
    ],
  };
}

describe('buildVocabularyRegistry', () => {
  it('creates exact lookup maps for namespaces and route ids', () => {
    const registry = buildVocabularyRegistry(makeRegistryData());

    expect(registry.sourceCommitSha).toBe('snapshot-123');
    expect(registry.namespacesByUrl.size).toBe(2);
    expect(
      getVocabularyNamespaceByRouteId(
        registry,
        'dokumentation-namespaces-security-level',
      )?.source.fileName,
    ).toBe('security_level.csv');
  });
});

describe('resolveVocabularyEntry', () => {
  it('returns the official entry only for an exact namespace + value hit', () => {
    const registry = buildVocabularyRegistry(makeRegistryData());

    expect(
      resolveVocabularyEntry(
        registry,
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
        'normal-SdT',
      )?.entry.definition,
    ).toBe('Standard-Sicherheitsstufe');
    expect(
      resolveVocabularyEntry(
        registry,
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
        'normal',
      ),
    ).toBeNull();
  });

  it('resolves PropValue metadata without reparsing OSCAL structures', () => {
    const registry = buildVocabularyRegistry(makeRegistryData());

    expect(
      resolvePropVocabularyEntry(registry, {
        name: 'sec_level',
        value: 'normal-SdT',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
      })?.entry.columns.Begriff,
    ).toBe('normal-SdT');
  });

  it('resolves multiple values only when each exact value exists', () => {
    const registry = buildVocabularyRegistry(makeRegistryData());

    const matches = resolveVocabularyEntries(
      registry,
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/tags.csv',
      ['Governance', 'Unbekannt', 'BCM'],
    );

    expect(matches.map((match) => match.entry.value)).toEqual([
      'Governance',
      'BCM',
    ]);
  });
});
