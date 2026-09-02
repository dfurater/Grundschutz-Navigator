// =============================================================================
// Reine Katalog-Parsepipeline für den Main-Thread-Fallback und Modul-Worker.
// =============================================================================

import { parseCatalogDocument } from '@/adapters/oscalDocument';
import { projectResolvedControlLinks } from '@/domain/catalogReferenceProjection';
import type { CatalogDocument, CatalogDocumentContext } from '@/domain/models';

export interface CatalogParseTimings {
  readonly jsonParseMs: number;
  readonly domainParseMs: number;
}

export type CatalogParserExecution = 'main-thread' | 'worker';
export type CatalogParsePhase = 'json' | 'domain';

export interface CatalogParseOptions {
  readonly execution: CatalogParserExecution;
  readonly onPhaseComplete?: (
    phase: CatalogParsePhase,
    startedAt: number,
    endedAt: number,
  ) => void;
}

export interface CatalogParseResult {
  readonly catalogDocument: CatalogDocument;
  readonly timings: CatalogParseTimings;
  readonly execution: CatalogParserExecution;
}

const MAIN_THREAD_PARSE_OPTIONS: CatalogParseOptions = { execution: 'main-thread' };

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/**
 * Dekodiert und parst den vollständigen Klasse-1-Katalog in seinem
 * Ausführungskontext. Das `ArrayBuffer` wird vom Main Thread erst nach der
 * Integritätsprüfung übertragen und nur hier in einen Quellgraphen umgesetzt.
 */
export function parseCatalogBuffer(
  buffer: ArrayBuffer,
  context: CatalogDocumentContext,
  options: CatalogParseOptions = MAIN_THREAD_PARSE_OPTIONS,
): CatalogParseResult {
  const text = new TextDecoder('utf-8').decode(buffer);
  const jsonStartedAt = now();
  const source = JSON.parse(text);
  const jsonEndedAt = now();
  const jsonParseMs = jsonEndedAt - jsonStartedAt;
  try {
    options.onPhaseComplete?.('json', jsonStartedAt, jsonEndedAt);
  } catch {
    // Eine Messung darf einen OSCAL-Import weder beeinflussen noch verdecken.
  }
  const domainStartedAt = now();
  const catalogDocument = projectResolvedControlLinks(parseCatalogDocument(source, context));
  const domainEndedAt = now();
  const domainParseMs = domainEndedAt - domainStartedAt;
  try {
    options.onPhaseComplete?.('domain', domainStartedAt, domainEndedAt);
  } catch {
    // Eine Messung darf einen OSCAL-Import weder beeinflussen noch verdecken.
  }

  return {
    catalogDocument,
    timings: { jsonParseMs, domainParseMs },
    execution: options.execution,
  };
}
