// =============================================================================
// Der Messapparat aus GSPP-382 taugt nur, wenn seine Fixtures wirklich EXAKT
// auf der jeweiligen Grenze liegen und die Prüfkette so weit durchlaufen, wie
// sie es behaupten. Diese Tests prüfen beides gegen die produktiven Einheiten:
// auf der Grenze angenommen, eine Einheit darüber mit dem erwarteten Code
// abgewiesen — und für die schemafähigen Fixtures zusätzlich, dass der
// Root-Dispatch sie als Katalog annimmt, statt sie vor der Schemastufe
// abzuweisen.
//
// Die Fixtures werden hier klein parametrisiert ausgeführt, wo die Grenze das
// zulässt. Die Knotengrenze prüft die Invariante gegen ihren echten Wert und
// braucht deshalb Vollgrößen.
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
  encodedBase64ForDecodedBytes,
  toBytes,
} from './class2WorstCaseFixtures.mjs';
import { dispatchOscalDocument } from '@/adapters/oscalRootDispatch';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { globToRegExp } from '@/domain/profileResolutionSelection';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { parseClass2OscalInput } from '@/domain/oscalImportProcessing';

const CONTEXT = { trustClass: 'class-2-local-user' } as const;

type Verdict = { stage: string; code: string | null };

/**
 * Führt einen Fixturetext durch Stufe 1, die Ressourcen- und Strukturprüfung
 * und den Root-Dispatch. Die Schemastufe selbst lädt einen eigenen Chunk und
 * bleibt dem Messlauf im Browser vorbehalten; entscheidend ist hier, ob der
 * Dispatch sie überhaupt erreichen würde.
 */
function verdictFor(text: string): Verdict {
  const parsed = parseClass2OscalInput(toBytes(text));
  if (!parsed.ok) return { stage: 'stufe-1', code: parsed.diagnostic.code };

  const diagnostic = enforceClass2ObjectGraphInvariants(parsed.source);
  if (diagnostic !== null) return { stage: 'invariante', code: diagnostic.code };

  const dispatch = dispatchOscalDocument(parsed.source, CONTEXT);
  return dispatch.ok
    ? { stage: 'dispatch-ok', code: dispatch.rootType }
    : { stage: 'dispatch', code: dispatch.diagnostic.code };
}

/** Liest den base64-Wert aus einem Base64-Fixture heraus. */
function readBase64Value(text: string): string {
  const document = JSON.parse(text) as {
    catalog: { 'back-matter': { resources: { base64: { value: string } }[] } };
  };
  return document.catalog['back-matter'].resources[0]!.base64.value;
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

  it('erreicht mit jedem als schemafähig ausgewiesenen Fixture den Katalog-Dispatch', () => {
    // Ein Fixture, das schon im Root-Dispatch scheitert, misst die Kosten von
    // Schema-Chunk und Ajv nicht mit — genau das war der Greptile-Befund zu
    // 6643714. `reachesSchemaStage` ist die Behauptung, dieser Test der Beleg.
    for (const fixture of CLASS_2_WORST_CASE_FIXTURES) {
      const verdict = verdictFor(fixture.build());
      if (fixture.reachesSchemaStage) {
        expect({ id: fixture.id, ...verdict }).toEqual({
          id: fixture.id,
          stage: 'dispatch-ok',
          code: 'catalog',
        });
      } else {
        expect(verdict.stage).not.toBe('dispatch-ok');
      }
    }
  }, 60_000);

  it('trifft die Bytegrenze exakt', () => {
    const limit = CLASS_2_LIMITS_UNDER_TEST.maxBytes;

    expect(toBytes(buildByteBoundDocumentText(limit)).byteLength).toBe(limit);
    expect(verdictFor(buildByteBoundDocumentText(limit + 1))).toEqual({
      stage: 'stufe-1',
      code: 'OSCAL_BYTE_LIMIT_EXCEEDED',
    });
  });

  // Die Knotengrenze wird von der produktiven Invariante gegen ihren echten
  // Wert geprüft, nicht gegen einen Testwert. Der Lauf baut deshalb zwei
  // Dokumente in Vollgröße und braucht neben den übrigen parallelen
  // Testdateien mehr als die voreingestellten fünf Sekunden.
  it('trifft die Knotengrenze exakt und kippt eine Einheit darüber', { timeout: 60_000 }, () => {
    const limit = CLASS_2_LIMITS_UNDER_TEST.maxNodes;

    expect(verdictFor(buildNodeBoundDocumentText(limit))).toEqual({
      stage: 'dispatch-ok',
      code: 'catalog',
    });
    expect(verdictFor(buildNodeBoundDocumentText(limit + 1))).toEqual({
      stage: 'invariante',
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
    });
  });

  it('trifft die Tiefengrenze exakt', () => {
    const depth = CLASS_2_LIMITS_UNDER_TEST.maxDepth;

    // Auf der Grenze passiert das Dokument Stufe 1 und die Invariante; erst
    // der Root-Dispatch weist es ab, weil ein Wurzelarray kein OSCAL-Root ist.
    expect(verdictFor(buildDepthBoundDocumentText(depth, 2_000))).toEqual({
      stage: 'dispatch',
      code: 'OSCAL_DOCUMENT_NOT_OBJECT',
    });
    expect(verdictFor(buildDepthBoundDocumentText(depth + 1, 2_000))).toEqual({
      stage: 'stufe-1',
      code: 'OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED',
    });
  });

  it('schöpft mit dem Kombinationsfixture Knoten- und Bytegrenze zugleich aus', { timeout: 60_000 }, () => {
    const nodes = CLASS_2_LIMITS_UNDER_TEST.maxNodes;
    const bytes = CLASS_2_LIMITS_UNDER_TEST.maxBytes;

    expect(toBytes(buildCombinedBoundDocumentText(nodes, bytes)).byteLength).toBe(bytes);
    expect(verdictFor(buildCombinedBoundDocumentText(nodes, bytes))).toEqual({
      stage: 'dispatch-ok',
      code: 'catalog',
    });
    expect(verdictFor(buildCombinedBoundDocumentText(nodes + 1, bytes))).toEqual({
      stage: 'invariante',
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
    });
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
    expect(verdictFor(buildBase64BoundDocumentText(
      CLASS_2_LIMITS_UNDER_TEST.maxDecodedBase64Bytes + 1,
    ))).toEqual({
      stage: 'invariante',
      code: 'OSCAL_RESOURCE_BASE64_LIMIT_EXCEEDED',
    });
  });

  it.each([1, 2, 3, 4, 5, 3_000_001])(
    'trifft mit der Polsterung die dekodierte Größe %i punktgenau',
    (decodedBytes) => {
      const encoded = encodedBase64ForDecodedBytes(decodedBytes);
      const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;

      expect(Math.floor(encoded.length / 4) * 3 - padding).toBe(decodedBytes);
    },
  );

  it('erzeugt ein Glob-Muster, das an der produktiven Übersetzung scheitert', () => {
    const { pattern, subject } = buildGlobPatternWorstCase(3, 12);

    expect(pattern).toBe('*a*a*a!');
    expect(subject).toBe('a'.repeat(12));
    // Gegen die PRODUKTIVE Übersetzung geprüft, nicht gegen eine Kopie: Das
    // abschließende `!` kommt im Subjekt nicht vor, die Regex-Engine muss also
    // alle Aufteilungen durchprobieren, bevor sie aufgibt. Genau dieser
    // vollständige Fehlschlag ist der gemessene Worst Case.
    expect(globToRegExp(pattern)!.test(subject)).toBe(false);
  });
});
