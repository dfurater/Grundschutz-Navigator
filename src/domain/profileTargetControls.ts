// =============================================================================
// Anforderungen eines Importziels für die Auswahl in der Profile-Station
//
// Quelle ist ein Katalog-Quellgraph: ein BSI-Katalog, ein lokaler Katalog oder
// der transient aufgelöste Katalog eines Profils. Oberste Gruppen sind
// Praktiken, ihre direkten Untergruppen Gruppen; tiefere Gruppen fallen in
// ihre Gruppe, verschachtelte Controls folgen ihrem Elternteil. `control/@id`
// ist nur innerhalb dieses einen Ziels eindeutig (`identifier-uniqueness=
// "local"`); der Index gilt deshalb immer für genau ein Importziel.
// =============================================================================

import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';

export interface TargetControl {
  readonly id: string;
  readonly title: string;
  readonly parentId?: string;
  /** 0 für ein Control direkt unter einer Gruppe. */
  readonly depth: number;
}

export interface TargetGroup {
  readonly id?: string;
  readonly title: string;
  readonly controls: readonly TargetControl[];
}

export interface TargetPractice {
  readonly id?: string;
  readonly title: string;
  readonly groups: readonly TargetGroup[];
  readonly controlCount: number;
}

export interface TargetControlIndex {
  readonly practices: readonly TargetPractice[];
  /** Alle Control-IDs in Dokumentreihenfolge. */
  readonly ids: readonly string[];
}

function collectControls(controls: readonly unknown[], depth: number, parentId: string | undefined, into: TargetControl[]): void {
  for (const control of controls) {
    if (!isJsonObject(control)) continue;
    const id = readString(control.id);
    if (id === undefined) continue;
    into.push({ id, title: readString(control.title) ?? '', parentId, depth });
    collectControls(readArray(control.controls), depth + 1, id, into);
  }
}

function groupControls(group: JsonObject): TargetControl[] {
  const controls: TargetControl[] = [];
  collectControls(readArray(group.controls), 0, undefined, controls);
  for (const nested of readArray(group.groups)) {
    if (isJsonObject(nested)) controls.push(...groupControls(nested));
  }
  return controls;
}

function practiceOf(group: JsonObject): TargetPractice {
  const groups: TargetGroup[] = [];
  const direct: TargetControl[] = [];
  collectControls(readArray(group.controls), 0, undefined, direct);
  if (direct.length > 0) groups.push({ id: readString(group.id), title: readString(group.title) ?? '', controls: direct });
  for (const child of readArray(group.groups)) {
    if (!isJsonObject(child)) continue;
    groups.push({ id: readString(child.id), title: readString(child.title) ?? '', controls: groupControls(child) });
  }
  return {
    id: readString(group.id),
    title: readString(group.title) ?? '',
    groups,
    controlCount: groups.reduce((sum, entry) => sum + entry.controls.length, 0),
  };
}

/** `null`, wenn die Quelle kein Katalog ist. */
export function buildTargetControlIndex(source: unknown): TargetControlIndex | null {
  const catalog = isJsonObject(source) && isJsonObject(source.catalog) ? source.catalog : undefined;
  if (!catalog) return null;
  const practices: TargetPractice[] = [];
  const root: TargetControl[] = [];
  collectControls(readArray(catalog.controls), 0, undefined, root);
  if (root.length > 0) practices.push({ title: '', groups: [{ title: '', controls: root }], controlCount: root.length });
  for (const group of readArray(catalog.groups)) {
    if (isJsonObject(group)) practices.push(practiceOf(group));
  }
  return {
    practices,
    ids: practices.flatMap((practice) => practice.groups.flatMap((group) => group.controls.map((control) => control.id))),
  };
}
