import type {
  VocabularyEntry,
  VocabularyNamespaceData,
  VocabularyRegistryData,
} from '@/domain/models';
import { buildVocabularyRegistry } from '@/domain/vocabularies';

function createNamespace({
  namespace,
  path,
  fileName,
  routeId,
  valueColumn = 'Begriff',
  definitionColumn = 'Definition',
  extraColumns = [],
  entries,
}: {
  namespace: string;
  path: string;
  fileName: string;
  routeId: string;
  valueColumn?: string;
  definitionColumn?: string;
  extraColumns?: string[];
  entries: VocabularyEntry[];
}): VocabularyNamespaceData {
  return {
    source: {
      namespace,
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      path,
      fileName,
      routeId,
      gitBlobSha: `${routeId}-blob-sha`,
    },
    columnOrder: [valueColumn, definitionColumn, ...extraColumns],
    valueColumn,
    definitionColumn,
    entries,
  };
}

export function createTestVocabularyRegistry() {
  const data: VocabularyRegistryData = {
    sourceCommitSha: 'test-upstream-commit',
    namespaces: [
      createNamespace({
        namespace: 'https://example.com/namespaces/modal_verbs.csv',
        path: 'namespaces/modal_verbs.csv',
        fileName: 'modal_verbs.csv',
        routeId: 'modal-verbs',
        entries: [
          {
            value: 'MUSS',
            definition: 'Modalverb definiert verbindliche Anforderungen.',
            columns: {
              Begriff: 'MUSS',
              Definition: 'Modalverb definiert verbindliche Anforderungen.',
            },
          },
          {
            value: 'SOLLTE',
            definition: 'Modalverb markiert eine starke Empfehlung.',
            columns: {
              Begriff: 'SOLLTE',
              Definition: 'Modalverb markiert eine starke Empfehlung.',
            },
          },
        ],
      }),
      createNamespace({
        namespace: 'https://example.com/namespaces/security_level.csv',
        path: 'namespaces/security_level.csv',
        fileName: 'security_level.csv',
        routeId: 'security-level',
        extraColumns: ['Kurzlabel'],
        entries: [
          {
            value: 'normal-SdT',
            definition: 'Standard-Sicherheitsniveau für den Stand der Technik.',
            columns: {
              Begriff: 'normal-SdT',
              Definition: 'Standard-Sicherheitsniveau für den Stand der Technik.',
              Kurzlabel: 'SdT',
            },
          },
          {
            value: 'erhöht',
            definition: 'Erhöhtes Sicherheitsniveau.',
            columns: {
              Begriff: 'erhöht',
              Definition: 'Erhöhtes Sicherheitsniveau.',
              Kurzlabel: 'Erhöht',
            },
          },
        ],
      }),
      createNamespace({
        namespace: 'https://example.com/namespaces/effort_level.csv',
        path: 'namespaces/effort_level.csv',
        fileName: 'effort_level.csv',
        routeId: 'effort-level',
        extraColumns: ['Skala'],
        entries: [
          {
            value: '3',
            definition: 'Mittlere Aufwandsstufe.',
            columns: {
              Begriff: '3',
              Definition: 'Mittlere Aufwandsstufe.',
              Skala: 'mittel',
            },
          },
          {
            value: '4',
            definition: 'Hohe Aufwandsstufe.',
            columns: {
              Begriff: '4',
              Definition: 'Hohe Aufwandsstufe.',
              Skala: 'hoch',
            },
          },
        ],
      }),
      createNamespace({
        namespace: 'https://example.com/namespaces/tags.csv',
        path: 'namespaces/tags.csv',
        fileName: 'tags.csv',
        routeId: 'tags',
        extraColumns: ['Kategorie'],
        entries: [
          {
            value: 'Governance',
            definition: 'Governance-Definition.',
            columns: {
              Begriff: 'Governance',
              Definition: 'Governance-Definition.',
              Kategorie: 'Organisation',
            },
          },
          {
            value: 'BCM',
            definition: 'Business-Continuity-Management.',
            columns: {
              Begriff: 'BCM',
              Definition: 'Business-Continuity-Management.',
              Kategorie: 'Resilienz',
            },
          },
        ],
      }),
      createNamespace({
        namespace: 'https://example.com/namespaces/result.csv',
        path: 'namespaces/result.csv',
        fileName: 'result.csv',
        routeId: 'result',
        extraColumns: ['Hinweis'],
        entries: [
          {
            value: 'Verfahren und Regelungen',
            definition: 'Offizielles Ergebnis für Richtlinien und Prozesse.',
            columns: {
              Begriff: 'Verfahren und Regelungen',
              Definition: 'Offizielles Ergebnis für Richtlinien und Prozesse.',
              Hinweis: 'Geeignet für Governance-Nachweise',
            },
          },
          {
            value: 'nach einem Standard',
            definition: 'Präzisierung verweist auf einen normativen Standard.',
            columns: {
              Begriff: 'nach einem Standard',
              Definition: 'Präzisierung verweist auf einen normativen Standard.',
              Hinweis: 'Standardbezug erforderlich',
            },
          },
        ],
      }),
      createNamespace({
        namespace: 'https://example.com/namespaces/action_words.csv',
        path: 'namespaces/action_words.csv',
        fileName: 'action_words.csv',
        routeId: 'action-words',
        entries: [
          {
            value: 'verankern',
            definition: 'Handlungswort für organisatorische Verankerung.',
            columns: {
              Begriff: 'verankern',
              Definition: 'Handlungswort für organisatorische Verankerung.',
            },
          },
          {
            value: 'umsetzen',
            definition: 'Handlungswort für konkrete Umsetzung.',
            columns: {
              Begriff: 'umsetzen',
              Definition: 'Handlungswort für konkrete Umsetzung.',
            },
          },
        ],
      }),
      createNamespace({
        namespace: 'https://example.com/namespaces/documentation_guidelines.csv',
        path: 'namespaces/documentation_guidelines.csv',
        fileName: 'documentation_guidelines.csv',
        routeId: 'documentation-guidelines',
        extraColumns: ['Pflicht'],
        entries: [
          {
            value: 'Richtlinie A',
            definition: 'Dokumentation muss nachvollziehbar gepflegt werden.',
            columns: {
              Begriff: 'Richtlinie A',
              Definition: 'Dokumentation muss nachvollziehbar gepflegt werden.',
              Pflicht: 'ja',
            },
          },
        ],
      }),
      createNamespace({
        namespace: 'https://example.com/namespaces/target_object_categories.csv',
        path: 'namespaces/target_object_categories.csv',
        fileName: 'target_object_categories.csv',
        routeId: 'target-object-categories',
        extraColumns: ['Objektklasse'],
        entries: [
          {
            value: 'Server',
            definition: 'Server sind Zielobjekte mit zentralen IT-Diensten.',
            columns: {
              Begriff: 'Server',
              Definition: 'Server sind Zielobjekte mit zentralen IT-Diensten.',
              Objektklasse: 'IT-System',
            },
          },
        ],
      }),
    ],
  };

  return buildVocabularyRegistry(data);
}
