import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  Control,
  Practice,
  VocabularyRegistry,
  VocabularyRegistryData,
} from '@/domain/models';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import {
  clearSearchCache,
  getSearchCacheEntry,
  getSearchCacheKeys,
  getSearchCacheSize,
  MAX_SEARCH_CACHE_ENTRIES,
  SEARCH_INDEX_BUILD_MEASURE,
  useSearch,
} from './useSearch';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Governance MUSS verankert werden.',
    statementRaw: 'Governance MUSS verankert werden.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
      ...overrides.statementProps,
    },
    links: [],
    params: {},
    ...overrides,
  };
}

function createSecurityLevelRegistry(): VocabularyRegistry {
  const registryData: VocabularyRegistryData = {
    sourceCommitSha: 'snapshot-123',
    namespaces: [
      {
        source: {
          namespace:
            'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_level.csv',
          repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
          path: 'documentation/namespaces/security_level.csv',
          fileName: 'security_level.csv',
          routeId: 'documentation-namespaces-security-level',
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
        ],
      },
    ],
  };

  return buildVocabularyRegistry(registryData);
}

describe('useSearch', () => {
  beforeEach(() => {
    clearSearchCache();
  });

  it('finds controls by result_specification / präzisierung', async () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        statementProps: {
          zielobjektKategorien: [],
          praezisierung: 'nach einem Standard',
        },
      }),
      makeControl({
        id: 'GC.1.2',
        title: 'Anderer Control',
        statementProps: {
          zielobjektKategorien: [],
        },
      }),
    ];

    const { result } = renderHook(() => useSearch(controls, 'Standard'));

    await waitFor(() => {
      expect(result.current.results).toHaveLength(1);
    });

    expect(result.current.results[0].control.id).toBe('GC.1.1');
  });

  it('finds controls by linked control id and relation type', async () => {
    const controls = [
      makeControl({
        id: 'GC.2.1',
        links: [{ targetId: 'GC.2.2', href: '#GC.2.2', rel: 'required', relStatus: 'custom' }],
      }),
      makeControl({
        id: 'GC.2.3',
        links: [{ targetId: 'GC.2.4', href: '#GC.2.4', rel: 'related', relStatus: 'custom' }],
      }),
    ];

    const { result } = renderHook(() => useSearch(controls, 'GC.2.2'));

    await waitFor(() => {
      expect(result.current.results[0]?.control.id).toBe('GC.2.1');
    });

    const relationSearch = renderHook(() => useSearch(controls, 'erforderlich'));

    await waitFor(() => {
      expect(
        relationSearch.result.current.results.map((entry) => entry.control.id),
      ).toContain('GC.2.1');
    });
  });

  it('finds controls by WLAN taxonomy level names and values', async () => {
    const controls = [
      makeControl({
        id: 'WLAN.1.1',
        taxonomy: [
          { name: 'Taxonomy-L1', value: 'Infrastruktur' },
          { name: 'Taxonomy-L4', value: 'Funknetz' },
        ],
      }),
    ];
    const valueSearch = renderHook(() => useSearch(controls, 'Infrastruktur'));
    const nameSearch = renderHook(() => useSearch(controls, 'Taxonomy-L4'));

    await waitFor(() => {
      expect(valueSearch.result.current.results[0]?.control.id).toBe('WLAN.1.1');
      expect(nameSearch.result.current.results[0]?.control.id).toBe('WLAN.1.1');
    });
  });

  it('finds controls by official vocabulary definitions', async () => {
    const controls = [
      makeControl({
        id: 'GC.3.1',
        securityLevel: 'erhöht',
        securityLevelProp: {
          name: 'sec_level',
          value: 'erhöht',
          ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_level.csv',
        },
      }),
    ];

    const registry = createSecurityLevelRegistry();
    const { result } = renderHook(() =>
      useSearch(controls, 'Sicherheitsstufe', registry),
    );

    await waitFor(() => {
      expect(result.current.results[0]?.control.id).toBe('GC.3.1');
    });
  });

  it('finds controls by threats and resolved security-target or threat vocabulary text', async () => {
    const controls = [
      makeControl({
        id: 'ASST.1.1',
        confidentiality: '2',
        confidentialityProp: {
          name: 'confidentiality',
          value: '2',
          ns: 'https://example.com/namespaces/security_targets.csv',
        },
        threats: ['G 0.18'],
        threatsProp: {
          name: 'threats',
          value: 'G 0.18',
          ns: 'https://example.com/namespaces/basethreats.csv',
        },
      }),
    ];
    const registry = createTestVocabularyRegistry();
    const threatIdSearch = renderHook(() =>
      useSearch(controls, 'G 0.18', registry),
    );
    const targetSearch = renderHook(() =>
      useSearch(controls, 'Vertraulichkeit', registry),
    );
    const threatDefinitionSearch = renderHook(() =>
      useSearch(controls, 'Fehlplanung', registry),
    );

    await waitFor(() => {
      expect(threatIdSearch.result.current.results[0]?.control.id).toBe('ASST.1.1');
      expect(targetSearch.result.current.results[0]?.control.id).toBe('ASST.1.1');
      expect(threatDefinitionSearch.result.current.results[0]?.control.id).toBe('ASST.1.1');
    });
  });

  it('finds controls by a UUID-joined practice alias without title fallback', async () => {
    const controls = [makeControl({ id: 'GC.1.1', practiceId: 'GC' })];
    const practice: Practice = {
      id: 'GC',
      title: 'Governance und Compliance',
      label: 'GC',
      altIdentifier: 'uuid-practice-1',
      topics: [],
      controlCount: 1,
    };
    const registry = createTestVocabularyRegistry();
    const aliasSearch = renderHook(() =>
      useSearch(controls, 'Corporate', registry, [practice]),
    );

    await waitFor(() => {
      expect(aliasSearch.result.current.results[0]?.control.id).toBe('GC.1.1');
    });

    const missingUuidSearch = renderHook(() =>
      useSearch(controls, 'Corporate', registry, [{
        ...practice,
        altIdentifier: undefined,
      }]),
    );

    await waitFor(() => {
      expect(missingUuidSearch.result.current.results).toHaveLength(0);
    });
  });

  it('ranks exact control ids before linked references', async () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        title: 'Errichtung und Aufrechterhaltung eines ISMS',
      }),
      makeControl({
        id: 'GC.2.1',
        title: 'Anderer Control',
        links: [{ targetId: 'GC.1.1', href: '#GC.1.1', rel: 'required', relStatus: 'custom' }],
      }),
    ];

    const { result } = renderHook(() => useSearch(controls, 'GC.1.1'));

    await waitFor(() => {
      expect(result.current.results.map((entry) => entry.control.id)).toEqual([
        'GC.1.1',
        'GC.2.1',
      ]);
    });
  });

  it('ranks title fragment matches before statement-only matches', async () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        title: 'Errichtung und Aufrechterhaltung eines ISMS',
      }),
      makeControl({
        id: 'GC.2.1',
        title: 'Anderer Control',
        statement: 'Das ISMS muss laufend überprüft werden.',
        statementRaw: 'Das ISMS muss laufend überprüft werden.',
      }),
    ];

    const { result } = renderHook(() => useSearch(controls, 'ISMS'));

    await waitFor(() => {
      expect(result.current.results.map((entry) => entry.control.id)).toEqual([
        'GC.1.1',
        'GC.2.1',
      ]);
    });
  });

  it('does not treat MUSS as Muster or Museen false positives', async () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        title: 'Errichtung und Aufrechterhaltung eines ISMS',
        statement: 'Governance MUSS verankert werden.',
        statementRaw: 'Governance MUSS verankert werden.',
      }),
      makeControl({
        id: 'PERF.5.2',
        title: 'Bericht an die Institutionsleitung',
        statement: 'Top-Management MUSS informiert werden.',
        statementRaw: 'Top-Management MUSS informiert werden.',
      }),
      makeControl({
        id: 'PERF.5.1.3',
        title: 'Erfolge und Probleme',
        statement: 'Berichte zu Audits und Beobachtungen.',
        statementRaw: 'Berichte zu Audits und Beobachtungen.',
      }),
      makeControl({
        id: 'KONF.6.3',
        title: 'Kiosk-Modus',
        statement: 'Informationsterminals in Museen und Einkaufszentren.',
        statementRaw: 'Informationsterminals in Museen und Einkaufszentren.',
      }),
      makeControl({
        id: 'GEB.9.1.1',
        title: 'Vorausschauende Lastanalyse',
        statement: 'Analyse von elektrischen Lastmustern.',
        statementRaw: 'Analyse von elektrischen Lastmustern.',
      }),
      makeControl({
        id: 'KONF.13.1',
        title: 'Filtern schädlicher Nachrichten',
        statement: 'Muster verdächtiger Inhalte erkennen.',
        statementRaw: 'Muster verdächtiger Inhalte erkennen.',
      }),
    ];

    const { result } = renderHook(() => useSearch(controls, 'MUSS'));

    await waitFor(() => {
      expect(result.current.results.map((entry) => entry.control.id)).toEqual([
        'GC.1.1',
        'PERF.5.2',
      ]);
    });
  });

  it('matches longer word forms in guidance without reopening short prefix false positives', async () => {
    const controls = [
      makeControl({
        id: 'GEB.9.1.1',
        title: 'Vorausschauende Lastanalyse',
        statement: 'Elektrische Lasten sollen fortlaufend beobachtet werden.',
        statementRaw: 'Elektrische Lasten sollen fortlaufend beobachtet werden.',
        guidance: 'Umsetzungshinweise zu elektrischen Lastmustern dokumentieren.',
      }),
      makeControl({
        id: 'GC.1.1',
        title: 'Errichtung und Aufrechterhaltung eines ISMS',
        statement: 'Governance MUSS verankert werden.',
        statementRaw: 'Governance MUSS verankert werden.',
      }),
    ];

    const { result } = renderHook(() => useSearch(controls, 'Lastmuster'));

    await waitFor(() => {
      expect(result.current.results.map((entry) => entry.control.id)).toEqual([
        'GEB.9.1.1',
      ]);
    });
  });

  it('matches umlauted vocabulary values case-insensitively', async () => {
    const controls = [
      makeControl({
        id: 'GC.3.1',
        securityLevel: 'erhöht',
        securityLevelProp: {
          name: 'sec_level',
          value: 'erhöht',
          ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_level.csv',
        },
      }),
    ];

    const registry = createSecurityLevelRegistry();
    const { result } = renderHook(() =>
      useSearch(controls, 'ERHÖHT', registry),
    );

    await waitFor(() => {
      expect(result.current.results.map((entry) => entry.control.id)).toEqual([
        'GC.3.1',
      ]);
    });
  });

  it('returns all matching controls instead of capping results at 50', async () => {
    const controls = Array.from({ length: 75 }, (_, index) =>
      makeControl({
        id: `GC.9.${index + 1}`,
        title: `Suchanker ${index + 1}`,
        statement: 'Der Suchanker MUSS auffindbar bleiben.',
        statementRaw: 'Der Suchanker MUSS auffindbar bleiben.',
      }),
    );

    const { result } = renderHook(() => useSearch(controls, 'Suchanker'));

    await waitFor(() => {
      expect(result.current.results).toHaveLength(75);
    });

    expect(result.current.totalResults).toBe(75);
  });

  describe('GSPP-218 kataloggescopten Cache', () => {
    it('zweiter Mount desselben Katalogs mit identischen Eingaben baut keine neuen Indizes', async () => {
      const controls = [makeControl({ id: 'GC.1.1', title: 'Cache Treffer' })];
      const registry = createSecurityLevelRegistry();
      const practices: Practice[] = [];
      const catalogKey = 'gspp';

      const first = renderHook(() =>
        useSearch(controls, 'Cache', registry, practices, catalogKey),
      );
      await waitFor(() => {
        expect(first.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheSize()).toBe(1);
      });
      const firstEntry = getSearchCacheEntry(catalogKey);
      expect(firstEntry).toBeDefined();
      const firstIndexes = firstEntry!.indexes;

      first.unmount();

      const second = renderHook(() =>
        useSearch(controls, 'Cache', registry, practices, catalogKey),
      );
      await waitFor(() => {
        expect(second.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheSize()).toBe(1);
      });
      const secondEntry = getSearchCacheEntry(catalogKey);
      expect(secondEntry!.indexes).toBe(firstIndexes);
      expect(secondEntry!.searchDocuments).toBe(firstEntry!.searchDocuments);
    });

    it('Wechsel zwischen Katalogen vermischt weder Indexdaten noch Suchergebnisse', async () => {
      const gsppControls = [makeControl({ id: 'GC.1.1', title: 'GSPP Titel' })];
      const wlanControls = [makeControl({ id: 'GC.1.1', title: 'WLAN Titel' })];
      const registry = createSecurityLevelRegistry();

      const gsppSearch = renderHook(() =>
        useSearch(gsppControls, 'GSPP', registry, [], 'gspp'),
      );
      await waitFor(() => {
        expect(gsppSearch.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry('gspp')).toBeDefined();
      });
      expect(gsppSearch.result.current.results[0].control.title).toBe('GSPP Titel');

      const wlanSearch = renderHook(() =>
        useSearch(wlanControls, 'GSPP', registry, [], 'wlan'),
      );
      await waitFor(() => {
        expect(wlanSearch.result.current.results).toHaveLength(0);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry('wlan')).toBeDefined();
      });

      const wlanOwnSearch = renderHook(() =>
        useSearch(wlanControls, 'WLAN', registry, [], 'wlan'),
      );
      await waitFor(() => {
        expect(wlanOwnSearch.result.current.results).toHaveLength(1);
      });
      expect(wlanOwnSearch.result.current.results[0].control.title).toBe('WLAN Titel');

      expect(getSearchCacheKeys()).toEqual(expect.arrayContaining(['gspp', 'wlan']));
      expect(getSearchCacheEntry('gspp')!.indexes).not.toBe(getSearchCacheEntry('wlan')!.indexes);
    });

    it('Rückkehr zu einem zuvor besuchten Katalog nutzt den Cache nur innerhalb des Speicherbudgets (LRU)', async () => {
      const makeControlsForKey = (key: string) => [
        makeControl({ id: `${key}.1.1`, title: `Titel ${key}` }),
      ];
      const registry = createSecurityLevelRegistry();
      const keys = ['k1', 'k2', 'k3', 'k4'] as const;

      for (const key of keys.slice(0, MAX_SEARCH_CACHE_ENTRIES)) {
        const hook = renderHook(() =>
          useSearch(makeControlsForKey(key), `Titel ${key}`, registry, [], key),
        );
        await waitFor(() => {
          expect(hook.result.current.results).toHaveLength(1);
        });
        await waitFor(() => {
          expect(getSearchCacheEntry(key)).toBeDefined();
        });
        hook.unmount();
      }
      expect(getSearchCacheSize()).toBe(MAX_SEARCH_CACHE_ENTRIES);
      expect(getSearchCacheKeys()).toEqual(['k1', 'k2', 'k3']);

      const before = getSearchCacheEntry('k1')!.indexes;
      expect(before).toBeDefined();

      const fourth = renderHook(() =>
        useSearch(makeControlsForKey('k4'), 'Titel k4', registry, [], 'k4'),
      );
      await waitFor(() => {
        expect(fourth.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheSize()).toBe(MAX_SEARCH_CACHE_ENTRIES);
      });
      expect(getSearchCacheKeys()).not.toContain('k1');
      expect(getSearchCacheKeys()).toEqual(['k2', 'k3', 'k4']);

      const reactivatedControls = makeControlsForKey('k1');
      const reactivated = renderHook(() =>
        useSearch(reactivatedControls, 'Titel k1', registry, [], 'k1'),
      );
      await waitFor(() => {
        expect(reactivated.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry('k1')).toBeDefined();
      });
      const after = getSearchCacheEntry('k1')!.indexes;
      expect(after).not.toBe(before);
    });

    it('geänderte Controls invalidieren den Cache', async () => {
      const registry = createSecurityLevelRegistry();
      const catalogKey = 'gspp';
      const firstControls = [makeControl({ id: 'GC.1.1', title: 'Erste Fassung' })];
      const first = renderHook(() =>
        useSearch(firstControls, 'Erste', registry, [], catalogKey),
      );
      await waitFor(() => {
        expect(first.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry(catalogKey)).toBeDefined();
      });
      const firstIndexes = getSearchCacheEntry(catalogKey)!.indexes;
      first.unmount();

      // Gleich langes Ersatz-Array: ein Vergleich über die Array-Länge statt der
      // Referenz würde hier den alten Index weiterverwenden.
      const secondControls = [makeControl({ id: 'GC.1.1', title: 'Zweite Fassung' })];
      const second = renderHook(() =>
        useSearch(secondControls, 'Zweite', registry, [], catalogKey),
      );
      await waitFor(() => {
        expect(second.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry(catalogKey)!.controls).toBe(secondControls);
      });
      const secondIndexes = getSearchCacheEntry(catalogKey)!.indexes;
      expect(secondIndexes).not.toBe(firstIndexes);
      second.unmount();

      // Gegenprobe: der ersetzte Titel liefert keine Treffer mehr.
      const stale = renderHook(() =>
        useSearch(secondControls, 'Erste', registry, [], catalogKey),
      );
      await waitFor(() => {
        expect(stale.result.current.results).toHaveLength(0);
      });
    });

    it('geänderte Vocabulary Registry invalidiert den Cache', async () => {
      const controls = [makeControl({ id: 'GC.3.1', securityLevel: 'erhöht', securityLevelProp: { name: 'sec_level', value: 'erhöht', ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_level.csv' } })];
      const firstRegistry = createSecurityLevelRegistry();
      const secondRegistry = createSecurityLevelRegistry();
      const catalogKey = 'gspp';

      const first = renderHook(() =>
        useSearch(controls, 'Sicherheitsstufe', firstRegistry, [], catalogKey),
      );
      await waitFor(() => {
        expect(first.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry(catalogKey)).toBeDefined();
      });
      const firstIndexes = getSearchCacheEntry(catalogKey)!.indexes;
      first.unmount();

      const second = renderHook(() =>
        useSearch(controls, 'Sicherheitsstufe', secondRegistry, [], catalogKey),
      );
      await waitFor(() => {
        expect(second.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry(catalogKey)!.vocabularyRegistry).toBe(secondRegistry);
      });
      const secondIndexes = getSearchCacheEntry(catalogKey)!.indexes;
      expect(secondIndexes).not.toBe(firstIndexes);
    });

    it('geänderte Practices invalidieren den Cache', async () => {
      const controls = [makeControl({ id: 'GC.1.1', practiceId: 'GC' })];
      const registry = createTestVocabularyRegistry();
      const firstPractices: Practice[] = [{ id: 'GC', title: 'Gov', label: 'GC', altIdentifier: 'uuid-practice-1', topics: [], controlCount: 1 }];
      // Gleich lang wie firstPractices, damit der Test die Referenzprüfung belegt.
      const secondPractices: Practice[] = [
        { id: 'GC', title: 'Gov', label: 'GC', altIdentifier: 'uuid-2', topics: [], controlCount: 1 },
      ];
      const catalogKey = 'gspp';

      const first = renderHook(() =>
        useSearch(controls, 'Corporate', registry, firstPractices, catalogKey),
      );
      await waitFor(() => {
        expect(first.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry(catalogKey)).toBeDefined();
      });
      const firstIndexes = getSearchCacheEntry(catalogKey)!.indexes;
      first.unmount();

      const second = renderHook(() =>
        useSearch(controls, 'Corporate', registry, secondPractices, catalogKey),
      );
      await waitFor(() => {
        expect(second.result.current.results).toHaveLength(0);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry(catalogKey)!.practices).toBe(secondPractices);
      });
      expect(getSearchCacheEntry(catalogKey)!.indexes).not.toBe(firstIndexes);
    });

    it('hinterlässt je Indexaufbau genau einen User-Timing-Eintrag und bei einem Cache-Treffer keinen', async () => {
      // Sichert den Vertrag zu scripts/measure-search-production.mjs ab: der Runner
      // leitet aus diesen Einträgen ab, ob überhaupt ein Index gebaut wurde.
      const controls = [makeControl({ id: 'GC.1.1', title: 'Messvertrag' })];
      const registry = createSecurityLevelRegistry();
      const practices: Practice[] = [];
      performance.clearMeasures(SEARCH_INDEX_BUILD_MEASURE);

      const first = renderHook(() =>
        useSearch(controls, 'Messvertrag', registry, practices, 'gspp'),
      );
      await waitFor(() => {
        expect(first.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheEntry('gspp')).toBeDefined();
      });
      expect(
        performance.getEntriesByName(SEARCH_INDEX_BUILD_MEASURE, 'measure').length,
      ).toBeGreaterThan(0);
      first.unmount();

      performance.clearMeasures(SEARCH_INDEX_BUILD_MEASURE);
      const second = renderHook(() =>
        useSearch(controls, 'Messvertrag', registry, practices, 'gspp'),
      );
      await waitFor(() => {
        expect(second.result.current.results).toHaveLength(1);
      });
      expect(performance.getEntriesByName(SEARCH_INDEX_BUILD_MEASURE, 'measure')).toHaveLength(0);
    });

    it('leere Controls oder fehlender catalogKey belegen kein LRU-Budget', async () => {
      const registry = createSecurityLevelRegistry();
      const controls = [makeControl({ id: 'GC.1.1', title: 'Titel' })];
      const withKey = renderHook(() =>
        useSearch(controls, 'Titel', registry, [], 'gspp'),
      );
      await waitFor(() => {
        expect(withKey.result.current.results).toHaveLength(1);
      });
      await waitFor(() => {
        expect(getSearchCacheSize()).toBe(1);
      });

      const emptyControls = renderHook(() => useSearch([], 'Titel', registry, [], 'gspp'));
      await waitFor(() => {
        expect(emptyControls.result.current.results).toHaveLength(0);
      });
      expect(getSearchCacheSize()).toBe(1);

      const withoutKey = renderHook(() => useSearch(controls, 'Titel', registry, []));
      await waitFor(() => {
        expect(withoutKey.result.current.results).toHaveLength(1);
      });
      expect(getSearchCacheSize()).toBe(1);
      expect(getSearchCacheKeys()).toEqual(['gspp']);
    });
  });
});
