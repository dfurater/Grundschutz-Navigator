import { serializeWorkspaceJson } from '@/domain/workspaceJson';

function isJsonScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0));
}

function jsonChildren(value: object): Iterator<unknown> | undefined {
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    return keys.length === value.length && keys.every((key, index) => key === String(index)) ? value.values() : undefined;
  }
  return [Object.prototype, null].includes(Object.getPrototypeOf(value)) ? Object.values(value).values() : undefined;
}

/** Depth-first preflight retains iterators and visited object identities, not a second encoded graph. */
function requiresRecoveryGraph(root: unknown): boolean {
  const seen = new WeakSet<object>();
  const stack = [{ values: [root].values() as Iterator<unknown>, depth: 0 }];
  while (stack.length > 0) {
    const frame = stack.at(-1)!;
    const next = frame.values.next();
    if (next.done) { stack.pop(); continue; }
    const value = next.value;
    if (isJsonScalar(value)) continue;
    if (value === null || typeof value !== 'object' || seen.has(value) || frame.depth >= 128) return true;
    const children = jsonChildren(value);
    if (!children) return true;
    seen.add(value);
    stack.push({ values: children, depth: frame.depth + 1 });
  }
  return false;
}

function scalarNode(value: unknown): unknown[] | undefined {
  if (isJsonScalar(value)) return ['value', value];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (value === undefined) return ['undefined'];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  return undefined;
}

/** Versioned recovery graph: references are node indices, never user-controlled type markers. */
export function serializeWorkspaceRecoveryJson(backup: { storageSchemaVersion: number; [key: string]: unknown }): string {
  if (!requiresRecoveryGraph(backup)) return serializeWorkspaceJson(backup);
  const pending: unknown[] = [];
  const nodes: unknown[][] = [];
  const references = new Map<object, number>();

  function reference(value: unknown): number {
    if (value !== null && typeof value === 'object') {
      const previous = references.get(value);
      if (previous !== undefined) return previous;
    }
    const index = pending.length;
    pending.push(value);
    if (value !== null && typeof value === 'object') references.set(value, index);
    return index;
  }

  function encode(value: unknown): unknown[] {
    const scalar = scalarNode(value);
    if (scalar) return scalar;
    if (value instanceof Date) return ['date', String(value.getTime())];
    if (value instanceof ArrayBuffer) {
      if (Reflect.get(value, 'resizable') === true) throw new Error('WORKSPACE_RECOVERY_VALUE_UNSUPPORTED');
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
  // The live array iterator also visits nodes appended by reference(), without recursive traversal.
  for (const value of pending) {
    if (Array.isArray(value)) {
      const entries = Object.entries(value).map(([key, child]) => [key, reference(child)]);
      nodes.push(['array', value.length, entries]);
    } else if (value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      nodes.push(['object', Object.entries(value).map(([key, child]) => [key, reference(child)])]);
    } else nodes.push(encode(value));
  }
  return JSON.stringify({
    format: 'gspp-workspace', storageSchemaVersion: backup.storageSchemaVersion,
    valueEncoding: 'gspp-structured-clone-v1', payload: { root: 0, nodes },
  });
}
