/** Web-Locks-Nachbildung für jsdom: exklusive und geteilte Locks je Name in Anforderungsreihenfolge, `ifAvailable` und `query()`. */
export function fakeLocks(): LockManager {
  const held: LockInfo[] = [];
  const queue: (LockInfo & { readonly grant: () => void })[] = [];
  const grantable = (lock: LockInfo, ahead: readonly LockInfo[]) =>
    [...held, ...ahead].every((other) => other.name !== lock.name || (lock.mode === 'shared' && other.mode === 'shared'));
  const pump = () => {
    for (let index = 0; index < queue.length;) {
      if (grantable(queue[index], queue.slice(0, index))) queue.splice(index, 1)[0].grant();
      else index++;
    }
  };
  const run = async (lock: LockInfo, callback: LockGrantedCallback<unknown>) => {
    held.push(lock);
    try { return await callback(lock as Lock); } finally {
      held.splice(held.indexOf(lock), 1);
      pump();
    }
  };
  return {
    request: (name: string, ...rest: unknown[]) => {
      const callback = rest.at(-1) as LockGrantedCallback<unknown>;
      const options = (rest.length > 1 ? rest[0] : {}) as LockOptions;
      const lock: LockInfo = { name, mode: options.mode ?? 'exclusive' };
      if (grantable(lock, queue)) return run(lock, callback);
      if (options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise<unknown>((resolve, reject) => {
        queue.push({ ...lock, grant: () => { run(lock, callback).then(resolve, reject); } });
      });
    },
    query: () => Promise.resolve({ held: held.map(({ name, mode }) => ({ name, mode })), pending: queue.map(({ name, mode }) => ({ name, mode })) }),
  } as LockManager;
}
