import { exportProfileDocument, type ProfileExportResult } from '@/domain/profileExport';
import { deriveProfileAnalysis, type ProfileAnalysisSnapshot } from '@/state/workspaceProfileAnalysis';
import { deriveVerbundView, type VerbundViewSnapshot } from '@/state/workspaceVerbundView';

/** Antwortrahmen je Anfrageart; `failure` für jede unbekannte Anfrage. */
export async function handleProfileWorkbenchRequest(request: unknown): Promise<Record<string, unknown>> {
  const candidate = request as { type?: unknown; snapshot?: unknown; document?: unknown } | null;
  if (candidate?.type === 'view' && candidate.snapshot) {
    return { type: 'view', view: await deriveVerbundView(candidate.snapshot as VerbundViewSnapshot) };
  }
  if (candidate?.type === 'analyze' && candidate.snapshot) {
    return { type: 'analysis', analysis: await deriveProfileAnalysis(candidate.snapshot as ProfileAnalysisSnapshot) };
  }
  if (candidate?.type === 'export' && candidate.document) {
    const result: ProfileExportResult = await exportProfileDocument(candidate.document as Parameters<typeof exportProfileDocument>[0]);
    return { type: 'exported', result };
  }
  return { type: 'failure' };
}
