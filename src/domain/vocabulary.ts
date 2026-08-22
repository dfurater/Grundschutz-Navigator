import type {
  Control,
  PropValue,
  VocabularyEntry,
  VocabularyNamespace,
  VocabularyNamespaceData,
  VocabularyNamespaceSource,
  VocabularyRegistry,
  VocabularyRegistryData,
} from './models';
import { SECURITY_TARGETS_NAMESPACE_URL } from './vocabularyNamespaces';

export interface VocabularyResolution {
  namespace: VocabularyNamespace;
  entry: VocabularyEntry;
}

export type ResolvedVocabularyEntry = VocabularyResolution;

export interface ResolvedControlVocabularies {
  modalverb: VocabularyResolution | null;
  securityLevel: VocabularyResolution | null;
  effortLevel: VocabularyResolution | null;
  tags: VocabularyResolution[];
  securityTargets: {
    confidentiality: VocabularyResolution | null;
    integrity: VocabularyResolution | null;
    availability: VocabularyResolution | null;
    authenticity: VocabularyResolution | null;
  };
  securityTargetLevels: {
    confidentiality: VocabularyResolution | null;
    integrity: VocabularyResolution | null;
    availability: VocabularyResolution | null;
    authenticity: VocabularyResolution | null;
  };
  threats: VocabularyResolution[];
  statement: {
    ergebnis: VocabularyResolution | null;
    praezisierung: VocabularyResolution | null;
    handlungsworte: VocabularyResolution | null;
    dokumentation: VocabularyResolution | null;
    zielobjektKategorien: VocabularyResolution[];
  };
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

  // Trailing Slashes ohne Regex entfernen — der end-verankerte Quantifier
  // `/\/+$/` löst die S8786-Superlinearitäts-Heuristik aus; das Muster ist
  // hier zwar linear, aber die regexfreie Form ist äquivalent und regelkonform.
  let repositoryUrl = source.repository;
  while (repositoryUrl.endsWith('/')) {
    repositoryUrl = repositoryUrl.slice(0, -1);
  }
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

export function resolvePropVocabularyEntry(
  registry: VocabularyRegistry | null | undefined,
  prop: PropValue | undefined,
): ResolvedVocabularyEntry | null {
  return resolveVocabularyProp(registry, prop);
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

export function resolveVocabularyEntries(
  registry: VocabularyRegistry | null | undefined,
  namespaceUrl: string | undefined,
  values: string[],
): ResolvedVocabularyEntry[] {
  return resolveVocabularyValues(registry, namespaceUrl, values);
}

export function getVocabularyNamespaceByRouteId(
  registry: VocabularyRegistry | null | undefined,
  routeId: string | undefined,
): VocabularyNamespace | null {
  if (!registry || !routeId) {
    return null;
  }

  return registry.namespacesByRouteId.get(routeId) ?? null;
}

function resolveSecurityTarget(registry: VocabularyRegistry | null | undefined, prop: PropValue | undefined, value: string): VocabularyResolution | null {
  return prop ? resolveVocabularyEntry(registry, SECURITY_TARGETS_NAMESPACE_URL, value) : null;
}

export function resolveControlVocabularies(registry: VocabularyRegistry | null | undefined, control: Control): ResolvedControlVocabularies {
  return {
    modalverb: resolveVocabularyProp(registry, control.modalverbProp),
    securityLevel: resolveVocabularyProp(registry, control.securityLevelProp),
    effortLevel: resolveVocabularyProp(registry, control.effortLevelProp),
    tags: resolveVocabularyValues(registry, control.tagsProp?.ns, control.tags),
    securityTargets: {
      confidentiality: resolveSecurityTarget(
        registry,
        control.confidentialityProp,
        'Vertraulichkeit (Confidentiality)',
      ),
      integrity: resolveSecurityTarget(
        registry,
        control.integrityProp,
        'Integrität (Integrity)',
      ),
      availability: resolveSecurityTarget(
        registry,
        control.availabilityProp,
        'Verfügbarkeit (Availability)',
      ),
      authenticity: resolveSecurityTarget(
        registry,
        control.authenticityProp,
        'Authentizität (Authenticity)',
      ),
    },
    securityTargetLevels: {
      confidentiality: resolveVocabularyProp(registry, control.confidentialityProp),
      integrity: resolveVocabularyProp(registry, control.integrityProp),
      availability: resolveVocabularyProp(registry, control.availabilityProp),
      authenticity: resolveVocabularyProp(registry, control.authenticityProp),
    },
    threats: resolveVocabularyValues(registry, control.threatsProp?.ns, control.threats),
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

export function collectControlVocabularySearchTexts(
  resolved: ResolvedControlVocabularies,
): string[] {
  return collectVocabularySearchTexts([
    resolved.modalverb,
    resolved.securityLevel,
    resolved.effortLevel,
    ...resolved.tags,
    resolved.securityTargets.confidentiality,
    resolved.securityTargets.integrity,
    resolved.securityTargets.availability,
    resolved.securityTargets.authenticity,
    resolved.securityTargetLevels.confidentiality,
    resolved.securityTargetLevels.integrity,
    resolved.securityTargetLevels.availability,
    resolved.securityTargetLevels.authenticity,
    ...resolved.threats,
    resolved.statement.ergebnis,
    resolved.statement.praezisierung,
    resolved.statement.handlungsworte,
    resolved.statement.dokumentation,
    ...resolved.statement.zielobjektKategorien,
  ]);
}
