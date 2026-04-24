import type {
  PropValue,
  VocabularyEntry,
  VocabularyNamespace,
  VocabularyNamespaceData,
  VocabularyRegistry,
  VocabularyRegistryData,
} from './models';

export interface ResolvedVocabularyEntry {
  namespace: VocabularyNamespace;
  entry: VocabularyEntry;
}

function createEntriesByValue(entries: VocabularyEntry[]) {
  const entriesByValue = new Map<string, VocabularyEntry>();

  for (const entry of entries) {
    if (entriesByValue.has(entry.value)) {
      throw new Error(`Duplicate vocabulary value "${entry.value}" in runtime registry.`);
    }
    entriesByValue.set(entry.value, entry);
  }

  return entriesByValue;
}

function createRuntimeNamespace(
  namespaceData: VocabularyNamespaceData,
): VocabularyNamespace {
  return {
    ...namespaceData,
    entriesByValue: createEntriesByValue(namespaceData.entries),
  };
}

export function buildVocabularyRegistry(
  data: VocabularyRegistryData,
): VocabularyRegistry {
  const namespaces = data.namespaces.map(createRuntimeNamespace);
  const namespacesByUrl = new Map<string, VocabularyNamespace>();
  const namespacesByRouteId = new Map<string, VocabularyNamespace>();

  for (const namespace of namespaces) {
    if (namespacesByUrl.has(namespace.source.namespace)) {
      throw new Error(
        `Duplicate vocabulary namespace URL "${namespace.source.namespace}" in runtime registry.`,
      );
    }
    if (namespacesByRouteId.has(namespace.source.routeId)) {
      throw new Error(
        `Duplicate vocabulary route id "${namespace.source.routeId}" in runtime registry.`,
      );
    }

    namespacesByUrl.set(namespace.source.namespace, namespace);
    namespacesByRouteId.set(namespace.source.routeId, namespace);
  }

  return {
    sourceCommitSha: data.sourceCommitSha,
    namespaces,
    namespacesByUrl,
    namespacesByRouteId,
  };
}

export function resolveVocabularyEntry(
  registry: VocabularyRegistry | null,
  namespaceUrl: string | undefined,
  value: string | undefined,
): ResolvedVocabularyEntry | null {
  if (!registry || !namespaceUrl || !value) {
    return null;
  }

  const namespace = registry.namespacesByUrl.get(namespaceUrl);
  if (!namespace) {
    return null;
  }

  const entry = namespace.entriesByValue.get(value);
  if (!entry) {
    return null;
  }

  return { namespace, entry };
}

export function resolvePropVocabularyEntry(
  registry: VocabularyRegistry | null,
  prop: PropValue | undefined,
): ResolvedVocabularyEntry | null {
  return resolveVocabularyEntry(registry, prop?.ns, prop?.value);
}

export function resolveVocabularyEntries(
  registry: VocabularyRegistry | null,
  namespaceUrl: string | undefined,
  values: string[],
): ResolvedVocabularyEntry[] {
  return values
    .map((value) => resolveVocabularyEntry(registry, namespaceUrl, value))
    .filter((match): match is ResolvedVocabularyEntry => match !== null);
}

export function getVocabularyNamespaceByRouteId(
  registry: VocabularyRegistry | null,
  routeId: string | undefined,
): VocabularyNamespace | null {
  if (!registry || !routeId) {
    return null;
  }

  return registry.namespacesByRouteId.get(routeId) ?? null;
}
