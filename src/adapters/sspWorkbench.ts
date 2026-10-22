import { runWorkbenchRequest, type ProfileExportRequest } from '@/adapters/profileWorkbench';
import type { SspExportResult } from '@/domain/sspExport';

/**
 * Prüft und serialisiert einen SSP-Export im Worker der Informationsverbünde
 * (`profileWorkbench.worker.ts`); ein Worker-Ausfall ist ein abgelehnter Export.
 */
export async function exportSspInWorker(document: ProfileExportRequest): Promise<SspExportResult> {
  const result = await runWorkbenchRequest({ type: 'ssp-export', document: { documentState: document.documentState, rootType: document.rootType, source: document.source } },
    (frame) => frame.type === 'exported' ? frame.result as SspExportResult : undefined);
  return result ?? { ok: false, code: 'OSCAL_EXPORT_WORKER_FAILURE', path: '/' };
}
