import { useEffect, useMemo } from 'react';
import { Index } from 'flexsearch';
import type { Control, Practice, VocabularyRegistry } from '@/domain/models';
import { getControlLinkSearchText } from '@/domain/controlRelationships';
import {
  collectControlVocabularyIdentifiers,
  collectControlVocabularySearchTexts,
  normalizeIdentifier,
  resolveControlVocabularies,
} from '@/domain/vocabulary';
import { resolvePracticeVocabulary } from '@/domain/taxonomyVocabulary';
import {
  normalizeSearchValue,
  rankSearchResults,
  type SearchDocument,
  type SearchIndexes,
} from './searchRanking';

export type { SearchResult } from './searchRanking';

export const MAX_SEARCH_CACHE_ENTRIES = 3;

const EMPTY_PRACTICES: Practice[] = [];

interface SearchCacheEntry {
  catalogKey: string;
  controls: Control[];
  practices: Practice[];
  vocabularyRegistry: VocabularyRegistry | null | undefined;
  searchDocuments: SearchDocument[];
  controlMap: Map<number, Control>;
  searchDocumentMap: Map<number, SearchDocument>;
  indexes: SearchIndexes;
  /**
   * Kennung (kleingeschrieben) → Controls, die sie trägt. Liegt bewusst im
   * kataloggescopten Cache-Eintrag, damit die Auflösung denselben Katalogscope
   * und dieselbe LRU-Invalidierung erbt wie die Volltextindizes (GSPP-218).
   */
  identifierIndex: Map<string, Set<number>>;
  /** Kennungen, die genau ein Control bezeichnen (Control-`alt-identifier`) */
  controlIdentifiers: Map<string, number>;
}

const searchCache = new Map<string, SearchCacheEntry>();

/**
 * Ein Eintrag ist nur dann noch gültig, wenn er aus genau diesen Objekten gebaut
 * wurde. Bewusst die Referenzen und nicht die Array-Längen: ein gleich großes
 * Ersatz-Array trägt anderen Inhalt und muss den Index neu aufbauen.
 */
function isFreshCacheEntry(
  entry: SearchCacheEntry | undefined,
  controls: Control[],
  practices: Practice[],
  vocabularyRegistry: VocabularyRegistry | null | undefined,
): entry is SearchCacheEntry {
  if (entry === undefined) {
    return false;
  }
  return (
    entry.controls === controls &&
    entry.practices === practices &&
    entry.vocabularyRegistry === vocabularyRegistry
  );
}

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
      vocabularyIdentifiers: collectControlVocabularyIdentifiers(resolved),
      normalizedControlId: normalizeSearchValue(control.id),
      normalizedTitle: normalizeSearchValue(control.title),
      normalizedLinkTargets: control.links.map((link) => normalizeSearchValue(link.targetId)),
    };
  });
}

/**
 * Baut die exakte Kennungsauflösung auf.
 *
 * Die Mengen entstehen aus den Strukturen, die eine Kennung tatsächlich trägt:
 * der `alt-identifier` eines Controls bezeichnet genau dieses Control, der
 * einer Gruppe alle Controls dieser Gruppe, und eine Vokabular-Kennung alle
 * Controls, die den zugehörigen Wert führen. Themen-UUIDs sind über Praktiken
 * hinweg wiederverwendet; ihre Mengen vereinigen sich deshalb absichtlich.
 */
function pushGrouped(target: Map<string, number[]>, key: string | undefined, numericId: number) {
  if (!key) {
    return;
  }

  const existing = target.get(key);
  if (existing) {
    existing.push(numericId);
    return;
  }
  target.set(key, [numericId]);
}

/** Gruppiert die Controls nach Gruppen- und Praktik-Zugehörigkeit. */
function groupNumericIds(searchDocuments: SearchDocument[]) {
  const byGroupId = new Map<string, number[]>();
  const byPracticeId = new Map<string, number[]>();

  for (const { control, numericId } of searchDocuments) {
    pushGrouped(byGroupId, control.groupId, numericId);
    pushGrouped(byPracticeId, control.practiceId, numericId);
  }

  return { byGroupId, byPracticeId };
}

function buildIdentifierIndex(
  searchDocuments: SearchDocument[],
  practices: Practice[],
) {
  const identifierIndex = new Map<string, Set<number>>();
  const controlIdentifiers = new Map<string, number>();

  const add = (rawIdentifier: string | undefined, numericIds: Iterable<number>) => {
    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier) {
      return;
    }

    const existing = identifierIndex.get(identifier);
    if (existing) {
      for (const numericId of numericIds) {
        existing.add(numericId);
      }
      return;
    }
    identifierIndex.set(identifier, new Set(numericIds));
  };

  const { byGroupId, byPracticeId } = groupNumericIds(searchDocuments);

  for (const document of searchDocuments) {
    const { control, numericId } = document;

    add(control.altIdentifier, [numericId]);
    const controlIdentifier = normalizeIdentifier(control.altIdentifier);
    if (controlIdentifier) {
      controlIdentifiers.set(controlIdentifier, numericId);
    }

    for (const identifier of document.vocabularyIdentifiers) {
      add(identifier, [numericId]);
    }
  }

  for (const practice of practices) {
    add(practice.altIdentifier, byPracticeId.get(practice.id ?? '') ?? []);

    for (const topic of practice.topics) {
      add(topic.altIdentifier, byGroupId.get(topic.id ?? '') ?? []);
    }
  }

  return { identifierIndex, controlIdentifiers };
}

/**
 * Baut Suchdokumente, FlexSearch-Indizes und Kennungsauflösung eines Katalogs.
 * Rein und ohne Cache-Zugriff; das Ergebnis ist zugleich die `SearchView` für
 * `rankSearchResults`.
 */
export function buildSearchCacheEntry(
  catalogKey: string,
  controls: Control[],
  practices: Practice[],
  vocabularyRegistry: VocabularyRegistry | null | undefined,
): SearchCacheEntry {
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

  const { identifierIndex, controlIdentifiers } = buildIdentifierIndex(
    searchDocuments,
    practices,
  );

  return {
    catalogKey,
    controls,
    practices,
    vocabularyRegistry,
    searchDocuments,
    controlMap,
    searchDocumentMap,
    indexes,
    identifierIndex,
    controlIdentifiers,
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
    if (isFreshCacheEntry(existing, controls, practices, vocabularyRegistry)) {
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

  const results = useMemo(
    () => rankSearchResults(query, cacheEntry),
    [query, cacheEntry],
  );

  return { results, totalResults: results.length };
}
