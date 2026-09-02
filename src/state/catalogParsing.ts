// =============================================================================
// Reine Katalog-Parsepipeline für den Main-Thread-Fallback und Modul-Worker.
// =============================================================================

import { parseCatalogDocument } from '@/adapters/oscalDocument';
import { projectResolvedControlLinks } from '@/domain/catalogReferenceProjection';
import type { CatalogDocument, CatalogDocumentContext } from '@/domain/models';

export type CatalogParserExecution = 'main-thread' | 'worker';

export interface CatalogParseOptions {
  readonly execution: CatalogParserExecution;
}

export interface CatalogParseResult {
  readonly catalogDocument: CatalogDocument;
  readonly execution: CatalogParserExecution;
}

const MAIN_THREAD_PARSE_OPTIONS: CatalogParseOptions = { execution: 'main-thread' };

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
  const source = JSON.parse(text);
  const catalogDocument = projectResolvedControlLinks(parseCatalogDocument(source, context));

  return {
    catalogDocument,
    execution: options.execution,
  };
}
