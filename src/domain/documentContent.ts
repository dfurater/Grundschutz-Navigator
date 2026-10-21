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

function withMetadata(content: JsonObject, metadata: unknown): JsonObject {
  if (metadata === undefined) return content;
  return isJsonObject(metadata) ? { ...content, metadata: withoutLastModified(metadata) } : { ...content, metadata };
}

/** Schreibt das Root-Objekt über Literalschlüssel; ein berechneter Schlüssel käme aus Nutzereingaben. */
function withRoot(copy: JsonObject, rootType: OscalRootKey, body: JsonObject): JsonObject {
  if (rootType === 'catalog') return { ...copy, catalog: body };
  if (rootType === 'profile') return { ...copy, profile: body };
  if (rootType === 'mapping-collection') return { ...copy, 'mapping-collection': body };
  if (rootType === 'component-definition') return { ...copy, 'component-definition': body };
  if (rootType === 'system-security-plan') return { ...copy, 'system-security-plan': body };
  if (rootType === 'assessment-plan') return { ...copy, 'assessment-plan': body };
  if (rootType === 'assessment-results') return { ...copy, 'assessment-results': body };
  return { ...copy, 'plan-of-action-and-milestones': body };
}

/** Der Quellgraph ohne Root-`uuid` und Root-`metadata.last-modified`. */
export function documentContent(source: unknown, rootType: OscalRootKey): unknown {
  const copy = structuredClone(source);
  const body = documentBody(copy, rootType);
  if (!body || !isJsonObject(copy)) return copy;
  const content: JsonObject = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'uuid'));
  return withRoot(copy, rootType, withMetadata(content, body.metadata));
}
