import { describe, expect, it } from 'vitest';
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
  it('erkennt eine wohlgeformte Kennung', () => {
    expect(classifyQuery('9bb16672-4394-4ce9-bd14-12a080233f7a')).toBe('identifier');
  });

  it('erkennt eine UUID-förmige Eingabe mit ungültigen Zeichen als Kennung', () => {
    // Vollständiges Segmentraster, aber Nicht-Hex-Zeichen: als Kennung
    // gemeint, also null Treffer statt Volltextsuche. Jedes Segment einzeln
    // geprüft, damit die Formerkennung nicht nur am ersten Block hängt.
    expect(classifyQuery('9bb16672-4394-4ce9-bd14-12a080233g7a')).toBe('malformed-identifier');
    expect(classifyQuery('9bb1667g-4394-4ce9-bd14-12a080233f7a')).toBe('malformed-identifier');
    expect(classifyQuery('9bb16672-43g4-4ce9-bd14-12a080233f7a')).toBe('malformed-identifier');
    expect(classifyQuery('9bb16672-4394-4cg9-bd14-12a080233f7a')).toBe('malformed-identifier');
    expect(classifyQuery('9bb16672-4394-4ce9-bg14-12a080233f7a')).toBe('malformed-identifier');
    // Auch ein Fragment mit ungültigem Zeichen bleibt Kennungsanfrage.
    expect(classifyQuery('9bb16672-4394-4cg9')).toBe('malformed-identifier');
  });

  it('erkennt ein Kennungsfragment als solches statt als Text', () => {
    // Ohne diese Einordnung liefe das Fragment in die Volltextsuche und träfe
    // jede Control, in deren Text es vorkommt.
    expect(classifyQuery('9bb16672-4394-4ce9-bd14-12a080233f7')).toBe('malformed-identifier');
    expect(classifyQuery('9bb16672-4394')).toBe('malformed-identifier');
    expect(classifyQuery('9bb16672-')).toBe('malformed-identifier');
    // Falsche Version bzw. Variante: als Kennung gemeint, aber nicht wohlgeformt.
    expect(classifyQuery('9bb16672-4394-3ce9-bd14-12a080233f7a')).toBe('malformed-identifier');
    expect(classifyQuery('9bb16672-4394-4ce9-cd14-12a080233f7a')).toBe('malformed-identifier');
  });

  it('lässt Eingaben außerhalb des UUID-Rasters als Text durch', () => {
    // Falsche Segmentlängen oder zu viele Segmente sind keine Kennungsform.
    expect(classifyQuery('9bb1667-4394-4ce9-bd14-12a080233f7a')).toBe('text');
    expect(classifyQuery('9bb16672-43945-4ce9-bd14-12a080233f7a')).toBe('text');
    expect(classifyQuery('9bb16672-4394-4ce9-bd14-12a080233f7a-extra')).toBe('text');
    // Ein zu langes letztes Segment ist kein angebrochenes Präfix.
    expect(classifyQuery('9bb16672-4394-4ce9-bd14-12a080233f7ab')).toBe('text');
    // Fachbegriffe, die das Raster zufällig erfüllen, brauchen einen der
    // beiden Anker — Taxonomy-L4 hat weder einen Hex-Kopfblock noch das volle
    // Fünf-Segment-Raster.
    expect(classifyQuery('Taxonomy-L4')).toBe('text');
    expect(classifyQuery('Struktur-Ebene')).toBe('text');
  });

  it('lässt fachliche Suchbegriffe unangetastet', () => {
    expect(classifyQuery('Passwort')).toBe('text');
    expect(classifyQuery('GC.1.1')).toBe('text');
    expect(classifyQuery('ad-hoc')).toBe('text');
    expect(classifyQuery('Taxonomy-L1')).toBe('text');
    // Hexzeichen ohne das Grundraster bleiben Text.
    expect(classifyQuery('cafe-babe')).toBe('text');
    expect(classifyQuery('9bb16672')).toBe('text');
    expect(classifyQuery('9bb16672 4394')).toBe('text');
    expect(classifyQuery('')).toBe('text');
  });
});
