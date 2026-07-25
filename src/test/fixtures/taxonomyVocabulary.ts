import type { VocabularyNamespaceData } from '@/domain/models';

export function createTaxonomyVocabularyNamespaces(): VocabularyNamespaceData[] {
  return [{
    source: {
      namespace:
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/practices.csv',
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      path: 'Dokumentation/namespaces/practices.csv',
      fileName: 'practices.csv',
      routeId: 'dokumentation-namespaces-practices',
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
    entries: [{
      value: 'GC',
      definition: 'Offizielle Praktik-Definition.',
      columns: {
        Kürzel: 'GC',
        Begriff: 'Governance und Compliance',
        Definition: 'Offizielle Praktik-Definition.',
        UUID: 'uuid-practice-1',
        Schwerpunkt: 'Methodik',
        Nummerierung: '1',
        'auch bekannt als': 'Corporate Governance',
      },
    }],
  }, {
    source: {
      namespace:
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/topics.csv',
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      path: 'Dokumentation/namespaces/topics.csv',
      fileName: 'topics.csv',
      routeId: 'dokumentation-namespaces-topics',
      gitBlobSha: 'topic-blob-sha',
    },
    columnOrder: ['Begriff', 'Definition', 'UUID'],
    valueColumn: 'Begriff',
    definitionColumn: 'Definition',
    entries: [{
      value: 'Organisation',
      definition: 'Offizielle Themen-Definition.',
      columns: {
        Begriff: 'Organisation',
        Definition: 'Offizielle Themen-Definition.',
        UUID: 'uuid-topic-1',
      },
    }, {
      value: 'Verwaistes Thema',
      definition: 'Bleibt im Vokabular auffindbar.',
      columns: {
        Begriff: 'Verwaistes Thema',
        Definition: 'Bleibt im Vokabular auffindbar.',
        UUID: 'uuid-topic-orphan',
      },
    }],
  }];
}
