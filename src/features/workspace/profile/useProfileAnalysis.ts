import { useContext, useEffect, useMemo, useState } from 'react';
import { SUPPORTED_CATALOGS, type CatalogKey } from '@/domain/sourceRegistry';
import type { LocalId, VerbundId, WorkspaceBinding } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';
import type { ProfileAnalysis } from '@/state/workspaceProfileAnalysis';
import { createProfileAnalysisSession } from '@/state/workspaceProfileAnalysisSession';
import type { WorkspaceDocuments } from '@/state/workspaceDocuments';

/** Wartezeit nach der letzten Änderung, bevor Graph, Schema und Resolution neu abgeleitet werden. */
export const PROFILE_ANALYSIS_DELAY_MS = 250;

/**
 * Validierungs- und Resolutionsdiagnosen des Arbeitsstands, nach jeder
 * Änderung neu abgeleitet. Gebundene BSI-Kataloge werden dafür geladen; der
 * Graph erhält sie erst nach bestandener Hashprüfung.
 */
export function useProfileAnalysis(verbundId: VerbundId, localId: LocalId, source: unknown, bindings: readonly WorkspaceBinding[]): {
  readonly analysis: ProfileAnalysis | null;
  readonly current: boolean;
  /** Die letzte Ableitung ist gescheitert; es gibt dann keinen (veralteten) Befund. */
  readonly failed: boolean;
  /** Die Bindungen, mit denen `analysis` abgeleitet wurde. */
  readonly analyzedBindings: readonly WorkspaceBinding[];
} {
  const { documents } = useWorkspace();
  const { requestCatalog } = useContext(CatalogContext);
  const session = useMemo(() => createProfileAnalysisSession(), [verbundId, localId]);
  const [state, setState] = useState<{ analysis: ProfileAnalysis | null; failed: boolean; source: unknown; bindings: readonly WorkspaceBinding[]; documents?: WorkspaceDocuments; session?: typeof session }>({ analysis: null, failed: false, source: undefined, bindings: [] });

  useEffect(() => () => session.dispose(), [session]);

  useEffect(() => {
    for (const binding of bindings) {
      if (binding.target.kind !== 'class-1') continue;
      const artifactKey = binding.target.artifactKey;
      const entry = SUPPORTED_CATALOGS.find((catalog) => catalog.artifactKey === artifactKey);
      if (entry) requestCatalog?.(entry.catalogKey as CatalogKey);
    }
  }, [bindings, requestCatalog]);

  useEffect(() => {
    if (source === undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void session.analyze(documents, { verbundId, localId, source, bindings }, controller.signal).then((result) => {
        if (!controller.signal.aborted && (result.ok || result.diagnostic.code !== 'WORKSPACE_OPERATION_CANCELLED')) {
          setState({ analysis: result.ok ? result.value : null, failed: !result.ok, source, bindings, documents, session });
        }
      });
    }, PROFILE_ANALYSIS_DELAY_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [documents, verbundId, localId, source, bindings, session]);

  const current = state.source === source && state.bindings === bindings && state.documents === documents && state.session === session;
  return { analysis: state.analysis, failed: current && state.failed, analyzedBindings: state.bindings, current };
}
