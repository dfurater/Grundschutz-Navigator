import { useContext, useEffect, useMemo, useState } from 'react';
import { buildTargetControlIndex } from '@/domain/profileTargetControls';
import { SUPPORTED_CATALOGS, type CatalogKey } from '@/domain/sourceRegistry';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { BindingTarget, LocalId } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';
import type { CatalogVerification } from '@/features/workspace/profile/ProfileMarks';
import type { VerbundView } from '@/state/workspaceVerbundView';

export interface ImportTargetOption {
  readonly key: string;
  readonly target: BindingTarget;
  readonly origin: 'class-1' | 'local';
  readonly title: string;
  /** Registerschlüssel eines BSI-Katalogs. */
  readonly artifactKey?: string;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  /** Anzahl der Anforderungen, sobald das Ziel gelesen ist. */
  readonly count?: number;
  /** Hashprüfung eines BSI-Katalogs in dieser Sitzung. */
  readonly verification?: CatalogVerification;
}

function verificationOf(valid: boolean | undefined, error: string | null | undefined): CatalogVerification {
  if (valid !== undefined) return valid ? 'valid' : 'invalid';
  return error ? 'unavailable' : 'pending';
}

/** Ein Katalog mit fehlgeschlagener Hashprüfung oder Ladefehler wird nie aufgelöst und ist kein wählbares Ziel. */
export function selectableTarget(option: ImportTargetOption): boolean {
  return option.verification !== 'invalid' && option.verification !== 'unavailable';
}

export function targetKey(target: BindingTarget): string {
  return target.kind === 'local' ? `local:${target.localId}` : `class-1:${target.artifactKey}`;
}

/**
 * Wählbare Importziele: ausgelieferte BSI-Kataloge (`lifecycle: 'supported'`)
 * und die Catalogs und Profiles genau dieses Verbunds. Ein Dokument eines
 * anderen Verbunds ist nie Teil der Ansicht und damit nie wählbar.
 */
export function useImportTargets(view: VerbundView, excludeLocalId?: LocalId): readonly ImportTargetOption[] {
  const { catalogs, catalogDirectory, requestCatalog } = useContext(CatalogContext);
  const { documents } = useWorkspace();
  const [localCounts, setLocalCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const catalogEntries = useMemo(() => SUPPORTED_CATALOGS.filter((entry) => entry.expectedRootType === 'catalog'), []);

  useEffect(() => {
    for (const entry of catalogEntries) requestCatalog?.(entry.catalogKey as CatalogKey);
  }, [catalogEntries, requestCatalog]);

  const locals = useMemo(
    () => view.documents.filter((document) => (document.rootType === 'catalog' || document.rootType === 'profile') && document.localId !== excludeLocalId),
    [view.documents, excludeLocalId],
  );

  useEffect(() => {
    let current = true;
    void Promise.all(locals.filter((document) => document.rootType === 'catalog').map(async (document) => {
      const result = await documents.getDocument(document.localId);
      const index = result.ok ? buildTargetControlIndex(result.value?.source) : null;
      return index ? [[document.localId, index.ids.length] as const] : [];
    })).then((entries) => { if (current) setLocalCounts(new Map(entries.flat())); });
    return () => { current = false; };
  }, [locals, documents]);

  return useMemo(() => [
    ...catalogEntries.map((entry): ImportTargetOption => {
      const loaded = catalogs.get(entry.catalogKey as CatalogKey);
      const target: BindingTarget = { kind: 'class-1', artifactKey: entry.artifactKey };
      return {
        key: targetKey(target),
        target,
        origin: 'class-1',
        title: loaded?.catalog?.metadata.title ?? catalogDirectory.find((item) => item.catalogKey === entry.catalogKey)?.title ?? entry.title ?? entry.artifactKey,
        artifactKey: entry.artifactKey,
        rootType: 'catalog',
        oscalVersion: entry.oscalVersion,
        count: loaded?.catalog?.controls.length,
        verification: verificationOf(loaded?.verification?.valid, loaded?.error),
      };
    }),
    ...locals.map((document): ImportTargetOption => {
      const target: BindingTarget = { kind: 'local', localId: document.localId };
      return {
        key: targetKey(target),
        target,
        origin: 'local',
        title: document.title ?? '',
        rootType: document.rootType,
        oscalVersion: document.oscalVersion,
        count: localCounts.get(document.localId),
      };
    }),
  ], [catalogEntries, catalogs, catalogDirectory, locals, localCounts]);
}
