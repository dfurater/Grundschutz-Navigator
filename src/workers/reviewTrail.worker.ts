import { diffDocuments } from '@/domain/documentDiff';
import { OSCAL_ROOT_KEYS, type OscalRootKey } from '@/domain/oscalVersionMatrix';
import { documentSnapshot } from '@/domain/reviewTrail';
import { withinSourceLimits } from '@/adapters/workspaceDraftSource';
import type { ReviewTrailWorkRequest, ReviewTrailWorkResponse } from '@/adapters/reviewTrailWork';
import { processContentHash } from '@/domain/sspProcessProjection';
import { compareStringsByCodeUnit } from '@/domain/codeUnitOrder.mjs';

/**
 * One request per worker: hash and structural diff of an already admitted document source.
 * The adapter terminates the worker after the response; a failure is terminal and writes nothing.
 */
function validRequest(value: unknown): value is ReviewTrailWorkRequest {
  if (value === null || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  const binding = request.processBinding;
  if (binding !== undefined && (request.rootType !== 'system-security-plan' || binding === null || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).sort(compareStringsByCodeUnit).join(',') !== 'decisionParties,processUuid'
    || typeof (binding as Record<string, unknown>).processUuid !== 'string' || !Array.isArray((binding as Record<string, unknown>).decisionParties))) return false;
  return Object.keys(request).sort(compareStringsByCodeUnit).join(',') === (binding === undefined ? 'baseSequence,diff,previous,rootType,source' : 'baseSequence,diff,previous,processBinding,rootType,source') && typeof request.source === 'object' && request.source !== null
    && OSCAL_ROOT_KEYS.includes(request.rootType as never) && typeof request.diff === 'boolean'
    && (request.previous === null || (typeof request.previous === 'object' && request.previous !== null))
    && (request.baseSequence === null || (Number.isInteger(request.baseSequence) && (request.baseSequence as number) > 0));
}

async function run(request: ReviewTrailWorkRequest): Promise<ReviewTrailWorkResponse> {
  if (!withinSourceLimits(request.source) || (request.previous !== null && !withinSourceLimits(request.previous))) return { ok: false };
  const rootType = request.rootType as OscalRootKey;
  const snapshot = await documentSnapshot(request.source, rootType);
  if (!snapshot) return { ok: false };
  if (request.processBinding && !withinSourceLimits(request.processBinding)) return { ok: false };
  const processHash = request.processBinding ? await processContentHash(request.source, request.processBinding.processUuid, request.processBinding.decisionParties) : undefined;
  const bound = processHash ? { processHash } : {};
  if (!request.diff) return { ok: true, snapshot, ...bound };
  const diff = diffDocuments({ base: request.previous ?? {}, next: request.source, rootType, baseSequence: request.baseSequence });
  return { ok: true, snapshot, diff, ...bound };
}

function fail(): void { globalThis.postMessage({ ok: false } satisfies ReviewTrailWorkResponse); }

globalThis.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== '' && event.origin !== globalThis.location.origin) { fail(); return; }
  if (!validRequest(event.data)) { fail(); return; }
  void run(event.data).then(result => globalThis.postMessage(result)).catch(fail);
});
