import type {
  EffortLevel,
  PropValue,
  SecurityLevel,
  VocabularyNamespace,
  VocabularyRegistry,
} from '@/domain/models';
import {
  resolvePropVocabularyEntry,
  resolveVocabularyEntry,
} from '@/domain/vocabularies';

export const OFFICIAL_SECURITY_LEVELS: SecurityLevel[] = [
  'normal-SdT',
  'erhöht',
];

export const OFFICIAL_EFFORT_LEVELS: EffortLevel[] = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
];

function getNamespaceByFileName(
  registry: VocabularyRegistry | null,
  fileName: string,
): VocabularyNamespace | null {
  if (!registry) {
    return null;
  }

  return registry.namespaces.find((namespace) => (
    namespace.source.fileName === fileName
  )) ?? null;
}

export function getOfficialSecurityLevelLabel(
  value: SecurityLevel | undefined,
): string {
  return value ?? '';
}

export function getOfficialEffortLevelLabel(
  value: EffortLevel | undefined,
): string {
  return value ?? '';
}

export function getVocabularyDefinitionTooltip(
  registry: VocabularyRegistry | null,
  prop: PropValue | undefined,
): string | undefined {
  return resolvePropVocabularyEntry(registry, prop)?.entry.definition;
}

export function getOfficialSecurityLevelTooltip(
  registry: VocabularyRegistry | null,
  value: SecurityLevel | undefined,
): string | undefined {
  const namespace = getNamespaceByFileName(registry, 'security_level.csv');
  return resolveVocabularyEntry(registry, namespace?.source.namespace, value)?.entry.definition;
}

export function getOfficialEffortLevelTooltip(
  registry: VocabularyRegistry | null,
  value: EffortLevel | undefined,
): string | undefined {
  const namespace = getNamespaceByFileName(registry, 'effort_level.csv');
  return resolveVocabularyEntry(registry, namespace?.source.namespace, value)?.entry.definition;
}
