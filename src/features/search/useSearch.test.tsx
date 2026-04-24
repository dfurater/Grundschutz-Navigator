import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  Control,
  VocabularyRegistry,
  VocabularyRegistryData,
} from '@/domain/models';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import { useSearch } from './useSearch';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
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
        links: [{ targetId: 'GC.2.2', relation: 'required' }],
      }),
      makeControl({
        id: 'GC.2.3',
        links: [{ targetId: 'GC.2.4', relation: 'related' }],
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

  it('finds controls by official vocabulary definitions', async () => {
    const controls = [
      makeControl({
        id: 'GC.3.1',
        securityLevel: 'erhöht',
        securityLevelProp: {
          name: 'sec_level',
          value: 'erhöht',
          ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
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

  it('ranks exact control ids before linked references', async () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        title: 'Errichtung und Aufrechterhaltung eines ISMS',
      }),
      makeControl({
        id: 'GC.2.1',
        title: 'Anderer Control',
        links: [{ targetId: 'GC.1.1', relation: 'required' }],
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
          ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
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
});
