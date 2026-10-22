import { PROFILE_WORKBENCH_TIMEOUT_MS } from '@/adapters/profileWorkbench';
import type { ProfileAnalysis, ProfileAnalysisBasis, ProfileAnalysisInput } from '@/state/workspaceProfileAnalysis';

export interface ProfileAnalysisClient {
  readonly analyze: (basis: ProfileAnalysisBasis, input: ProfileAnalysisInput, signal?: AbortSignal) => Promise<ProfileAnalysis | null>;
  readonly dispose: () => void;
}

function isAnalysis(value: unknown): value is ProfileAnalysis {
  const analysis = value as ProfileAnalysis | null;
  return analysis !== null && typeof analysis === 'object'
    && (analysis.schema?.status === 'passed' || analysis.schema?.status === 'failed')
    && Array.isArray(analysis.hints) && Array.isArray(analysis.imports) && analysis.targets instanceof Map
    && ['resolved', 'not-evaluable', 'error'].includes(analysis.resolution?.status);
}

/** Ein lebender Worker je Client; nur erfolgreiche Analysen behalten ihn und seine Basis. */
export function createProfileAnalysisClient(): ProfileAnalysisClient {
  let worker: Worker | undefined;
  let sentBasis: ProfileAnalysisBasis | undefined;
  let basisId = 0;
  let requestId = 0;
  let pending: { id: number; finish: (analysis: ProfileAnalysis | null) => void } | undefined;

  function stop(): void {
    worker?.removeEventListener('message', onMessage);
    worker?.removeEventListener('error', onFailure);
    worker?.removeEventListener('messageerror', onFailure);
    worker?.terminate();
    worker = undefined;
    sentBasis = undefined;
  }

  function complete(analysis: ProfileAnalysis | null, terminate: boolean): void {
    if (terminate) stop();
    const current = pending;
    pending = undefined;
    current?.finish(analysis);
  }

  function onFailure(): void { complete(null, true); }

  function onMessage(event: MessageEvent): void {
    const frame = event.data as { requestId?: unknown; type?: unknown; analysis?: unknown } | null;
    if (!pending) return;
    // Alte Request-IDs können eine neuere Anfrage weder abschließen noch scheitern lassen.
    if (typeof frame?.requestId === 'number' && frame.requestId < pending.id) return;
    if (frame?.requestId !== pending.id || frame.type !== 'analysis' || !isAnalysis(frame.analysis)) {
      onFailure();
      return;
    }
    complete(frame.analysis, false);
  }

  return {
    dispose: onFailure,
    analyze(basis, input, signal) {
      if (pending) onFailure();
      if (signal?.aborted) return Promise.resolve(null);
      const id = ++requestId;
      return new Promise((resolve) => {
        const abort = () => { if (pending?.id === id) onFailure(); };
        const timeout = setTimeout(abort, PROFILE_WORKBENCH_TIMEOUT_MS);
        pending = { id, finish: (value) => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          resolve(value);
        } };
        signal?.addEventListener('abort', abort, { once: true });
        if (typeof Worker === 'undefined') {
          void import('@/state/workspaceProfileAnalysis').then(async ({ withProfileAnalysisInput, deriveProfileAnalysis }) => {
            if (pending?.id !== id) return;
            const analysis = await deriveProfileAnalysis(withProfileAnalysisInput(basis, input));
            if (pending?.id === id) complete(analysis, false);
          }).catch(() => { if (pending?.id === id) onFailure(); });
          return;
        }
        try {
          if (!worker) {
            worker = new Worker(new URL('../workers/profileWorkbench.worker.ts', import.meta.url), { type: 'module' });
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onFailure);
            worker.addEventListener('messageerror', onFailure);
          }
          const changed = sentBasis !== basis;
          if (changed) basisId++;
          sentBasis = basis;
          worker.postMessage({ type: 'analyze-session', requestId: id, basisId, ...(changed ? { basis } : {}), input });
        } catch {
          onFailure();
        }
      });
    },
  };
}
