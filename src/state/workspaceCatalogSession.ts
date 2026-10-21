import type { CatalogState } from '@/domain/models';
import { getCatalogByKey } from '@/domain/sourceRegistry';
import type { CatalogDelivery } from '@/domain/workspaceCatalogPin';
import type { WorkspaceClass1Artifact } from '@/domain/workspaceGraphModel';

/**
 * Bereits geladene Kataloge mit bestandener Hashprüfung als lesende
 * Klasse-1-Artefakte für den Dokumentgraphen. Nicht verifizierte oder nicht
 * unterstützte Kataloge bleiben draußen; nichts davon gelangt in den Speicher.
 */
export function verifiedCatalogArtifacts(catalogs: CatalogState['catalogs'] | undefined): WorkspaceClass1Artifact[] {
  const artifacts: WorkspaceClass1Artifact[] = [];
  for (const [catalogKey, loaded] of catalogs ?? []) {
    const entry = getCatalogByKey(catalogKey);
    if (entry?.lifecycle !== 'supported' || !loaded.catalogDocument || loaded.verification?.valid !== true) continue;
    artifacts.push({
      artifactKey: entry.artifactKey,
      lifecycle: 'supported',
      trustClass: 'class-1-verified-public',
      rootType: entry.expectedRootType,
      oscalVersion: entry.oscalVersion,
      source: loaded.catalogDocument.source,
    });
  }
  return artifacts;
}

/**
 * Ausgelieferter Katalogstand je `artifactKey`: Commit aus dem eigenen Manifest
 * und Ergebnis der Laufzeit-Hashprüfung. Ein noch ladender Katalog fehlt.
 */
export function catalogDelivery(catalogs: CatalogState['catalogs'] | undefined): CatalogDelivery {
  const delivery = new Map<string, { commit: string | null; verified: boolean }>();
  for (const [catalogKey, loaded] of catalogs ?? []) {
    const entry = getCatalogByKey(catalogKey);
    if (entry?.lifecycle !== 'supported' || (loaded.loading && !loaded.error)) continue;
    const verified = loaded.catalogDocument !== null && loaded.verification?.valid === true;
    delivery.set(entry.artifactKey, { commit: verified ? loaded.verification!.sourceCommit : null, verified });
  }
  return delivery;
}
