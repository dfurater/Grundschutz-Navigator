import { describe, expect, it } from 'vitest';
import * as provenanceModule from './oscalObjectProvenance';

describe('Geschlossene Herkunftsfläche (Gate-Befund zu 805c638)', () => {
  it('exponiert keine beschreibbare Registrierung — Herkunft entsteht nur durch echtes Parsen', () => {
    const names = Object.keys(provenanceModule);

    expect(names).not.toContain('registerParserProducedRoot');
    expect(names).not.toContain('register');
    expect(names).toContain('parseAndRegisterOscalJson');
    expect(names).toContain('isParserProducedRoot');
  });

  it('erzeugt über die Textschnittstelle ausschließlich echte Parse-Produkte mit Herkunft', () => {
    // Ein Angreifer kann höchstens Text einspeisen; das Ergebnis ist dann
    // tatsächlich ein Produkt von JSON.parse — kein eingetragenes Fremdobjekt.
    const forged = { catalog: { metadata: { title: 'fremd' } } };
    const reparsed = provenanceModule.parseAndRegisterOscalJson(
      JSON.stringify(forged),
    ) as object;

    expect(reparsed).not.toBe(forged);
    expect(provenanceModule.isParserProducedRoot(reparsed)).toBe(true);
    expect(provenanceModule.isParserProducedRoot(forged)).toBe(false);
  });
});
