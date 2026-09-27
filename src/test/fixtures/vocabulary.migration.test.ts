import { describe, expect, it, vi } from 'vitest';
import {
  PRACTICES_NAMESPACE_URL,
  SECURITY_TARGETS_NAMESPACE_URL,
  SECURITY_TARGET_LEVELS_NAMESPACE_URL,
  TOPICS_NAMESPACE_URL,
} from '@/domain/vocabularyNamespaces';
import { deriveRouteId } from '../../../scripts/vocabulary-utils.mjs';
import { createTestVocabularyRegistry } from './vocabulary';

/*
 * Simulierte Pfadmigration: Das Quellregister verlegt die BSI-Vokabulare in ein
 * anderes Verzeichnis, wie bei der Umbenennung in BSI-PR #63. Die Fixture muss
 * Namespace, Pfad und Routenkennung dann so bilden wie Register und Pipeline,
 * sonst bestätigen Linktests weiter einen Slug, den es produktiv nicht mehr gibt.
 */
vi.mock('@/domain/sourceRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/sourceRegistry')>();
  return {
    ...actual,
    SOURCE_REGISTRY: actual.SOURCE_REGISTRY.map((entry) => (entry.artifactKey === 'namespaces-bsi'
      ? { ...entry, upstreamDirectory: 'Dokumentation/namespaces' }
      : entry)),
  };
});

describe('BSI-Vokabulare der Test-Fixture nach einer Pfadmigration', () => {
  it.each([
    SECURITY_TARGETS_NAMESPACE_URL,
    SECURITY_TARGET_LEVELS_NAMESPACE_URL,
    PRACTICES_NAMESPACE_URL,
    TOPICS_NAMESPACE_URL,
  ])('bildet Pfad und Routenkennung wie die Pipeline: %s', (namespaceUrl) => {
    expect(namespaceUrl).toContain('/Dokumentation/namespaces/');
    const source = createTestVocabularyRegistry().namespacesByUrl.get(namespaceUrl)?.source;

    expect(source?.path).toMatch(/^Dokumentation\/namespaces\//);
    expect(source?.routeId).toBe(deriveRouteId(source?.path ?? ''));
  });
});
