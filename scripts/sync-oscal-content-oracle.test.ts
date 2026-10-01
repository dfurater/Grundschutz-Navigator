import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

// Ersetzt im Kindprozess `globalThis.fetch`, bevor das Skript lädt: bedient nur
// die konfigurierten Orakelpfade und protokolliert jeden Aufruf.
const FETCH_STUB = [
  "import { appendFileSync, readFileSync } from 'node:fs';",
  "const { log, bodies } = JSON.parse(readFileSync(new URL('./fetch-stub.json', import.meta.url), 'utf8'));",
  'globalThis.fetch = async url => {',
  "  appendFileSync(log, String(url) + '\\n');",
  "  const body = Object.entries(bodies).find(([path]) => String(url).endsWith('/' + path))?.[1];",
  "  return body === undefined ? new Response('unexpected', { status: 404 }) : new Response(body);",
  '};',
].join('\n');

it('can be imported without fetching or running the maintenance CLI', async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error('Unexpected import-time download'));
  vi.stubGlobal('fetch', fetchImpl);
  try {
    const oracle = await import('./sync-oscal-content-oracle.mjs');
    expect(oracle.syncOscalContentOracle).toBeTypeOf('function');
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

interface OracleManifest {
  source: { commit: string };
  files: { fileName: string; remotePath: string; sha256: string; sizeBytes: number }[];
}

describe('syncOscalContentOracle', () => {
  let directory: string;
  let manifest: OracleManifest;
  let bodies: Map<string, Buffer>;

  beforeEach(async () => {
    directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'oscal-oracle-'));
    manifest = JSON.parse(await readFile('src/test/fixtures/oscal-content-v1.5.0/ORACLE_MANIFEST.json', 'utf8'));
    bodies = new Map(manifest.files.map(entry => {
      const bytes = Buffer.from(JSON.stringify({ fixture: entry.fileName }));
      entry.sha256 = createHash('sha256').update(bytes).digest('hex');
      entry.sizeBytes = bytes.length;
      return [entry.remotePath, bytes];
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  const download = (bodies: Map<string, Buffer>) => vi.fn(async (url: string) => {
    const bytes = [...bodies.entries()].find(([path]) => url.endsWith(`/${path}`))?.[1];
    if (!bytes) throw new Error(`Unexpected fixture URL: ${url}`);
    return new Response(new Uint8Array(bytes));
  });

  async function seed(target = directory) {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'ORACLE_MANIFEST.json'), JSON.stringify(manifest));
    for (const entry of manifest.files) await writeFile(join(target, entry.fileName), 'previous fixture');
  }

  async function snapshot(target = directory) {
    const files = await readdir(target);
    return Promise.all(files.sort().map(async name => [name, await readFile(join(target, name))]));
  }

  it('writes all matching same-pin artifacts and their manifest', async () => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    await seed();
    const fetchImpl = download(bodies);
    const result = await syncOscalContentOracle({ force: true, fetchImpl, targetDirectory: directory });
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(result.source.commit).toBe(manifest.source.commit);
    expect(result.files).toEqual(manifest.files);
    for (const entry of manifest.files) {
      expect(await readFile(join(directory, entry.fileName))).toEqual(bodies.get(entry.remotePath));
    }
    expect(JSON.parse(await readFile(join(directory, 'ORACLE_MANIFEST.json'), 'utf8'))).toEqual(result);
  });

  it.each(['hash', 'size'])('preserves the entire target when the last same-pin %s does not match', async mismatch => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    const last = manifest.files.at(-1)!;
    if (mismatch === 'hash') last.sha256 = '0'.repeat(64);
    if (mismatch === 'size') last.sizeBytes++;
    await seed();
    const before = await snapshot();
    await expect(syncOscalContentOracle({ force: true, fetchImpl: download(bodies), targetDirectory: directory }))
      .rejects.toThrow(/Hash|Größe/);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ['no file pins', () => { manifest.files = []; }, /rev5-catalog\.json/],
    ['a missing last pin', () => { manifest.files.pop(); }, /privacy-resolved\.json/],
    ['an additional valid pin', () => { manifest.files.push({ ...manifest.files[0], fileName: 'extra.json' }); }, /extra\.json/],
    ['a duplicate pin', () => { manifest.files.push({ ...manifest.files.at(-1)! }); }, /Manifest/],
  ])('rejects a same-pin manifest with %s before fetching', async (_case, mutate, message) => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    await seed();
    mutate();
    await writeFile(join(directory, 'ORACLE_MANIFEST.json'), JSON.stringify(manifest));
    const fetchImpl = download(bodies);
    const before = await snapshot();
    await expect(syncOscalContentOracle({ force: true, fetchImpl, targetDirectory: directory })).rejects.toThrow(message);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it('rejects an oversized streamed body before changing any target file', async () => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    await seed();
    const before = await snapshot();
    const fetchImpl = download(bodies);
    const cancel = vi.fn();
    fetchImpl.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)); },
      cancel,
    })));
    await expect(syncOscalContentOracle({ force: true, fetchImpl, targetDirectory: directory })).rejects.toThrow(/Limit/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a later HTTP failure before creating or writing the target', async () => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    const targetDirectory = join(directory, 'new-target');
    const fetchImpl = download(bodies);
    fetchImpl.mockResolvedValueOnce(new Response('{}'));
    fetchImpl.mockResolvedValueOnce(new Response('failure', { status: 503 }));
    await expect(syncOscalContentOracle({ fetchImpl, targetDirectory })).rejects.toThrow('HTTP 503');
    expect(await readdir(directory)).toEqual([]);
  });

  it('requires force before downloading when the manifest exists', async () => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    await seed();
    const fetchImpl = download(bodies);
    await expect(syncOscalContentOracle({ fetchImpl, targetDirectory: directory })).rejects.toThrow('existiert bereits');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates a first manifest without a previous pin', async () => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    const targetDirectory = join(directory, 'new-target');
    const result = await syncOscalContentOracle({ fetchImpl: download(bodies), targetDirectory });
    expect(result.files).toEqual(manifest.files);
    expect(await readdir(targetDirectory)).toHaveLength(10);
  });

  it('establishes a new manifest for a deliberately changed commit pin', async () => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    manifest.source.commit = 'a'.repeat(40);
    manifest.files[0].sha256 = '0'.repeat(64);
    await seed();
    const result = await syncOscalContentOracle({ force: true, fetchImpl: download(bodies), targetDirectory: directory });
    expect(result.source.commit).not.toBe(manifest.source.commit);
    expect(result.files[0].sha256).not.toBe(manifest.files[0].sha256);
  });

  it('rejects a corrupt manifest instead of silently treating it as the first sync', async () => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    await writeFile(join(directory, 'ORACLE_MANIFEST.json'), '{invalid');
    const fetchImpl = download(bodies);
    const before = await snapshot();
    await expect(syncOscalContentOracle({ force: true, fetchImpl, targetDirectory: directory })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it.each([null, {}, { source: { commit: 'not-a-commit' }, files: [] }, { source: { commit: 'a'.repeat(40) } }, { source: { commit: ['a'.repeat(40)] }, files: [] }])('rejects malformed manifest metadata %# before fetching', async malformed => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    await writeFile(join(directory, 'ORACLE_MANIFEST.json'), JSON.stringify(malformed));
    const fetchImpl = download(bodies);
    const before = await snapshot();
    await expect(syncOscalContentOracle({ force: true, fetchImpl, targetDirectory: directory })).rejects.toThrow(/Manifest/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it.each([null, {}, { fileName: 'extra.json', sha256: 'not-a-hash', sizeBytes: 1 }, { fileName: 'extra.json', sha256: '0'.repeat(64), sizeBytes: -1 }])('rejects an additional invalid file pin %# before fetching', async extra => {
    const { syncOscalContentOracle } = await import('./sync-oscal-content-oracle.mjs');
    await seed();
    await writeFile(join(directory, 'ORACLE_MANIFEST.json'), JSON.stringify({ ...manifest, files: [...manifest.files, extra] }));
    const fetchImpl = download(bodies);
    const before = await snapshot();
    await expect(syncOscalContentOracle({ force: true, fetchImpl, targetDirectory: directory })).rejects.toThrow(/Manifest/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  describe('direct CLI entry', () => {
    // Das Skript schreibt relativ zum Arbeitsverzeichnis; der Kindprozess läuft
    // deshalb im Temp-Verzeichnis und berührt die committeten Fixtures nie.
    const cliTarget = () => join(directory, 'src/test/fixtures/oscal-content-v1.5.0');
    const fetchLog = () => join(directory, 'fetch.log');

    async function runCli(args: string[] = []) {
      await writeFile(join(directory, 'fetch-stub.mjs'), FETCH_STUB);
      await writeFile(join(directory, 'fetch-stub.json'), JSON.stringify({
        log: fetchLog(),
        bodies: Object.fromEntries([...bodies].map(([path, bytes]) => [path, bytes.toString('utf8')])),
      }));
      const command = [
        '--import', pathToFileURL(join(directory, 'fetch-stub.mjs')).href,
        resolve('scripts/sync-oscal-content-oracle.mjs'), ...args,
      ];
      let result: { code: number; stderr: string };
      try {
        const { stderr } = await execFileAsync(process.execPath, command, { cwd: directory, timeout: 60_000 });
        result = { code: 0, stderr };
      } catch (error) {
        const failure = error as { code?: number | string; stderr?: string };
        result = { code: typeof failure.code === 'number' ? failure.code : -1, stderr: failure.stderr ?? '' };
      }
      const fetched = await readFile(fetchLog(), 'utf8').then(log => log.split('\n').filter(Boolean), () => []);
      return { ...result, fetched };
    }

    it('runs a first sync without --force', async () => {
      const result = await runCli();
      expect(result.code).toBe(0);
      expect(result.fetched).toHaveLength(9);
      const written = JSON.parse(await readFile(join(cliTarget(), 'ORACLE_MANIFEST.json'), 'utf8'));
      expect(written.files).toEqual(manifest.files);
    }, 60_000);

    it('refuses an existing manifest without --force before fetching', async () => {
      await seed(cliTarget());
      const before = await snapshot(cliTarget());
      const result = await runCli();
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('existiert bereits');
      expect(result.fetched).toEqual([]);
      expect(await snapshot(cliTarget())).toEqual(before);
    }, 60_000);

    it('passes --force through to refresh a matching same-pin manifest', async () => {
      await seed(cliTarget());
      const result = await runCli(['--force']);
      expect(result.code).toBe(0);
      expect(result.fetched).toHaveLength(9);
      for (const entry of manifest.files) {
        expect(await readFile(join(cliTarget(), entry.fileName))).toEqual(bodies.get(entry.remotePath));
      }
    }, 60_000);
  });
});
