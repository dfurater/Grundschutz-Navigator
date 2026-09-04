import { describe, expect, it } from 'vitest';
import { isIdentifierQuery } from './identifierQuery';

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
