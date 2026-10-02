import type { Index } from 'flexsearch';
import type { Control } from '@/domain/models';
import { normalizeIdentifier } from '@/domain/vocabulary';
import { classifyQuery } from '@/domain/identifierQuery';
import { compareControlIds } from '@/domain/germanCollation';

export interface SearchResult {
  control: Control;
}

const NATURAL_LANGUAGE_PREFIX_MIN_LENGTH = 6;
const NATURAL_LANGUAGE_METADATA_PREFIX_WEIGHT = 0.75;
const NATURAL_LANGUAGE_CONTENT_PREFIX_WEIGHT = 0.5;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

export interface SearchIndexes {
  controlIds: Index;
  titles: Index;
  links: Index;
  metadata: Index;
  content: Index;
}

export interface SearchDocument {
  control: Control;
  numericId: number;
  controlIdText: string;
  titleText: string;
  linkText: string;
  metadataText: string;
  contentText: string;
  /** Eigene Kennungen der aufgelösten Vokabular-Einträge dieses Controls */
  vocabularyIdentifiers: string[];
  normalizedControlId: string;
  normalizedTitle: string;
  normalizedLinkTargets: string[];
}

/**
 * Schmale Sicht auf die bereits aufgebauten Suchdaten eines Katalogs. Der
 * Cache-Eintrag aus `useSearch` erfüllt sie strukturell; die Bewertung kennt
 * weder den Cache noch dessen Lebenszyklus.
 */
export type SearchView = Readonly<{
  searchDocuments: readonly SearchDocument[];
  controlMap: ReadonlyMap<number, Control>;
  searchDocumentMap: ReadonlyMap<number, SearchDocument>;
  indexes: SearchIndexes;
  /** Kennung (kleingeschrieben) → Controls, die sie trägt */
  identifierIndex: ReadonlyMap<string, ReadonlySet<number>>;
  /** Kennungen, die genau ein Control bezeichnen (Control-`alt-identifier`) */
  controlIdentifiers: ReadonlyMap<string, number>;
}>;

export function normalizeSearchValue(value: string) {
  return value
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

function resolveIdentifierQuery(query: string, view: SearchView): SearchResult[] {
  const { identifierIndex, controlIdentifiers, controlMap } = view;
  const identifier = normalizeIdentifier(query);
  const matches = identifierIndex.get(identifier);

  if (!matches) {
    return [];
  }

  const exactControlId = controlIdentifiers.get(identifier);

  return [...matches]
    .sort((left, right) => {
      // Ein Control-`alt-identifier`-Treffer steht vorn, der Rest folgt in
      // Katalogreihenfolge.
      if (left === exactControlId) return -1;
      if (right === exactControlId) return 1;
      return left - right;
    })
    .flatMap((numericId) => {
      const control = controlMap.get(numericId);
      return control ? [{ control }] : [];
    });
}

function rankTextQuery(query: string, view: SearchView): SearchResult[] {
  const { searchDocuments, controlMap, searchDocumentMap, indexes } = view;
  const candidateLimit = searchDocuments.length;
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

      return compareControlIds(leftControl?.id ?? '', rightControl?.id ?? '');
    })
    .map(([numericId]) => numericId)
    .filter((numericId) => !exactIdMatches.includes(numericId));

  return [...exactIdMatches, ...matched].flatMap((numericId) => {
    const control = controlMap.get(numericId);

    return control ? [{ control }] : [];
  });
}

/**
 * Bewertet eine Suchanfrage gegen die Suchdaten eines Katalogs.
 *
 * Reine Funktion: kein React, kein Zugriff auf den Suchcache. Gleiche Eingaben
 * liefern dieselbe Reihenfolge. FlexSearchs interner Abfrage-Cache in den
 * Indizes ist eine semantikneutrale Memoisierung.
 *
 * Kennungsanfragen laufen ausschließlich über die exakte Auflösung. Ein
 * Rückfall auf die Volltextsuche würde das Teiltoken-Verhalten aus GSPP-274
 * durch die Hintertür zurückholen, deshalb bleibt eine unbekannte Kennung ohne
 * Treffer statt ohne Antwort. Das gilt auch für eine unvollständige Kennung:
 * Sie ist als Kennung gemeint und darf nicht als Textfragment auf Titel oder
 * Fließtext treffen.
 */
export function rankSearchResults(query: string, view: SearchView): SearchResult[] {
  if (!query.trim() || view.searchDocuments.length === 0) {
    return [];
  }

  const queryKind = classifyQuery(query);

  if (queryKind === 'malformed-identifier') {
    return [];
  }

  if (queryKind === 'identifier') {
    return resolveIdentifierQuery(query, view);
  }

  return rankTextQuery(query, view);
}
