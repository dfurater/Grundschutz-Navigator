import { createStoredZip, storedZipByteLength } from '@/adapters/storedZip';
import { decodeEvidenceContent } from '@/domain/evidencePreview';
import { isJsonObject, readArray, type JsonObject } from '@/domain/jsonGuards';
import { decodedBase64ByteLength } from '@/domain/oscalBackMatterBase64';
import { processClass2OscalValue } from '@/domain/oscalObjectPipeline';
import { toDerivedOscalTree } from '@/domain/profileExport';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';

export const EVIDENCE_EXPORT_LIMITS = Object.freeze({ maxResources: 1_000, maxBytes: 16 * 1024 * 1024 });

export interface EvidenceExportInput {
  readonly source: unknown;
  readonly resourceUuids: readonly string[];
  readonly confirmedFullDocument: boolean;
}
export type EvidenceExportResult =
  | { readonly ok: true; readonly zip: Uint8Array<ArrayBuffer>; readonly report: { readonly schema: 'passed'; readonly constraints: 'not-checked'; readonly references: 'not-checked' } }
  | { readonly ok: false; readonly code: string };

const fail = (code: string): EvidenceExportResult => ({ ok: false, code });
function evidenceExportErrorCode(error: unknown): string {
  if (error instanceof Error && error.message === 'EVIDENCE_ZIP_INVALID') return 'EVIDENCE_ZIP_INVALID';
  return 'EVIDENCE_EXPORT_SOURCE_INVALID';
}

function indexResources(body: JsonObject): Map<string, JsonObject> | undefined {
  const index = new Map<string, JsonObject>();
  const backMatter = body['back-matter'];
  for (const resource of readArray(isJsonObject(backMatter) ? backMatter.resources : undefined)) {
    // The shared pipeline has already checked the resource shape and UUID datatype.
    if (!isJsonObject(resource) || typeof resource.uuid !== 'string') return undefined;
    const uuid = resource.uuid.toLowerCase();
    if (index.has(uuid)) return undefined;
    index.set(uuid, resource);
  }
  return index;
}

/** Complete source plus explicitly selected embedded files; never resolves a document reference. */
export async function exportEvidencePackage(input: EvidenceExportInput): Promise<EvidenceExportResult> {
  if (input.confirmedFullDocument !== true) return fail('EVIDENCE_EXPORT_CONFIRMATION_REQUIRED');
  const selection = input.resourceUuids;
  if (!Array.isArray(selection) || selection.length > EVIDENCE_EXPORT_LIMITS.maxResources || selection.some(uuid => typeof uuid !== 'string')) return fail('EVIDENCE_EXPORT_SELECTION_INVALID');
  const uuids = selection.map(uuid => uuid.toLowerCase());
  if (new Set(uuids).size !== uuids.length) return fail('EVIDENCE_EXPORT_SELECTION_INVALID');
  try {
    // Private builder snapshot: later caller edits cannot change the validated/exported content.
    const tree = toDerivedOscalTree(input.source);
    const processed = await processClass2OscalValue(tree, { trustClass: 'class-2-local-user' });
    if (!processed.ok || !['assessment-results', 'plan-of-action-and-milestones'].includes(processed.document.rootType)) return fail('EVIDENCE_EXPORT_SOURCE_INVALID');
    const source = processed.document.source as JsonObject;
    const resources = indexResources(source[processed.document.rootType] as JsonObject);
    if (!resources) return fail('EVIDENCE_EXPORT_SELECTION_INVALID');
    const selected: { name: string; resource: JsonObject; byteLength: number }[] = [];
    for (const uuid of uuids) {
      const resource = resources.get(uuid);
      if (!resource || !isJsonObject(resource.base64) || typeof resource.base64.value !== 'string') return fail('EVIDENCE_EXPORT_SELECTION_INVALID');
      selected.push({ name: `evidence/${uuid}.bin`, resource, byteLength: decodedBase64ByteLength(resource.base64.value) });
    }
    const json = new TextEncoder().encode(serializeWorkspaceJson(source));
    const size = storedZipByteLength([{ name: 'document.json', byteLength: json.length }, ...selected]);
    // The current 10 MiB source and 4 MiB payload limits stay below the 16 MiB ZIP cap.
    if (size > EVIDENCE_EXPORT_LIMITS.maxBytes) return fail('EVIDENCE_EXPORT_SIZE_EXCEEDED');
    const entries = [{ name: 'document.json', data: json }];
    for (const { name, resource } of selected) {
      const data = decodeEvidenceContent(resource);
      if (!data) return fail('EVIDENCE_EXPORT_CONTENT_INVALID');
      entries.push({ name, data });
    }
    return {
      ok: true,
      zip: createStoredZip(entries, EVIDENCE_EXPORT_LIMITS.maxBytes),
      report: { schema: 'passed', constraints: 'not-checked', references: 'not-checked' },
    };
  } catch (error) {
    return fail(evidenceExportErrorCode(error));
  }
}
