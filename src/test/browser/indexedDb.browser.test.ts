import { afterEach, expect, test } from 'vitest';

const createdDatabaseNames = new Set<string>();

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore('records', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB konnte nicht geöffnet werden.'));
    request.onsuccess = () => resolve(request.result);
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB-Transaktion fehlgeschlagen.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB-Transaktion wurde abgebrochen.'));
  });
}

function readRecord(
  database: IDBDatabase,
  id: string,
): Promise<{ id: string; value: string } | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('records', 'readonly');
    const request = transaction.objectStore('records').get(id);

    request.onerror = () => reject(request.error ?? new Error('IndexedDB-Datensatz konnte nicht gelesen werden.'));
    request.onsuccess = () => resolve(request.result as { id: string; value: string } | undefined);
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);

    request.onerror = () => reject(request.error ?? new Error('IndexedDB-Datenbank konnte nicht gelöscht werden.'));
    request.onsuccess = () => resolve();
  });
}

afterEach(async () => {
  await Promise.all([...createdDatabaseNames].map(deleteDatabase));
  createdDatabaseNames.clear();
});

test('speichert, liest und löscht einen Datensatz in echtem IndexedDB', async () => {
  const databaseName = `gspp-browser-reference-${crypto.randomUUID()}`;
  createdDatabaseNames.add(databaseName);

  const database = await openDatabase(databaseName);
  const writeTransaction = database.transaction('records', 'readwrite');
  writeTransaction.objectStore('records').put({ id: 'reference-record', value: 'gespeichert' });
  await waitForTransaction(writeTransaction);

  await expect(readRecord(database, 'reference-record')).resolves.toEqual({
    id: 'reference-record',
    value: 'gespeichert',
  });

  database.close();
  await deleteDatabase(databaseName);
  createdDatabaseNames.delete(databaseName);

  const knownDatabases = await indexedDB.databases();
  expect(knownDatabases.some((entry) => entry.name === databaseName)).toBe(false);
});
