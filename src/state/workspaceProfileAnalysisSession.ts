import { createProfileAnalysisClient } from '@/adapters/profileAnalysisClient';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { WorkspaceDocuments } from '@/state/workspaceDocuments';
import type { ProfileAnalysis, ProfileAnalysisBasis, ProfileAnalysisInput } from '@/state/workspaceProfileAnalysis';
import type { WorkspaceResult } from '@/domain/workspaceModel';

const cancelled = () => failure(new StorageFailure('WORKSPACE_OPERATION_CANCELLED'));

/** Der Editor besitzt Client und Basis; ein Dispose gibt beide frei und beendet auch die Vorbereitung. */
export function createProfileAnalysisSession() {
  const client = createProfileAnalysisClient();
  let active: AbortController | undefined;
  let cached: { documents: WorkspaceDocuments; version: number; verbundId: string; basis: Promise<WorkspaceResult<ProfileAnalysisBasis>> } | undefined;
  let supplied: { original: ProfileAnalysisBasis; basis: ProfileAnalysisBasis } | undefined;

  return {
    dispose() {
      active?.abort();
      active = undefined;
      cached = undefined;
      supplied = undefined;
      client.dispose();
    },
    async analyze(documents: WorkspaceDocuments, input: ProfileAnalysisInput, signal: AbortSignal): Promise<WorkspaceResult<ProfileAnalysis>> {
      active?.abort();
      if (signal.aborted) return cancelled();
      const controller = new AbortController();
      active = controller;
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      let finishAbort!: () => void;
      const stopped = new Promise<WorkspaceResult<ProfileAnalysis>>((resolve) => {
        finishAbort = () => resolve(cancelled());
        controller.signal.addEventListener('abort', finishAbort, { once: true });
      });
      const version = documents.analysisVersion();
      if (cached?.documents !== documents || cached.version !== version || cached.verbundId !== input.verbundId) {
        cached = { documents, version, verbundId: input.verbundId, basis: documents.loadProfileAnalysisBasis(input.verbundId) };
      }
      const entry = cached;
      const run = async (): Promise<WorkspaceResult<ProfileAnalysis>> => {
        const basis = await entry.basis;
        if (controller.signal.aborted || cached !== entry || documents.analysisVersion() !== version) return cancelled();
        if (!basis.ok) { cached = undefined; return basis; }
        const bindings = [...basis.value.bindings.filter((binding) => binding.fromLocalId !== input.localId), ...input.bindings];
        const bound = new Set(bindings.flatMap((binding) => binding.target.kind === 'class-1' ? [binding.target.artifactKey] : []));
        const class1Artifacts = basis.value.class1Artifacts.filter((artifact) => bound.has(artifact.artifactKey));
        if (supplied?.original !== basis.value || supplied.basis.class1Artifacts.length !== class1Artifacts.length
          || class1Artifacts.some((artifact, index) => supplied?.basis.class1Artifacts[index] !== artifact)) {
          supplied = { original: basis.value, basis: { ...basis.value, class1Artifacts } };
        }
        const analysis = await client.analyze(supplied.basis, input, controller.signal);
        if (controller.signal.aborted || documents.analysisVersion() !== version) return cancelled();
        return analysis ? { ok: true, value: analysis } : failure(new StorageFailure('WORKSPACE_STORAGE_FAILED'));
      };
      try {
        return await Promise.race([stopped, run()]);
      } catch {
        if (cached === entry) cached = undefined;
        return failure(new StorageFailure('WORKSPACE_STORAGE_FAILED'));
      } finally {
        signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', finishAbort);
        if (active === controller) active = undefined;
      }
    },
  };
}
