import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import type {
  ResidueInspection,
  WorkspaceAdapter,
  WorkspaceAdapterFactory,
  WorkspaceDocumentV1,
  WorkspaceDocumentV2,
  WorkspaceExport,
} from './contract';

const DOCUMENT_STORE = 'documents';
const VIEW_TITLE_INDEX = 'by-view-title';
const DELETE_TIMEOUT_MS = 2_000;

// GSPP-340 area: Schema-Migration
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertV1Record(value: unknown): asserts value is WorkspaceDocumentV1 {
  if (!isRecord(value) || value.storageSchemaVersion !== 1 || typeof value.localId !== 'string') {
    throw new Error('GSPP340_INVALID_V1_RECORD: Envelope');
  }
  if (typeof value.oscalVersion !== 'string' || !isRecord(value.source)) {
    throw new Error('GSPP340_INVALID_V1_RECORD: OSCAL-Version oder Source');
  }

  const catalog = value.source.catalog;
  if (
    !isRecord(catalog)
    || typeof catalog.uuid !== 'string'
    || !Array.isArray(catalog.groups)
    || !isRecord(catalog.metadata)
  ) {
    throw new Error('GSPP340_INVALID_V1_RECORD: OSCAL-Katalogmetadaten');
  }
  if (
    typeof catalog.metadata.title !== 'string'
    || typeof catalog.metadata['last-modified'] !== 'string'
    || typeof catalog.metadata.version !== 'string'
    || catalog.metadata['oscal-version'] !== value.oscalVersion
    || !isRecord(value.view)
    || typeof value.view.title !== 'string'
    || typeof value.view.summary !== 'string'
    || !isRecord(value.exportDraft)
    || value.exportDraft.mediaType !== 'application/oscal+json'
    || typeof value.exportDraft.content !== 'string'
  ) {
    throw new Error('GSPP340_INVALID_V1_RECORD: abgeleitete Repräsentationen');
  }
}

function migrateV1Record(value: unknown): WorkspaceDocumentV2 {
  assertV1Record(value);
  return {
    localId: value.localId,
    storageSchemaVersion: 2,
    oscalVersion: value.oscalVersion,
    source: value.source,
    derived: {
      view: value.view,
      exportDraft: value.exportDraft,
    },
  };
}

// GSPP-340 area: Öffnen und Versionieren
function createV1Store(database: IDBPDatabase<unknown>): void {
  const store = database.createObjectStore(DOCUMENT_STORE, { keyPath: 'localId' });
  store.createIndex(VIEW_TITLE_INDEX, 'view.title');
}

class IdbWorkspaceAdapter implements WorkspaceAdapter {
  readonly candidate = 'idb' as const;
  readonly databaseName: string;
  private database: IDBPDatabase<unknown> | undefined;
  private readonly cache = new Map<string, WorkspaceDocumentV2>();

  constructor(databaseName: string) {
    this.databaseName = databaseName;
  }

  private requireDatabase(): IDBPDatabase<unknown> {
    if (!this.database) {
      throw new Error('GSPP340_DATABASE_NOT_OPEN: idb');
    }
    return this.database;
  }

  async createV1(records: readonly unknown[]): Promise<void> {
    const legacyDatabase = await openDB(this.databaseName, 1, {
      upgrade(database) {
        createV1Store(database);
      },
    });
    try {
      const transaction = legacyDatabase.transaction(DOCUMENT_STORE, 'readwrite');
      await Promise.all(records.map((record) => transaction.store.put(record)));
      await transaction.done;
    } finally {
      legacyDatabase.close();
    }
  }

  async openV2(): Promise<void> {
    let migrationError: Error | undefined;
    try {
      this.database = await openDB(this.databaseName, 2, {
        upgrade(database, oldVersion, _newVersion, transaction) {
          if (oldVersion === 0) {
            const store = database.createObjectStore(DOCUMENT_STORE, { keyPath: 'localId' });
            store.createIndex(VIEW_TITLE_INDEX, 'derived.view.title');
            return;
          }

          // GSPP-340 area: Schema-Migration
          const store = transaction.objectStore(DOCUMENT_STORE);
          if (store.indexNames.contains(VIEW_TITLE_INDEX)) {
            store.deleteIndex(VIEW_TITLE_INDEX);
          }
          store.createIndex(VIEW_TITLE_INDEX, 'derived.view.title');
          void transaction.done.catch(() => undefined);

          const migrateRecords = async () => {
            let cursor = await store.openCursor();
            while (cursor) {
              await cursor.update(migrateV1Record(cursor.value));
              cursor = await cursor.continue();
            }
          };
          void migrateRecords().catch((error: unknown) => {
            migrationError = error instanceof Error ? error : new Error(String(error));
            transaction.abort();
          });
          // GSPP-340 area: Öffnen und Versionieren
        },
        blocking: () => {
          this.database?.close();
        },
      });
      // GSPP-340 area: Schema-Migration
    } catch (error) {
      if (migrationError) {
        throw migrationError;
      }
      throw error;
    }
    // GSPP-340 area: Öffnen und Versionieren
  }

  // GSPP-340 area: CRUD
  async putDocument(document: WorkspaceDocumentV2): Promise<void> {
    await this.requireDatabase().put(DOCUMENT_STORE, document);
    this.cache.set(document.localId, document);
  }

  async getDocument(localId: string): Promise<WorkspaceDocumentV2 | undefined> {
    const document = await this.requireDatabase().get(DOCUMENT_STORE, localId) as (
      WorkspaceDocumentV2 | undefined
    );
    if (document) {
      this.cache.set(localId, document);
    } else {
      this.cache.delete(localId);
    }
    return document;
  }

  // GSPP-340 area: Export/Restore
  async exportWorkspace(): Promise<WorkspaceExport> {
    const documents = await this.requireDatabase().getAll(DOCUMENT_STORE) as WorkspaceDocumentV2[];
    documents.sort((left, right) => left.localId.localeCompare(right.localId));
    return { formatVersion: 1, documents };
  }

  async restoreWorkspace(snapshot: WorkspaceExport): Promise<void> {
    if (snapshot.formatVersion !== 1 || !Array.isArray(snapshot.documents)) {
      throw new Error('GSPP340_INVALID_EXPORT');
    }
    const transaction = this.requireDatabase().transaction(DOCUMENT_STORE, 'readwrite');
    await transaction.store.clear();
    await Promise.all(snapshot.documents.map((document) => transaction.store.put(document)));
    await transaction.done;
    this.cache.clear();
  }

  // GSPP-340 area: Einzel- und Gesamtlöschung
  async deleteDocument(localId: string): Promise<void> {
    await this.requireDatabase().delete(DOCUMENT_STORE, localId);
    this.cache.delete(localId);
  }

  async deleteWorkspace(): Promise<void> {
    this.cache.clear();
    this.close();

    let timeout: number | undefined;
    try {
      await Promise.race([
        deleteDB(this.databaseName),
        new Promise<never>((_resolve, reject) => {
          timeout = window.setTimeout(() => {
            reject(new Error('GSPP340_DELETE_BLOCKED: idb'));
          }, DELETE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
    }
  }

  // GSPP-340 area: Index- und Cache-Bereinigung
  async inspectResidues(): Promise<ResidueInspection> {
    const databaseExists = (await indexedDB.databases())
      .some((entry) => entry.name === this.databaseName);
    if (!databaseExists) {
      return {
        databaseExists,
        storedValues: [],
        indexKeys: [],
        cacheValues: [...this.cache.values()].map((value) => JSON.stringify(value)),
      };
    }

    if (!this.database) {
      await this.openV2();
    }
    const transaction = this.requireDatabase().transaction(DOCUMENT_STORE, 'readonly');
    const storedValues = (await transaction.store.getAll())
      .map((value) => JSON.stringify(value));
    const indexKeys: string[] = [];
    let cursor = await transaction.store.index(VIEW_TITLE_INDEX).openKeyCursor();
    while (cursor) {
      indexKeys.push(JSON.stringify(cursor.key));
      cursor = await cursor.continue();
    }
    await transaction.done;
    return {
      databaseExists,
      storedValues,
      indexKeys,
      cacheValues: [...this.cache.values()].map((value) => JSON.stringify(value)),
    };
  }

  // GSPP-340 area: Transaktions-/Fehlerbehandlung
  close(): void {
    this.database?.close();
    this.database = undefined;
  }
}

export const createIdbAdapter: WorkspaceAdapterFactory = (databaseName) => (
  new IdbWorkspaceAdapter(databaseName)
);
