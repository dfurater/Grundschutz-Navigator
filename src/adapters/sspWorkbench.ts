import { runWorkbenchRequest, type ProfileExportRequest } from '@/adapters/profileWorkbench';
import type { TargetCategoryContext } from '@/domain/sspTargetObjects';
import type { SspExportResult } from '@/domain/sspExport';

/**
 * Prüft und serialisiert einen SSP-Export im Worker der Informationsverbünde
 * (`profileWorkbench.worker.ts`); ein Worker-Ausfall ist ein abgelehnter Export.
 */
export async function exportSspInWorker(document: ProfileExportRequest, categories?: TargetCategoryContext): Promise<SspExportResult> {
  const result = await runWorkbenchRequest({ type: 'ssp-export', document: { documentState: document.documentState, rootType: document.rootType, source: document.source, ...(categories ? { categories } : {}) } },
    (frame) => frame.type === 'exported' ? frame.result as SspExportResult : undefined);
  return result ?? { ok: false, code: 'OSCAL_EXPORT_WORKER_FAILURE', path: '/' };
}
