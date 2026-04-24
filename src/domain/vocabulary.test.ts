import { describe, expect, it } from 'vitest';
import {
  buildVocabularySourceUrl,
  buildVocabularyRegistry,
  resolveVocabularyEntry,
  resolveVocabularyProp,
  resolveVocabularyValues,
} from './vocabulary';
import type { VocabularyRegistryData } from './models';

const namespaceUrl =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv';

function makeRegistryData(): VocabularyRegistryData {
  return {
    sourceCommitSha: 'snapshot-123',
    namespaces: [
      {
        source: {
          namespace: namespaceUrl,
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
            value: 'erhöht',
            definition: 'Erhöhte Sicherheitsstufe',
            columns: {
              Begriff: 'erhöht',
              Definition: 'Erhöhte Sicherheitsstufe',
            },
          },
          {
            value: 'normal-SdT',
            definition: 'Normale Sicherheitsstufe',
            columns: {
              Begriff: 'normal-SdT',
              Definition: 'Normale Sicherheitsstufe',
            },
          },
        ],
      },
    ],
  };
}

describe('vocabulary runtime', () => {
  it('builds exact lookup indexes for namespaces and entries', () => {
    const registry = buildVocabularyRegistry(makeRegistryData());

    expect(
      registry.namespacesByUrl.get(namespaceUrl)?.entriesByValue.get('erhöht')
        ?.definition,
    ).toBe('Erhöhte Sicherheitsstufe');
    expect(
      registry.namespacesByRouteId.get('dokumentation-namespaces-security-level')
        ?.source.fileName,
    ).toBe('security_level.csv');
  });

  it('resolves exact namespace + value matches', () => {
    const registry = buildVocabularyRegistry(makeRegistryData());

    expect(resolveVocabularyEntry(registry, namespaceUrl, 'erhöht')).toMatchObject({
      namespace: {
        source: {
          namespace: namespaceUrl,
        },
      },
      entry: {
        value: 'erhöht',
        definition: 'Erhöhte Sicherheitsstufe',
      },
    });
    expect(resolveVocabularyEntry(registry, namespaceUrl, 'ERHÖHT')).toBeNull();
    expect(resolveVocabularyEntry(registry, undefined, 'erhöht')).toBeNull();
  });

  it('resolves prop values and multi-value lists without heuristics', () => {
    const registry = buildVocabularyRegistry(makeRegistryData());

    expect(
      resolveVocabularyProp(registry, {
        name: 'sec_level',
        value: 'normal-SdT',
        ns: namespaceUrl,
      })?.entry.definition,
    ).toBe('Normale Sicherheitsstufe');

    expect(
      resolveVocabularyValues(registry, namespaceUrl, ['erhöht', 'unbekannt']),
    ).toHaveLength(1);
  });

  it('builds exact upstream file links from repository metadata', () => {
    const data = makeRegistryData();

    expect(
      buildVocabularySourceUrl(data.namespaces[0].source, data.sourceCommitSha),
    ).toBe(
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/blob/snapshot-123/Dokumentation/namespaces/security_level.csv',
    );
  });
});
