/** Callers validate the bounded plain-data graph before serialization. */
export function serializeWorkspaceJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('WORKSPACE_JSON_INVALID');
      return item;
    });
    if (typeof text !== 'string') throw new Error('WORKSPACE_JSON_INVALID');
    return text;
  } catch {
    throw new Error('WORKSPACE_JSON_INVALID');
  }
}
