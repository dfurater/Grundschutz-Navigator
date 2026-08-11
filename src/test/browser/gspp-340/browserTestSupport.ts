import type { WorkspaceAdapter } from './contract';

const BLOCKED_DATABASE_TIMEOUT_MS = 2_000;

export function createDatabaseName(candidate: string, purpose: string): string {
  return `gspp-340-${candidate}-${purpose}-${crypto.randomUUID()}`;
}

export function deleteDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    let blockedTimeout: number | undefined;
    const clearBlockedTimeout = () => {
      if (blockedTimeout !== undefined) {
        window.clearTimeout(blockedTimeout);
      }
    };
    request.onerror = () => {
      clearBlockedTimeout();
      reject(request.error ?? new Error('GSPP-340-Testdatenbank konnte nicht gelöscht werden.'));
    };
    request.onblocked = () => {
      blockedTimeout = window.setTimeout(() => {
        reject(new Error('GSPP-340-Testdatenbank blieb länger als zwei Sekunden blockiert.'));
      }, BLOCKED_DATABASE_TIMEOUT_MS);
    };
    request.onsuccess = () => {
      clearBlockedTimeout();
      resolve();
    };
  });
}

export function openExistingDatabase(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(
      request.error ?? new Error('GSPP-340-Testdatenbank konnte nicht geöffnet werden.'),
    );
    request.onsuccess = () => resolve(request.result);
  });
}

export function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error('GSPP-340-Testtransaktion fehlgeschlagen.'),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error('GSPP-340-Testtransaktion wurde abgebrochen.'),
    );
  });
}

export async function waitForDatabaseAbsence(databaseName: string): Promise<void> {
  const deadline = Date.now() + BLOCKED_DATABASE_TIMEOUT_MS;
  while ((await indexedDB.databases()).some((entry) => entry.name === databaseName)) {
    if (Date.now() >= deadline) {
      throw new Error('GSPP-340-Testdatenbank blieb nach Freigabe der Blockade erhalten.');
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
}

export async function cleanupAdapter(adapter: WorkspaceAdapter): Promise<void> {
  adapter.close();
  await deleteDatabase(adapter.databaseName);
}
