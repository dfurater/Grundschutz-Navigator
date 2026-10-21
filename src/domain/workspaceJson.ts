import { compareStringsByCodeUnit } from '@/domain/codeUnitOrder.mjs';

function encode(value: unknown, sorted: boolean): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('WORKSPACE_JSON_INVALID');
    return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, child => encode(child, sorted)).join(',')}]`;
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const entries = Object.entries(value);
    if (sorted) entries.sort(([left], [right]) => compareStringsByCodeUnit(left, right));
    const members = entries.map(([key, child]) => `${JSON.stringify(key)}:${encode(child, sorted)}`);
    return `{${members.join(',')}}`;
  }
  throw new Error('WORKSPACE_JSON_INVALID');
}

function encodeWith(value: unknown, sorted: boolean): string {
  try { return encode(value, sorted); }
  catch { throw new Error('WORKSPACE_JSON_INVALID'); }
}

/** Callers validate the bounded plain-data graph; numeric tokens retain negative zero. */
export function serializeWorkspaceJson(value: unknown): string {
  return encodeWith(value, false);
}

/**
 * Dieselben Invarianten wie `serializeWorkspaceJson`, Objektschlüssel in
 * UTF-16-Code-Unit-Ordnung. Arrays behalten ihre Reihenfolge. Grundlage des
 * Content-Hash (GSPP-315), damit die Schlüsselreihenfolge den Hash nicht ändert.
 */
export function serializeWorkspaceJsonSorted(value: unknown): string {
  return encodeWith(value, true);
}
