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

export interface CatalogParseResult {
  readonly catalogDocument: CatalogDocument;
  readonly timings: CatalogParseTimings;
}

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
): CatalogParseResult {
  const text = new TextDecoder('utf-8').decode(buffer);
  const jsonStartedAt = now();
  const source = JSON.parse(text);
  const jsonParseMs = now() - jsonStartedAt;
  const domainStartedAt = now();
  const catalogDocument = projectResolvedControlLinks(parseCatalogDocument(source, context));
  const domainParseMs = now() - domainStartedAt;

  return {
    catalogDocument,
    timings: { jsonParseMs, domainParseMs },
  };
}
