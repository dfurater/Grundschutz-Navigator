import Dexie, { type Table, type Transaction } from 'dexie';
import type {
  ResidueInspection,
  WorkspaceAdapter,
  WorkspaceAdapterFactory,
  WorkspaceDocumentV1,
  WorkspaceDocumentV2,
  WorkspaceExport,
} from './contract';

const DOCUMENT_STORE = 'documents';
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

function configureDatabase(databaseName: string): Dexie {
  const database = new Dexie(databaseName);
  database.version(1).stores({ [DOCUMENT_STORE]: 'localId, view.title' });
  database.version(2)
    .stores({ [DOCUMENT_STORE]: 'localId, derived.view.title' })
    .upgrade(async (transaction: Transaction) => {
      const table = transaction.table(DOCUMENT_STORE);
      const records = await table.toArray();
      await table.bulkPut(records.map(migrateV1Record));
    });
  return database;
}

// GSPP-340 area: Öffnen und Versionieren
class DexieWorkspaceAdapter implements WorkspaceAdapter {
  readonly candidate = 'dexie' as const;
  readonly databaseName: string;
  private readonly database: Dexie;
  private readonly cache = new Map<string, WorkspaceDocumentV2>();

  constructor(databaseName: string) {
    this.databaseName = databaseName;
    this.database = configureDatabase(databaseName);
  }

  private documents(): Table<WorkspaceDocumentV2, string> {
    return this.database.table(DOCUMENT_STORE);
  }

  async createV1(records: readonly unknown[]): Promise<void> {
    const legacyDatabase = new Dexie(this.databaseName);
    legacyDatabase.version(1).stores({ [DOCUMENT_STORE]: 'localId, view.title' });
    try {
      await legacyDatabase.open();
      await legacyDatabase.table(DOCUMENT_STORE).bulkPut(records);
    } finally {
      legacyDatabase.close();
    }
  }

  async openV2(): Promise<void> {
    await this.database.open();
  }

  // GSPP-340 area: CRUD
  async putDocument(document: WorkspaceDocumentV2): Promise<void> {
    await this.documents().put(document);
    this.cache.set(document.localId, document);
  }

  async getDocument(localId: string): Promise<WorkspaceDocumentV2 | undefined> {
    const document = await this.documents().get(localId);
    if (document) {
      this.cache.set(localId, document);
    } else {
      this.cache.delete(localId);
    }
    return document;
  }

  // GSPP-340 area: Export/Restore
  async exportWorkspace(): Promise<WorkspaceExport> {
    const documents = await this.documents().toArray();
    documents.sort((left, right) => left.localId.localeCompare(right.localId));
    return { formatVersion: 1, documents };
  }

  async restoreWorkspace(snapshot: WorkspaceExport): Promise<void> {
    if (snapshot.formatVersion !== 1 || !Array.isArray(snapshot.documents)) {
      throw new Error('GSPP340_INVALID_EXPORT');
    }
    await this.database.transaction('rw', this.documents(), async () => {
      await this.documents().clear();
      await this.documents().bulkPut(snapshot.documents);
    });
    this.cache.clear();
  }

  // GSPP-340 area: Einzel- und Gesamtlöschung
  async deleteDocument(localId: string): Promise<void> {
    await this.documents().delete(localId);
    this.cache.delete(localId);
  }

  async deleteWorkspace(): Promise<void> {
    this.cache.clear();
    this.database.close();

    let timeout: number | undefined;
    try {
      await Promise.race([
        Dexie.delete(this.databaseName),
        new Promise<never>((_resolve, reject) => {
          timeout = window.setTimeout(() => {
            reject(new Error('GSPP340_DELETE_BLOCKED: dexie'));
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
    const databaseExists = await Dexie.exists(this.databaseName);
    if (!databaseExists) {
      return {
        databaseExists,
        storedValues: [],
        indexKeys: [],
        cacheValues: [...this.cache.values()].map((value) => JSON.stringify(value)),
      };
    }

    await this.database.open();
    const storedValues = (await this.documents().toArray()).map((value) => JSON.stringify(value));
    const indexKeys = (await this.documents().orderBy('derived.view.title').keys())
      .map((value) => JSON.stringify(value));
    return {
      databaseExists,
      storedValues,
      indexKeys,
      cacheValues: [...this.cache.values()].map((value) => JSON.stringify(value)),
    };
  }

  // GSPP-340 area: Transaktions-/Fehlerbehandlung
  close(): void {
    this.database.close();
  }
}

export const createDexieAdapter: WorkspaceAdapterFactory = (databaseName) => (
  new DexieWorkspaceAdapter(databaseName)
);
