// =============================================================================
// GSPP-380 — Exakte Kennungsauflösung
//
// Jede Zeile des Auflösungsmappings aus dem Issue hat hier ihren Test. Die
// Kennungen kommen aus der geteilten Vokabular-Fixture, damit ein geänderter
// Testwert nicht stillschweigend an der Auflösung vorbeiläuft.
// =============================================================================

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Control, Practice } from '@/domain/models';
import {
  createTestVocabularyRegistry,
  VOCABULARY_IDENTIFIERS,
} from '@/test/fixtures/vocabulary';
import { clearSearchCache, useSearch } from './useSearch';

const THREAT_NAMESPACE = 'https://example.com/namespaces/basethreats.csv';
const TARGET_OBJECT_NAMESPACE =
  'https://example.com/namespaces/target_object_categories.csv';
const ACTION_WORD_NAMESPACE = 'https://example.com/namespaces/action_words.csv';
const MODAL_VERB_NAMESPACE = 'https://example.com/namespaces/modal_verbs.csv';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Governance MUSS verankert werden.',
    statementRaw: 'Governance MUSS verankert werden.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
      ...overrides.statementProps,
    },
    links: [],
    params: {},
    ...overrides,
  };
}

function withThreat(control: Control, threat: string): Control {
  return {
    ...control,
    threats: [threat],
    threatsProp: { name: 'threats', value: threat, ns: THREAT_NAMESPACE },
  };
}

function withTargetObject(control: Control, category: string): Control {
  return {
    ...control,
    statementProps: {
      ...control.statementProps,
      zielobjektKategorien: [category],
      zielobjektKategorienProp: {
        name: 'target_object_categories',
        value: category,
        ns: TARGET_OBJECT_NAMESPACE,
      },
    },
  };
}

function renderIdentifierSearch(
  controls: Control[],
  query: string,
  practices: Practice[] = [],
) {
  return renderHook(() =>
    useSearch(controls, query, createTestVocabularyRegistry(), practices, 'gspp'),
  );
}

async function expectMatches(
  controls: Control[],
  query: string,
  expected: string[],
  practices: Practice[] = [],
) {
  const { result } = renderIdentifierSearch(controls, query, practices);

  await waitFor(() => {
    expect(result.current.results.map((entry) => entry.control.id)).toEqual(expected);
  });
}

describe('useSearch — Kennungsauflösung', () => {
  beforeEach(() => {
    clearSearchCache();
  });

  it('resolves a control alt-identifier to exactly that control', async () => {
    const controls = [
      makeControl({ id: 'PERF.2.1', altIdentifier: '9bb16672-4394-4ce9-bd14-12a080233f7a' }),
      makeControl({ id: 'PERF.2.2', altIdentifier: '5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f' }),
    ];

    await expectMatches(controls, '9bb16672-4394-4ce9-bd14-12a080233f7a', ['PERF.2.1']);
  });

  it('puts a control alt-identifier match first when a group shares the identifier', async () => {
    const sharedIdentifier = '9bb16672-4394-4ce9-bd14-12a080233f7a';
    const controls = [
      makeControl({ id: 'GC.1.1', groupId: 'GC.1', practiceId: 'GC' }),
      makeControl({ id: 'GC.1.2', groupId: 'GC.1', practiceId: 'GC', altIdentifier: sharedIdentifier }),
    ];
    const practices: Practice[] = [{
      id: 'GC',
      title: 'Governance und Compliance',
      label: 'GC',
      altIdentifier: sharedIdentifier,
      topics: [],
      controlCount: 2,
    }];

    await expectMatches(controls, sharedIdentifier, ['GC.1.2', 'GC.1.1'], practices);
  });

  it('resolves a practice identifier to every control of that practice', async () => {
    const controls = [
      makeControl({ id: 'GC.1.1', practiceId: 'GC' }),
      makeControl({ id: 'GC.2.1', groupId: 'GC.2', practiceId: 'GC' }),
      makeControl({ id: 'ASST.1.1', groupId: 'ASST.1', practiceId: 'ASST' }),
    ];
    const practices: Practice[] = [{
      id: 'GC',
      title: 'Governance und Compliance',
      label: 'GC',
      altIdentifier: VOCABULARY_IDENTIFIERS.practiceGC,
      topics: [],
      controlCount: 2,
    }];

    await expectMatches(
      controls,
      VOCABULARY_IDENTIFIERS.practiceGC,
      ['GC.1.1', 'GC.2.1'],
      practices,
    );
  });

  it('unions the controls of every group sharing a topic identifier', async () => {
    const controls = [
      makeControl({ id: 'GC.1.1', groupId: 'GC.1', practiceId: 'GC' }),
      makeControl({ id: 'ASST.3.1', groupId: 'ASST.3', practiceId: 'ASST' }),
      makeControl({ id: 'GC.9.1', groupId: 'GC.9', practiceId: 'GC' }),
    ];
    // Dieselbe Themen-UUID hängt an zwei Gruppen zweier Praktiken — im realen
    // Katalog trägt "Grundlagen" diese Wiederverwendung über 15 Gruppen.
    const practices: Practice[] = [
      {
        id: 'GC',
        title: 'Governance und Compliance',
        label: 'GC',
        topics: [{
          id: 'GC.1',
          title: 'Organisation',
          label: '1',
          altIdentifier: VOCABULARY_IDENTIFIERS.topicOrganisation,
          practiceId: 'GC',
          controlCount: 1,
          controlIds: ['GC.1.1'],
        }],
        controlCount: 2,
      },
      {
        id: 'ASST',
        title: 'Asset-Management',
        label: 'ASST',
        topics: [{
          id: 'ASST.3',
          title: 'Organisation',
          label: '3',
          altIdentifier: VOCABULARY_IDENTIFIERS.topicOrganisation,
          practiceId: 'ASST',
          controlCount: 1,
          controlIds: ['ASST.3.1'],
        }],
        controlCount: 1,
      },
    ];

    await expectMatches(
      controls,
      VOCABULARY_IDENTIFIERS.topicOrganisation,
      ['GC.1.1', 'ASST.3.1'],
      practices,
    );
  });

  it('resolves a threat identifier to every control carrying that threat', async () => {
    const controls = [
      withThreat(makeControl({ id: 'GC.1.1' }), 'G 0.18'),
      withThreat(makeControl({ id: 'GC.1.2' }), 'G 0.19'),
      withThreat(makeControl({ id: 'GC.1.3' }), 'G 0.18'),
    ];

    await expectMatches(controls, VOCABULARY_IDENTIFIERS.threatG018, ['GC.1.1', 'GC.1.3']);
  });

  it('resolves a target object category identifier', async () => {
    const controls = [
      withTargetObject(makeControl({ id: 'GC.1.1' }), 'Server'),
      makeControl({ id: 'GC.1.2' }),
    ];

    await expectMatches(controls, VOCABULARY_IDENTIFIERS.targetObjectServer, ['GC.1.1']);
  });

  it('resolves an action word identifier', async () => {
    const controls = [
      makeControl({
        id: 'GC.1.1',
        statementProps: {
          zielobjektKategorien: [],
          handlungsworte: 'verankern',
          handlungsworteProp: {
            name: 'action_words',
            value: 'verankern',
            ns: ACTION_WORD_NAMESPACE,
          },
        },
      }),
      makeControl({ id: 'GC.1.2' }),
    ];

    await expectMatches(controls, VOCABULARY_IDENTIFIERS.actionWordVerankern, ['GC.1.1']);
  });

  it('resolves a modal verb identifier to every control with that modal verb', async () => {
    const modalverbProp = {
      name: 'modal_verb',
      value: 'MUSS',
      ns: MODAL_VERB_NAMESPACE,
    };
    const controls = [
      makeControl({ id: 'GC.1.1', modalverb: 'MUSS', modalverbProp }),
      makeControl({
        id: 'GC.1.2',
        modalverb: 'SOLLTE',
        modalverbProp: { ...modalverbProp, value: 'SOLLTE' },
      }),
      makeControl({ id: 'GC.1.3', modalverb: 'MUSS', modalverbProp }),
    ];

    await expectMatches(controls, VOCABULARY_IDENTIFIERS.modalverbMuss, ['GC.1.1', 'GC.1.3']);
  });

  it('keeps a parent identifier free of the child entry controls', async () => {
    // "Dateiserver" verweist per ChildOfUUID auf "Server". Beide Einträge
    // hängen an verschiedenen Controls; die Elternkennung darf ausschließlich
    // die Controls des Elterneintrags liefern.
    const controls = [
      withTargetObject(makeControl({ id: 'GC.1.1' }), 'Server'),
      withTargetObject(makeControl({ id: 'GC.1.2' }), 'Dateiserver'),
    ];

    await expectMatches(controls, VOCABULARY_IDENTIFIERS.targetObjectServer, ['GC.1.1']);
    await expectMatches(
      controls,
      VOCABULARY_IDENTIFIERS.targetObjectDateiserver,
      ['GC.1.2'],
    );
  });

  it('returns nothing for identifiers without a control relation', async () => {
    const controls = [withTargetObject(makeControl({ id: 'GC.1.1' }), 'Server')];

    // Stellvertretend für catalog.uuid, document-id, parties.uuid und
    // resources.uuid: wohlgeformt, aber ohne Control-Bezug.
    await expectMatches(controls, 'c1b2a394-8d7e-4f60-9a51-2b3c4d5e6f70', []);
  });

  it('does not reach controls of another catalog', async () => {
    // Der Index entsteht je Katalog aus den übergebenen Controls. Eine Kennung
    // aus einem anderen Katalog ist darin schlicht nicht enthalten.
    const wlanControl = makeControl({
      id: 'WLAN.1.1',
      altIdentifier: 'd4c3b2a1-9e8f-4a7b-8c6d-5e4f3a2b1c09',
    });
    const gsppControls = [makeControl({ id: 'GC.1.1', altIdentifier: '9bb16672-4394-4ce9-bd14-12a080233f7a' })];

    await expectMatches(gsppControls, wlanControl.altIdentifier!, []);
  });

  it('never falls back to full-text search for a malformed identifier', async () => {
    const fragment = '9bb16672-4394-4ce9-bd14-12a080233f7';
    const controls = [
      makeControl({ id: 'GC.1.1', altIdentifier: '9bb16672-4394-4ce9-bd14-12a080233f7a' }),
      // Das Fragment steht im Titel und im Fließtext einer anderen Control.
      // Ohne die Einordnung als Kennungsanfrage würde die Volltextsuche genau
      // diese Control liefern statt der geforderten null Treffer.
      makeControl({
        id: 'TEXT.1',
        title: `Referenzliste ${fragment}`,
        statement: `Der Eintrag ${fragment} ist zu prüfen.`,
      }),
    ];

    await expectMatches(controls, fragment, []);
    await expectMatches(controls, '9bb16672-4394', []);
  });

  it('never falls back to full-text search for a broken identifier', async () => {
    // Vollständiges Segmentraster mit einem Nicht-Hex-Zeichen. Ohne
    // Formerkennung liefe die Eingabe als gewöhnlicher Suchbegriff in Titel
    // und Fließtext.
    const cases = [
      '9bb16672-4394-4ce9-bd14-12a080233g7a',
      '9bb1667g-4394-4ce9-bd14-12a080233f7a',
      '9bb16672-4394-4cg9-bd14-12a080233f7a',
      // Verrutschte Segmentlängen hinter gültigem Kopfblock.
      '9bb16672-43945-4ce9-bd14-12a080233f7a',
      '9bb16672-4394-4ce9-bd14-12a080233f7ab',
    ];

    for (const invalid of cases) {
      const controls = [
        makeControl({ id: 'GC.1.1', altIdentifier: '9bb16672-4394-4ce9-bd14-12a080233f7a' }),
        makeControl({
          id: 'TEXT.1',
          title: `Referenzliste ${invalid}`,
          statement: `Der Eintrag ${invalid} ist zu prüfen.`,
        }),
      ];

      await expectMatches(controls, invalid, []);
    }
  });

  it('GSPP-274: keeps identifiers sharing hyphen sub-tokens apart', async () => {
    // Die drei Gefährdungskennungen der Fixture unterscheiden sich nur im
    // letzten Oktett — genau die Konstellation, die 81 themenfremde Treffer
    // erzeugt hatte.
    const controls = [
      withThreat(makeControl({ id: 'GC.1.1' }), 'G 0.18'),
      withThreat(makeControl({ id: 'GC.1.2' }), 'G 0.19'),
      withThreat(makeControl({ id: 'GC.1.3' }), 'G 0.20'),
    ];

    await expectMatches(controls, VOCABULARY_IDENTIFIERS.threatG018, ['GC.1.1']);
    await expectMatches(controls, VOCABULARY_IDENTIFIERS.threatG019, ['GC.1.2']);
    await expectMatches(controls, VOCABULARY_IDENTIFIERS.threatG020, ['GC.1.3']);
  });
});
