import { expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportProcessing';
import { buildSchemaId } from '@/domain/oscalVersionMatrix';
import { CLASS_2_IMPORT_WORKER_TIMEOUT_MS } from '@/domain/oscalImportContract';
import { OscalSourceDecoder } from '@/domain/oscalImportTransport';
import {
  makeSchemaInvalidOscalDocument,
  makeSchemaLeakProbeDocument,
  makeSchemaValidOscalDocument,
} from '@/test/fixtures/oscalSchemaFixtures';

function encode(source: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(source));
}

test('verarbeitet Klasse-2-Bytes im Modul-Worker ohne JSON-Parsing im Main-Thread', async () => {
  const jsonParse = vi.spyOn(JSON, 'parse');
  const source = {
    $schema: buildSchemaId('catalog', '1.1.3'),
    ...makeSchemaValidOscalDocument('catalog', '1.1.3'),
  };

  const result = await importClass2OscalDocument(encode(source), {
    trustClass: 'class-2-local-user',
  });

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

test('weist 8 000 Ebenen im öffentlichen Workerpfad mit der Tiefendiagnose ab', async () => {
  const nesting = 8_000;
  const text = `${'['.repeat(nesting)}null${']'.repeat(nesting)}`;

  const result = await importClass2OscalDocument(
    new TextEncoder().encode(text),
    { trustClass: 'class-2-local-user' },
  );

  expect(result).toMatchObject({
    ok: false,
    diagnostic: { code: 'OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED', stage: 'resource-limit' },
  });
});

test('lehnt ein schemawidriges Dokument in Stufe 3 im Modul-Worker ab', async () => {
  const result = await importClass2OscalDocument(
    encode(makeSchemaInvalidOscalDocument('catalog', '1.2.2')),
    { trustClass: 'class-2-local-user' },
  );

  expect(result).toMatchObject({
    ok: false,
    diagnostic: {
      code: 'OSCAL_SCHEMA_REQUIRED_PROPERTY_MISSING',
      stage: 'json-schema',
      validator: { name: 'ajv', version: '8.20.0' },
      path: '/catalog/metadata',
    },
  });
});

test('bezieht für Stufe 3 keine fremde Origin — insbesondere nicht github.com oder csrc.nist.gov', async () => {
  // Das Schema der gewählten Zelle wird als Chunk derselben Origin geladen.
  // Ein Bezug von `github.com` (Release-Asset) oder `csrc.nist.gov` (die `$id`
  // des Schemas) wäre dagegen ein Bruch der Bauzeitgarantie. Das Orakel aus
  // GSPP-339 wertet genau fremde Origins als Verletzung.
  await commands.resetBrowserEgressGuard();

  const valid = await importClass2OscalDocument(
    encode(makeSchemaValidOscalDocument('mapping-collection', '1.2.2')),
    { trustClass: 'class-2-local-user' },
  );
  const invalid = await importClass2OscalDocument(
    encode(makeSchemaInvalidOscalDocument('assessment-results', '1.2.1')),
    { trustClass: 'class-2-local-user' },
  );

  expect(valid).toMatchObject({ ok: true, document: { rootType: 'mapping-collection' } });
  expect(invalid).toMatchObject({ ok: false, diagnostic: { stage: 'json-schema' } });

  const enforcements = await commands.getBrowserEgressEnforcements();
  expect(enforcements.violations).toEqual([]);
  expect(enforcements.httpAborts).toBe(0);
  expect(enforcements.webSocketCloses).toBe(0);
});

test('lässt einen unbekannten Property-Namen weder in Diagnose noch in die Konsole', async () => {
  const marker = 'BROWSER-STUFE-3-LECKMARKER';
  const consoleError = vi.spyOn(console, 'error');
  const consoleLog = vi.spyOn(console, 'log');
  const consoleWarn = vi.spyOn(console, 'warn');

  const result = await importClass2OscalDocument(
    encode(makeSchemaLeakProbeDocument(marker, '1.2.2')),
    { trustClass: 'class-2-local-user' },
  );

  expect(result).toMatchObject({
    ok: false,
    diagnostic: { code: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY', stage: 'json-schema' },
  });
  expect(JSON.stringify(result)).not.toContain(marker);
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleLog).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
});

test('übernimmt fragmentierte Unicode-Werte vollständig und hält parallele Importe getrennt', async () => {
  const first = makeSchemaValidOscalDocument('catalog', '1.1.3');
  const second = makeSchemaValidOscalDocument('catalog', '1.2.2');
  const title = 'A'.repeat(32_767) + '😀\ud800漢'.repeat(20_000);
  (first.catalog as { metadata: { title: string } }).metadata.title = title;
  const contexts = [
    { trustClass: 'class-2-local-user', documentId: 'first' },
    { trustClass: 'class-2-local-user', documentId: 'second' },
  ] as const;
  const results = await Promise.all([
    importClass2OscalDocument(encode(first), contexts[0]),
    importClass2OscalDocument(encode(second), contexts[1]),
  ]);
  expect(results[0]).toEqual({ ok: true, document: {
    source: first, context: contexts[0], rootType: 'catalog', oscalVersion: '1.1.3',
  } });
  expect(results[1]).toEqual({ ok: true, document: {
    source: second, context: contexts[1], rootType: 'catalog', oscalVersion: '1.2.2',
  } });
});

test('der echte Worker wartet nach jedem Datenfragment auf dessen Quittung', async () => {
  const worker = new Worker(new URL('../../workers/oscalImport.worker.ts', import.meta.url), { type: 'module' });
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  (source.catalog as { metadata: { title: string } }).metadata.title = 'A'.repeat(100_000);
  const decoder = new OscalSourceDecoder();
  const frames: { type: string; sequence?: number; operations?: unknown }[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstChunk = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let sequence = 0;
  let paused = true;
  const done = new Promise<void>((resolve, reject) => {
    worker.addEventListener('error', reject);
    worker.addEventListener('message', (event) => {
      const frame = event.data;
      frames.push(frame);
      if (frame.type === 'chunk') {
        try {
          expect(frame.sequence).toBe(sequence++);
          decoder.accept(frame.operations);
          if (paused) releaseFirst!();
          else worker.postMessage({ type: 'ack', sequence: frame.sequence });
        } catch (error) { reject(error); }
      } else if (frame.type === 'done') resolve();
      else if (frame.type !== 'start') reject(new Error('Unexpected worker frame'));
    });
  });
  try {
    const bytes = encode(source).buffer;
    worker.postMessage({ type: 'import', bytes, context: { trustClass: 'class-2-local-user' } }, [bytes]);
    await firstChunk;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(frames.map((frame) => frame.type)).toEqual(['start', 'chunk']);
    paused = false;
    worker.postMessage({ type: 'ack', sequence: 0 });
    await done;
    expect(sequence).toBeGreaterThan(1);
    expect(decoder.finish()).toEqual(source);
  } finally { worker.terminate(); decoder.dispose(); }
});

test.each(['error', 'messageerror', 'protocol'])('räumt einen echten Worker nach %s auf', async (failure) => {
  const original = Worker.prototype.postMessage;
  const terminate = vi.spyOn(Worker.prototype, 'terminate');
  const post = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, message, transfer) {
    original.call(this, message, Array.isArray(transfer) ? { transfer } : transfer);
    queueMicrotask(() => this.dispatchEvent(failure === 'protocol'
      ? new MessageEvent('message', { data: { type: 'chunk', sequence: 0, operations: [] } })
      : new Event(failure)));
  });
  try {
    expect(await importClass2OscalDocument(encode(makeSchemaValidOscalDocument('catalog', '1.1.3')), {
      trustClass: 'class-2-local-user',
    })).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
    expect(terminate).toHaveBeenCalledTimes(1);
  } finally { post.mockRestore(); terminate.mockRestore(); }
});

test('beendet einen echten Worker beim absoluten Timeout', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const terminate = vi.spyOn(Worker.prototype, 'terminate');
  try {
    const pending = importClass2OscalDocument(new Uint8Array(), { trustClass: 'class-2-local-user' });
    vi.advanceTimersByTime(CLASS_2_IMPORT_WORKER_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
    expect(terminate).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); terminate.mockRestore(); }
});
