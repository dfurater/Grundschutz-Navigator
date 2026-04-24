import type {
  Control,
  PropValue,
  VocabularyEntry,
  VocabularyNamespace,
  VocabularyNamespaceSource,
  VocabularyRegistry,
  VocabularyRegistryData,
} from './models';

export interface VocabularyResolution {
  namespace: VocabularyNamespace;
  entry: VocabularyEntry;
}

export interface ResolvedControlVocabularies {
  modalverb: VocabularyResolution | null;
  securityLevel: VocabularyResolution | null;
  effortLevel: VocabularyResolution | null;
  tags: VocabularyResolution[];
  statement: {
    ergebnis: VocabularyResolution | null;
    praezisierung: VocabularyResolution | null;
    handlungsworte: VocabularyResolution | null;
    dokumentation: VocabularyResolution | null;
    zielobjektKategorien: VocabularyResolution[];
  };
}

export function buildVocabularyRegistry(
  data: VocabularyRegistryData,
): VocabularyRegistry {
  const namespaces = data.namespaces.map<VocabularyNamespace>((namespace) => ({
    ...namespace,
    entriesByValue: new Map(
      namespace.entries.map((entry) => [entry.value, entry]),
    ),
  }));

  return {
    sourceCommitSha: data.sourceCommitSha,
    namespaces,
    namespacesByUrl: new Map(
      namespaces.map((namespace) => [namespace.source.namespace, namespace]),
    ),
    namespacesByRouteId: new Map(
      namespaces.map((namespace) => [namespace.source.routeId, namespace]),
    ),
  };
}

function encodeRepositoryPath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildVocabularySourceUrl(
  source: Pick<VocabularyNamespaceSource, 'namespace' | 'repository' | 'path'>,
  snapshotCommitSha: string | null | undefined,
): string {
  if (!source.repository || !source.path) {
    return source.namespace;
  }

  const repositoryUrl = source.repository.replace(/\/+$/, '');
  const encodedPath = encodeRepositoryPath(source.path);

  if (!encodedPath) {
    return source.namespace;
  }

  if (snapshotCommitSha) {
    return `${repositoryUrl}/blob/${encodeURIComponent(snapshotCommitSha)}/${encodedPath}`;
  }

  return `${repositoryUrl}/tree/main/${encodedPath}`;
}

export function resolveVocabularyEntry(
  registry: VocabularyRegistry | null | undefined,
  namespaceUrl: string | undefined,
  value: string | undefined,
): VocabularyResolution | null {
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

export function resolveVocabularyProp(
  registry: VocabularyRegistry | null | undefined,
  prop: PropValue | undefined,
): VocabularyResolution | null {
  return resolveVocabularyEntry(registry, prop?.ns, prop?.value);
}

export function resolveVocabularyValues(
  registry: VocabularyRegistry | null | undefined,
  namespaceUrl: string | undefined,
  values: string[],
): VocabularyResolution[] {
  return values
    .map((value) => resolveVocabularyEntry(registry, namespaceUrl, value))
    .filter((resolution): resolution is VocabularyResolution => resolution !== null);
}

export function resolveControlVocabularies(
  registry: VocabularyRegistry | null | undefined,
  control: Control,
): ResolvedControlVocabularies {
  return {
    modalverb: resolveVocabularyProp(registry, control.modalverbProp),
    securityLevel: resolveVocabularyProp(registry, control.securityLevelProp),
    effortLevel: resolveVocabularyProp(registry, control.effortLevelProp),
    tags: resolveVocabularyValues(registry, control.tagsProp?.ns, control.tags),
    statement: {
      ergebnis: resolveVocabularyProp(registry, control.statementProps.ergebnisProp),
      praezisierung: resolveVocabularyProp(
        registry,
        control.statementProps.praezisierungProp,
      ),
      handlungsworte: resolveVocabularyProp(
        registry,
        control.statementProps.handlungsworteProp,
      ),
      dokumentation: resolveVocabularyProp(
        registry,
        control.statementProps.dokumentationProp,
      ),
      zielobjektKategorien: resolveVocabularyValues(
        registry,
        control.statementProps.zielobjektKategorienProp?.ns,
        control.statementProps.zielobjektKategorien,
      ),
    },
  };
}

export function collectVocabularySearchTexts(
  resolutions: Array<VocabularyResolution | null>,
): string[] {
  const values = new Set<string>();

  for (const resolution of resolutions) {
    if (!resolution) {
      continue;
    }

    for (const value of Object.values(resolution.entry.columns)) {
      if (value) {
        values.add(value);
      }
    }
  }

  return [...values];
}
