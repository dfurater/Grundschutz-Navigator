/** Web-Locks-Nachbildung für jsdom: exklusive Locks je Name, `ifAvailable` und `query()`. */
export function fakeLocks(): LockManager {
  const held = new Set<string>();
  const waiting = new Map<string, (() => void)[]>();
  const run = async (name: string, callback: LockGrantedCallback<unknown>) => {
    held.add(name);
    try { return await callback({ name, mode: 'exclusive' }); } finally {
      held.delete(name);
      waiting.get(name)?.shift()?.();
    }
  };
  return {
    request: (name: string, ...rest: unknown[]) => {
      const callback = rest.at(-1) as LockGrantedCallback<unknown>;
      const options = (rest.length > 1 ? rest[0] : {}) as LockOptions;
      if (!held.has(name)) return run(name, callback);
      if (options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise<unknown>((resolve, reject) => {
        waiting.set(name, [...(waiting.get(name) ?? []), () => { run(name, callback).then(resolve, reject); }]);
      });
    },
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name, mode: 'exclusive' as const })), pending: [] }),
  } as LockManager;
}
