import { useContext, useEffect, useState } from 'react';
import { buildWorkspaceCatalog } from '@/domain/workspaceCatalog';
import type { CatalogPin } from '@/domain/workspaceCatalogPin';
import { SUPPORTED_CATALOGS, type CatalogKey } from '@/domain/sourceRegistry';
import type { BindingTarget, VerbundId } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';

/** Control-IDs der Baseline; `null` heißt: im aktuellen Kontext nicht auflösbar. */
export type BaselineControls = readonly string[] | null;

/**
 * Anforderungen der gebundenen Baseline: ein BSI-Katalog erst nach bestandener
 * Hashprüfung und nur, solange das Dokument an genau den ausgelieferten Stand
 * gebunden ist (`pin`), ein lokaler Catalog über dieselbe Katalogprojektion wie
 * der Verbundgraph (mehrdeutige IDs machen ihn unauflösbar), ein lokales Profil
 * über die Auflösung im Worker. `control/@id` ist nur innerhalb dieser einen
 * Baseline eindeutig.
 */
export function useBaselineControls(verbundId: VerbundId, target: BindingTarget | undefined, pin: CatalogPin | undefined): BaselineControls {
  const { catalogs, requestCatalog } = useContext(CatalogContext);
  const { documents } = useWorkspace();
  const [local, setLocal] = useState<{ key: string; ids: BaselineControls }>();
  const entry = target?.kind === 'class-1' ? SUPPORTED_CATALOGS.find((catalog) => catalog.artifactKey === target.artifactKey) : undefined;
  const localId = target?.kind === 'local' ? target.localId : undefined;

  useEffect(() => {
    if (entry) requestCatalog?.(entry.catalogKey as CatalogKey);
  }, [entry, requestCatalog]);

  useEffect(() => {
    if (localId === undefined) return;
    let current = true;
    void (async (): Promise<BaselineControls> => {
      const document = await documents.getDocument(localId);
      if (!document.ok || !document.value) return null;
      if (document.value.rootType === 'catalog') {
        const catalog = buildWorkspaceCatalog(document.value.source);
        return catalog.status === 'success' ? [...catalog.catalog.controlsById.keys()] : null;
      }
      if (document.value.rootType !== 'profile') return null;
      const bindings = await documents.listBindings();
      if (!bindings.ok) return null;
      const own = bindings.value.filter((binding) => binding.fromLocalId === localId);
      const analysis = await documents.analyzeProfile({ verbundId, localId, source: document.value.source, bindings: own });
      return analysis.ok && analysis.value.resolution.status === 'resolved' ? analysis.value.resolution.index.ids : null;
    })().then((ids) => { if (current) setLocal({ key: localId, ids }); });
    return () => { current = false; };
  }, [documents, localId, verbundId]);

  if (entry) {
    // Ein anderer als der gebundene Stand bewertet nie still um (applyCatalogPins hält ihn aus dem Graphen).
    if (pin && pin.state !== 'bound') return null;
    const loaded = catalogs.get(entry.catalogKey as CatalogKey);
    return loaded?.verification?.valid === true && loaded.catalog ? loaded.catalog.controls.map((control) => control.id) : null;
  }
  return localId !== undefined && local?.key === localId ? local.ids : null;
}
