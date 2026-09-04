import { describe, expect, it } from 'vitest';
import type { QueryKind } from './identifierQuery';
import { classifyQuery, isIdentifierQuery } from './identifierQuery';

describe('isIdentifierQuery', () => {
  it('accepts UUID v4 and v5 in any case', () => {
    expect(isIdentifierQuery('9bb16672-4394-4ce9-bd14-12a080233f7a')).toBe(true);
    expect(isIdentifierQuery('9BB16672-4394-4CE9-BD14-12A080233F7A')).toBe(true);
    // v5: Versionsziffer 5, Variante 'a'
    expect(isIdentifierQuery('21f7f8de-8051-5b89-8680-0195ef798b6a')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(isIdentifierQuery('  9bb16672-4394-4ce9-bd14-12a080233f7a  ')).toBe(true);
  });

  it('rejects anything the pinned OSCAL 1.1.3 UUIDDatatype rejects', () => {
    // Unvollständig: letztes Segment zu kurz
    expect(isIdentifierQuery('9bb16672-4394-4ce9-bd14-12a080233f7')).toBe(false);
    // Präfix einer gültigen Kennung
    expect(isIdentifierQuery('9bb16672-4394')).toBe(false);
    // Version 3 statt 4/5
    expect(isIdentifierQuery('9bb16672-4394-3ce9-bd14-12a080233f7a')).toBe(false);
    // Variante 'c' statt 8/9/a/b
    expect(isIdentifierQuery('9bb16672-4394-4ce9-cd14-12a080233f7a')).toBe(false);
    // Nicht-Hex-Zeichen
    expect(isIdentifierQuery('9bb16672-4394-4ce9-bd14-12a080233g7a')).toBe(false);
    // Ohne Bindestriche
    expect(isIdentifierQuery('9bb1667243944ce9bd1412a080233f7a')).toBe(false);
    // Gültige Kennung mit Zusatztext
    expect(isIdentifierQuery('uuid 9bb16672-4394-4ce9-bd14-12a080233f7a')).toBe(false);
    expect(isIdentifierQuery('')).toBe(false);
  });
});

describe('classifyQuery', () => {
  // Tabellengetrieben, damit jeder Fall seine Begründung trägt und die
  // Aufzählung nicht zu wiederholten Assertion-Zeilen wird.
  const cases: ReadonlyArray<[string, QueryKind, string]> = [
    ['9bb16672-4394-4ce9-bd14-12a080233f7a', 'identifier', 'wohlgeformte Kennung'],

    // Vollständiges Raster mit einem ungültigen Zeichen — je Segment einmal,
    // damit die Formerkennung nicht nur am Kopfblock hängt.
    ['9bb1667g-4394-4ce9-bd14-12a080233f7a', 'malformed-identifier', 'Fremdzeichen im 1. Segment'],
    ['9bb16672-43g4-4ce9-bd14-12a080233f7a', 'malformed-identifier', 'Fremdzeichen im 2. Segment'],
    ['9bb16672-4394-4cg9-bd14-12a080233f7a', 'malformed-identifier', 'Fremdzeichen im 3. Segment'],
    ['9bb16672-4394-4ce9-bg14-12a080233f7a', 'malformed-identifier', 'Fremdzeichen im 4. Segment'],
    ['9bb16672-4394-4ce9-bd14-12a080233g7a', 'malformed-identifier', 'Fremdzeichen im 5. Segment'],

    // Ersatzzeichen außerhalb des Alphanumerischen — dieselbe Fehlerklasse,
    // nur mit anderem Zeichen. Die Einordnung darf nicht am Zeichenvorrat
    // hängen, sonst bleibt bei jeder Erweiterung eine Lücke.
    ['9bb16672-4394-4ce9-bd14-12a080233_7a', 'malformed-identifier', 'Unterstrich im letzten Segment'],
    ['9bb16672-4394-4ce9-bd14-12a080233.7a', 'malformed-identifier', 'Punkt im letzten Segment'],
    ['9bb16672-4394-4ce9-bd14-12a080233ü7a', 'malformed-identifier', 'Umlaut im letzten Segment'],
    ['9bb16672-43_4-4ce9-bd14-12a080233f7a', 'malformed-identifier', 'Unterstrich im zweiten Segment'],
    ['9bb1667_-4394-4ce9-bd14-12a080233f7a', 'malformed-identifier', 'Unterstrich im Kopfblock'],
    ['9bb1667ü-4394-4ce9-bd14-12a080233f7a', 'malformed-identifier', 'Umlaut im Kopfblock'],
    ['9bb16672-4394-4ce9-bd14-12a0802✓37a', 'malformed-identifier', 'Nicht-ASCII-Symbol'],

    // Abgeschnitten: als Kennung gemeint, aber unvollständig.
    ['9bb16672-4394-4ce9-bd14-12a080233f7', 'malformed-identifier', 'letztes Segment angebrochen'],
    ['9bb16672-4394', 'malformed-identifier', 'nach dem zweiten Segment abgeschnitten'],
    ['9bb16672-', 'malformed-identifier', 'nur der Kopfblock'],
    ['9bb16672-4394-4cg9', 'malformed-identifier', 'Fragment mit Fremdzeichen'],

    // Vollständig, aber außerhalb des gepinnten v4/v5-Vertrags.
    ['9bb16672-4394-3ce9-bd14-12a080233f7a', 'malformed-identifier', 'Version 3 statt 4/5'],
    ['9bb16672-4394-4ce9-cd14-12a080233f7a', 'malformed-identifier', 'unzulässige Variante'],

    // Verrutschte Segmente hinter einem gültigen Kopfblock: immer noch eine
    // Kennung, nur eine kaputte.
    ['9bb16672-43945-4ce9-bd14-12a080233f7a', 'malformed-identifier', 'zweites Segment zu lang'],
    ['9bb16672-4394-4ce9-bd14-12a080233f7a-extra', 'malformed-identifier', 'ein Segment zu viel'],
    ['9bb16672-4394-4ce9-bd14-12a080233f7ab', 'malformed-identifier', 'letztes Segment zu lang'],
    ['9bb16672-4394-4ce9-12a080233f7a', 'malformed-identifier', 'ein Segment zu wenig'],

    // Ohne beide Anker ist die Eingabe nicht von einem Suchbegriff zu
    // unterscheiden — hier fehlt der Kopfblock ein Zeichen und das Raster
    // stimmt dadurch auch nicht.
    ['9bb1667-4394-4ce9-bd14-12a080233f7a', 'text', 'Kopfblock zu kurz'],

    // Fachbegriffe, auch wenn sie das Raster zufällig treffen: "Taxonomy" hat
    // acht Zeichen, ist aber kein Hex-Kopfblock, und zwei Segmente sind nicht
    // das volle Raster.
    ['Taxonomy-L4', 'text', 'WLAN-Taxonomie-Prop'],
    ['Struktur-Ebene', 'text', 'zusammengesetzter Begriff'],
    ['ad-hoc', 'text', 'kurzer Bindestrichbegriff'],
    ['cafe-babe', 'text', 'Hexzeichen ohne Raster'],
    ['Passwort', 'text', 'einzelnes Wort'],
    ['GC.1.1', 'text', 'Control-ID'],
    ['9bb16672', 'text', 'Kopfblock ohne Bindestrich'],
    ['9bb16672 4394', 'text', 'Leerzeichen statt Bindestrich'],
    ['', 'text', 'leere Eingabe'],
  ];

  it.each(cases)('ordnet %j als %s ein (%s)', (query, expected) => {
    expect(classifyQuery(query)).toBe(expected);
  });

  it('ignoriert Randabstand bei der Einordnung', () => {
    expect(classifyQuery('  9bb16672-4394-4ce9-bd14-12a080233f7a  ')).toBe('identifier');
    expect(classifyQuery('  9bb16672-4394  ')).toBe('malformed-identifier');
  });
});
