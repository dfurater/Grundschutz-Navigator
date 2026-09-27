import { describe, expect, it, vi } from 'vitest';
import {
  BSI_NAMESPACE_DIRECTORY,
  PRACTICES_NAMESPACE_URL,
  SECURITY_TARGETS_NAMESPACE_URL,
  SECURITY_TARGET_LEVELS_NAMESPACE_URL,
  TOPICS_NAMESPACE_URL,
} from '@/domain/vocabularyNamespaces';
import { deriveRouteId } from '@/domain/vocabularyRouteId';
import { createTestVocabularyRegistry } from './vocabulary';

/*
 * Simulierte Pfadmigration: Das Quellregister verlegt die BSI-Vokabulare in ein
 * anderes Verzeichnis. Das neue Verzeichnis entsteht aus dem registrierten,
 * damit der Test keinen eigenen Upstream-Pfad annimmt. Die Fixture muss
 * Namespace, Pfad und Routenkennung dann so bilden wie Register und Pipeline,
 * sonst bestätigen Linktests weiter einen Slug, den es produktiv nicht mehr gibt.
 */
vi.mock('@/domain/sourceRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/sourceRegistry')>();
  return {
    ...actual,
    SOURCE_REGISTRY: actual.SOURCE_REGISTRY.map((entry) => (
      entry.kind === 'vocabulary-collection' && entry.artifactKey === 'namespaces-bsi'
        ? { ...entry, upstreamDirectory: `verlegt/${entry.upstreamDirectory}` }
        : entry)),
  };
});

describe('BSI-Vokabulare der Test-Fixture nach einer Pfadmigration', () => {
  it('liest das verlegte Verzeichnis aus dem Register', () => {
    expect(BSI_NAMESPACE_DIRECTORY.startsWith('verlegt/')).toBe(true);
  });

  it.each([
    SECURITY_TARGETS_NAMESPACE_URL,
    SECURITY_TARGET_LEVELS_NAMESPACE_URL,
    PRACTICES_NAMESPACE_URL,
    TOPICS_NAMESPACE_URL,
  ])('bildet Pfad und Routenkennung wie die Pipeline: %s', (namespaceUrl) => {
    expect(namespaceUrl).toContain(`/${BSI_NAMESPACE_DIRECTORY}/`);
    const source = createTestVocabularyRegistry().namespacesByUrl.get(namespaceUrl)?.source;

    expect(source?.path.startsWith(`${BSI_NAMESPACE_DIRECTORY}/`)).toBe(true);
    expect(source?.routeId).toBe(deriveRouteId(source?.path ?? ''));
  });
});
