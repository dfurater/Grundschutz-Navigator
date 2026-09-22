import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { parseClass2OscalInput } from './oscalImportProcessing';

function parseText(text: string) {
  return parseClass2OscalInput(new TextEncoder().encode(text));
}

const MALFORMED = {
  ok: false,
  diagnostic: { code: 'OSCAL_JSON_MALFORMED', stage: 'json-syntax', path: '/' },
} as const;

// Der Duplicate-Member-Scanner ist modulprivat; seine Grammatik wird über den
// Byte-Eintrittspunkt geprüft. Maßstab ist JSON (RFC 8259): Was der Scanner
// annimmt, liest JSON.parse entweder identisch oder weist es ab — sonst hätte
// die Duplicate-Prüfung einen anderen Baum gesehen als den, der registriert wird.
describe('DuplicateMemberScanner über parseClass2OscalInput', () => {
  let jsonParse: MockInstance<typeof JSON.parse>;

  beforeEach(() => {
    jsonParse = vi.spyOn(JSON, 'parse');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('String-Escapes', () => {
    // [Escape im Quelltext, dekodiertes Zeichen]
    const ESCAPES = [
      ['\\"', '"'],
      ['\\\\', '\\'],
      ['\\/', '/'],
      ['\\b', '\b'],
      ['\\f', '\f'],
      ['\\n', '\n'],
      ['\\r', '\r'],
      ['\\t', '\t'],
      ['\\u00e4', 'ä'],
    ] as const;

    it.each(ESCAPES)('akzeptiert das Escape %s und dekodiert es wie JSON.parse', (escape, decoded) => {
      const result = parseText(`{"x${escape}y":1}`);

      expect(result).toEqual({ ok: true, source: { [`x${decoded}y`]: 1 } });
    });

    it.each(ESCAPES)('erkennt das Escape %s und seine \\u-Schreibweise als denselben Member', (escape, decoded) => {
      const unicode = `\\u${decoded.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

      const result = parseText(`{"x${escape}y":1,"x${unicode}y":2}`);

      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: 'OSCAL_JSON_DUPLICATE_MEMBER', stage: 'json-syntax', path: '/' },
      });
      expect(jsonParse).not.toHaveBeenCalled();
    });

    it('setzt ein Surrogatpaar aus zwei \\u-Escapes zum selben Member zusammen wie das Literal', () => {
      const result = parseText('{"\u{1F512}":1,"\\uD83D\\uDD12":2}');

      expect(result).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_JSON_DUPLICATE_MEMBER' } });
      expect(jsonParse).not.toHaveBeenCalled();
    });

    it.each([
      ['ein unbekanntes Escape-Zeichen', String.raw`["\x41"]`],
      ['ein Apostroph-Escape', String.raw`["\'"]`],
      ['ein \\u mit weniger als vier Zeichen vor dem String-Ende', String.raw`["\u12"]`],
      ['ein \\u mit Nicht-Hex-Ziffer', String.raw`["\u12G4"]`],
      ['ein \\u am Textende', String.raw`["\u`],
      ['einen Backslash am Textende', '["\\'],
      ['ein ungültiges Escape im Membernamen', String.raw`{"\q":1}`],
    ])('weist %s vor JSON.parse ab', (_description, text) => {
      expect(parseText(text)).toMatchObject(MALFORMED);
      expect(jsonParse).not.toHaveBeenCalled();
    });

    it.each([
      ['ein rohes Steuerzeichen', '["a\u0001b"]'],
      ['einen rohen Tabulator', '["a\tb"]'],
      ['einen rohen Zeilenumbruch', '["a\nb"]'],
      ['einen nicht geschlossenen String', '["abc'],
    ])('weist %s in einem String vor JSON.parse ab', (_description, text) => {
      expect(parseText(text)).toMatchObject(MALFORMED);
      expect(jsonParse).not.toHaveBeenCalled();
    });
  });

  describe('Zahlen', () => {
    it.each([
      '0',
      '-0',
      '7',
      '-12',
      '1234567890',
      '0.25',
      '-1.5',
      '1e5',
      '1E5',
      '1e+5',
      '1E-5',
      '-0.5e-10',
      '10.01E+2',
    ])('akzeptiert %s mit demselben Wert wie JSON.parse', (number) => {
      const expected: unknown = JSON.parse(number);
      jsonParse.mockClear();

      const result = parseText(`[${number}]`);

      expect(result).toEqual({ ok: true, source: [expected] });
    });

    it.each([
      ['eine führende Null', '01'],
      ['eine doppelte Null', '00'],
      ['eine negative Zahl mit führender Null', '-01'],
      ['ein einzelnes Minus', '-'],
      ['ein Minus ohne Ziffer', '-a'],
      ['ein Pluszeichen', '+1'],
      ['einen Bruch ohne Ganzzahlanteil', '.5'],
      ['einen Bruch ohne Nachkommaziffer', '1.'],
      ['einen Bruch mit direktem Exponenten', '1.e5'],
      ['einen Exponenten ohne Ziffer', '1e'],
      ['einen Exponenten mit Pluszeichen ohne Ziffer', '1e+'],
      ['einen Exponenten mit Minuszeichen ohne Ziffer', '1E-x'],
      ['einen doppelten Exponenten', '1e5e5'],
    ])('weist %s vor JSON.parse ab', (_description, number) => {
      expect(parseText(`[${number}]`)).toMatchObject(MALFORMED);
      expect(parseText(number)).toMatchObject(MALFORMED);
      expect(jsonParse).not.toHaveBeenCalled();
    });
  });

  describe('Literale und Struktur', () => {
    it('akzeptiert true, false und null', () => {
      expect(parseText('[true,false,null]')).toEqual({ ok: true, source: [true, false, null] });
    });

    it.each([
      ['ein abgeschnittenes true', '[tru]'],
      ['ein abgeschnittenes false', '[fals]'],
      ['ein abgeschnittenes null', '[nul]'],
      ['ein unbekanntes Token', '[x]'],
      ['leeren Text', ''],
      ['Text nach dem Wurzelwert', '{}x'],
      ['einen zweiten Wurzelwert', '{}{}'],
      ['einen Membernamen ohne Anführungszeichen', '{a:1}'],
      ['einen Membernamen als Zahl', '{1:1}'],
      ['einen Member ohne Doppelpunkt', '{"a" 1}'],
      ['Member ohne Komma', '{"a":1 "b":2}'],
      ['ein nach dem Komma abgeschnittenes Objekt', '{"a":1,'],
      ['ein Objekt mit abschließendem Komma', '{"a":1,}'],
      ['einen ungültigen Stringwert', String.raw`{"a":"\q"}`],
      ['Array-Elemente ohne Komma', '[1 2]'],
      ['ein nach dem Komma abgeschnittenes Array', '[1,'],
      ['ein Array mit abschließendem Komma', '[1,]'],
    ])('weist %s vor JSON.parse ab', (_description, text) => {
      expect(parseText(text)).toMatchObject(MALFORMED);
      expect(jsonParse).not.toHaveBeenCalled();
    });

    it('akzeptiert JSON-Leerraum zwischen allen Token', () => {
      const text = ' \t\n\r{ "a" : [ 1 , 2 ] ,\r\n\t"b" : { } , "c" : [ ] } \n';

      expect(parseText(text)).toEqual({ ok: true, source: { a: [1, 2], b: {}, c: [] } });
    });

    it('meldet den Pfad eines verschachtelten Duplikats über den Containerindex', () => {
      const result = parseText('{"a":[{"x":1},{"y":1,"y":2}]}');

      expect(result).toMatchObject({
        ok: false,
        diagnostic: { code: 'OSCAL_JSON_DUPLICATE_MEMBER', path: '/object/0/array/1' },
      });
      expect(jsonParse).not.toHaveBeenCalled();
    });
  });

  describe('Rückfallpfad nach bestandenem Scan', () => {
    // Der Scanner überspringt Leerraum per `\s` und damit mehr als JSON, das
    // nur Leerzeichen, Tabulator, LF und CR kennt. Diese Eingaben erreichen
    // deshalb heute JSON.parse und dessen catch-Zweig. Festgehalten wird nur
    // die Invariante, nicht der Weg: Die Abweichung bleibt fail-closed, mit
    // derselben redigierten Syntaxdiagnose — ein Scanner, der auf
    // JSON-Leerraum verschärft wird, besteht diese Tests ebenso.
    const secret = 'NUR-IN-TEST-FIXTURE';

    it.each([
      ['ein geschütztes Leerzeichen', `["${secret}",\u00a01]`],
      ['einen vertikalen Tabulator', `\u000b{"a":"${secret}"}`],
      ['einen Seitenvorschub', `{"a":"${secret}"}\f`],
      ['einen Zeilentrenner', `["${secret}"\u2028]`],
    ])('weist %s als Leerraum außerhalb eines Strings redigiert ab', (_description, text) => {
      const result = parseText(text);

      expect(result).toMatchObject(MALFORMED);
      expect(JSON.stringify(result)).not.toContain(secret);
    });
  });
});
