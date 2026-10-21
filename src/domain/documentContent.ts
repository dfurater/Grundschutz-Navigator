// =============================================================================
// Inhalt eines OSCAL-Workspace-Dokuments
//
// „Inhalt“ ist der Quellgraph ohne genau zwei Felder: Root-`uuid` und
// Root-`metadata.last-modified`. Beide bezeichnen den Schreibvorgang, nicht den
// fachlichen Stand (docs/PERSISTENCE.md §5 und §9). Explizites Speichern und
// Content-Hash teilen diese Definition, damit sie nicht auseinanderlaufen.
// =============================================================================

import { isJsonObject, type JsonObject } from '@/domain/jsonGuards';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';

/** Das Root-Objekt eines Workspace-Dokuments (`catalog`, `profile`, …). */
export function documentBody(source: unknown, rootType: OscalRootKey): JsonObject | undefined {
  return isJsonObject(source) && isJsonObject(source[rootType]) ? source[rootType] : undefined;
}

function withoutLastModified(metadata: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'last-modified'));
}

/** Der Quellgraph ohne Root-`uuid` und Root-`metadata.last-modified`. */
export function documentContent(source: unknown, rootType: OscalRootKey): unknown {
  const copy = structuredClone(source);
  const body = documentBody(copy, rootType);
  if (!body) return copy;
  const content: JsonObject = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'uuid'));
  const metadata = body.metadata;
  const next = metadata === undefined
    ? content
    : isJsonObject(metadata) ? { ...content, metadata: withoutLastModified(metadata) } : { ...content, metadata };
  return { ...(copy as JsonObject), [rootType]: next };
}
