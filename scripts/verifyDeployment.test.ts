// @vitest-environment node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { writeChecksumsManifestFile } from './deployChecksums.mjs';
import {
  DeploymentVerificationError,
  PREDICATE_TYPES,
  SIGNER_WORKFLOW,
  main,
  parseVerifyArgs,
  runGh,
  verifyDeployment,
} from './verifyDeployment.mjs';

const execFileAsync = promisify(execFile);
const SOURCE_SHA = 'a800873e1b25667b466b3df093ba8370ea56176f';
const OTHER_SHA = '0000000000000000000000000000000000000001';
const ROUTE = 'katalog/gspp/kontrolle/80351189-6ffc-495e-a995-6219b9704724/index.html';

const tempDirs: string[] = [];

function tempDir(prefix = 'gspp-verify-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function builtDist() {
  const dist = tempDir();
  for (const [path, content] of Object.entries({
    'index.html': '<!doctype html>',
    'favicon.svg': '<svg/>',
    [ROUTE]: '<html>route</html>',
  })) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  }
  writeChecksumsManifestFile(dist);
  return dist;
}

interface GhCall {
  args: string[];
  manifestBytes: Buffer;
}

/**
 * Kontrollierter `gh`: bestätigt nur Aufrufe, deren Herkunftsfilter exakt dem
 * erwarteten Deploy entsprechen. So prüft der Test die Filter selbst, nicht
 * nur ihr Vorhandensein.
 */
function fakeGh({
  attestedSha = SOURCE_SHA,
  failPredicate,
}: { attestedSha?: string; failPredicate?: string } = {}) {
  const calls: GhCall[] = [];
  const run = async (args: string[]) => {
    calls.push({ args, manifestBytes: readFileSync(args[2]) });
    const option = (name: string) => args[args.indexOf(name) + 1];
    const matches =
      option('--repo') === 'dfurater/Grundschutz-Navigator'
      && option('--signer-workflow') === SIGNER_WORKFLOW
      && option('--source-ref') === 'refs/heads/main'
      && option('--source-digest') === attestedSha
      && option('--predicate-type') !== failPredicate;
    return matches
      ? { ok: true, stdout: '', stderr: '' }
      : { ok: false, reason: 'Exit 1', stdout: '', stderr: 'no matching attestations found' };
  };
  return { calls, run };
}

const silent = () => {};

function options(dist: string, path: string, overrides: Partial<Record<'manifest' | 'file' | 'sourceSha', string>> = {}) {
  return {
    manifest: overrides.manifest ?? join(dist, 'SHA256SUMS'),
    file: overrides.file ?? join(dist, path),
    path,
    sourceSha: overrides.sourceSha ?? SOURCE_SHA,
  };
}

describe('parseVerifyArgs', () => {
  const valid = ['--manifest', 'm', '--file', 'f', '--path', 'favicon.svg', '--source-sha', SOURCE_SHA];

  it('accepts all four options in any order', () => {
    expect(parseVerifyArgs(valid)).toEqual({ manifest: 'm', file: 'f', path: 'favicon.svg', sourceSha: SOURCE_SHA });
    expect(parseVerifyArgs([...valid.slice(4), ...valid.slice(0, 4)]).path).toBe('favicon.svg');
  });

  it.each([
    ['a missing option', valid.slice(0, 6)],
    ['a duplicate option', [...valid, '--file', 'g']],
    ['an unknown option', [...valid, '--force', 'x']],
    ['an option without value', ['--manifest', '--file', 'f', '--path', 'p', '--source-sha', SOURCE_SHA]],
    ['a short SHA', [...valid.slice(0, 6), '--source-sha', 'a800873']],
    ['an uppercase SHA', [...valid.slice(0, 6), '--source-sha', SOURCE_SHA.toUpperCase()]],
    ['a traversal path', ['--manifest', 'm', '--file', 'f', '--path', '../etc/passwd', '--source-sha', SOURCE_SHA]],
    ['an absolute path', ['--manifest', 'm', '--file', 'f', '--path', '/index.html', '--source-sha', SOURCE_SHA]],
  ])('rejects %s with exit code 2', (_label, argv) => {
    expect(() => parseVerifyArgs(argv)).toThrow(DeploymentVerificationError);
    try {
      parseVerifyArgs(argv);
    } catch (error) {
      expect((error as DeploymentVerificationError).exitCode).toBe(2);
    }
  });
});

describe('verifyDeployment', () => {
  it.each([
    ['an asset', 'favicon.svg'],
    ['a deep route', ROUTE],
    ['the manifest itself', 'SHA256SUMS'],
  ])('verifies %s after both predicate checks with all provenance filters', async (_label, path) => {
    const dist = builtDist();
    const gh = fakeGh();

    await verifyDeployment(options(dist, path), { run: gh.run, log: silent });

    expect(gh.calls.map(({ args }) => args.slice(0, 2))).toEqual([
      ['attestation', 'verify'],
      ['attestation', 'verify'],
    ]);
    expect(gh.calls.map(({ args }) => args[args.indexOf('--predicate-type') + 1])).toEqual(PREDICATE_TYPES);
    for (const { args } of gh.calls) {
      expect(args.slice(3)).toEqual([
        '--repo', 'dfurater/Grundschutz-Navigator',
        '--signer-workflow', 'dfurater/Grundschutz-Navigator/.github/workflows/deploy.yml',
        '--source-ref', 'refs/heads/main',
        '--source-digest', SOURCE_SHA,
        '--predicate-type', args[args.length - 1],
      ]);
    }
  });

  it('hands both gh calls the same private copy of the manifest bytes and removes it afterwards', async () => {
    const dist = builtDist();
    const original = readFileSync(join(dist, 'SHA256SUMS'));
    const gh = fakeGh();
    const run = async (args: string[]) => {
      // Ein Angreifer tauscht das Original während der Prüfung aus.
      writeFileSync(join(dist, 'SHA256SUMS'), 'tampered\n');
      return gh.run(args);
    };

    await expect(
      verifyDeployment(options(dist, 'favicon.svg'), { run, log: silent }),
    ).resolves.toBeUndefined();

    const [first, second] = gh.calls;
    expect(first.args[2]).toBe(second.args[2]);
    expect(first.args[2]).not.toBe(join(dist, 'SHA256SUMS'));
    expect(first.manifestBytes).toEqual(original);
    expect(second.manifestBytes).toEqual(original);
    expect(existsSync(dirname(first.args[2]))).toBe(false);
  });

  it.each([
    ['the wrong commit', { attestedSha: OTHER_SHA }, /Attestierung https:\/\/slsa.dev\/provenance\/v1 nicht bestätigt/],
    ['a failing SBOM predicate', { failPredicate: 'https://cyclonedx.org/bom' }, /Attestierung https:\/\/cyclonedx.org\/bom nicht bestätigt/],
    ['a failing provenance predicate', { failPredicate: 'https://slsa.dev/provenance/v1' }, /provenance\/v1 nicht bestätigt/],
  ])('rejects %s', async (_label, ghOptions, message) => {
    const dist = builtDist();
    const gh = fakeGh(ghOptions);

    await expect(verifyDeployment(options(dist, 'favicon.svg'), { run: gh.run, log: silent })).rejects.toThrow(message);
    expect(existsSync(dirname(gh.calls[0].args[2]))).toBe(false);
  });

  it('rejects a wrong signer workflow or ref reported by gh', async () => {
    const dist = builtDist();
    const run = async (args: string[]) => {
      const workflow = args[args.indexOf('--signer-workflow') + 1];
      return workflow.endsWith('/deploy.yml') && args.includes('refs/heads/develop')
        ? { ok: true, stdout: '', stderr: '' }
        : { ok: false, reason: 'Exit 1', stderr: 'signer workflow mismatch' };
    };

    await expect(verifyDeployment(options(dist, 'favicon.svg'), { run, log: silent })).rejects.toThrow(/signer workflow mismatch/);
  });

  it('rejects a manipulated file', async () => {
    const dist = builtDist();
    writeFileSync(join(dist, 'favicon.svg'), '<svg>evil</svg>');

    await expect(
      verifyDeployment(options(dist, 'favicon.svg'), { run: fakeGh().run, log: silent }),
    ).rejects.toThrow(/SHA-256 von .* weicht ab/);
  });

  it('rejects a manipulated manifest even when gh were to confirm it', async () => {
    const dist = builtDist();
    writeFileSync(join(dist, 'SHA256SUMS'), 'not a manifest\n');

    await expect(
      verifyDeployment(options(dist, 'favicon.svg'), { run: fakeGh().run, log: silent }),
    ).rejects.toThrow(/Manifest ungültig/);
  });

  it('rejects a local manifest copy that differs from the attested bytes', async () => {
    const dist = builtDist();
    const manifestCopy = join(tempDir(), 'SHA256SUMS');
    writeFileSync(manifestCopy, readFileSync(join(dist, 'SHA256SUMS')));
    writeFileSync(join(dist, 'SHA256SUMS'), 'other\n');

    await expect(
      verifyDeployment(
        options(dist, 'SHA256SUMS', { manifest: manifestCopy }),
        { run: fakeGh().run, log: silent },
      ),
    ).rejects.toThrow(/stimmt nicht mit dem attestierten Manifest überein/);
  });

  it('rejects a path that is missing from the manifest', async () => {
    const dist = builtDist();
    writeFileSync(join(dist, 'late.js'), 'x');

    await expect(
      verifyDeployment(options(dist, 'late.js'), { run: fakeGh().run, log: silent }),
    ).rejects.toThrow('late.js steht nicht im attestierten Manifest.');
  });

  it('rejects a manifest with a duplicate line', async () => {
    const dist = builtDist();
    const manifest = readFileSync(join(dist, 'SHA256SUMS'), 'utf8');
    const firstLine = manifest.split('\n')[0];
    writeFileSync(join(dist, 'SHA256SUMS'), `${firstLine}\n${manifest}`);

    await expect(
      verifyDeployment(options(dist, 'favicon.svg'), { run: fakeGh().run, log: silent }),
    ).rejects.toThrow(/nicht eindeutig sortiert/);
  });

  it('rejects a manifest entry with path traversal', async () => {
    const dist = builtDist();
    const hash = createHash('sha256').update('x').digest('hex');
    writeFileSync(join(dist, 'SHA256SUMS'), `${hash}  ../favicon.svg\n`);

    await expect(
      verifyDeployment(options(dist, 'favicon.svg'), { run: fakeGh().run, log: silent }),
    ).rejects.toThrow(/Unzulässiges Pfadsegment/);
  });

  it('rejects a symlinked target file and a symlinked manifest', async () => {
    const dist = builtDist();
    const link = join(tempDir(), 'favicon.svg');
    symlinkSync(join(dist, 'favicon.svg'), link);

    await expect(
      verifyDeployment(options(dist, 'favicon.svg', { file: link }), { run: fakeGh().run, log: silent }),
    ).rejects.toThrow(/keine reguläre Datei/);

    const manifestLink = join(tempDir(), 'SHA256SUMS');
    symlinkSync(join(dist, 'SHA256SUMS'), manifestLink);
    await expect(
      verifyDeployment(options(dist, 'favicon.svg', { manifest: manifestLink }), { run: fakeGh().run, log: silent }),
    ).rejects.toThrow(/Manifest ist keine reguläre Datei/);
  });

  it('rejects a missing manifest before calling gh', async () => {
    const dist = builtDist();
    const gh = fakeGh();

    await expect(
      verifyDeployment(options(dist, 'favicon.svg', { manifest: join(dist, 'missing') }), { run: gh.run, log: silent }),
    ).rejects.toThrow(/Manifest fehlt/);
    expect(gh.calls).toHaveLength(0);
  });

  it('removes the private copy when gh fails', async () => {
    const dist = builtDist();
    let copyDir = '';
    const run = async (args: string[]) => {
      copyDir = dirname(args[2]);
      return { ok: false, reason: 'gh nicht gefunden', stderr: '' };
    };

    await expect(verifyDeployment(options(dist, 'favicon.svg'), { run, log: silent })).rejects.toThrow(/gh nicht gefunden/);
    expect(copyDir).not.toBe('');
    expect(existsSync(copyDir)).toBe(false);
  });
});

describe('runGh', () => {
  it('reports a missing gh binary', async () => {
    const result = await runGh(['--version'], { ghBinary: join(tempDir(), 'no-such-gh') });

    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/nicht gefunden/);
  });

  it.skipIf(process.platform === 'win32')('kills gh after the timeout', async () => {
    const fake = join(tempDir(), 'slow-gh');
    writeFileSync(fake, '#!/bin/sh\nsleep 5\n');
    chmodSync(fake, 0o755);

    const result = await runGh(['attestation'], { ghBinary: fake, timeoutMs: 100 });

    expect(result).toMatchObject({ ok: false, reason: 'Zeitüberschreitung nach 100 ms' });
  });

  it.skipIf(process.platform === 'win32')('passes arguments without a shell and reports a non-zero exit', async () => {
    const fake = join(tempDir(), 'echo-gh');
    const marker = join(tempDir(), 'marker');
    writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 1\n');
    chmodSync(fake, 0o755);

    const result = await runGh(['a b', `$(touch ${marker})`], { ghBinary: fake });

    expect(result.ok).toBe(false);
    expect(result.stdout).toBe(`a b\n$(touch ${marker})\n`);
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('succeeds on exit 0', async () => {
    const fake = join(tempDir(), 'ok-gh');
    writeFileSync(fake, '#!/bin/sh\nexit 0\n');
    chmodSync(fake, 0o755);

    await expect(runGh([], { ghBinary: fake })).resolves.toMatchObject({ ok: true });
  });
});

describe('verify CLI', () => {
  it('main parses argv and verifies', async () => {
    const dist = builtDist();
    const gh = fakeGh();

    await main(
      ['--manifest', join(dist, 'SHA256SUMS'), '--file', join(dist, ROUTE), '--path', ROUTE, '--source-sha', SOURCE_SHA],
      { run: gh.run, log: silent },
    );

    expect(gh.calls).toHaveLength(2);
  });

  it('exits 2 on usage errors and 1 on a failed verification as a child process', async () => {
    const script = join(import.meta.dirname, 'verifyDeployment.mjs');
    const dist = builtDist();
    // Ein leerer PATH macht `gh` unauffindbar, ohne das Netz zu berühren.
    const env = { ...process.env, PATH: tempDir() };

    const usage = await execFileAsync(process.execPath, [script, '--path', 'x'], { env }).catch((error) => error);
    expect(usage.code).toBe(2);

    const failed = await execFileAsync(
      process.execPath,
      [script, '--manifest', join(dist, 'SHA256SUMS'), '--file', join(dist, 'favicon.svg'), '--path', 'favicon.svg', '--source-sha', SOURCE_SHA],
      { env },
    ).catch((error) => error);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('gh nicht gefunden');
  });
});
