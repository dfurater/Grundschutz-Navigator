import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  escapeCSVField,
  controlToCSVRow,
  controlsToCSV,
  downloadCSV,
} from './csvExport';
import type { Control } from '@/domain/models';
import { downloadBlob } from '@/adapters/browserDownload';

vi.mock('@/adapters/browserDownload', () => ({
  downloadBlob: vi.fn(),
}));

const mockedDownloadBlob = vi.mocked(downloadBlob);

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
    confidentiality: '2',
    confidentialityProp: {
      name: 'confidentiality',
      value: '2',
      ns: 'https://example.com/namespaces/security_targets.csv',
    },
    integrity: '1',
    integrityProp: {
      name: 'integrity',
      value: '1',
      ns: 'https://example.com/namespaces/security_targets.csv',
    },
    availability: '1',
    availabilityProp: {
      name: 'availability',
      value: '1',
      ns: 'https://example.com/namespaces/security_targets.csv',
    },
    authenticity: '0',
    authenticityProp: {
      name: 'authenticity',
      value: '0',
      ns: 'https://example.com/namespaces/security_targets.csv',
    },
    threats: ['G 0.18', 'G 0.19'],
    threatsProp: {
      name: 'threats',
      value: 'G 0.18, G 0.19',
      ns: 'https://example.com/namespaces/basethreats.csv',
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
      { targetId: 'GC.2.2', href: '#GC.2.2', rel: 'related', relStatus: 'custom' },
      { targetId: 'GC.3.1', href: '#GC.3.1', rel: 'required', relStatus: 'custom' },
    ],
    params: { 'gc.1.1-prm1': 'BSI Grundschutz++' },
    ...overrides,
  };
}

function parseSemicolonCSV(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ';') {
      row.push(field);
      field = '';
    } else if (char === '\r' && next === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
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

  it.each([
    ['equals sign', '=cmd|calc!A0', "'=cmd|calc!A0"],
    ['plus sign', '+1+1', "'+1+1"],
    ['minus sign', '-2', "'-2"],
    ['at sign', '@DDE()', "'@DDE()"],
    ['tab', '\tIDS', "'\tIDS"],
    ['carriage return', '\r\nFOO', '"\'\r\nFOO"'],
    ['line feed', '\n=HYPERLINK("https://example.invalid")', '"\'\n=HYPERLINK(""https://example.invalid"")"'],
  ])('prefixes formula-looking values starting with %s', (_label, input, expected) => {
    expect(escapeCSVField(input)).toBe(expected);
  });

  it.each(['MUSS', 'ARCH.1.1'])('keeps harmless value %s unchanged', (value) => {
    expect(escapeCSVField(value)).toBe(value);
  });

  it('protects and quotes formula-looking values containing semicolons', () => {
    expect(escapeCSVField('=SUM(1;2)')).toBe('"\'=SUM(1;2)"');
  });
});

/* ------------------------------------------------------------------ */
/*  controlToCSVRow                                                    */
/* ------------------------------------------------------------------ */

describe('controlToCSVRow', () => {
  it('produces semicolon-delimited row with 25 fields', () => {
    const row = controlToCSVRow(makeControl());
    const fields = row.split(';');
    expect(fields.length).toBe(25);
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
      '2',
      '1',
      '1',
      '0',
      'G 0.18, G 0.19',
      'uuid-1',
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
      confidentiality: undefined,
      integrity: undefined,
      availability: undefined,
      authenticity: undefined,
      threats: [],
      links: [],
      statementProps: { zielobjektKategorien: [] },
    });
    const fields = parseSemicolonCSV(`${controlToCSVRow(control)}\r\n`)[0];

    expect(fields).toHaveLength(25);
    expect(fields.slice(-6)).toEqual(['', '', '', '', '', 'uuid-1']);
  });

  it('escapes the joined threat list as a single CSV field', () => {
    const row = controlToCSVRow(
      makeControl({ threats: ['G 0.18', 'G 0.19; "Kommentar"'] }),
    );
    const fields = parseSemicolonCSV(`${row}\r\n`)[0];

    expect(row).toContain('"G 0.18, G 0.19; ""Kommentar"""');
    expect(fields).toHaveLength(25);
    expect(fields.at(-2)).toBe('G 0.18, G 0.19; "Kommentar"');
  });

  it('appends an existing alt-identifier unchanged', () => {
    const fields = parseSemicolonCSV(`${controlToCSVRow(makeControl())}\r\n`)[0];

    expect(fields.at(-1)).toBe('uuid-1');
  });

  it('exports a missing alt-identifier as an empty field without fallback', () => {
    const fields = parseSemicolonCSV(`${controlToCSVRow(
      makeControl({ altIdentifier: undefined }),
    )}\r\n`)[0];

    expect(fields).toHaveLength(25);
    expect(fields.at(-1)).toBe('');
    expect(fields.at(-1)).not.toBe('GC.1.1');
  });

  it('escapes an alt-identifier as a single CSV field', () => {
    const altIdentifier = 'uuid; "mit Anführungszeichen"\nzweite Zeile';
    const row = controlToCSVRow(makeControl({ altIdentifier }));
    const fields = parseSemicolonCSV(`${row}\r\n`)[0];

    expect(row).toContain('"uuid; ""mit Anführungszeichen""\nzweite Zeile"');
    expect(fields).toHaveLength(25);
    expect(fields.at(-1)).toBe(altIdentifier);
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
    expect(row).not.toContain('https://example.com/namespaces/security_targets.csv');
    expect(row).not.toContain('https://example.com/namespaces/basethreats.csv');
  });
});

/* ------------------------------------------------------------------ */
/*  controlsToCSV                                                      */
/* ------------------------------------------------------------------ */

describe('controlsToCSV', () => {
  it('produces header + data rows', () => {
    const csv = controlsToCSV([makeControl()]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(2); // header + 1 data row
  });

  it('header contains expected column names', () => {
    const csv = controlsToCSV([]);
    const header = csv.split('\r\n')[0];
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
    expect(header).toContain('confidentiality');
    expect(header).toContain('integrity');
    expect(header).toContain('availability');
    expect(header).toContain('authenticity');
    expect(header).toContain('threats');
    expect(header).toContain('control_alt_identifier');
  });

  it('uses the expected logical header order', () => {
    const csv = controlsToCSV([]);
    const header = csv.split('\r\n')[0];
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
      'confidentiality',
      'integrity',
      'availability',
      'authenticity',
      'threats',
      'control_alt_identifier',
    ]);
  });

  it('does not add provenance or matching columns', () => {
    const header = controlsToCSV([]).split('\r\n')[0];

    expect(header).not.toContain('snapshot_commit_sha');
    expect(header).not.toContain('catalog_uuid');
    expect(header).not.toContain('catalog_version');
    expect(header).not.toContain('catalog_key');
  });

  it('header omits namespace columns', () => {
    const csv = controlsToCSV([]);
    const header = csv.split('\r\n')[0];
    expect(header).not.toContain('modal_verb_ns');
    expect(header).not.toContain('sec_level_ns');
    expect(header).not.toContain('effort_level_ns');
    expect(header).not.toContain('tags_ns');
    expect(header).not.toContain('documentation_ns');
    expect(header).not.toContain('target_object_categories_ns');
    expect(header).not.toContain('result_ns');
    expect(header).not.toContain('result_specification_ns');
    expect(header).not.toContain('action_word_ns');
    expect(header).not.toContain('confidentiality_ns');
    expect(header).not.toContain('integrity_ns');
    expect(header).not.toContain('availability_ns');
    expect(header).not.toContain('authenticity_ns');
    expect(header).not.toContain('threats_ns');
  });

  it('uses semicolon as delimiter', () => {
    const csv = controlsToCSV([]);
    const header = csv.split('\r\n')[0];
    expect(header.split(';').length).toBe(25);
  });

  it('uses CRLF row separators and terminates with a final CRLF', () => {
    const csv = controlsToCSV([
      makeControl({ id: 'GC.1.1' }),
      makeControl({ id: 'GC.1.2' }),
    ]);

    expect(csv).toContain('\r\n');
    expect(csv).not.toMatch(/(?<!\r)\n/u);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(4); // header + 2 rows + final empty segment
  });

  it('handles multiple controls', () => {
    const controls = [
      makeControl({ id: 'GC.1.1' }),
      makeControl({ id: 'GC.1.2', title: 'Zweite Kontrolle' }),
    ];
    const csv = controlsToCSV(controls);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 data
    expect(lines[1]).toContain('GC.1.1');
    expect(lines[2]).toContain('GC.1.2');
  });

  it('handles empty controls array', () => {
    const csv = controlsToCSV([]);
    const lines = csv.trimEnd().split('\r\n');
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

  it('round-trips escaped cells without changing their values', () => {
    const control = makeControl({
      parentId: 'GC.1',
      title: 'Prüfung; Bewertung und "Analyse"',
      guidance: 'Zeile 1\nZeile 2',
      statement: '=MUSS erhalten bleiben',
    });

    const rows = parseSemicolonCSV(controlsToCSV([control]));

    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([
      'GC.1.1',
      'GC.1',
      'GC',
      'GC.1',
      'Prüfung; Bewertung und "Analyse"',
      "'=MUSS erhalten bleiben",
      'Zeile 1\nZeile 2',
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
      '2',
      '1',
      '1',
      '0',
      'G 0.18, G 0.19',
      'uuid-1',
    ]);
  });
});

describe('downloadCSV', () => {
  beforeEach(() => {
    mockedDownloadBlob.mockReset();
  });

  it('delegates the generated UTF-8 CSV blob to the browser adapter', async () => {
    const control = makeControl();

    downloadCSV([control], 'grundschutz-auswahl.csv');

    expect(mockedDownloadBlob).toHaveBeenCalledOnce();
    const [blob, filename] = mockedDownloadBlob.mock.calls[0];
    expect(filename).toBe('grundschutz-auswahl.csv');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe(controlsToCSV([control]));
  });
});
