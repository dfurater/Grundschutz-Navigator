import type { VocabularyNamespaceData } from '@/domain/models';
import { compareStringsByCodeUnit } from '@/domain/codeUnitOrder.mjs';

export type CategoryClosure =
  | { readonly status: 'invalid'; readonly code: string }
  | { readonly status: 'ready'; readonly catalogKey: 'gspp'; readonly commit: string; readonly objectId: string;
      readonly direct: readonly string[]; readonly effective: readonly string[];
      readonly entries: readonly { readonly uuid: string; readonly direct: boolean; readonly derivedFrom: readonly string[] }[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Prüft den ganzen Graphen vor jeder Auswertung; ein Fehler liefert keine Teilmenge. */
export function closeTargetCategories(namespace: VocabularyNamespaceData, selected: readonly string[], objectId: string, commit: string): CategoryClosure {
  const invalid = (): CategoryClosure => ({ status: 'invalid', code: 'SSP_CATEGORY_GRAPH_INVALID' });
  const parents = new Map<string, string>();
  for (const entry of namespace.entries) {
    const uuid = entry.columns.UUID?.toLowerCase();
    const parent = entry.columns.ChildOfUUID?.toLowerCase();
    if (!uuid || !UUID.test(uuid) || parent === undefined || (parent !== '' && !UUID.test(parent)) || parents.has(uuid)) return invalid();
    parents.set(uuid, parent);
  }
  const ancestors = new Map<string, string[]>();
  for (const uuid of parents.keys()) {
    const seen = new Set<string>([uuid]);
    const chain: string[] = [];
    let parent = parents.get(uuid)!;
    while (parent !== '') {
      if (!parents.has(parent) || seen.has(parent)) return invalid();
      seen.add(parent);
      chain.push(parent);
      parent = parents.get(parent)!;
    }
    ancestors.set(uuid, chain);
  }
  const direct = [...new Set(selected.map(value => value.toLowerCase()))].sort(compareStringsByCodeUnit);
  if (direct.some(uuid => !parents.has(uuid))) return { status: 'invalid', code: 'SSP_CATEGORY_UNKNOWN' };
  const effective = [...new Set(direct.flatMap(uuid => [uuid, ...ancestors.get(uuid)!]))].sort(compareStringsByCodeUnit);
  return { status: 'ready', catalogKey: 'gspp', commit, objectId, direct, effective,
    entries: effective.map(uuid => ({ uuid, direct: direct.includes(uuid), derivedFrom: direct.filter(chosen => ancestors.get(chosen)!.includes(uuid)) })) };
}
