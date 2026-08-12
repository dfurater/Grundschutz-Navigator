import { expect, test, vi } from 'vitest';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportProcessing';
import { buildSchemaId } from '@/domain/oscalVersionMatrix';

test('verarbeitet Klasse-2-Bytes im Modul-Worker ohne JSON-Parsing im Main-Thread', async () => {
  const jsonParse = vi.spyOn(JSON, 'parse');
  const source = {
    $schema: buildSchemaId('catalog', '1.1.3'),
    catalog: {
      uuid: 'class-2-browser-catalog',
      metadata: { 'oscal-version': '1.1.3' },
      'back-matter': { resources: [{ uuid: 'empty-resource' }] },
    },
  };

  const result = await importClass2OscalDocument(
    new TextEncoder().encode(JSON.stringify(source)),
    { trustClass: 'class-2-local-user' },
  );

  expect(result).toMatchObject({
    ok: true,
    document: {
      rootType: 'catalog',
      oscalVersion: '1.1.3',
      context: { trustClass: 'class-2-local-user' },
    },
  });
  expect(jsonParse).not.toHaveBeenCalled();
});

test('leitet einen Root-Dispatch-Fehler ohne Netzwerkzugriff aus dem Worker zurück', async () => {
  const result = await importClass2OscalDocument(
    new TextEncoder().encode('{"unbekannt":{"metadata":{"oscal-version":"1.1.3"}}}'),
    { trustClass: 'class-2-local-user' },
  );

  expect(result).toMatchObject({
    ok: false,
    diagnostic: { code: 'OSCAL_ROOT_TYPE_UNKNOWN', stage: 'root-dispatch' },
  });
});

test('prüft das Bytelimit im Worker ohne Netzwerkzugriff', async () => {
  const result = await importClass2OscalDocument(
    new Uint8Array(CLASS_2_IMPORT_LIMITS.maxBytes + 1),
    { trustClass: 'class-2-local-user' },
  );

  expect(result).toMatchObject({
    ok: false,
    diagnostic: { code: 'OSCAL_BYTE_LIMIT_EXCEEDED', stage: 'resource-limit' },
  });
});
