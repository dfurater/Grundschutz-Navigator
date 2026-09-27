import type { VocabularyNamespaceData } from '@/domain/models';
import {
  BSI_NAMESPACE_DIRECTORY,
  PRACTICES_NAMESPACE_URL,
  TOPICS_NAMESPACE_URL,
} from '@/domain/vocabularyNamespaces';
import { deriveRouteId } from '../../../scripts/vocabulary-utils.mjs';

/**
 * Pfad und Routenkennung eines BSI-Vokabulars, gebildet wie in der Pipeline:
 * Verzeichnis aus dem Quellregister, Kennung über `deriveRouteId`. Nach einer
 * Pfadmigration folgen beide, statt einen alten Slug zu bestätigen.
 */
export function bsiNamespaceLocation(fileName: string): { path: string; routeId: string } {
  const path = `${BSI_NAMESPACE_DIRECTORY}/${fileName}`;
  return { path, routeId: deriveRouteId(path) };
}

/** Kennungen der Taxonomie-Fixture; Tests referenzieren sie statt Literalen. */
export const TAXONOMY_IDENTIFIERS = {
  practiceGC: '9e6f7a8b-5c6d-4e7f-8a8b-9c0d1e2f3a45',
  topicOrganisation: '0f7a8b9c-6d7e-4f8a-9b9c-0d1e2f3a4b56',
  topicOrphan: '1a8b9c0d-7e8f-4a9b-8c0d-1e2f3a4b5c67',
} as const;

export function createTaxonomyVocabularyNamespaces(): VocabularyNamespaceData[] {
  return [{
    source: {
      namespace: PRACTICES_NAMESPACE_URL,
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      ...bsiNamespaceLocation('practices.csv'),
      fileName: 'practices.csv',
      gitBlobSha: 'practice-blob-sha',
    },
    columnOrder: [
      'Kürzel',
      'Begriff',
      'Definition',
      'UUID',
      'Schwerpunkt',
      'Nummerierung',
      'auch bekannt als',
    ],
    valueColumn: 'Kürzel',
    definitionColumn: 'Definition',
    identifierColumns: ['UUID'],
    identifierReferenceColumns: [],
    entries: [{
      value: 'GC',
      definition: 'Offizielle Praktik-Definition.',
      columns: {
        Kürzel: 'GC',
        Begriff: 'Governance und Compliance',
        Definition: 'Offizielle Praktik-Definition.',
        UUID: TAXONOMY_IDENTIFIERS.practiceGC,
        Schwerpunkt: 'Methodik',
        Nummerierung: '1',
        'auch bekannt als': 'Corporate Governance',
      },
    }],
  }, {
    source: {
      namespace: TOPICS_NAMESPACE_URL,
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      ...bsiNamespaceLocation('topics.csv'),
      fileName: 'topics.csv',
      gitBlobSha: 'topic-blob-sha',
    },
    columnOrder: ['Begriff', 'Definition', 'UUID'],
    valueColumn: 'Begriff',
    definitionColumn: 'Definition',
    identifierColumns: ['UUID'],
    identifierReferenceColumns: [],
    entries: [{
      value: 'Organisation',
      definition: 'Offizielle Themen-Definition.',
      columns: {
        Begriff: 'Organisation',
        Definition: 'Offizielle Themen-Definition.',
        UUID: TAXONOMY_IDENTIFIERS.topicOrganisation,
      },
    }, {
      value: 'Verwaistes Thema',
      definition: 'Bleibt im Vokabular auffindbar.',
      columns: {
        Begriff: 'Verwaistes Thema',
        Definition: 'Bleibt im Vokabular auffindbar.',
        UUID: TAXONOMY_IDENTIFIERS.topicOrphan,
      },
    }],
  }];
}
