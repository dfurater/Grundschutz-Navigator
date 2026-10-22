import type { ProfileExportResult } from '@/domain/profileExport';
import type { DocumentState } from '@/domain/workspaceModel';
import type { ProfileAnalysis, ProfileAnalysisSnapshot } from '@/state/workspaceProfileAnalysis';
import type { VerbundView, VerbundViewSnapshot } from '@/state/workspaceVerbundView';

/** Frist einer Anfrage an den Worker der Profile-Station; danach endet sie fail-closed. */
export const PROFILE_WORKBENCH_TIMEOUT_MS = 30_000;

export interface ProfileExportRequest {
  readonly documentState: DocumentState;
  readonly rootType: string;
  readonly source: unknown;
}

export type WorkbenchRequest =
  | { readonly type: 'view'; readonly snapshot: VerbundViewSnapshot }
  | { readonly type: 'analyze'; readonly snapshot: ProfileAnalysisSnapshot }
  | { readonly type: 'export'; readonly document: ProfileExportRequest }
  | { readonly type: 'ssp-export'; readonly document: ProfileExportRequest };

/**
 * Ohne `Worker`-API läuft dieselbe Ableitung im Main Thread; ein vorhandener
 * Worker, der nicht startet oder ausfällt, bleibt ein Ausfall.
 */
async function inProcess(request: WorkbenchRequest): Promise<Record<string, unknown>> {
  const { handleProfileWorkbenchRequest } = await import('@/workers/profileWorkbenchRequests');
  return handleProfileWorkbenchRequest(request);
}

/** Ein Worker je Anfrage; nach Antwort, Fehler oder Frist wird er beendet. */
export function runWorkbenchRequest<T>(request: WorkbenchRequest, accept: (frame: Record<string, unknown>) => T | undefined): Promise<T | null> {
  if (typeof Worker === 'undefined') {
    return inProcess(request).then((frame) => accept(frame) ?? null).catch(() => null);
  }
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/profileWorkbench.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let completed = false;
    const onMessage = (event: MessageEvent) => {
      const frame: unknown = event.data;
      complete(frame !== null && typeof frame === 'object' ? accept(frame as Record<string, unknown>) ?? null : null);
    };
    const onFailure = () => complete(null);
    function complete(value: T | null): void {
      if (completed) return;
      completed = true;
      if (timeout !== undefined) clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onFailure);
      worker.removeEventListener('messageerror', onFailure);
      worker.terminate();
      resolve(value);
    }
    try {
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onFailure);
      worker.addEventListener('messageerror', onFailure);
      timeout = setTimeout(onFailure, PROFILE_WORKBENCH_TIMEOUT_MS);
      worker.postMessage(request);
    } catch {
      complete(null);
    }
  });
}

/** Leitet die Verbundansicht im Worker ab; `null` bei Worker-Ausfall. */
export function deriveVerbundViewInWorker(snapshot: VerbundViewSnapshot): Promise<VerbundView | null> {
  return runWorkbenchRequest({ type: 'view', snapshot }, (frame) => frame.type === 'view' ? frame.view as VerbundView : undefined);
}

/** Leitet die Analyse im Worker ab; `null` bei Worker-Ausfall. */
export function analyzeProfileInWorker(snapshot: ProfileAnalysisSnapshot): Promise<ProfileAnalysis | null> {
  return runWorkbenchRequest({ type: 'analyze', snapshot }, (frame) => frame.type === 'analysis' ? frame.analysis as ProfileAnalysis : undefined);
}

/** Prüft und serialisiert einen Export im Worker; ein Worker-Ausfall ist ein abgelehnter Export. */
export async function exportProfileInWorker(document: ProfileExportRequest): Promise<ProfileExportResult> {
  const result = await runWorkbenchRequest({ type: 'export', document: { documentState: document.documentState, rootType: document.rootType, source: document.source } },
    (frame) => frame.type === 'exported' ? frame.result as ProfileExportResult : undefined);
  return result ?? { ok: false, code: 'OSCAL_EXPORT_WORKER_FAILURE', path: '/' };
}
