import { describe, expect, test, vi } from 'vitest';
import {
  cleanupAdapter,
  createDatabaseName,
  openExistingDatabase,
  waitForDatabaseAbsence,
  waitForTransaction,
} from './browserTestSupport';
import type { ResidueInspection, WorkspaceAdapterFactory } from './contract';
import { createDexieAdapter } from './dexieAdapter';
import { createV1Document, createV2Document, expectedV2Document } from './fixtures';
import { createIdbAdapter } from './idbAdapter';

const candidates: ReadonlyArray<{
  name: 'dexie' | 'idb';
  createAdapter: WorkspaceAdapterFactory;
}> = [
  { name: 'dexie', createAdapter: createDexieAdapter },
  { name: 'idb', createAdapter: createIdbAdapter },
];

const invalidV1Cases: ReadonlyArray<{
  field: string;
  path: readonly string[];
  value: unknown;
}> = [
  { field: 'localId', path: ['localId'], value: 17 },
  { field: 'storageSchemaVersion', path: ['storageSchemaVersion'], value: 2 },
  { field: 'oscalVersion', path: ['oscalVersion'], value: undefined },
  { field: 'source.catalog', path: ['source', 'catalog'], value: undefined },
  { field: 'catalog.uuid', path: ['source', 'catalog', 'uuid'], value: undefined },
  { field: 'catalog.metadata', path: ['source', 'catalog', 'metadata'], value: undefined },
  { field: 'metadata.title', path: ['source', 'catalog', 'metadata', 'title'], value: undefined },
  {
    field: 'metadata.last-modified',
    path: ['source', 'catalog', 'metadata', 'last-modified'],
    value: undefined,
  },
  { field: 'metadata.version', path: ['source', 'catalog', 'metadata', 'version'], value: undefined },
  {
    field: 'metadata.oscal-version',
    path: ['source', 'catalog', 'metadata', 'oscal-version'],
    value: '1.2.0',
  },
  { field: 'catalog.groups', path: ['source', 'catalog', 'groups'], value: undefined },
  { field: 'view.title', path: ['view', 'title'], value: undefined },
  { field: 'view.summary', path: ['view', 'summary'], value: undefined },
  { field: 'exportDraft.mediaType', path: ['exportDraft', 'mediaType'], value: 'text/plain' },
  { field: 'exportDraft.content', path: ['exportDraft', 'content'], value: undefined },
];

function createInvalidV1Record(
  candidate: string,
  invalidCase: (typeof invalidV1Cases)[number],
): unknown {
  const record = structuredClone(createV1Document(
    `local-invalid-${invalidCase.field}`,
    `${candidate}-invalid-${invalidCase.field}`,
  )) as unknown as Record<string, unknown>;
  let owner = record;
  for (const segment of invalidCase.path.slice(0, -1)) {
    owner = owner[segment] as Record<string, unknown>;
  }
  owner[invalidCase.path.at(-1) as string] = invalidCase.value;
  return record;
}

function containsSentinel(inspection: ResidueInspection, sentinel: string): boolean {
  return [
    ...inspection.storedValues,
    ...inspection.indexKeys,
    ...inspection.cacheValues,
  ].some((value) => value.includes(sentinel));
}

describe.each(candidates)('$name adapter', ({ name, createAdapter }) => {
  test('migriert v1 defensiv nach v2, ohne die OSCAL-Version zu verändern', async () => {
    const adapter = createAdapter(createDatabaseName(name, 'migration'));
    const original = createV1Document('local-migration', `${name}-migration-sentinel`);

    try {
      await adapter.createV1([original]);
      await adapter.openV2();

      const migrated = await adapter.getDocument(original.localId);
      expect(migrated).toEqual(expectedV2Document(original));
      expect(migrated?.oscalVersion).toBe(original.oscalVersion);
      expect(migrated?.source.catalog.metadata['oscal-version']).toBe(
        original.source.catalog.metadata['oscal-version'],
      );
    } finally {
      await cleanupAdapter(adapter);
    }
  });

  test(
    'nimmt einen beim versionchange noch committed v1-Datensatz atomar in die Migration auf',
    async () => {
      const adapter = createAdapter(createDatabaseName(name, 'concurrent-migration'));
      const original = createV1Document('local-concurrent-a', 'idb-concurrent-a');
      const lateDocument = createV1Document('local-concurrent-b', 'idb-concurrent-b');
      let writer: IDBDatabase | undefined;

      try {
        await adapter.createV1([original]);
        writer = await openExistingDatabase(adapter.databaseName);
        const lateWrite = new Promise<void>((resolve, reject) => {
          if (!writer) {
            reject(new Error('GSPP-340-v1-Writer fehlt.'));
            return;
          }
          writer.onversionchange = () => {
            const transaction = writer?.transaction('documents', 'readwrite');
            if (!transaction) {
              reject(new Error('GSPP-340-v1-Writer ist während versionchange geschlossen.'));
              return;
            }
            transaction.objectStore('documents').put(lateDocument);
            void waitForTransaction(transaction).then(resolve, reject).finally(() => writer?.close());
          };
        });

        await Promise.all([adapter.openV2(), lateWrite]);

        expect(await adapter.getDocument(lateDocument.localId)).toEqual(
          expectedV2Document(lateDocument),
        );
      } finally {
        writer?.close();
        await cleanupAdapter(adapter);
      }
    },
  );

  test.each(invalidV1Cases)(
    'weist ein ungültiges v1-Feld $field erklärbar zurück',
    async (invalidCase) => {
      const adapter = createAdapter(createDatabaseName(name, `invalid-${invalidCase.field}`));
      const invalid = createInvalidV1Record(name, invalidCase);

      try {
        await adapter.createV1([invalid]);
        await expect(adapter.openV2()).rejects.toThrow('GSPP340_INVALID_V1_RECORD');
      } finally {
        await cleanupAdapter(adapter);
      }
    },
  );

  test('exportiert und restauriert einen semantisch gleichen Arbeitsbereich', async () => {
    const sourceAdapter = createAdapter(createDatabaseName(name, 'roundtrip-source'));
    const restoreAdapter = createAdapter(createDatabaseName(name, 'roundtrip-restore'));
    const documents = [
      createV2Document('local-roundtrip-a', `${name}-roundtrip-a`),
      createV2Document('local-roundtrip-b', `${name}-roundtrip-b`, '1.2.0'),
    ];

    try {
      await sourceAdapter.openV2();
      await Promise.all(documents.map((document) => sourceAdapter.putDocument(document)));
      const snapshot = await sourceAdapter.exportWorkspace();
      await sourceAdapter.deleteWorkspace();

      await restoreAdapter.openV2();
      await restoreAdapter.restoreWorkspace(snapshot);

      expect(await restoreAdapter.exportWorkspace()).toEqual(snapshot);
    } finally {
      await cleanupAdapter(sourceAdapter);
      await cleanupAdapter(restoreAdapter);
    }
  });

  test('löscht ein Dokument aus Store, Index und internem Cache', async () => {
    const adapter = createAdapter(createDatabaseName(name, 'single-delete'));
    const sentinel = `${name}-single-delete-sentinel`;
    const document = createV2Document('local-delete', sentinel);
    const survivorSentinel = `${name}-single-delete-survivor`;
    const survivor = createV2Document('local-survivor', survivorSentinel);

    try {
      await adapter.openV2();
      await Promise.all([
        adapter.putDocument(document),
        adapter.putDocument(survivor),
      ]);
      await Promise.all([
        adapter.getDocument(document.localId),
        adapter.getDocument(survivor.localId),
      ]);
      await adapter.deleteDocument(document.localId);

      const inspection = await adapter.inspectResidues();
      expect(containsSentinel(inspection, sentinel)).toBe(false);
      expect(containsSentinel(inspection, survivorSentinel)).toBe(true);
      expect(await adapter.getDocument(document.localId)).toBeUndefined();
      expect(await adapter.getDocument(survivor.localId)).toEqual(survivor);
    } finally {
      await cleanupAdapter(adapter);
    }
  });

  test('löscht den vollständigen Arbeitsbereich mit fester Blockadefrist', async () => {
    const adapter = createAdapter(createDatabaseName(name, 'workspace-delete'));
    const sentinels = [
      `${name}-workspace-delete-sentinel-a`,
      `${name}-workspace-delete-sentinel-b`,
    ];
    const documents = sentinels.map((sentinel, index) => (
      createV2Document(`local-workspace-delete-${index}`, sentinel)
    ));

    try {
      await adapter.openV2();
      await Promise.all(documents.map((document) => adapter.putDocument(document)));
      await Promise.all(documents.map((document) => adapter.getDocument(document.localId)));
      await adapter.deleteWorkspace();

      const inspection = await adapter.inspectResidues();
      expect(inspection.databaseExists).toBe(false);
      sentinels.forEach((sentinel) => {
        expect(containsSentinel(inspection, sentinel)).toBe(false);
      });
    } finally {
      await cleanupAdapter(adapter);
    }
  });

  test('bricht eine blockierte Arbeitsbereichslöschung nach zwei Sekunden erklärbar ab', async () => {
    const adapter = createAdapter(createDatabaseName(name, 'blocked-workspace-delete'));
    let blockingConnection: IDBDatabase | undefined;
    const expectedDexieWarning = name === 'dexie'
      ? vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      : undefined;

    try {
      await adapter.openV2();
      await adapter.putDocument(createV2Document('local-blocked-delete', `${name}-blocked-delete`));
      blockingConnection = await openExistingDatabase(adapter.databaseName);

      await expect(adapter.deleteWorkspace()).rejects.toThrow('GSPP340_DELETE_BLOCKED');
      if (expectedDexieWarning) {
        expect(expectedDexieWarning).toHaveBeenCalledWith(
          expect.stringContaining(`Dexie.delete('${adapter.databaseName}') was blocked`),
        );
      }
    } finally {
      expectedDexieWarning?.mockRestore();
      blockingConnection?.close();
      adapter.close();
      await waitForDatabaseAbsence(adapter.databaseName);
    }
  });
});
