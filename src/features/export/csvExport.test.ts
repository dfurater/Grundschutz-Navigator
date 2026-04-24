import { describe, it, expect } from 'vitest';
import {
  escapeCSVField,
  controlToCSVRow,
  controlsToCSV,
} from './csvExport';
import type { Control } from '@/domain/models';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    altIdentifier: 'uuid-1',
    groupId: 'GC.1',
    practiceId: 'GC',
    securityLevel: 'normal-SdT',
    securityLevelProp: {
      name: 'sec_level',
      value: 'normal-SdT',
      ns: 'https://example.com/namespaces/security_level.csv',
    },
    effortLevel: '3',
    effortLevelProp: {
      name: 'effort_level',
      value: '3',
      ns: 'https://example.com/namespaces/effort_level.csv',
    },
    modalverb: 'MUSS',
    modalverbProp: {
      name: 'modal_verb',
      value: 'MUSS',
      ns: 'https://example.com/namespaces/modal_verbs.csv',
    },
    tags: ['BCM', 'Compliance Management'],
    tagsProp: {
      name: 'tags',
      value: 'BCM, Compliance Management',
      ns: 'https://example.com/namespaces/tags.csv',
    },
    statement: 'MUSS Verfahren verankern.',
    statementRaw: 'MUSS Verfahren nach {{ insert: param, gc.1.1-prm1 }} verankern.',
    guidance: 'Ein ISMS besteht aus Verfahren.',
    statementProps: {
      ergebnis: 'Verfahren und Regelungen',
      ergebnisProp: {
        name: 'result',
        value: 'Verfahren und Regelungen',
        ns: 'https://example.com/namespaces/result.csv',
      },
      praezisierung: 'nach einem Standard',
      praezisierungProp: {
        name: 'result_specification',
        value: 'nach einem Standard',
        ns: 'https://example.com/namespaces/result.csv',
      },
      handlungsworte: 'verankern',
      handlungsworteProp: {
        name: 'action_word',
        value: 'verankern',
        ns: 'https://example.com/namespaces/action_words.csv',
      },
      dokumentation: 'Sicherheitsleitlinie',
      dokumentationProp: {
        name: 'documentation',
        value: 'Sicherheitsleitlinie',
        ns: 'https://example.com/namespaces/documentation_guidelines.csv',
      },
      zielobjektKategorien: ['Server', 'Client'],
      zielobjektKategorienProp: {
        name: 'target_object_categories',
        value: 'Server, Client',
        ns: 'https://example.com/namespaces/target_object_categories.csv',
      },
    },
    links: [
      { targetId: 'GC.2.2', relation: 'related' },
      { targetId: 'GC.3.1', relation: 'required' },
    ],
    params: { 'gc.1.1-prm1': 'BSI Grundschutz++' },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  escapeCSVField                                                     */
/* ------------------------------------------------------------------ */

describe('escapeCSVField', () => {
  it('returns plain text unchanged', () => {
    expect(escapeCSVField('Hello World')).toBe('Hello World');
  });

  it('wraps values containing semicolons in quotes', () => {
    expect(escapeCSVField('a;b')).toBe('"a;b"');
  });

  it('wraps values containing newlines in quotes', () => {
    expect(escapeCSVField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('escapes internal double quotes by doubling', () => {
    expect(escapeCSVField('say "hello"')).toBe('"say ""hello"""');
  });

  it('handles combined special characters', () => {
    expect(escapeCSVField('a;b"c\nd')).toBe('"a;b""c\nd"');
  });

  it('handles empty strings', () => {
    expect(escapeCSVField('')).toBe('');
  });

  it('handles carriage returns', () => {
    expect(escapeCSVField('line1\rline2')).toBe('"line1\rline2"');
  });
});

/* ------------------------------------------------------------------ */
/*  controlToCSVRow                                                    */
/* ------------------------------------------------------------------ */

describe('controlToCSVRow', () => {
  it('produces semicolon-delimited row with 19 fields', () => {
    const row = controlToCSVRow(makeControl());
    const fields = row.split(';');
    expect(fields.length).toBe(19);
  });

  it('aligns row fields with the logical export order', () => {
    const row = controlToCSVRow(makeControl({ parentId: 'GC.1' }));
    expect(row.split(';')).toEqual([
      'GC.1.1',
      'GC.1',
      'GC',
      'GC.1',
      'Errichtung und Aufrechterhaltung eines ISMS',
      'MUSS Verfahren verankern.',
      'Ein ISMS besteht aus Verfahren.',
      'MUSS',
      'normal-SdT',
      '3',
      'BCM, Compliance Management',
      'Server, Client',
      'Verfahren und Regelungen',
      'nach einem Standard',
      'verankern',
      'Sicherheitsleitlinie',
      'GC.2.2 (related), GC.3.1 (required)',
      'GC.3.1',
      'GC.2.2',
    ]);
  });

  it('includes control ID as first field', () => {
    const row = controlToCSVRow(makeControl());
    expect(row.startsWith('GC.1.1;')).toBe(true);
  });

  it('includes modalverb', () => {
    const row = controlToCSVRow(makeControl());
    expect(row).toContain('MUSS');
  });

  it('includes tags joined by comma', () => {
    const row = controlToCSVRow(makeControl());
    expect(row).toContain('BCM, Compliance Management');
  });

  it('handles missing optional fields', () => {
    const control = makeControl({
      securityLevel: undefined,
      effortLevel: undefined,
      modalverb: undefined,
      tags: [],
      links: [],
      statementProps: { zielobjektKategorien: [] },
    });
    const row = controlToCSVRow(control);
    // Should not throw, empty fields represented as empty strings
    expect(row).toContain('GC.1.1');
  });

  it('includes linked controls', () => {
    const row = controlToCSVRow(makeControl());
    expect(row).toContain('GC.2.2 (related)');
    expect(row).toContain('GC.3.1 (required)');
  });

  it('includes relation-specific link columns', () => {
    const row = controlToCSVRow(makeControl());
    expect(row).toContain('GC.3.1');
    expect(row).toContain('GC.2.2');
  });

  it('includes parent control id when present', () => {
    const row = controlToCSVRow(makeControl({ parentId: 'GC.1' }));
    expect(row.startsWith('GC.1.1;GC.1;')).toBe(true);
  });

  it('does not include namespace URLs for controlled vocabularies', () => {
    const row = controlToCSVRow(makeControl());
    expect(row).not.toContain('https://example.com/namespaces/modal_verbs.csv');
    expect(row).not.toContain('https://example.com/namespaces/security_level.csv');
    expect(row).not.toContain('https://example.com/namespaces/documentation_guidelines.csv');
    expect(row).not.toContain('https://example.com/namespaces/action_words.csv');
  });
});

/* ------------------------------------------------------------------ */
/*  controlsToCSV                                                      */
/* ------------------------------------------------------------------ */

describe('controlsToCSV', () => {
  it('produces header + data rows', () => {
    const csv = controlsToCSV([makeControl()]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 data row
  });

  it('header contains expected column names', () => {
    const csv = controlsToCSV([]);
    const header = csv.split('\n')[0];
    expect(header).toContain('ID');
    expect(header).toContain('parent_id');
    expect(header).toContain('Praktik');
    expect(header).toContain('Thema');
    expect(header).toContain('Titel');
    expect(header).toContain('statement');
    expect(header).toContain('guidance');
    expect(header).toContain('modal_verb');
    expect(header).toContain('sec_level');
    expect(header).toContain('effort_level');
    expect(header).toContain('tags');
    expect(header).toContain('target_object_categories');
    expect(header).toContain('result');
    expect(header).toContain('result_specification');
    expect(header).toContain('action_word');
    expect(header).toContain('documentation');
    expect(header).toContain('required_links');
    expect(header).toContain('related_links');
  });

  it('uses the expected logical header order', () => {
    const csv = controlsToCSV([]);
    const header = csv.split('\n')[0];
    expect(header.split(';')).toEqual([
      'ID',
      'parent_id',
      'Praktik',
      'Thema',
      'Titel',
      'statement',
      'guidance',
      'modal_verb',
      'sec_level',
      'effort_level',
      'tags',
      'target_object_categories',
      'result',
      'result_specification',
      'action_word',
      'documentation',
      'links',
      'required_links',
      'related_links',
    ]);
  });

  it('header omits namespace columns', () => {
    const csv = controlsToCSV([]);
    const header = csv.split('\n')[0];
    expect(header).not.toContain('modal_verb_ns');
    expect(header).not.toContain('sec_level_ns');
    expect(header).not.toContain('effort_level_ns');
    expect(header).not.toContain('tags_ns');
    expect(header).not.toContain('documentation_ns');
    expect(header).not.toContain('target_object_categories_ns');
    expect(header).not.toContain('result_ns');
    expect(header).not.toContain('result_specification_ns');
    expect(header).not.toContain('action_word_ns');
  });

  it('uses semicolon as delimiter', () => {
    const csv = controlsToCSV([]);
    const header = csv.split('\n')[0];
    expect(header.split(';').length).toBe(19);
  });

  it('handles multiple controls', () => {
    const controls = [
      makeControl({ id: 'GC.1.1' }),
      makeControl({ id: 'GC.1.2', title: 'Zweite Kontrolle' }),
    ];
    const csv = controlsToCSV(controls);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 data
    expect(lines[1]).toContain('GC.1.1');
    expect(lines[2]).toContain('GC.1.2');
  });

  it('handles empty controls array', () => {
    const csv = controlsToCSV([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1); // header only
  });

  it('properly escapes German text with special characters', () => {
    const control = makeControl({
      title: 'Prüfung; Bewertung und "Analyse"',
      guidance: 'Zeile 1\nZeile 2',
    });
    const csv = controlsToCSV([control]);
    // Should contain escaped content
    expect(csv).toContain('"Prüfung; Bewertung und ""Analyse"""');
    expect(csv).toContain('"Zeile 1\nZeile 2"');
  });
});
