// =============================================================================
// Der Messapparat aus GSPP-382 taugt nur, wenn seine Fixtures wirklich EXAKT
// auf der jeweiligen Grenze liegen. Diese Tests prüfen genau das gegen die
// produktive Prüfkette: auf der Grenze angenommen, eine Einheit darüber mit
// dem erwarteten Code abgewiesen.
//
// Die Fixtures selbst werden hier klein parametrisiert ausgeführt. Die
// Vollgrößen (10 MiB, 1 000 000 Knoten) gehören in den Messlauf
// `scripts/measure-class2-budget.mjs`, nicht in die Standard-Testkette.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  CLASS_2_LIMITS_UNDER_TEST,
  CLASS_2_WORST_CASE_FIXTURES,
  buildBase64BoundDocumentText,
  buildBase64CeilingDocumentText,
  buildByteBoundDocumentText,
  buildCombinedBoundDocumentText,
  buildDepthBoundDocumentText,
  buildGlobPatternWorstCase,
  buildNodeBoundDocumentText,
  decodedBase64BytesForLength,
  toBytes,
} from './class2WorstCaseFixtures.mjs';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { parseClass2OscalInput } from '@/domain/oscalImportProcessing';

/** Liest den base64-Wert aus einem Base64-Fixture heraus. */
function readBase64Value(text: string): string {
  const document = JSON.parse(text) as {
    'back-matter': { resources: { base64: { value: string } }[] };
  };
  return document['back-matter'].resources[0]!.base64.value;
}

/** Führt einen Fixturetext durch Stufe 1 und die Ressourcen-/Strukturprüfung. */
function verdictFor(text: string): { stage: string; code: string | null } {
  const parsed = parseClass2OscalInput(toBytes(text));
  if (!parsed.ok) return { stage: 'stufe-1', code: parsed.diagnostic.code };

  const diagnostic = enforceClass2ObjectGraphInvariants(parsed.source);
  return diagnostic === null
    ? { stage: 'angenommen', code: null }
    : { stage: 'invariante', code: diagnostic.code };
}

describe('Worst-Case-Fixtures der Klasse-2-Grenzen', () => {
  it('führt dieselben Grenzwerte wie der produktive Vertrag', () => {
    // Driften die beiden auseinander, misst der Messlauf an der falschen
    // Grenze und das Protokoll in docs/OSCAL_VALIDATION.md wird unwahr.
    expect(CLASS_2_LIMITS_UNDER_TEST).toEqual(CLASS_2_IMPORT_LIMITS);
  });

  it('registriert für jede durchgesetzte Grenze ein Fixture', () => {
    expect(CLASS_2_WORST_CASE_FIXTURES.map((fixture) => fixture.id)).toEqual([
      'byte-bound',
      'node-bound',
      'depth-bound',
      'base64-bound',
      'combined-bound',
    ]);
  });

  it('trifft die Bytegrenze exakt', () => {
    const limit = 4096;

    expect(toBytes(buildByteBoundDocumentText(limit)).byteLength).toBe(limit);
    expect(toBytes(buildByteBoundDocumentText(limit + 1)).byteLength).toBe(limit + 1);
  });

  // Die Knotengrenze ist die einzige Grenze, deren Schärfe sich nicht klein
  // parametrisieren lässt: Sie wird von der produktiven Invariante gegen den
  // echten Wert geprüft, nicht gegen einen Testwert. Der Lauf baut deshalb
  // zwei Dokumente in Vollgröße (je rund 3 MB) und braucht neben den übrigen
  // parallelen Testdateien mehr als die voreingestellten fünf Sekunden.
  it('trifft die Knotengrenze exakt und kippt eine Einheit darüber', { timeout: 60_000 }, () => {
    const limit = CLASS_2_LIMITS_UNDER_TEST.maxNodes;

    expect(verdictFor(buildNodeBoundDocumentText(limit))).toEqual({
      stage: 'angenommen',
      code: null,
    });
    expect(verdictFor(buildNodeBoundDocumentText(limit + 1))).toEqual({
      stage: 'invariante',
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
    });
  });

  it('trifft die Tiefengrenze exakt', () => {
    const depth = CLASS_2_LIMITS_UNDER_TEST.maxDepth;

    expect(verdictFor(buildDepthBoundDocumentText(depth, 2_000))).toEqual({
      stage: 'angenommen',
      code: null,
    });
    expect(verdictFor(buildDepthBoundDocumentText(depth + 1, 2_000))).toEqual({
      stage: 'stufe-1',
      code: 'OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED',
    });
  });

  it('schöpft mit dem Kombinationsfixture alle drei Grenzen zugleich aus', () => {
    const bytes = 64 * 1024;
    const text = buildCombinedBoundDocumentText(CLASS_2_LIMITS_UNDER_TEST.maxDepth, 2_000, bytes);

    expect(toBytes(text).byteLength).toBe(bytes);
    expect(verdictFor(text)).toEqual({ stage: 'angenommen', code: null });
  });

  it('belegt, dass die Base64-Grenze unter der Bytegrenze überhaupt erreichbar ist', () => {
    // Das Deckel-Fixture schöpft den Byteraum vollständig als base64-Text aus.
    // Seine dekodierte Summe ist damit das arithmetische Maximum, das ein
    // zugelassenes Dokument je erreichen kann.
    const encoded = readBase64Value(buildBase64CeilingDocumentText());
    const reachableCeiling = decodedBase64BytesForLength(encoded.length);

    expect(reachableCeiling).toBeLessThan(CLASS_2_LIMITS_UNDER_TEST.maxBytes);
    expect(CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes).toBeLessThan(reachableCeiling);
  });

  it('legt die dekodierte Summe des Base64-Fixtures exakt auf die Grenze', () => {
    const encoded = readBase64Value(buildBase64BoundDocumentText());
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;

    expect(Math.floor(encoded.length / 4) * 3 - padding).toBe(
      CLASS_2_LIMITS_UNDER_TEST.maxDecodedBase64Bytes,
    );
  });

  it('erzeugt ein Glob-Muster, das am Subjekt garantiert scheitert', () => {
    const { pattern, subject } = buildGlobPatternWorstCase(3, 12);

    expect(pattern).toBe('*a*a*a!');
    expect(subject).toBe('a'.repeat(12));
    // Das abschließende `!` kommt im Subjekt nicht vor: Die Regex-Engine muss
    // alle Aufteilungen durchprobieren, bevor sie aufgibt. Genau dieser
    // vollständige Fehlschlag ist der gemessene Worst Case.
    expect(subject.includes('!')).toBe(false);
  });
});
