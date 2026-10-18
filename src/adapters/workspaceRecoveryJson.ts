import { serializeWorkspaceJson } from '@/domain/workspaceJson';

function scalarNode(value: unknown): unknown[] | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return ['value', value];
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0)
      ? ['value', value] : ['number', Object.is(value, -0) ? '-0' : String(value)];
  }
  if (value === undefined) return ['undefined'];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  return undefined;
}

/** Versioned recovery graph: references are node indices, never user-controlled type markers. */
export function serializeWorkspaceRecoveryJson(backup: { storageSchemaVersion: number; [key: string]: unknown }): string {
  const pending: unknown[] = [];
  const nodes: unknown[][] = [];
  const references = new Map<object, number>();
  let needsGraph = false;

  function reference(value: unknown): number {
    if (value !== null && typeof value === 'object') {
      const previous = references.get(value);
      if (previous !== undefined) { needsGraph = true; return previous; }
    }
    const index = pending.length;
    pending.push(value);
    if (value !== null && typeof value === 'object') references.set(value, index);
    return index;
  }

  function encode(value: unknown): unknown[] {
    const scalar = scalarNode(value);
    if (scalar) {
      if (scalar[0] !== 'value') needsGraph = true;
      return scalar;
    }
    needsGraph = true;
    if (value instanceof Date) return ['date', String(value.getTime())];
    if (value instanceof ArrayBuffer) {
      let binary = '';
      for (const byte of new Uint8Array(value)) binary += String.fromCodePoint(byte);
      return ['buffer', btoa(binary)];
    }
    if (ArrayBuffer.isView(value)) return ['view', Object.prototype.toString.call(value).slice(8, -1), reference(value.buffer), value.byteOffset, value.byteLength];
    if (value instanceof Map) return ['map', [...value].map(([key, child]) => [reference(key), reference(child)])];
    if (value instanceof Set) return ['set', [...value].map(reference)];
    if (value instanceof RegExp) return ['regexp', value.source, value.flags];
    // Unsupported structured-clone types fail closed instead of silently dropping data.
    throw new Error('WORKSPACE_RECOVERY_VALUE_UNSUPPORTED');
  }

  reference(backup);
  // Iterative traversal preserves cycles and deep future graphs without recursive serialization.
  for (let index = 0; index < pending.length; index++) {
    const value = pending[index];
    if (Array.isArray(value)) {
      const entries = Object.entries(value).map(([key, child]) => [key, reference(child)]);
      if (entries.length !== value.length || entries.some(([key], offset) => key !== String(offset))) needsGraph = true;
      nodes.push(['array', value.length, entries]);
    } else if (value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      nodes.push(['object', Object.entries(value).map(([key, child]) => [key, reference(child)])]);
    } else nodes.push(encode(value));
  }
  if (!needsGraph) {
    try { return serializeWorkspaceJson(backup); }
    catch { /* A deep future JSON tree can exceed the recursive serializer's stack; use the flat graph. */ }
  }
  return JSON.stringify({
    format: 'gspp-workspace', storageSchemaVersion: backup.storageSchemaVersion,
    valueEncoding: 'gspp-structured-clone-v1', payload: { root: 0, nodes },
  });
}
