import { exportProfileDocument, type ProfileExportResult } from '@/domain/profileExport';
import { exportSspDocument, type SspExportResult } from '@/domain/sspExport';
import { deriveProfileAnalysis, withProfileAnalysisInput, type ProfileAnalysisBasis, type ProfileAnalysisInput, type ProfileAnalysisSnapshot } from '@/state/workspaceProfileAnalysis';
import { deriveVerbundView, type VerbundViewSnapshot } from '@/state/workspaceVerbundView';

/** Sitzungsbasis bleibt ausschließlich im Speicher dieses Workers. */
export function createProfileAnalysisHandler() {
  let cached: { id: number; basis: ProfileAnalysisBasis } | undefined;
  return async (request: unknown): Promise<Record<string, unknown>> => {
    const candidate = request as { type?: unknown; requestId?: number; basisId?: number; basis?: ProfileAnalysisBasis; input?: ProfileAnalysisInput } | null;
    const requestId = candidate?.requestId;
    const failure = { type: 'failure', ...(requestId === undefined ? {} : { requestId }) };
    if (candidate?.type !== 'analyze-session' || !Number.isSafeInteger(requestId) || !Number.isSafeInteger(candidate.basisId) || !candidate.input) return failure;
    if (candidate.basis) cached = { id: candidate.basisId!, basis: candidate.basis };
    if (!cached || cached.id !== candidate.basisId) return failure;
    const analysis = await deriveProfileAnalysis(withProfileAnalysisInput(cached.basis, candidate.input));
    return { type: 'analysis', requestId, analysis };
  };
}

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
  if (candidate?.type === 'ssp-export' && candidate.document) {
    const result: SspExportResult = await exportSspDocument(candidate.document as Parameters<typeof exportSspDocument>[0]);
    return { type: 'exported', result };
  }
  return { type: 'failure' };
}
