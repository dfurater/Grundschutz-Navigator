import { describe, it, expect } from 'vitest';
import {
  parseCatalog,
  parseControl,
  parseTopic,
  parsePractice,
  parseMetadata,
  getPropValue,
  getPropValues,
  findPart,
  buildParamMap,
  resolveParams,
  parseTags,
  parseLinkHref,
  toSecurityLevel,
  toEffortLevel,
  toModalverb,
} from './oscalAdapter';
import type {
  RawOscalControl,
  RawOscalGroup,
  RawOscalCatalog,
  RawOscalDocument,
} from '@/domain/models';

/* ------------------------------------------------------------------ */
/*  Test Fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeControl(overrides: Partial<RawOscalControl> = {}): RawOscalControl {
  return {
    id: 'GC.1.1',
    class: 'BSI-Methodik-Grundschutz-plus-plus',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    params: [
      {
        id: 'gc.1.1-prm1',
        props: [{ name: 'alt-identifier', value: 'uuid-1' }],
        label: 'BSI Grundschutz++',
        values: ['BSI Grundschutz++'],
      },
    ],
    props: [
      { name: 'alt-identifier', value: 'uuid-control-1' },
      {
        name: 'sec_level',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/sicherheitsniveau.csv',
        value: 'normal-SdT',
      },
      {
        name: 'effort_level',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/aufwand.csv',
        value: '3',
      },
      {
        name: 'tags',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/tags.csv',
        value: 'BCM, Compliance Management',
      },
    ],
    parts: [
      {
        id: 'GC.1.1_stm',
        name: 'statement',
        props: [
          { name: 'result', ns: '...', value: 'Verfahren und Regelungen' },
          { name: 'result_specification', ns: '...', value: 'nach einem Standard' },
          { name: 'action_word', ns: '...', value: 'verankern' },
          { name: 'modal_verb', ns: '...', value: 'MUSS' },
          { name: 'documentation', ns: '...', value: 'Dokument A' },
          { name: 'target_object_categories', ns: '...', value: 'Server, Client' },
        ],
        prose:
          'Governance MUSS Verfahren nach {{ insert: param, gc.1.1-prm1 }} verankern.',
      },
      {
        id: 'GC.1.1_gdn',
        name: 'guidance',
        prose: 'Ein ISMS besteht aus Verfahren und Regelungen.',
      },
    ],
    links: [
      { href: '#GC.2.2', rel: 'related' },
      { href: '#GC.3.1', rel: 'required' },
    ],
    ...overrides,
  };
}

function makeGroup(overrides: Partial<RawOscalGroup> = {}): RawOscalGroup {
  return {
    id: 'GC.1',
    title: 'Grundlagen',
    props: [
      { name: 'label', value: '1' },
      { name: 'alt-identifier', value: 'uuid-topic-1' },
    ],
    controls: [makeControl()],
    ...overrides,
  };
}

function makePracticeGroup(overrides: Partial<RawOscalGroup> = {}): RawOscalGroup {
  return {
    id: 'GC',
    title: 'Governance und Compliance',
    props: [
      { name: 'label', value: 'GC' },
      { name: 'alt-identifier', value: 'uuid-practice-1' },
    ],
    groups: [makeGroup()],
    ...overrides,
  };
}

function makeCatalog(): RawOscalDocument {
  return {
    catalog: {
      uuid: 'test-uuid-1234',
      metadata: {
        title: 'Anwenderkatalog Grundschutz++',
        'last-modified': '2026-03-05T08:08:21Z',
        version: '2026-03-05',
        'oscal-version': '1.1.3',
        props: [
          { name: 'resolution-tool', value: 'Grundschutz++ Navigator', ns: 'https://example.com/namespaces/tool' },
          { name: 'keywords', value: 'BSI, Grundschutz++' },
        ],
        links: [
          {
            href: '#resource-uuid',
            rel: 'reference',
            text: 'BSI IT-Grundschutz Edition 2023',
          },
        ],
        roles: [
          { id: 'creator', title: 'Ersteller' },
        ],
        remarks: 'Test remarks',
        parties: [
          {
            uuid: 'party-uuid',
            type: 'organization',
            name: 'BSI',
            'email-addresses': ['test@bsi.bund.de'],
          },
        ],
        'responsible-parties': [
          {
            'role-id': 'creator',
            'party-uuids': ['party-uuid'],
          },
        ],
      },
      groups: [makePracticeGroup()],
      'back-matter': {
        resources: [
          {
            uuid: 'resource-uuid',
            title: 'BSI IT-Grundschutz Edition 2023',
            rlinks: [
              {
                href: 'https://example.com/grundschutz-edition-2023.pdf',
                hashes: [
                  { algorithm: 'sha-256', value: 'abc123' },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Helper Tests                                                       */
/* ------------------------------------------------------------------ */

describe('getPropValue', () => {
  it('returns the value for a matching prop name', () => {
    const props = [
      { name: 'sec_level', value: 'normal-SdT' },
      { name: 'effort_level', value: '3' },
    ];
    expect(getPropValue(props, 'sec_level')).toBe('normal-SdT');
  });

  it('returns undefined for missing prop', () => {
    expect(getPropValue([{ name: 'a', value: 'b' }], 'missing')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(getPropValue(undefined, 'any')).toBeUndefined();
  });
});

describe('getPropValues', () => {
  it('returns all values for a name', () => {
    const props = [
      { name: 'tags', value: 'BCM' },
      { name: 'other', value: 'x' },
      { name: 'tags', value: 'Compliance' },
    ];
    expect(getPropValues(props, 'tags')).toEqual(['BCM', 'Compliance']);
  });

  it('returns empty array for undefined', () => {
    expect(getPropValues(undefined, 'tags')).toEqual([]);
  });
});

describe('findPart', () => {
  it('finds a part by name', () => {
    const parts = [
      { name: 'statement', prose: 'stmt' },
      { name: 'guidance', prose: 'gdn' },
    ];
    expect(findPart(parts, 'guidance')?.prose).toBe('gdn');
  });

  it('returns undefined for missing part', () => {
    expect(findPart([{ name: 'statement', prose: 'x' }], 'guidance')).toBeUndefined();
  });
});

describe('buildParamMap', () => {
  it('maps param ID to first value', () => {
    const params = [
      { id: 'prm1', values: ['BSI Grundschutz++'] },
      { id: 'prm2', label: 'Fallback Label', values: ['Actual Value'] },
    ];
    const map = buildParamMap(params);
    expect(map['prm1']).toBe('BSI Grundschutz++');
    expect(map['prm2']).toBe('Actual Value');
  });

  it('falls back to label when no values', () => {
    const params = [{ id: 'prm1', label: 'Label Only' }];
    expect(buildParamMap(params)['prm1']).toBe('Label Only');
  });

  it('uses empty string when no values or label', () => {
    const params = [{ id: 'prm1' }];
    expect(buildParamMap(params)['prm1']).toBe('');
  });

  it('returns empty object for undefined', () => {
    expect(buildParamMap(undefined)).toEqual({});
  });
});

describe('resolveParams', () => {
  it('replaces param insertions with values', () => {
    const result = resolveParams(
      'MUSS Verfahren nach {{ insert: param, gc.1.1-prm1 }} verankern.',
      { 'gc.1.1-prm1': 'BSI Grundschutz++' },
    );
    expect(result).toBe('MUSS Verfahren nach BSI Grundschutz++ verankern.');
  });

  it('handles multiple param insertions', () => {
    const result = resolveParams(
      '{{ insert: param, a }} und {{ insert: param, b }}',
      { a: 'Wert A', b: 'Wert B' },
    );
    expect(result).toBe('Wert A und Wert B');
  });

  it('replaces unknown params with [paramId]', () => {
    const result = resolveParams('{{ insert: param, unknown-prm }}', {});
    expect(result).toBe('[unknown-prm]');
  });

  it('handles varying whitespace in template', () => {
    const result = resolveParams(
      '{{insert:param,tight}}',
      { tight: 'value' },
    );
    expect(result).toBe('value');
  });

  it('strips BSI inline choice brackets that are not OSCAL param insertions', () => {
    const result = resolveParams(
      'ein {{Reaktiv-, Aufbau- oder Standard-}}BCMS nach {{einem anerkannten BCM-Standard}}',
      {},
    );
    expect(result).toBe('ein Reaktiv-, Aufbau- oder Standard-BCMS nach einem anerkannten BCM-Standard');
  });

  it('resolves OSCAL params first, then strips remaining choice brackets', () => {
    const result = resolveParams(
      '{{ insert: param, prm1 }} und {{Auswahl}}',
      { prm1: 'Wert' },
    );
    expect(result).toBe('Wert und Auswahl');
  });

  it('preserves text without param insertions', () => {
    const text = 'No insertions here.';
    expect(resolveParams(text, {})).toBe(text);
  });
});

describe('parseTags', () => {
  it('splits comma-separated tags', () => {
    expect(parseTags('BCM, Compliance Management')).toEqual([
      'BCM',
      'Compliance Management',
    ]);
  });

  it('handles single tag', () => {
    expect(parseTags('BCM')).toEqual(['BCM']);
  });

  it('returns empty array for undefined', () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  it('filters empty strings', () => {
    expect(parseTags('a, , b')).toEqual(['a', 'b']);
  });
});

describe('parseLinkHref', () => {
  it('strips leading # from internal links', () => {
    expect(parseLinkHref('#GC.2.2')).toBe('GC.2.2');
  });

  it('returns external links unchanged', () => {
    expect(parseLinkHref('https://example.com')).toBe('https://example.com');
  });
});

describe('toSecurityLevel', () => {
  it('accepts valid values', () => {
    expect(toSecurityLevel('normal-SdT')).toBe('normal-SdT');
    expect(toSecurityLevel('erhöht')).toBe('erhöht');
  });

  it('returns undefined for invalid', () => {
    expect(toSecurityLevel('invalid')).toBeUndefined();
    expect(toSecurityLevel(undefined)).toBeUndefined();
  });
});

describe('toEffortLevel', () => {
  it('accepts 0–5', () => {
    for (const v of ['0', '1', '2', '3', '4', '5']) {
      expect(toEffortLevel(v)).toBe(v);
    }
  });

  it('rejects out-of-range', () => {
    expect(toEffortLevel('6')).toBeUndefined();
    expect(toEffortLevel('abc')).toBeUndefined();
    expect(toEffortLevel(undefined)).toBeUndefined();
  });
});

describe('toModalverb', () => {
  it('accepts MUSS, SOLLTE, KANN', () => {
    expect(toModalverb('MUSS')).toBe('MUSS');
    expect(toModalverb('SOLLTE')).toBe('SOLLTE');
    expect(toModalverb('KANN')).toBe('KANN');
  });

  it('rejects invalid', () => {
    expect(toModalverb('muss')).toBeUndefined();
    expect(toModalverb(undefined)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  parseControl Tests                                                 */
/* ------------------------------------------------------------------ */

describe('parseControl', () => {
  it('parses basic fields', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.id).toBe('GC.1.1');
    expect(control.title).toBe('Errichtung und Aufrechterhaltung eines ISMS');
    expect(control.groupId).toBe('GC.1');
    expect(control.practiceId).toBe('GC');
  });

  it('extracts security and effort levels', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.securityLevel).toBe('normal-SdT');
    expect(control.effortLevel).toBe('3');
  });

  it('retains namespace provenance for controlled props', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.securityLevelProp).toEqual({
      name: 'sec_level',
      value: 'normal-SdT',
      ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/sicherheitsniveau.csv',
    });
    expect(control.effortLevelProp).toEqual({
      name: 'effort_level',
      value: '3',
      ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/aufwand.csv',
    });
    expect(control.modalverbProp).toEqual({
      name: 'modal_verb',
      value: 'MUSS',
      ns: '...',
    });
    expect(control.tagsProp).toEqual({
      name: 'tags',
      value: 'BCM, Compliance Management',
      ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/tags.csv',
    });
    expect(control.statementProps.handlungsworteProp).toEqual({
      name: 'action_word',
      value: 'verankern',
      ns: '...',
    });
    expect(control.statementProps.dokumentationProp).toEqual({
      name: 'documentation',
      value: 'Dokument A',
      ns: '...',
    });
    expect(control.statementProps.zielobjektKategorienProp).toEqual({
      name: 'target_object_categories',
      value: 'Server, Client',
      ns: '...',
    });
  });

  it('extracts modalverb from statement props', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.modalverb).toBe('MUSS');
  });

  it('parses tags from comma-separated prop', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.tags).toEqual(['BCM', 'Compliance Management']);
  });

  it('resolves params in statement prose', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.statement).toBe(
      'Governance MUSS Verfahren nach BSI Grundschutz++ verankern.',
    );
    expect(control.statementRaw).toContain('{{ insert: param, gc.1.1-prm1 }}');
  });

  it('extracts guidance prose', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.guidance).toBe(
      'Ein ISMS besteht aus Verfahren und Regelungen.',
    );
  });

  it('extracts statement metadata props', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.statementProps.ergebnis).toBe('Verfahren und Regelungen');
    expect(control.statementProps.praezisierung).toBe('nach einem Standard');
    expect(control.statementProps.handlungsworte).toBe('verankern');
    expect(control.statementProps.dokumentation).toBe('Dokument A');
    expect(control.statementProps.zielobjektKategorien).toEqual(['Server', 'Client']);
  });

  it('parses links with correct relations', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.links).toEqual([
      { targetId: 'GC.2.2', relation: 'related' },
      { targetId: 'GC.3.1', relation: 'required' },
    ]);
  });

  it('builds param map', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.params['gc.1.1-prm1']).toBe('BSI Grundschutz++');
  });

  it('handles control without optional fields', () => {
    const minimal: RawOscalControl = {
      id: 'MIN.1.1',
      title: 'Minimal Control',
    };
    const control = parseControl(minimal, 'MIN.1', 'MIN');
    expect(control.id).toBe('MIN.1.1');
    expect(control.securityLevel).toBeUndefined();
    expect(control.effortLevel).toBeUndefined();
    expect(control.modalverb).toBeUndefined();
    expect(control.tags).toEqual([]);
    expect(control.statement).toBe('');
    expect(control.guidance).toBe('');
    expect(control.links).toEqual([]);
    expect(control.params).toEqual({});
    expect(control.statementProps.dokumentation).toBeUndefined();
    expect(control.statementProps.zielobjektKategorien).toEqual([]);
    expect(control.modalverbProp).toBeUndefined();
    expect(control.securityLevelProp).toBeUndefined();
    expect(control.effortLevelProp).toBeUndefined();
    expect(control.tagsProp).toBeUndefined();
  });

  it('extracts altIdentifier', () => {
    const control = parseControl(makeControl(), 'GC.1', 'GC');
    expect(control.altIdentifier).toBe('uuid-control-1');
  });
});

/* ------------------------------------------------------------------ */
/*  parseTopic Tests                                                   */
/* ------------------------------------------------------------------ */

describe('parseTopic', () => {
  it('parses topic fields', () => {
    const { topic } = parseTopic(makeGroup(), 'GC');
    expect(topic.id).toBe('GC.1');
    expect(topic.title).toBe('Grundlagen');
    expect(topic.label).toBe('1');
    expect(topic.practiceId).toBe('GC');
    expect(topic.altIdentifier).toBe('uuid-topic-1');
  });

  it('counts controls correctly', () => {
    const { topic, controls } = parseTopic(makeGroup(), 'GC');
    expect(topic.controlCount).toBe(1);
    expect(topic.controlIds).toEqual(['GC.1.1']);
    expect(controls).toHaveLength(1);
  });

  it('handles topic without controls', () => {
    const { topic, controls } = parseTopic(
      { id: 'X.1', title: 'Empty', props: [] },
      'X',
    );
    expect(topic.controlCount).toBe(0);
    expect(controls).toHaveLength(0);
  });

  it('falls back to id when label prop is missing', () => {
    const { topic } = parseTopic(
      { id: 'X.1', title: 'No Label', props: [] },
      'X',
    );
    expect(topic.label).toBe('X.1');
  });
});

/* ------------------------------------------------------------------ */
/*  parsePractice Tests                                                */
/* ------------------------------------------------------------------ */

describe('parsePractice', () => {
  it('parses practice fields', () => {
    const { practice } = parsePractice(makePracticeGroup());
    expect(practice.id).toBe('GC');
    expect(practice.title).toBe('Governance und Compliance');
    expect(practice.label).toBe('GC');
    expect(practice.altIdentifier).toBe('uuid-practice-1');
  });

  it('collects topics', () => {
    const { practice } = parsePractice(makePracticeGroup());
    expect(practice.topics).toHaveLength(1);
    expect(practice.topics[0].id).toBe('GC.1');
  });

  it('counts total controls across topics', () => {
    const multi = makePracticeGroup({
      groups: [
        makeGroup(),
        makeGroup({
          id: 'GC.2',
          title: 'Kontext',
          controls: [
            makeControl({ id: 'GC.2.1', title: 'Control 2.1' }),
            makeControl({ id: 'GC.2.2', title: 'Control 2.2' }),
          ],
        }),
      ],
    });
    const { practice, controls } = parsePractice(multi);
    expect(practice.controlCount).toBe(3);
    expect(controls).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */
/*  parseMetadata Tests                                                */
/* ------------------------------------------------------------------ */

describe('parseMetadata', () => {
  it('parses all metadata fields', () => {
    const catalog = makeCatalog().catalog;
    const meta = parseMetadata(catalog);
    expect(meta.title).toBe('Anwenderkatalog Grundschutz++');
    expect(meta.lastModified).toBe('2026-03-05T08:08:21Z');
    expect(meta.version).toBe('2026-03-05');
    expect(meta.oscalVersion).toBe('1.1.3');
    expect(meta.remarks).toBe('Test remarks');
    expect(meta.publisherName).toBe('BSI');
    expect(meta.publisherEmail).toBe('test@bsi.bund.de');
    expect(meta.props).toEqual([
      {
        name: 'resolution-tool',
        value: 'Grundschutz++ Navigator',
        ns: 'https://example.com/namespaces/tool',
      },
      {
        name: 'keywords',
        value: 'BSI, Grundschutz++',
        ns: undefined,
      },
    ]);
    expect(meta.links).toEqual([
      {
        href: '#resource-uuid',
        rel: 'reference',
        text: 'BSI IT-Grundschutz Edition 2023',
      },
    ]);
    expect(meta.roles).toEqual([{ id: 'creator', title: 'Ersteller' }]);
    expect(meta.parties).toEqual([
      {
        uuid: 'party-uuid',
        type: 'organization',
        name: 'BSI',
        email: 'test@bsi.bund.de',
      },
    ]);
    expect(meta.responsibleParties).toEqual([
      {
        roleId: 'creator',
        partyUuids: ['party-uuid'],
      },
    ]);
  });

  it('handles missing parties', () => {
    const catalog: RawOscalCatalog = {
      uuid: 'test',
      metadata: {
        title: 'Test',
        'last-modified': '2026-01-01',
        version: '1.0',
        'oscal-version': '1.1.3',
      },
      groups: [],
    };
    const meta = parseMetadata(catalog);
    expect(meta.publisherName).toBeUndefined();
    expect(meta.publisherEmail).toBeUndefined();
    expect(meta.props).toEqual([]);
    expect(meta.links).toEqual([]);
    expect(meta.roles).toEqual([]);
    expect(meta.parties).toEqual([]);
    expect(meta.responsibleParties).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  parseCatalog Integration Tests                                     */
/* ------------------------------------------------------------------ */

describe('parseCatalog', () => {
  it('parses a complete catalog document', () => {
    const catalog = parseCatalog(makeCatalog());
    expect(catalog.uuid).toBe('test-uuid-1234');
    expect(catalog.metadata.title).toBe('Anwenderkatalog Grundschutz++');
    expect(catalog.practices).toHaveLength(1);
    expect(catalog.totalControls).toBe(1);
    expect(catalog.backMatter).toEqual([
      {
        uuid: 'resource-uuid',
        title: 'BSI IT-Grundschutz Edition 2023',
        rlinks: [
          {
            href: 'https://example.com/grundschutz-edition-2023.pdf',
            hashes: [{ algorithm: 'sha-256', value: 'abc123' }],
          },
        ],
      },
    ]);
  });

  it('builds controlsById map', () => {
    const catalog = parseCatalog(makeCatalog());
    expect(catalog.controlsById.has('GC.1.1')).toBe(true);
    expect(catalog.controlsById.get('GC.1.1')?.title).toBe(
      'Errichtung und Aufrechterhaltung eines ISMS',
    );
  });

  it('controls array matches controlsById size', () => {
    const catalog = parseCatalog(makeCatalog());
    expect(catalog.controls.length).toBe(catalog.controlsById.size);
  });

  it('accepts unwrapped catalog (without { catalog: ... })', () => {
    const catalog = parseCatalog(makeCatalog().catalog);
    expect(catalog.uuid).toBe('test-uuid-1234');
  });

  it('returns empty backMatter when the source catalog has none', () => {
    const doc = makeCatalog();
    delete doc.catalog['back-matter'];
    const catalog = parseCatalog(doc);
    expect(catalog.backMatter).toEqual([]);
  });

  it('throws on invalid input', () => {
    expect(() => parseCatalog({})).toThrow('Invalid OSCAL catalog');
    expect(() => parseCatalog({ uuid: 'x' })).toThrow('Invalid OSCAL catalog');
    expect(() => parseCatalog(null)).toThrow();
  });

  it('handles catalog with multiple practices', () => {
    const doc = makeCatalog();
    doc.catalog.groups = [
      makePracticeGroup(),
      makePracticeGroup({
        id: 'STM',
        title: 'Strukturmodellierung',
        props: [{ name: 'label', value: 'STM' }],
        groups: [
          makeGroup({
            id: 'STM.1',
            title: 'Definition',
            controls: [
              makeControl({ id: 'STM.1.1', title: 'Informationsverbund' }),
              makeControl({ id: 'STM.1.2', title: 'Anforderungspaket' }),
            ],
          }),
        ],
      }),
    ];
    const catalog = parseCatalog(doc);
    expect(catalog.practices).toHaveLength(2);
    expect(catalog.totalControls).toBe(3);
    expect(catalog.controlsById.has('STM.1.1')).toBe(true);
    expect(catalog.controlsById.has('STM.1.2')).toBe(true);
  });
});
