import { afterEach, expect, test } from 'vitest';

const createdDatabaseNames = new Set<string>();
const BLOCKED_DATABASE_TIMEOUT_MS = 2_000;

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
    let blockedTimeout: number | undefined;

    const clearBlockedTimeout = () => {
      if (blockedTimeout !== undefined) {
        window.clearTimeout(blockedTimeout);
        blockedTimeout = undefined;
      }
    };

    request.onerror = () => {
      clearBlockedTimeout();
      reject(request.error ?? new Error('IndexedDB-Datenbank konnte nicht gelöscht werden.'));
    };
    request.onblocked = () => {
      blockedTimeout ??= window.setTimeout(() => {
        reject(new Error('IndexedDB-Datenbanklöschung blieb länger als zwei Sekunden blockiert.'));
      }, BLOCKED_DATABASE_TIMEOUT_MS);
    };
    request.onsuccess = () => {
      clearBlockedTimeout();
      resolve();
    };
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

test('wartet beim Löschen auf eine offene IndexedDB-Verbindung', async () => {
  const databaseName = `gspp-browser-blocked-delete-${crypto.randomUUID()}`;
  createdDatabaseNames.add(databaseName);

  const firstConnection = await openDatabase(databaseName);
  const blockingConnection = await openDatabase(databaseName);
  firstConnection.close();

  const deletionResult = deleteDatabase(databaseName).then(
    () => 'deleted',
    () => 'rejected',
  );

  try {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    blockingConnection.close();

    await expect(deletionResult).resolves.toBe('deleted');
    createdDatabaseNames.delete(databaseName);
  } finally {
    blockingConnection.close();
  }
});
