import type { Catalog, CatalogState, Control } from '@/domain/models';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { TAXONOMY_IDENTIFIERS } from '@/test/fixtures/taxonomyVocabulary';

/**
 * Katalog für die Browser-Prüfungen der Tablet-Ansicht (GSPP-514, GSPP-523):
 * volle Detailinhalte (Anforderung, Umsetzungshinweise, Zusammenhänge) und eine
 * lange Liste, damit Zuschnitt und Scrollkopplung auffielen. Zwei Themen
 * erlauben Prüfungen des Listenbereichs.
 */

const LONG_STATEMENT = 'Die Architektur verankert Verfahren und Regelungen zum Schutz der Netze und der damit verbundenen Infrastrukturen. ';
const LONG_GUIDANCE = 'Die Netzarchitektur ist der strukturierte Entwurf aller Netzinfrastrukturen einschließlich Segmentierung, Filterung und Redundanz wichtiger Systeme. ';

function makeControl(id: string, title: string, overrides: Partial<Control> = {}): Control {
  const [practiceId, groupId] = [id.split('.')[0], id.split('.').slice(0, 2).join('.')];
  return {
    id,
    altIdentifier: `alt-${id.toLowerCase().replaceAll('.', '-')}`,
    title,
    groupId,
    practiceId,
    modalverb: 'MUSS',
    securityLevel: 'normal-SdT',
    effortLevel: '2',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: LONG_STATEMENT.repeat(6),
    statementRaw: LONG_STATEMENT.repeat(6),
    guidance: LONG_GUIDANCE.repeat(10),
    statementProps: {
      ergebnis: '',
      praezisierung: '',
      handlungsworte: '',
      dokumentation: '',
      zielobjektKategorien: [],
    },
    links: [],
    params: {},
    ...overrides,
  } as Control;
}

/** `overrides` ergänzt einzelne Kontrollen, etwa um den Filterzustand sichtbar zu machen. */
export function createTabletCatalogState(overrides: Readonly<Record<string, Partial<Control>>> = {}): CatalogState {
  const topic1Controls: Control[] = [
    makeControl('TOP.1.1', 'Verfahren und Regelungen', {
      tags: ['netz'],
      links: [{ targetId: 'TOP.1.2', href: '#TOP.1.2', rel: 'required', relStatus: 'custom' }],
      ...overrides['TOP.1.1'],
    }),
    ...['TOP.1.1.1', 'TOP.1.1.2', 'TOP.1.1.3'].map((id, index) =>
      makeControl(id, `Erweiterung ${index + 1}`, { parentId: 'TOP.1.1', ...overrides[id] }),
    ),
    ...Array.from({ length: 12 }, (_, index) => {
      const id = `TOP.1.${index + 2}`;
      return makeControl(id, `Kontrolle ${index + 2}`, overrides[id]);
    }),
  ];
  const topic2Controls: Control[] = Array.from({ length: 8 }, (_, index) => {
    const id = `TOP.2.${index + 1}`;
    return makeControl(id, `Thema-2-Kontrolle ${index + 1}`, overrides[id]);
  });
  const controls = [...topic1Controls, ...topic2Controls];

  const catalog = {
    catalogKey: 'gspp',
    uuid: 'tablet-test-catalog',
    metadata: { title: 'Grundschutz++-Katalog' },
    practices: [{
      id: 'TOP',
      title: 'Governance und Compliance',
      label: 'TOP',
      altIdentifier: TAXONOMY_IDENTIFIERS.practiceGC,
      topics: [
        {
          id: 'TOP.1',
          title: 'Organisation',
          label: '1',
          altIdentifier: TAXONOMY_IDENTIFIERS.topicOrganisation,
          practiceId: 'TOP',
          controlCount: topic1Controls.length,
          controlIds: topic1Controls.map((control) => control.id),
        },
        {
          id: 'TOP.2',
          title: 'Zweites Thema',
          label: '2',
          practiceId: 'TOP',
          controlCount: topic2Controls.length,
          controlIds: topic2Controls.map((control) => control.id),
        },
      ],
      controlCount: controls.length,
    }],
    controls,
    controlsById: new Map(controls.map((control) => [control.id, control])),
    controlsByAltIdentifier: new Map(controls.map((control) => [control.altIdentifier!, control])),
    backMatter: [],
    totalControls: controls.length,
  } as unknown as Catalog;

  return {
    ...catalogCollectionDefaults(),
    catalog,
    catalogDocument: null,
    provenance: null,
    verification: null,
    vocabularyRegistry: createTestVocabularyRegistry(),
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  } as CatalogState;
}
