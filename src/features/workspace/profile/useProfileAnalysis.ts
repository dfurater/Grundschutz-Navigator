import { useContext, useEffect, useState } from 'react';
import { SUPPORTED_CATALOGS, type CatalogKey } from '@/domain/sourceRegistry';
import type { LocalId, VerbundId, WorkspaceBinding } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';
import type { ProfileAnalysis } from '@/state/workspaceProfileAnalysis';

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
} {
  const { documents } = useWorkspace();
  const { requestCatalog } = useContext(CatalogContext);
  const [state, setState] = useState<{ analysis: ProfileAnalysis | null; source: unknown; bindings: readonly WorkspaceBinding[] }>({ analysis: null, source: undefined, bindings: [] });

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
    let active = true;
    const timer = setTimeout(() => {
      void documents.analyzeProfile({ verbundId, localId, source, bindings }).then((result) => {
        if (active && result.ok) setState({ analysis: result.value, source, bindings });
      });
    }, PROFILE_ANALYSIS_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [documents, verbundId, localId, source, bindings]);

  return { analysis: state.analysis, current: state.source === source && state.bindings === bindings };
}
