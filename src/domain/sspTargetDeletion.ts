import type { LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import type { SspPath } from '@/domain/sspAuthoring';
import { readSspValue } from '@/domain/sspAuthoring';
import { isJsonObject, pointerString, readArray, readString } from '@/domain/jsonGuards';
import { TARGET_LISTS } from '@/domain/sspTargetObjects';

function localUses(source: unknown, uuid: string | undefined): string[] {
  if (uuid === undefined) return [];
  const found: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${path}/${index}`)); return; }
    if (!isJsonObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      // Eigene Identitäten, Freitext und fremde Properties beweisen keinen Bezug.
      if ((['component-uuid', 'inventory-item-uuid', 'information-type-uuid', 'subject-uuid'].includes(key) && typeof value === 'string' && value.toLowerCase() === uuid)
        || (key === 'href' && typeof value === 'string' && value.toLowerCase() === `#${uuid}`)) found.push(`${path}/${key}`);
      walk(value, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
    }
  };
  walk(source, '');
  return found;
}

/** Nur explizite lokale Bindungen bilden den Dokumentverbund; unprüfbare Bindungen sperren konservativ. */
function incomingUses(localId: LocalId, members: readonly WorkspaceEnvelope[], bindings: readonly WorkspaceBinding[]): string[] {
  const found = new Set<string>();
  const reached = new Set<string>([localId]);
  const queue: string[] = [localId];
  while (queue.length) {
    const next = queue.shift()!;
    for (const binding of bindings) {
      if (binding.target.kind !== 'local' || binding.target.localId !== next || binding.fromLocalId === localId) continue;
      const member = members.find(member => member.localId === binding.fromLocalId);
      if (!member || pointerString(member.source, binding.pointer) !== binding.href) found.add('Verwendung nicht vollständig prüfbar');
      else found.add(`${binding.fromLocalId}${binding.pointer}`);
      if (!reached.has(binding.fromLocalId)) { reached.add(binding.fromLocalId); queue.push(binding.fromLocalId); }
    }
  }
  return [...found];
}

export function targetDeletionUses(source: unknown, path: SspPath, localId: LocalId, members: readonly WorkspaceEnvelope[], bindings: readonly WorkspaceBinding[]): readonly string[] {
  const item = readSspValue(source, path);
  if (!isJsonObject(item)) return ['Verwendung nicht vollständig prüfbar'];
  return [...localUses(source, readString(item.uuid)?.toLowerCase()), ...incomingUses(localId, members, bindings)];
}

/** Läuft mit aktuellen Quellen und Bindungen in der Schreibtransaktion, auch nach einem Autosave/Tabwechsel. */
export function sspDeletionBlocked(before: unknown, after: unknown, localId: LocalId, members: readonly WorkspaceEnvelope[], bindings: readonly WorkspaceBinding[]): boolean {
  for (const { path } of TARGET_LISTS) {
    const old = readArray(readSspValue(before, path));
    const next = readArray(readSspValue(after, path));
    const countUuid = (items: readonly unknown[], uuid: string) => items.filter(item => isJsonObject(item) && readString(item.uuid)?.toLowerCase() === uuid).length;
    const removed = old.filter(item => isJsonObject(item) && typeof item.uuid === 'string' && countUuid(old, item.uuid.toLowerCase()) > countUuid(next, item.uuid.toLowerCase()));
    const noUuid = (items: readonly unknown[]) => items.filter(item => isJsonObject(item) && item.uuid === undefined).length;
    if (!removed.length && noUuid(old) <= noUuid(next) && next.length >= old.length) continue;
    if (incomingUses(localId, members, bindings).length) return true;
    if (old.some(item => !isJsonObject(item) || (typeof item.uuid !== 'string' && !(path.at(-1) === 'information-types' && item.uuid === undefined)))) return true;
    if (removed.some(item => isJsonObject(item) && localUses(after, readString(item.uuid)?.toLowerCase()).length)) return true;
  }
  return false;
}
