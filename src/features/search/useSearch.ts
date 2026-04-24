import { useMemo } from 'react';
import { Index } from 'flexsearch';
import type { Control, VocabularyRegistry } from '@/domain/models';
import { getControlLinkSearchText } from '@/domain/controlRelationships';
import {
  collectVocabularySearchTexts,
  resolveControlVocabularies,
} from '@/domain/vocabulary';

export interface SearchResult {
  control: Control;
}

const NATURAL_LANGUAGE_PREFIX_MIN_LENGTH = 6;
const NATURAL_LANGUAGE_METADATA_PREFIX_WEIGHT = 0.75;
const NATURAL_LANGUAGE_CONTENT_PREFIX_WEIGHT = 0.5;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

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
 */
export function useSearch(
  controls: Control[],
  query: string,
  vocabularyRegistry?: VocabularyRegistry | null,
) {
  const searchDocuments = useMemo(() => {
    return controls.map<SearchDocument>((control, numericId) => {
      const resolved = resolveControlVocabularies(vocabularyRegistry, control);
      const vocabularyTexts = collectVocabularySearchTexts([
        resolved.modalverb,
        resolved.securityLevel,
        resolved.effortLevel,
        ...resolved.tags,
        resolved.statement.ergebnis,
        resolved.statement.praezisierung,
        resolved.statement.handlungsworte,
        resolved.statement.dokumentation,
        ...resolved.statement.zielobjektKategorien,
      ]);

      return {
        control,
        numericId,
        controlIdText: control.id,
        titleText: control.title,
        linkText: getControlLinkSearchText(control.links),
        metadataText: [
          control.tags.join(' '),
          control.modalverb ?? '',
          control.statementProps.ergebnis ?? '',
          control.statementProps.praezisierung ?? '',
          control.statementProps.handlungsworte ?? '',
          control.statementProps.dokumentation ?? '',
          control.statementProps.zielobjektKategorien.join(' '),
          ...vocabularyTexts,
        ].join(' '),
        contentText: [control.statement, control.guidance].join(' '),
        normalizedControlId: normalizeSearchValue(control.id),
        normalizedTitle: normalizeSearchValue(control.title),
        normalizedLinkTargets: control.links.map((link) =>
          normalizeSearchValue(link.targetId),
        ),
      };
    });
  }, [controls, vocabularyRegistry]);

  const controlMap = useMemo(() => {
    return new Map(
      searchDocuments.map((document) => [document.numericId, document.control]),
    );
  }, [searchDocuments]);

  const searchDocumentMap = useMemo(() => {
    return new Map(
      searchDocuments.map((document) => [document.numericId, document]),
    );
  }, [searchDocuments]);

  const indexes = useMemo(() => {
    const nextIndexes = createSearchIndexes();
    searchDocuments.forEach((document) => {
      nextIndexes.controlIds.add(document.numericId, document.controlIdText);
      nextIndexes.titles.add(document.numericId, document.titleText);
      nextIndexes.links.add(document.numericId, document.linkText);
      nextIndexes.metadata.add(document.numericId, document.metadataText);
      nextIndexes.content.add(document.numericId, document.contentText);
    });

    return nextIndexes;
  }, [searchDocuments]);

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
