import { useEffect, useMemo } from 'react';
import { Index } from 'flexsearch';
import type { Control, Practice, VocabularyRegistry } from '@/domain/models';
import { getControlLinkSearchText } from '@/domain/controlRelationships';
import {
  collectControlVocabularySearchTexts,
  resolveControlVocabularies,
} from '@/domain/vocabulary';
import { resolvePracticeVocabulary } from '@/domain/taxonomyVocabulary';

export interface SearchResult {
  control: Control;
}

export const MAX_SEARCH_CACHE_ENTRIES = 3;

const NATURAL_LANGUAGE_PREFIX_MIN_LENGTH = 6;
const NATURAL_LANGUAGE_METADATA_PREFIX_WEIGHT = 0.75;
const NATURAL_LANGUAGE_CONTENT_PREFIX_WEIGHT = 0.5;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const EMPTY_PRACTICES: Practice[] = [];

interface SearchIndexes {
  controlIds: Index;
  titles: Index;
  links: Index;
  metadata: Index;
  content: Index;
}

interface SearchDocument {
  control: Control;
  numericId: number;
  controlIdText: string;
  titleText: string;
  linkText: string;
  metadataText: string;
  contentText: string;
  normalizedControlId: string;
  normalizedTitle: string;
  normalizedLinkTargets: string[];
}

interface SearchCacheEntry {
  catalogKey: string;
  controls: Control[];
  practices: Practice[];
  vocabularyRegistry: VocabularyRegistry | null | undefined;
  searchDocuments: SearchDocument[];
  controlMap: Map<number, Control>;
  searchDocumentMap: Map<number, SearchDocument>;
  indexes: SearchIndexes;
}

const searchCache = new Map<string, SearchCacheEntry>();

function createSearchDocuments(
  controls: Control[],
  practicesById: Map<string | undefined, Practice>,
  vocabularyRegistry: VocabularyRegistry | null | undefined,
): SearchDocument[] {
  return controls.map<SearchDocument>((control, numericId) => {
    const resolved = resolveControlVocabularies(vocabularyRegistry, control);
    const vocabularyTexts = collectControlVocabularySearchTexts(resolved);
    const practiceVocabulary = resolvePracticeVocabulary(
      vocabularyRegistry,
      practicesById.get(control.practiceId),
    );

    return {
      control,
      numericId,
      controlIdText: control.id,
      titleText: control.title,
      linkText: getControlLinkSearchText(control.links),
      metadataText: [
        control.tags.join(' '),
        control.taxonomy.flatMap((prop) => [prop.name, prop.value]).join(' '),
        control.modalverb ?? '',
        control.statementProps.ergebnis ?? '',
        control.statementProps.praezisierung ?? '',
        control.statementProps.handlungsworte ?? '',
        control.statementProps.dokumentation ?? '',
        control.statementProps.zielobjektKategorien.join(' '),
        control.threats.join(' '),
        practiceVocabulary?.entry.columns['auch bekannt als'] ?? '',
        ...vocabularyTexts,
      ].join(' '),
      contentText: [control.statement, control.guidance].join(' '),
      normalizedControlId: normalizeSearchValue(control.id),
      normalizedTitle: normalizeSearchValue(control.title),
      normalizedLinkTargets: control.links.map((link) => normalizeSearchValue(link.targetId)),
    };
  });
}

/**
 * Name des User-Timing-Eintrags, den jeder Indexaufbau hinterlässt.
 * `scripts/measure-search-production.mjs` liest ihn aus, um die reine
 * Index-Build-Zeit getrennt von Navigation, Bootstrap und Rendering
 * auszuweisen. Bleibt die Liste nach einer Navigation leer, hat der Cache
 * getroffen und es wurde kein Index neu gebaut.
 */
export const SEARCH_INDEX_BUILD_MEASURE = 'gspp:search-index-build';

function recordIndexBuildDuration(startedAt: number, finishedAt: number) {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') {
    return;
  }
  try {
    performance.measure(SEARCH_INDEX_BUILD_MEASURE, { start: startedAt, end: finishedAt });
  } catch {
    // Reine Messinstrumentierung: ein fehlgeschlagener Eintrag darf die Suche nie stören.
  }
}

function buildSearchCacheEntry(
  catalogKey: string,
  controls: Control[],
  practices: Practice[],
  vocabularyRegistry: VocabularyRegistry | null | undefined,
): SearchCacheEntry {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const practicesById = new Map(practices.map((practice) => [practice.id, practice]));
  const searchDocuments = createSearchDocuments(controls, practicesById, vocabularyRegistry);
  const controlMap = new Map(searchDocuments.map((document) => [document.numericId, document.control]));
  const searchDocumentMap = new Map(searchDocuments.map((document) => [document.numericId, document]));
  const indexes = createSearchIndexes();
  searchDocuments.forEach((document) => {
    indexes.controlIds.add(document.numericId, document.controlIdText);
    indexes.titles.add(document.numericId, document.titleText);
    indexes.links.add(document.numericId, document.linkText);
    indexes.metadata.add(document.numericId, document.metadataText);
    indexes.content.add(document.numericId, document.contentText);
  });
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  recordIndexBuildDuration(t0, t1);

  return {
    catalogKey,
    controls,
    practices,
    vocabularyRegistry,
    searchDocuments,
    controlMap,
    searchDocumentMap,
    indexes,
  };
}

export function clearSearchCache(): void {
  searchCache.clear();
}

export function getSearchCacheSize(): number {
  return searchCache.size;
}

export function getSearchCacheKeys(): string[] {
  return [...searchCache.keys()];
}

export function getSearchCacheEntry(catalogKey: string): SearchCacheEntry | undefined {
  return searchCache.get(catalogKey);
}

function createForwardIndex() {
  return new Index({
    tokenize: 'forward',
    resolution: 9,
    cache: 100,
  });
}

function createStrictIndex() {
  return new Index({
    tokenize: 'strict',
    resolution: 9,
    cache: 100,
  });
}

function createSearchIndexes(): SearchIndexes {
  return {
    controlIds: createForwardIndex(),
    titles: createForwardIndex(),
    links: createForwardIndex(),
    metadata: createStrictIndex(),
    content: createStrictIndex(),
  };
}

function normalizeSearchValue(value: string) {
  return value
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldUseNaturalLanguagePrefixSearch(normalizedQuery: string) {
  return (
    normalizedQuery.length >= NATURAL_LANGUAGE_PREFIX_MIN_LENGTH &&
    !normalizedQuery.includes(' ')
  );
}

function hasNaturalLanguagePrefixMatch(text: string, normalizedQuery: string) {
  const normalizedTokens = normalizeSearchValue(text).match(TOKEN_PATTERN) ?? [];

  return normalizedTokens.some((token) => token.startsWith(normalizedQuery));
}

/**
 * Full-text search hook using FlexSearch.
 *
 * Uses dedicated indexes for ids, titles, relationships, and natural-language
 * content so modal verbs like "MUSS" do not degrade into arbitrary prefix
 * matches such as "Muster" or "Museen".
 *
 * Indizes werden kataloggescopt gecacht (GSPP-218): Zweiter Mount desselben
 * Katalogs mit identischen Controls-/Vocabulary-Referenzen baut keine neuen
 * FlexSearch-Indizes. Der Schlüssel umfasst den stabilen `catalogKey` sowie
 * die Objektidentität von Controls, Practices und Vocabulary Registry; neue
 * Referenzen invalidieren deterministisch. Der Cache ist auf
 * `MAX_SEARCH_CACHE_ENTRIES` begrenzt (LRU), damit Katalogwechsel keinen
 * unbegrenzten Speicheraufbau erzeugen, und strikt je Katalog getrennt — keine
 * Ergebnis- oder Indexvermischung. Leere Controls oder fehlender catalogKey
 * legen keinen Cache-Eintrag an, damit transiente Ladezustände das LRU-Budget
 * nicht belegen. Cache-Mutationen laufen ausschließlich in einem Effect, damit
 * Reacts Render-Phase (inkl. StrictMode double-invoke und abgebrochene
 * Concurrent-Renders) keine verwaisten Evictions erzeugt; LRU-Reihenfolge wird
 * beim Rebuild via delete+set korrekt aufgefrischt.
 */
export function useSearch(
  controls: Control[],
  query: string,
  vocabularyRegistry?: VocabularyRegistry | null,
  practices: Practice[] = EMPTY_PRACTICES,
  catalogKey?: string,
) {
  const normalizedCatalogKey = catalogKey ?? '__default__';
  const shouldCache = !!catalogKey && controls.length > 0;
  const cacheEntry = useMemo(() => {
    if (!shouldCache) {
      return buildSearchCacheEntry(
        normalizedCatalogKey,
        controls,
        practices,
        vocabularyRegistry,
      );
    }
    const existing = searchCache.get(normalizedCatalogKey);
    if (
      existing &&
      existing.controls === controls &&
      existing.practices === practices &&
      existing.vocabularyRegistry === vocabularyRegistry
    ) {
      return existing;
    }
    return buildSearchCacheEntry(
      normalizedCatalogKey,
      controls,
      practices,
      vocabularyRegistry,
    );
  }, [normalizedCatalogKey, controls, practices, vocabularyRegistry, shouldCache]);

  useEffect(() => {
    if (!shouldCache) return;
    const existing = searchCache.get(normalizedCatalogKey);
    if (existing === cacheEntry) {
      searchCache.delete(normalizedCatalogKey);
      searchCache.set(normalizedCatalogKey, existing);
      return;
    }
    if (searchCache.has(normalizedCatalogKey)) {
      searchCache.delete(normalizedCatalogKey);
    }
    searchCache.set(normalizedCatalogKey, cacheEntry);
    if (searchCache.size > MAX_SEARCH_CACHE_ENTRIES) {
      const oldestKey = searchCache.keys().next().value as string;
      searchCache.delete(oldestKey);
    }
  }, [normalizedCatalogKey, cacheEntry, shouldCache]);

  const { searchDocuments, controlMap, searchDocumentMap, indexes } = cacheEntry;

  const results = useMemo(() => {
    if (!query.trim() || controls.length === 0) {
      return [];
    }

    const candidateLimit = controls.length;
    const normalizedQuery = normalizeSearchValue(query);
    const rankedMatches = new Map<number, { score: number; bestRank: number }>();
    const searchBuckets = [
      { ids: indexes.controlIds.search(query, { limit: candidateLimit }), weight: 5 },
      { ids: indexes.titles.search(query, { limit: candidateLimit }), weight: 4 },
      { ids: indexes.links.search(query, { limit: candidateLimit }), weight: 3 },
      { ids: indexes.metadata.search(query, { limit: candidateLimit }), weight: 2 },
      { ids: indexes.content.search(query, { limit: candidateLimit }), weight: 1 },
    ];

    for (const bucket of searchBuckets) {
      bucket.ids.forEach((rawId, rank) => {
        const numericId = rawId as number;
        const document = searchDocumentMap.get(numericId);

        if (!document) {
          return;
        }

        const rankScore = bucket.weight * 1000 + (candidateLimit - rank);
        const exactIdBoost =
          document.normalizedControlId === normalizedQuery ? 5000 : 0;
        const exactLinkBoost = document.normalizedLinkTargets.includes(
          normalizedQuery,
        )
          ? 2500
          : 0;
        const exactTitleBoost =
          document.normalizedTitle === normalizedQuery ? 1000 : 0;
        const score = rankScore + exactIdBoost + exactLinkBoost + exactTitleBoost;
        const existing = rankedMatches.get(numericId);

        if (!existing) {
          rankedMatches.set(numericId, { score, bestRank: rank });
          return;
        }

        rankedMatches.set(numericId, {
          score: existing.score + score,
          bestRank: Math.min(existing.bestRank, rank),
        });
      });
    }

    if (shouldUseNaturalLanguagePrefixSearch(normalizedQuery)) {
      searchDocuments.forEach((document) => {
        if (
          hasNaturalLanguagePrefixMatch(
            document.metadataText,
            normalizedQuery,
          )
        ) {
          const existing = rankedMatches.get(document.numericId);
          const score =
            NATURAL_LANGUAGE_METADATA_PREFIX_WEIGHT * 1000 +
            (searchDocuments.length - document.numericId);

          rankedMatches.set(document.numericId, {
            score: (existing?.score ?? 0) + score,
            bestRank: Math.min(existing?.bestRank ?? document.numericId, document.numericId),
          });
        }

        if (
          hasNaturalLanguagePrefixMatch(
            document.contentText,
            normalizedQuery,
          )
        ) {
          const existing = rankedMatches.get(document.numericId);
          const score =
            NATURAL_LANGUAGE_CONTENT_PREFIX_WEIGHT * 1000 +
            (searchDocuments.length - document.numericId);

          rankedMatches.set(document.numericId, {
            score: (existing?.score ?? 0) + score,
            bestRank: Math.min(existing?.bestRank ?? document.numericId, document.numericId),
          });
        }
      });
    }

    const exactIdMatches = searchDocuments
      .filter((document) => document.normalizedControlId === normalizedQuery)
      .map((document) => document.numericId);

    const matched = [...rankedMatches.entries()]
      .sort((a, b) => {
        if (b[1].score !== a[1].score) {
          return b[1].score - a[1].score;
        }

        if (a[1].bestRank !== b[1].bestRank) {
          return a[1].bestRank - b[1].bestRank;
        }

        const leftControl = controlMap.get(a[0]);
        const rightControl = controlMap.get(b[0]);

        return (leftControl?.id ?? '').localeCompare(rightControl?.id ?? '', 'de', {
          numeric: true,
        });
      })
      .map(([numericId]) => numericId)
      .filter((numericId) => !exactIdMatches.includes(numericId));

    const orderedMatches = [...exactIdMatches, ...matched].flatMap(
      (numericId) => {
        const control = controlMap.get(numericId);

        return control ? [{ control }] : [];
      },
    );

    return orderedMatches;
  }, [controls.length, query, controlMap, indexes, searchDocumentMap, searchDocuments]);

  return { results, totalResults: results.length };
}
