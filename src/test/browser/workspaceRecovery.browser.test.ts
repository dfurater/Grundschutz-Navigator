import Dexie from 'dexie';
import { expect, test, vi } from 'vitest';
import { WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { open, value } from '@/test/browser/workspaceStoreFixtures';

type Recovery = { valueEncoding: string; payload: { root: number; nodes: unknown[][] } };

/** Follow the documented references without decoding or executing stored type names. */
function nodeAt(backup: Recovery, ...path: string[]): unknown[] {
  let node = backup.payload.nodes[backup.payload.root];
  for (const key of path) {
    const entries = (node[0] === 'array' ? node[2] : node[1]) as [string, number][];
    node = backup.payload.nodes[entries.find(([name]) => name === key)![1]];
  }
  return node;
}

test('sichert Date und Binäransichten neuerer Stores mit eindeutigen Typen und Referenzen', async () => {
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ futureStore: '' });
  await next.open();
  try {
    const buffer = new Uint8Array([1, 2, 255, 4]).buffer;
    const row = {
      date: new Date('2026-10-18T00:00:00.000Z'),
      buffer, binary: new Uint8Array(buffer, 1, 2), view: new DataView(buffer, 2, 1),
      lookalike: { date: '2026-10-18T00:00:00.000Z', binary: 'AQL/BA==' },
    };
    await next.table('futureStore').add(row, 'separate');
    const older = await open();
    const backup = JSON.parse(value(await older.exportBackup()));
    expect(backup.valueEncoding).toBe('gspp-structured-clone-v1');
    expect(nodeAt(backup, 'futureStore', '0', 'date')).toEqual(['date', '1792281600000']);
    const bufferNode = nodeAt(backup, 'futureStore', '0', 'buffer');
    expect(bufferNode).toEqual(['buffer', 'AQL/BA==']);
    const bufferId = backup.payload.nodes.indexOf(bufferNode);
    expect(nodeAt(backup, 'futureStore', '0', 'binary')).toEqual(['view', 'Uint8Array', bufferId, 1, 2]);
    expect(nodeAt(backup, 'futureStore', '0', 'view')).toEqual(['view', 'DataView', bufferId, 2, 1]);
    expect(nodeAt(backup, 'futureStore', '0', 'lookalike')[0]).toBe('object');
    expect(nodeAt(backup, 'outOfLineKeys', 'futureStore', '0')).toEqual(['value', 'separate']);
    expect(await next.table('futureStore').get('separate')).toEqual(row);
    expect(await older.createVerbund('Blocked')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
    expect(await older.restoreBackup(new TextEncoder().encode(JSON.stringify(backup)), 'replace-workspace')).toMatchObject({ ok: false });
    expect(await next.table('futureStore').get('separate')).toEqual(row);
  } finally { next.close(); }
});

test.each(['__proto__', 'constructor', 'toString'])('erhält den Store %s mit separatem Schlüssel', async name => {
  // Native creation also checks names that collide with JavaScript object members.
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DATABASE_NAME, 20);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(name);
      request.result.createObjectStore('futureStore');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  await next.open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = next.backendDB().transaction(name, 'readwrite');
      tx.objectStore(name).add({ synthetic: name }, 'separate');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const older = await open();
    const backup = JSON.parse(value(await older.exportBackup()));
    expect(Object.hasOwn(backup, name)).toBe(true);
    expect(backup[name]).toEqual([{ synthetic: name }]);
    expect(Object.hasOwn(backup.outOfLineKeys, name)).toBe(true);
    expect(backup.outOfLineKeys[name]).toEqual(['separate']);
    expect(backup.futureStore).toEqual([]);
    const stored = await new Promise((resolve, reject) => {
      const request = next.backendDB().transaction(name).objectStore(name).get('separate');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(stored).toEqual({ synthetic: name });
  } finally { next.close(); }
});

test.each(['format', 'storageSchemaVersion', 'outOfLineKeys'])('lehnt einen Store mit dem Rahmenfeldnamen %s ohne Datenänderung ab', async name => {
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ [name]: 'id' });
  await next.open();
  try {
    await next.table(name).add({ id: 'synthetic' });
    const older = await open();
    expect(await older.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_INVALID' } });
    expect(await next.table(name).toArray()).toEqual([{ id: 'synthetic' }]);
  } finally { next.close(); }
});

test('erhält Zyklen, Aliase, Arraylücken und besondere Werte im Rettungsgraph', async () => {
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ futureStore: '' });
  await next.open();
  try {
    const shared = { marker: 'shared' };
    const row: Record<string, unknown> = {
      first: shared, second: shared,
      sparse: Object.assign(new Array(3), { 1: undefined, extra: 'array-property' }),
      infinity: Infinity, negativeInfinity: -Infinity, nan: NaN, negativeZero: -0, big: 12345678901234567890n,
      invalidDate: new Date(NaN), map: new Map([[shared, shared]]), set: new Set([shared]), regex: /synthetic/gi,
      lookalike: { valueEncoding: 'gspp-structured-clone-v1', payload: { root: 0, nodes: [['date', '0']] } },
    };
    row.self = row;
    await next.table('futureStore').add(row, 'separate');
    const older = await open();
    const backup = JSON.parse(value(await older.exportBackup()));
    const nodes = backup.payload.nodes as unknown[][];
    expect(nodeAt(backup, 'futureStore', '0', 'first')).toBe(nodeAt(backup, 'futureStore', '0', 'second'));
    expect(nodeAt(backup, 'futureStore', '0', 'self')).toBe(nodeAt(backup, 'futureStore', '0'));
    expect(nodeAt(backup, 'futureStore', '0', 'sparse')).toEqual(['array', 3, [['1', expect.any(Number)], ['extra', expect.any(Number)]]]);
    expect(nodeAt(backup, 'futureStore', '0', 'sparse', '1')).toEqual(['undefined']);
    for (const [key, tag, encoded] of [
      ['infinity', 'number', 'Infinity'], ['negativeInfinity', 'number', '-Infinity'], ['nan', 'number', 'NaN'],
      ['negativeZero', 'number', '-0'], ['big', 'bigint', '12345678901234567890'], ['invalidDate', 'date', 'NaN'],
    ]) expect(nodeAt(backup, 'futureStore', '0', key)).toEqual([tag, encoded]);
    const sharedId = nodes.indexOf(nodeAt(backup, 'futureStore', '0', 'first'));
    expect(nodeAt(backup, 'futureStore', '0', 'map')).toEqual(['map', [[sharedId, sharedId]]]);
    expect(nodeAt(backup, 'futureStore', '0', 'set')).toEqual(['set', [sharedId]]);
    expect(nodeAt(backup, 'futureStore', '0', 'regex')).toEqual(['regexp', 'synthetic', 'gi']);
    expect(nodeAt(backup, 'futureStore', '0', 'lookalike')[0]).toBe('object');
    const stored = await next.table('futureStore').get('separate');
    expect(stored.self).toBe(stored);
    expect(stored.first).toBe(stored.second);
  } finally { next.close(); }
});

test('bricht bei nicht unterstützten Werten redigiert ab und erhält den gespeicherten Bestand', async () => {
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ futureStore: '' });
  await next.open();
  try {
    await next.table('futureStore').add(new Blob(['PRIVATE_SYNTHETIC'], { type: 'text/plain' }), 'separate');
    const older = await open();
    const result = await older.exportBackup();
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_STORAGE_FAILED' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
    expect(await (await next.table('futureStore').get('separate')).text()).toBe('PRIVATE_SYNTHETIC');
  } finally { next.close(); }
});

test.each(['buffer', 'typed', 'view'])('lehnt veränderbare Puffer ohne stillen Eigenschaftsverlust ab (%s)', async kind => {
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ futureStore: '' });
  await next.open();
  try {
    const buffer = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer;
    expect(Reflect.get(buffer, 'resizable')).toBe(true);
    const storedValue = kind === 'buffer' ? buffer : kind === 'typed' ? new Uint8Array(buffer) : new DataView(buffer);
    await next.table('futureStore').add(storedValue, 'separate');
    const older = await open();
    const result = await older.exportBackup();
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_STORAGE_FAILED' } });
    expect(result).not.toHaveProperty('value');
    const saved = await next.table('futureStore').get('separate');
    const savedBuffer = saved instanceof ArrayBuffer ? saved : saved.buffer;
    expect(Reflect.get(savedBuffer, 'resizable')).toBe(true);
    expect(Reflect.get(savedBuffer, 'maxByteLength')).toBe(8);
    expect(savedBuffer.byteLength).toBe(4);
  } finally { next.close(); }
});

test('bricht die native Lesetransaktion nach einer Zeile ohne Teilbackup und ohne Datenänderung ab', async () => {
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ futureStore: '' });
  await next.open();
  try {
    await next.table('futureStore').bulkAdd([{ sentinel: 'PRIVATE_ONE' }, { sentinel: 'PRIVATE_TWO' }], ['one', 'two']);
    const before = await next.table('futureStore').toArray();
    const older = await open();
    const original = IDBCursor.prototype.continue;
    let rows = 0;
    const cursor = vi.spyOn(IDBCursor.prototype, 'continue').mockImplementation(function (this: IDBCursor, ...args: Parameters<IDBCursor['continue']>) {
      if (this.source instanceof IDBObjectStore && this.source.name === 'futureStore') {
        rows++;
        this.source.transaction.abort();
      } else original.apply(this, args);
    });
    const result = await older.exportBackup();
    cursor.mockRestore();
    expect(rows).toBe(1);
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_STORAGE_FAILED' } });
    expect(result).not.toHaveProperty('value');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(await next.table('futureStore').toArray()).toEqual(before);
    expect(await next.table('futureStore').toCollection().primaryKeys()).toEqual(['one', 'two']);
  } finally { next.close(); }
});
