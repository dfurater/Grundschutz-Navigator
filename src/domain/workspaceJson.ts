function encode(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('WORKSPACE_JSON_INVALID');
    return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, encode).join(',')}]`;
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const members = Object.entries(value).map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`);
    return `{${members.join(',')}}`;
  }
  throw new Error('WORKSPACE_JSON_INVALID');
}

/** Callers validate the bounded plain-data graph; numeric tokens retain negative zero. */
export function serializeWorkspaceJson(value: unknown): string {
  try { return encode(value); }
  catch { throw new Error('WORKSPACE_JSON_INVALID'); }
}
