import { processClass2OscalValue } from '@/domain/oscalObjectPipeline';
import type {
  Class2ObjectPipelineContext,
  Class2OscalValueDocument,
  Class2OscalValueResult,
} from '@/domain/oscalObjectPipeline';
import { parseClass2OscalInput, CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportProcessing';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';

export type Class2OscalDocumentContext = Class2ObjectPipelineContext;

export type Class2OscalImportedDocument = Class2OscalValueDocument;

export type Class2OscalImportResult = Class2OscalValueResult;

/**
 * Worker-interne Pipeline für Klasse-2-Bytes: Stufe 1 → gemeinsame
 * objektorientierte Kette. Stufe 1 (Größenlimit, fatale UTF-8-Dekodierung,
 * Duplicate-Member-Scanner und `JSON.parse`) ist die Byte-Vorstufe dieser
 * Einheit und bleibt hier; Strukturinvariante, Ressourcenlimits,
 * Root-Dispatch und Schemastufe laufen in `processClass2OscalValue()` — genau
 * derselben Einheit, über die auch der Ableitungsweg eintritt (ADR-8
 * Festlegung 1).
 *
 * Der öffentliche Einstieg bleibt `importClass2OscalDocument()` im Adapter;
 * diese Funktion ist für den Worker und deterministische Unit-Tests
 * ausgelagert.
 *
 * `async`, weil die Schemastufe das Schema der ausgewählten Zelle als eigenen
 * Chunk nachlädt — nur die eine Zelle, aus dem eigenen Bundle und von derselben
 * Origin, nie von einem fremden Host.
 */
export async function processClass2OscalBytes(
  bytes: Uint8Array,
  context: Class2OscalDocumentContext,
): Promise<Class2OscalImportResult> {
  if (context.trustClass !== 'class-2-local-user') {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_IMPORT_CONTEXT_INVALID',
        stage: 'domain',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: '/',
      }),
    };
  }

  const input = parseClass2OscalInput(bytes);
  if (!input.ok) return input;

  return processClass2OscalValue(input.source, context);
}
