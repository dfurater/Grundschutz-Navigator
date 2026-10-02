// =============================================================================
// GSPP-453 — Trefferbewertung als reine Funktion
//
// Die Bewertung läuft hier ohne React und ohne Suchcache: Die Sicht entsteht
// über `buildSearchCacheEntry`, das selbst nichts im Cache ablegt. Cache-
// Invalidierung, LRU und Katalogtrennung belegen weiterhin die Hook-Tests.
// =============================================================================

import type { Index } from 'flexsearch';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Control, Practice } from '@/domain/models';
import { rankSearchResults, type SearchView } from './searchRanking';
import {
  buildSearchCacheEntry,
  clearSearchCache,
  getSearchCacheSize,
} from './useSearch';

const CONTROL_IDENTIFIER = '9bb16672-4394-4ce9-bd14-12a080233f7a';
const PRACTICE_IDENTIFIER = '5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f';

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

function buildView(controls: Control[], practices: Practice[] = []): SearchView {
  return buildSearchCacheEntry('gspp', controls, practices, null);
}

function rankedIds(query: string, view: SearchView) {
  return rankSearchResults(query, view).map((entry) => entry.control.id);
}

describe('rankSearchResults', () => {
  beforeEach(() => {
    clearSearchCache();
  });

  it('returns no results for a blank query or an empty catalog', () => {
    expect(rankedIds('   ', buildView([makeControl()]))).toEqual([]);
    expect(rankedIds('ISMS', buildView([]))).toEqual([]);
  });

  describe('Kennungspfad', () => {
    const controls = [
      makeControl({ id: 'GC.1.1', practiceId: 'GC' }),
      makeControl({ id: 'GC.1.2', practiceId: 'GC', altIdentifier: CONTROL_IDENTIFIER }),
      makeControl({ id: 'ASST.1.1', groupId: 'ASST.1', practiceId: 'ASST' }),
    ];
    const practices: Practice[] = [{
      id: 'GC',
      title: 'Governance und Compliance',
      label: 'GC',
      altIdentifier: PRACTICE_IDENTIFIER,
      topics: [],
      controlCount: 2,
    }];

    it('resolves an exact control identifier to that control', () => {
      expect(rankedIds(CONTROL_IDENTIFIER, buildView(controls, practices))).toEqual(['GC.1.2']);
    });

    it('resolves a practice identifier in catalog order', () => {
      expect(rankedIds(PRACTICE_IDENTIFIER, buildView(controls, practices))).toEqual([
        'GC.1.1',
        'GC.1.2',
      ]);
    });

    it('puts the control alt-identifier first when a practice shares it', () => {
      const shared: Practice[] = [{ ...practices[0], altIdentifier: CONTROL_IDENTIFIER }];

      expect(rankedIds(CONTROL_IDENTIFIER, buildView(controls, shared))).toEqual([
        'GC.1.2',
        'GC.1.1',
      ]);
    });

    it('returns nothing for an unknown identifier instead of falling back to text', () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      const view = buildView([makeControl({ id: 'GC.1.1', title: unknown })]);

      expect(rankedIds(unknown, view)).toEqual([]);
    });

    it('returns nothing for an incomplete identifier even when text would match', () => {
      const fragment = CONTROL_IDENTIFIER.slice(0, 13);
      const view = buildView([makeControl({ id: 'GC.1.1', statement: `Kennung ${fragment}` })]);

      expect(rankedIds(fragment, view)).toEqual([]);
    });
  });

  describe('Textpfad', () => {
    it('puts an exact control id ahead of every other match', () => {
      const view = buildView([
        makeControl({ id: 'GC.1.10', title: 'GC.1.1 erweitert' }),
        makeControl({ id: 'GC.1.1', title: 'Basis' }),
      ]);

      expect(rankedIds('GC.1.1', view)[0]).toBe('GC.1.1');
    });

    it('weights title matches above content-only matches', () => {
      const view = buildView([
        makeControl({ id: 'GC.1.1', title: 'Allgemein', statement: 'Protokollierung MUSS erfolgen.' }),
        makeControl({ id: 'GC.1.2', title: 'Protokollierung', statement: 'Nichts weiter.' }),
      ]);

      expect(rankedIds('Protokollierung', view)).toEqual(['GC.1.2', 'GC.1.1']);
    });

    it('matches word prefixes of longer single-word queries in content', () => {
      const view = buildView([
        makeControl({ id: 'GC.1.1', title: 'Allgemein', statement: 'Datensicherungskonzept MUSS bestehen.' }),
      ]);

      expect(rankedIds('datensich', view)).toEqual(['GC.1.1']);
    });

    it('keeps short modal verbs from matching unrelated words', () => {
      const view = buildView([
        makeControl({ id: 'GC.1.1', title: 'Allgemein', statement: 'Ein Muster wird genutzt.' }),
        makeControl({ id: 'GC.1.2', title: 'Allgemein', statement: 'Das MUSS gelten.' }),
      ]);

      expect(rankedIds('MUSS', view)).toEqual(['GC.1.2']);
    });

    it('breaks equal score and rank by German control-id collation', () => {
      // Gestubbte Indizes erzwingen den Gleichstand: Beide Controls erreichen
      // über die gekreuzten Ränge dieselbe Summe und denselben besten Rang,
      // sodass nur noch die Kennungs-Sortierung entscheidet.
      const base = buildView([
        makeControl({ id: 'GC.1.10', title: 'Allgemein' }),
        makeControl({ id: 'GC.1.2', title: 'Allgemein' }),
      ]);
      const stub = (ids: number[]) => ({ search: () => ids }) as unknown as Index;
      const view: SearchView = {
        ...base,
        indexes: {
          controlIds: stub([0, 1]),
          titles: stub([1, 0]),
          links: stub([]),
          metadata: stub([]),
          content: stub([]),
        },
      };

      expect(rankedIds('Allgemein', view)).toEqual(['GC.1.2', 'GC.1.10']);
    });

    it('is deterministic and leaves the search cache untouched', () => {
      const view = buildView([
        makeControl({ id: 'GC.1.1', title: 'Protokollierung' }),
        makeControl({ id: 'GC.1.2', title: 'Allgemein', statement: 'Protokollierung MUSS erfolgen.' }),
      ]);

      const first = rankedIds('Protokollierung', view);

      expect(rankedIds('Protokollierung', view)).toEqual(first);
      expect(getSearchCacheSize()).toBe(0);
    });
  });
});
