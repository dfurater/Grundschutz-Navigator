import type {
  VocabularyEntry,
  VocabularyNamespaceData,
  VocabularyRegistryData,
} from '@/domain/models';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import {
  createTaxonomyVocabularyNamespaces,
  TAXONOMY_IDENTIFIERS,
} from './taxonomyVocabulary';

/**
 * Kennungen der Vokabular-Fixture. Die drei Gefährdungen teilen sich bewusst
 * vier der fünf Bindestrich-Teiltokens: Genau diese Nachbarschaft hatte in
 * GSPP-274 im Volltextindex zu gegenseitigen Treffern geführt.
 */
export const VOCABULARY_IDENTIFIERS = {
  ...TAXONOMY_IDENTIFIERS,
  modalverbMuss: '5a2b3c4d-1e2f-4a3b-8c4d-5e6f7a8b9c01',
  modalverbSollte: '6b3c4d5e-2f3a-4b4c-9d5e-6f7a8b9c0d12',
  actionWordVerankern: '7c4d5e6f-3a4b-4c5d-8e6f-7a8b9c0d1e23',
  actionWordUmsetzen: '8d5e6f7a-4b5c-4d6e-9f7a-8b9c0d1e2f34',
  threatG018: 'aa11bb22-cc33-4d44-8e55-ff6600112233',
  threatG019: 'aa11bb22-cc33-4d44-8e55-ff6600112244',
  threatG020: 'aa11bb22-cc33-4d44-8e55-ff6600112255',
  targetObjectServer: '1f8a6a1e-9c2b-4d3a-9f11-0b7c5d2e4a60',
  targetObjectDateiserver: '2c9b7b2f-8d3c-4e4b-8a22-1c8d6e3f5b71',
  targetObjectOrphanParent: '3d0c8c30-7e4d-4f5c-9b33-2d9e7f4a6c82',
  targetObjectOrphan: '4e1d9d41-6f5e-4a6d-8c44-3eaf805b7d93',
} as const;

function createNamespace({
  namespace,
  path,
  fileName,
  routeId,
  valueColumn = 'Begriff',
  definitionColumn = 'Definition',
  extraColumns = [],
  identifierColumns = [],
  identifierReferenceColumns = [],
  entries,
}: {
  namespace: string;
  path: string;
  fileName: string;
  routeId: string;
  valueColumn?: string;
  definitionColumn?: string;
  extraColumns?: string[];
  identifierColumns?: string[];
  identifierReferenceColumns?: string[];
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
    identifierColumns,
    identifierReferenceColumns,
    entries,
  };
}

function createDefinitionEntry(
  value: string,
  definition: string,
  valueColumn = 'Begriff',
): VocabularyEntry {
  return { value, definition, columns: { [valueColumn]: value, Definition: definition } };
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
        extraColumns: ['UUID'],
        identifierColumns: ['UUID'],
        entries: [
          {
            value: 'MUSS',
            definition: 'Modalverb definiert verbindliche Anforderungen.',
            columns: {
              Begriff: 'MUSS',
              Definition: 'Modalverb definiert verbindliche Anforderungen.',
              UUID: VOCABULARY_IDENTIFIERS.modalverbMuss,
            },
          },
          {
            value: 'SOLLTE',
            definition: 'Modalverb markiert eine starke Empfehlung.',
            columns: {
              Begriff: 'SOLLTE',
              Definition: 'Modalverb markiert eine starke Empfehlung.',
              UUID: VOCABULARY_IDENTIFIERS.modalverbSollte,
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
        extraColumns: ['UUID'],
        identifierColumns: ['UUID'],
        entries: [
          {
            value: 'verankern',
            definition: 'Handlungswort für organisatorische Verankerung.',
            columns: {
              Begriff: 'verankern',
              Definition: 'Handlungswort für organisatorische Verankerung.',
              UUID: VOCABULARY_IDENTIFIERS.actionWordVerankern,
            },
          },
          {
            value: 'umsetzen',
            definition: 'Handlungswort für konkrete Umsetzung.',
            columns: {
              Begriff: 'umsetzen',
              Definition: 'Handlungswort für konkrete Umsetzung.',
              UUID: VOCABULARY_IDENTIFIERS.actionWordUmsetzen,
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
        extraColumns: ['Objektklasse', 'ChildOfUUID', 'UUID'],
        identifierColumns: ['UUID'],
        identifierReferenceColumns: ['ChildOfUUID'],
        entries: [
          {
            value: 'Server',
            definition: 'Server sind Zielobjekte mit zentralen IT-Diensten.',
            columns: {
              Begriff: 'Server',
              Definition: 'Server sind Zielobjekte mit zentralen IT-Diensten.',
              Objektklasse: 'IT-System',
              ChildOfUUID: '',
              UUID: VOCABULARY_IDENTIFIERS.targetObjectServer,
            },
          },
          // Kind mit eigener Kennung und Verweis auf "Server": belegt, dass die
          // Elternkennung nur die Controls des Elterneintrags liefert.
          {
            value: 'Dateiserver',
            definition: 'Dateiserver sind eine Unterkategorie der Server.',
            columns: {
              Begriff: 'Dateiserver',
              Definition: 'Dateiserver sind eine Unterkategorie der Server.',
              Objektklasse: 'IT-System',
              ChildOfUUID: VOCABULARY_IDENTIFIERS.targetObjectServer,
              UUID: VOCABULARY_IDENTIFIERS.targetObjectDateiserver,
            },
          },
          // Verweis ins Leere: die Zeile darf in der Karte nicht erscheinen.
          {
            value: 'Verwaiste Kategorie',
            definition: 'Kategorie mit unauflösbarem Elternverweis.',
            columns: {
              Begriff: 'Verwaiste Kategorie',
              Definition: 'Kategorie mit unauflösbarem Elternverweis.',
              Objektklasse: 'IT-System',
              ChildOfUUID: VOCABULARY_IDENTIFIERS.targetObjectOrphanParent,
              UUID: VOCABULARY_IDENTIFIERS.targetObjectOrphan,
            },
          },
        ],
      }),
      createNamespace({
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv',
        path: 'documentation/namespaces/security_targets.csv',
        fileName: 'security_targets.csv',
        routeId: 'documentation-namespaces-security-targets',
        entries: [
          createDefinitionEntry('Vertraulichkeit (Confidentiality)', 'Schutz vor unbefugter Offenlegung.'),
          createDefinitionEntry('Integrität (Integrity)', 'Schutz vor unbefugter oder unbemerkter Veränderung.'),
          createDefinitionEntry('Verfügbarkeit (Availability)', 'Schutz der rechtzeitigen Nutzbarkeit.'),
          createDefinitionEntry('Authentizität (Authenticity)', 'Sicherstellung der Echtheit und Herkunft.'),
        ],
      }),
      createNamespace({
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets_levels.csv',
        path: 'documentation/namespaces/security_targets_levels.csv',
        fileName: 'security_targets_levels.csv',
        routeId: 'documentation-namespaces-security-targets-levels',
        valueColumn: 'Wert',
        entries: [
          createDefinitionEntry('0', 'Die Anforderung wirkt nicht oder vernachlässigbar gering auf dieses Schutzziel hin.', 'Wert'),
          createDefinitionEntry('1', 'Die Anforderung wirkt auf dieses Schutzziel hin.', 'Wert'),
          createDefinitionEntry('2', 'Die Anforderung wirkt in besonderem Maße auf dieses Schutzziel hin. Dieser Wert zeigt an, dass das Schutzziel im Zentrum dieser Anforderung steht.', 'Wert'),
        ],
      }),
      ...createTaxonomyVocabularyNamespaces(),
      createNamespace({
        namespace: 'https://example.com/namespaces/basethreats.csv',
        path: 'namespaces/basethreats.csv',
        fileName: 'basethreats.csv',
        routeId: 'basethreats',
        // Wie im echten Artefakt: die ID ist der Lookup-Wert, `Begriff` trägt den Namen.
        valueColumn: 'ID',
        extraColumns: ['Begriff', 'uuid'],
        identifierColumns: ['uuid'],
        entries: [
          {
            value: 'G 0.18',
            definition: 'Fehlplanung oder fehlende Anpassung von Prozessen.',
            columns: {
              ID: 'G 0.18',
              Begriff: 'Fehlplanung oder fehlende Anpassung',
              Definition: 'Fehlplanung oder fehlende Anpassung von Prozessen.',
              uuid: VOCABULARY_IDENTIFIERS.threatG018,
            },
          },
          {
            value: 'G 0.19',
            definition: 'Offenlegung schützenswerter Informationen.',
            columns: {
              ID: 'G 0.19',
              Begriff: 'Offenlegung schützenswerter Informationen',
              Definition: 'Offenlegung schützenswerter Informationen.',
              uuid: VOCABULARY_IDENTIFIERS.threatG019,
            },
          },
          {
            value: 'G 0.20',
            definition: 'Gefährdung ohne hinterlegten Begriff.',
            columns: {
              ID: 'G 0.20',
              Definition: 'Gefährdung ohne hinterlegten Begriff.',
              uuid: VOCABULARY_IDENTIFIERS.threatG020,
            },
          },
        ],
      }),
    ],
  };

  return buildVocabularyRegistry(data);
}
