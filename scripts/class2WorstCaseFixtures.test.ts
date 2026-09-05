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
  CLASS_2_WORST_CASE_FIXTURES,
  assertScalableNodeCounts,
  buildBase64BoundDocumentText,
  buildBase64CeilingDocumentText,
  buildByteBoundDocumentText,
  buildCombinedBoundDocumentText,
  buildDepthBoundDocumentText,
  buildGlobPatternWorstCase,
  buildHeapBoundDocumentText,
  buildNodeBoundDocumentText,
  buildRecordBoundDocumentText,
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
  it('registriert für jede durchgesetzte Grenze ein Fixture', () => {
    expect(CLASS_2_WORST_CASE_FIXTURES.map((fixture) => fixture.id)).toEqual([
      'byte-bound',
      'node-bound',
      'depth-bound',
      'heap-bound',
      'record-bound',
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
    const limit = CLASS_2_IMPORT_LIMITS.maxBytes;

    // OHNE Argument gebaut: Der Bauer muss die produktive Grenze selbst
    // treffen. Die Fixtures lesen sie aus derselben Quelle wie der
    // Importvertrag; käme dort je wieder eine eigene Wertetabelle hinein,
    // misst der Messlauf an einer Grenze, die die Anwendung nicht zieht, und
    // das Protokoll in docs/OSCAL_VALIDATION.md wird unwahr.
    expect(toBytes(buildByteBoundDocumentText()).byteLength).toBe(limit);
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
    const limit = CLASS_2_IMPORT_LIMITS.maxNodes;

    // Ebenfalls ohne Argument, aus demselben Grund wie bei der Bytegrenze.
    expect(verdictFor(buildNodeBoundDocumentText())).toEqual({
      stage: 'dispatch-ok',
      code: 'catalog',
    });
    expect(verdictFor(buildNodeBoundDocumentText(limit + 1))).toEqual({
      stage: 'invariante',
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
    });
  });

  it('trifft die Tiefengrenze exakt', () => {
    const depth = CLASS_2_IMPORT_LIMITS.maxDepth;

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
    const nodes = CLASS_2_IMPORT_LIMITS.maxNodes;
    const bytes = CLASS_2_IMPORT_LIMITS.maxBytes;

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

  it('schöpft mit dem Heap-Fixture Knoten- und Bytegrenze zugleich aus', { timeout: 60_000 }, () => {
    const nodes = CLASS_2_IMPORT_LIMITS.maxNodes;
    const bytes = CLASS_2_IMPORT_LIMITS.maxBytes;

    expect(toBytes(buildHeapBoundDocumentText(nodes, bytes)).byteLength).toBe(bytes);
    // Wurzelarray: Stufe 1 und Invariante nehmen es an, erst der Dispatch
    // weist es ab — nachdem der Speicher belegt ist. Genau darin liegt der
    // Angriff, den dieses Fixture abbildet.
    expect(verdictFor(buildHeapBoundDocumentText(nodes, bytes))).toEqual({
      stage: 'dispatch',
      code: 'OSCAL_DOCUMENT_NOT_OBJECT',
    });
    expect(verdictFor(buildHeapBoundDocumentText(nodes + 2, bytes))).toEqual({
      stage: 'invariante',
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
    });
  });

  it('schöpft mit dem Record-Fixture Byte- und Knotengrenze in EINEM Container aus', { timeout: 120_000 }, () => {
    // Die Lücke aus dem Codex-Befund zu 84ca1f6: Die kurzlebigen Allokationen
    // der Prüfkette — `Object.entries(record)` in `visitRecord`, die
    // `Reflect.ownKeys`-Arrays in Formprüfung, Knotenuntergrenze und
    // Bytebuchhaltung — wachsen mit der BREITE eines Containers, nicht mit der
    // Knotenzahl. Ein Satz aus schmalen Containern sieht davon nichts.
    const nodes = CLASS_2_IMPORT_LIMITS.maxNodes;
    const bytes = CLASS_2_IMPORT_LIMITS.maxBytes;
    const text = buildRecordBoundDocumentText(nodes, bytes);

    expect(toBytes(text).byteLength).toBe(bytes);
    // Alle Knoten bis auf die Wurzel hängen an EINEM Container; die Schlüssel
    // sind paarweise verschieden, sonst würde die Duplicate-Member-Prüfung in
    // Stufe 1 abweisen und die Breite käme nie zustande.
    const members = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(members).toHaveLength(nodes - 1);
    expect(new Set(members).size).toBe(nodes - 1);

    // Auf der Grenze läuft es durch Stufe 1 und die Invariante und wird erst im
    // Root-Dispatch abgewiesen — nachdem der Speicher belegt ist.
    expect(verdictFor(text)).toEqual({
      stage: 'dispatch',
      code: 'OSCAL_ROOT_KEY_AMBIGUOUS',
    });
    expect(verdictFor(buildRecordBoundDocumentText(nodes + 1, bytes))).toEqual({
      stage: 'invariante',
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
    });
  });

  it('deckt mit dem Satz beide Enden der Breitenachse ab', () => {
    // Schmalster und breitester RECORD des Satzes. `Object.entries` und die
    // `Reflect.ownKeys`-Arrays der Formprüfung entstehen nur an Records, nicht
    // an Arrays — Arrays laufen in `visitArray` über `for…of` ohne Paar-Array.
    // Fällt einer der beiden Pole weg, misst der Lauf die transienten Kosten
    // wieder nur an einem Ende.
    const widestRecord = (text: string): number => {
      let maximum = 0;
      (function walk(value: unknown): void {
        if (value === null || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          for (const element of value) walk(element);
          return;
        }
        const keys = Object.keys(value as Record<string, unknown>);
        maximum = Math.max(maximum, keys.length);
        for (const key of keys) walk((value as Record<string, unknown>)[key]);
      })(JSON.parse(text));
      return maximum;
    };

    expect(widestRecord(buildHeapBoundDocumentText(1_000))).toBe(1);
    expect(widestRecord(buildRecordBoundDocumentText(1_000))).toBe(999);
  });

  it('variiert im Heap-Fixture die Objektform mit der Containerzahl', { timeout: 60_000 }, () => {
    // Die Lücke, die der Codex-Befund zu 36d9c79 aufgedeckt hat, war nicht die
    // Containerzahl, sondern die Formgleichheit: V8 teilt die verborgene
    // Klasse unter formgleichen Objekten, sodass eine Million identischer
    // leerer Objekte eine einzige Formbeschreibung kostet. Die Zahl
    // VERSCHIEDENER Schlüsselsignaturen ist der beobachtbare Stellvertreter
    // dafür. Dieser Test hält fest, dass der Satz beide Enden der Achse
    // abdeckt — sonst misst er den Speicher wieder nur im günstigsten Fall.
    const signatures = (text: string): Set<string> => {
      const seen = new Set<string>();
      (function walk(value: unknown): void {
        if (value === null || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          for (const element of value) walk(element);
          return;
        }
        const keys = Object.keys(value as Record<string, unknown>);
        seen.add(keys.join('\u0000'));
        for (const key of keys) walk((value as Record<string, unknown>)[key]);
      })(JSON.parse(text));
      return seen;
    };

    const nodes = CLASS_2_IMPORT_LIMITS.maxNodes;
    // Untere Ecke: lauter identische leere Objekte, genau eine Form.
    expect(signatures(buildDepthBoundDocumentText(CLASS_2_IMPORT_LIMITS.maxDepth, nodes)).size)
      .toBe(1);
    // Obere Ecke: eine eigene Form je äußerem Container, plus die leere Form
    // der inneren Container.
    expect(signatures(buildHeapBoundDocumentText(nodes)).size).toBe(nodes / 2);
  });

  it('belegt, dass die Base64-Grenze unter der Bytegrenze überhaupt erreichbar ist', () => {
    // Das Deckel-Fixture schöpft den Byteraum vollständig als base64-Text aus.
    // Seine dekodierte Summe ist damit das arithmetische Maximum, das ein
    // zugelassenes Dokument je erreichen kann.
    const encoded = readBase64Value(buildBase64CeilingDocumentText());
    const reachableCeiling = decodedBase64BytesForLength(encoded.length);

    expect(reachableCeiling).toBeLessThan(CLASS_2_IMPORT_LIMITS.maxBytes);
    expect(CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes).toBeLessThan(reachableCeiling);
  });

  it('legt die dekodierte Summe des Base64-Fixtures exakt auf die Grenze', () => {
    const encoded = readBase64Value(buildBase64BoundDocumentText());
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;

    expect(Math.floor(encoded.length / 4) * 3 - padding).toBe(
      CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes,
    );
    expect(verdictFor(buildBase64BoundDocumentText(
      CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes + 1,
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

  it('nennt für jedes skalierbare Fixture die wirklich kleinste baubare Knotenzahl', () => {
    // `minScaledNodes` ist eine Behauptung über den Builder daneben. Läuft sie
    // von ihm weg, weist die Prüfung entweder gültige Stützpunkte ab oder
    // lässt einen durch, der den Messlauf nach dem Browserstart abbrechen
    // lässt. Der Test bindet beide Seiten aneinander: auf dem Minimum baut es,
    // eine Einheit darunter nicht.
    for (const fixture of CLASS_2_WORST_CASE_FIXTURES) {
      if (fixture.buildScaled === undefined) continue;

      expect(() => fixture.buildScaled!(fixture.minScaledNodes!)).not.toThrow();
      expect(() => fixture.buildScaled!(fixture.minScaledNodes! - 2)).toThrow(RangeError);
    }
  });

  it('weist Stützpunkte zurück, die nicht jedes skalierbare Fixture trägt', () => {
    // Genau die Werte aus dem Greptile-Befund zu e786a39: Beide passieren die
    // syntaktische Prüfung und scheiterten früher erst im laufenden Browser.
    expect(() => assertScalableNodeCounts([4])).toThrow(/node-bound/);
    expect(() => assertScalableNodeCounts([12])).toThrow(/combined-bound/);
    expect(assertScalableNodeCounts([14, 62_500])).toEqual([14, 62_500]);
  });

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
