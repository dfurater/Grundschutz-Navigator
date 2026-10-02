// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHECKSUMS_FILE,
  assertChecksumsManifest,
  assertSafeRelativePath,
  buildChecksumsManifest,
  collectDeployedFiles,
  main,
  parseCheckArgs,
  parseChecksumsManifest,
  readRegularFileNoFollow,
  writeChecksumsManifestFile,
} from './deployChecksums.mjs';

const tempDirs: string[] = [];

function tempDir(prefix = 'gspp-deploy-checksums-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

// Sichtbare Dateien, tiefe Routen, Dotfiles und versteckte Unterverzeichnisse.
const FIXTURE = {
  'index.html': '<!doctype html>',
  '404.html': '<!doctype html>',
  'favicon.svg': '<svg/>',
  'assets/index-abc.js': 'console.log(1)',
  'katalog/gspp/GC/index.html': '<html>GC</html>',
  'katalog/gspp/kontrolle/80351189-6ffc-495e-a995-6219b9704724/index.html': '<html>K</html>',
  'B/index.html': 'upper',
  'a/index.html': 'lower',
  '.DS_Store': 'mac',
  '.well-known/security.txt': 'hidden dir',
  'assets/.cache/x.js': 'hidden nested dir',
  'katalog/.hidden': 'hidden nested file',
};

describe('assertSafeRelativePath', () => {
  it.each(['index.html', 'katalog/gspp/GC/index.html', 'a-b_c.d/e'])('accepts %s', (path) => {
    expect(assertSafeRelativePath(path)).toBe(path);
  });

  it.each(['', '/index.html', 'a//b', './a', 'a/./b', '../a', 'a/..', 'a b', 'Ü/index.html', 'a\\b', 'a\nb'])(
    'rejects %j',
    (path) => {
      expect(() => assertSafeRelativePath(path)).toThrow(/Unzulässig/);
    },
  );
});

describe('collectDeployedFiles', () => {
  it('lists visible regular files sorted by UTF-16 code unit and skips dot names with their subtree', () => {
    const dist = tempDir();
    writeTree(dist, FIXTURE);

    expect(collectDeployedFiles(dist)).toEqual([
      '404.html',
      'B/index.html',
      'a/index.html',
      'assets/index-abc.js',
      'favicon.svg',
      'index.html',
      'katalog/gspp/GC/index.html',
      'katalog/gspp/kontrolle/80351189-6ffc-495e-a995-6219b9704724/index.html',
    ]);
  });

  it('aborts on a symlink instead of following it', () => {
    const dist = tempDir();
    writeTree(dist, { 'index.html': 'x' });
    symlinkSync(join(dist, 'index.html'), join(dist, 'link.html'));

    expect(() => collectDeployedFiles(dist)).toThrow('Symlink in der Auslieferung: link.html');
  });

  it('aborts on a symlinked directory', () => {
    const dist = tempDir();
    const outside = tempDir();
    writeTree(outside, { 'secret.txt': 'x' });
    writeTree(dist, { 'index.html': 'x' });
    symlinkSync(outside, join(dist, 'linked'));

    expect(() => collectDeployedFiles(dist)).toThrow('Symlink in der Auslieferung: linked');
  });

  it('aborts on a non-regular file type', () => {
    if (process.platform === 'win32') return;
    const dist = tempDir();
    writeTree(dist, { 'index.html': 'x' });
    execFileSync('mkfifo', [join(dist, 'pipe')]);

    expect(() => collectDeployedFiles(dist)).toThrow('Kein regulärer Dateityp in der Auslieferung: pipe');
  });

  it('aborts on a path outside the permitted character set', () => {
    const dist = tempDir();
    writeTree(dist, { 'Überblick/index.html': 'x' });

    expect(() => collectDeployedFiles(dist)).toThrow(/Unzulässiger Pfad/);
  });
});

describe('readRegularFileNoFollow', () => {
  it('reads a regular file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a'), 'x');

    expect(readRegularFileNoFollow(join(dir, 'a')).toString()).toBe('x');
  });

  it('rejects a symlink, a FIFO and a missing file without blocking', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a'), 'x');
    symlinkSync(join(dir, 'a'), join(dir, 'link'));

    expect(() => readRegularFileNoFollow(join(dir, 'link'), 'Ziel')).toThrow('Ziel ist keine reguläre Datei (Symlink)');
    expect(() => readRegularFileNoFollow(join(dir, 'missing'), 'Ziel')).toThrow('Ziel fehlt');
    if (process.platform !== 'win32') {
      execFileSync('mkfifo', [join(dir, 'pipe')]);
      expect(() => readRegularFileNoFollow(join(dir, 'pipe'), 'Ziel')).toThrow('Ziel ist keine reguläre Datei');
    }
  });
});

describe('buildChecksumsManifest', () => {
  it('emits one canonical line per file with two spaces, LF and a trailing LF', () => {
    const dist = tempDir();
    writeTree(dist, { 'index.html': 'a', 'assets/x.js': 'b' });

    expect(buildChecksumsManifest(dist)).toBe(
      `${sha('b')}  assets/x.js\n${sha('a')}  index.html\n`,
    );
  });

  it('never lists the manifest itself and is stable across rewrites', () => {
    const dist = tempDir();
    writeTree(dist, FIXTURE);

    const first = writeChecksumsManifestFile(dist);
    const second = writeChecksumsManifestFile(dist);

    expect(second).toBe(first);
    expect(first).not.toContain(CHECKSUMS_FILE);
    expect(readFileSync(join(dist, CHECKSUMS_FILE), 'utf8')).toBe(first);
  });

  it('refuses an empty deployment', () => {
    expect(() => buildChecksumsManifest(tempDir())).toThrow(/Keine veröffentlichten Dateien/);
  });
});

describe('parseChecksumsManifest', () => {
  const line = (content: string, path: string) => `${sha(content)}  ${path}\n`;

  it('returns the entries of a canonical manifest', () => {
    const entries = parseChecksumsManifest(line('b', 'assets/x.js') + line('a', 'index.html'));

    expect([...entries]).toEqual([
      ['assets/x.js', sha('b')],
      ['index.html', sha('a')],
    ]);
  });

  it.each([
    ['empty input', ''],
    ['missing trailing LF', line('a', 'index.html').trimEnd()],
    ['CRLF', line('a', 'index.html').replaceAll('\n', '\r\n')],
    ['uppercase hex', line('a', 'index.html').toUpperCase().replace('INDEX.HTML', 'index.html')],
    ['single space', `${sha('a')} index.html\n`],
    ['blank line', `${line('a', 'index.html')}\n`],
    ['self entry', line('a', 'SHA256SUMS')],
    ['duplicate path', line('a', 'index.html') + line('b', 'index.html')],
    ['unsorted paths', line('a', 'index.html') + line('b', 'assets/x.js')],
    ['traversal', line('a', '../index.html')],
    ['absolute path', line('a', '/index.html')],
  ])('rejects %s', (_label, text) => {
    expect(() => parseChecksumsManifest(text)).toThrow();
  });
});

describe('assertChecksumsManifest', () => {
  function builtDist() {
    const dist = tempDir();
    writeTree(dist, FIXTURE);
    writeChecksumsManifestFile(dist);
    return dist;
  }

  it('accepts a matching manifest without modifying it and reports subject count one', () => {
    const dist = builtDist();
    const before = readFileSync(join(dist, CHECKSUMS_FILE));

    expect(assertChecksumsManifest(dist)).toEqual({ fileCount: 9, subjectCount: 1 });
    expect(readFileSync(join(dist, CHECKSUMS_FILE))).toEqual(before);
  });

  it('fails when the manifest is missing', () => {
    const dist = builtDist();
    unlinkSync(join(dist, CHECKSUMS_FILE));

    expect(() => assertChecksumsManifest(dist)).toThrow('SHA256SUMS fehlt');
  });

  it('fails when the manifest is a symlink', () => {
    const dist = builtDist();
    const copy = join(tempDir(), 'copy');
    writeFileSync(copy, readFileSync(join(dist, CHECKSUMS_FILE)));
    unlinkSync(join(dist, CHECKSUMS_FILE));
    symlinkSync(copy, join(dist, CHECKSUMS_FILE));

    expect(() => assertChecksumsManifest(dist)).toThrow(/Symlink|keine reguläre Datei/);
  });

  it('fails when a published file changes after the manifest was written', () => {
    const dist = builtDist();
    writeFileSync(join(dist, 'favicon.svg'), '<svg>changed</svg>');

    expect(() => assertChecksumsManifest(dist)).toThrow('Inhalt geändert: favicon.svg');
  });

  it('fails when a file is added', () => {
    const dist = builtDist();
    writeTree(dist, { 'late/index.html': 'x' });

    expect(() => assertChecksumsManifest(dist)).toThrow('nicht im Manifest: late/index.html');
  });

  it('fails when a file is removed', () => {
    const dist = builtDist();
    unlinkSync(join(dist, 'favicon.svg'));

    expect(() => assertChecksumsManifest(dist)).toThrow('nicht mehr ausgeliefert: favicon.svg');
  });

  it('fails when the manifest bytes are not canonical', () => {
    const dist = builtDist();
    const manifest = readFileSync(join(dist, CHECKSUMS_FILE), 'utf8');
    writeFileSync(join(dist, CHECKSUMS_FILE), manifest.replaceAll('\n', '\r\n'));

    expect(() => assertChecksumsManifest(dist)).toThrow(/nicht kanonisch/);
  });

  it('fails when a symlink appears in the deployment', () => {
    const dist = builtDist();
    symlinkSync(join(dist, 'index.html'), join(dist, 'alias.html'));

    expect(() => assertChecksumsManifest(dist)).toThrow('Symlink in der Auslieferung: alias.html');
  });

  it('fails when a path outside the permitted character set appears', () => {
    const dist = builtDist();
    writeTree(dist, { 'a b.html': 'x' });

    expect(() => assertChecksumsManifest(dist)).toThrow(/Unzulässiger Pfad/);
  });

  // Die Subject-Zahl hängt nicht am Katalogwachstum: auch weit über der
  // 1.024-Dateigrenze von actions/attest bleibt es genau ein Manifest.
  it('binds a deployment of more than 1,500 files including many routes', () => {
    const dist = tempDir();
    const files: Record<string, string> = { 'index.html': 'root', '404.html': 'root' };
    for (let index = 0; index < 1_500; index += 1) {
      files[`katalog/gspp/kontrolle/route-${index}/index.html`] = `<html>${index}</html>`;
    }
    writeTree(dist, files);
    writeChecksumsManifestFile(dist);

    expect(assertChecksumsManifest(dist)).toEqual({ fileCount: 1_503, subjectCount: 1 });
  });
});

describe('check CLI', () => {
  it('requires exactly --dist <directory>', () => {
    expect(parseCheckArgs(['--dist', 'dist'])).toEqual({ distDir: 'dist' });
    for (const argv of [[], ['dist'], ['--dist'], ['--dist', ''], ['--dist', 'a', 'b'], ['--out', 'dist']]) {
      expect(() => parseCheckArgs(argv)).toThrow(/Aufruf/);
    }
  });

  it('runs as a child process: exit 0 on a bound deployment, exit 1 on drift', () => {
    const dist = tempDir();
    writeTree(dist, FIXTURE);
    writeChecksumsManifestFile(dist);
    const script = join(import.meta.dirname, 'deployChecksums.mjs');

    const ok = execFileSync(process.execPath, [script, '--dist', dist], { encoding: 'utf8' });
    expect(ok).toContain('9 Dateien einschließlich Manifest, 1 Attestierungs-Subject');

    writeFileSync(join(dist, 'index.html'), 'tampered');
    expect(() => execFileSync(process.execPath, [script, '--dist', dist], { stdio: 'pipe' })).toThrow(
      /Inhalt geändert: index.html/,
    );
  });

  it('main reports through the console on success', () => {
    const dist = tempDir();
    writeTree(dist, { 'index.html': 'x' });
    writeChecksumsManifestFile(dist);

    expect(() => main(['--dist', dist])).not.toThrow();
  });
});

/*
 * Paketabdeckung gegen den gepinnten Pages-Uploader
 * (actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9,
 * action.yml, Linux-Zweig). Die tar-Optionen sind dort wörtlich übernommen;
 * `deploy.yml` pinnt denselben SHA, ein Pin-Wechsel fällt im Test unten auf.
 * Nur GNU tar kennt `--hard-dereference`, deshalb läuft der Test auf Linux
 * (CI) und wird mit bsdtar übersprungen.
 */
const UPLOAD_PAGES_PIN = 'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9';

function isGnuTar() {
  try {
    return execFileSync('tar', ['--version'], { encoding: 'utf8' }).includes('GNU tar');
  } catch {
    return false;
  }
}

function listExtracted(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(relative(root, full).split('\\').join('/'));
    }
  };
  walk(root);
  return files.sort();
}

describe('package coverage against the pinned Pages uploader', () => {
  it('pins the uploader whose tar options this test replays', () => {
    const deploy = readFileSync(join(import.meta.dirname, '..', '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toContain(`uses: ${UPLOAD_PAGES_PIN}`);
  });

  it.skipIf(!isGnuTar())('publishes exactly the manifest entries plus SHA256SUMS', () => {
    const dist = tempDir();
    writeTree(dist, FIXTURE);
    const manifest = writeChecksumsManifestFile(dist);
    const work = tempDir('gspp-pages-tar-');
    const archive = join(work, 'artifact.tar');
    const extracted = join(work, 'out');
    mkdirSync(extracted);

    execFileSync('tar', [
      '--dereference', '--hard-dereference',
      '--directory', dist,
      '-cvf', archive,
      '--exclude=.git',
      '--exclude=.github',
      '--exclude=.[^/]*',
      '.',
    ]);
    execFileSync('tar', ['-xf', archive, '-C', extracted]);

    const packaged = listExtracted(extracted);
    const entries = parseChecksumsManifest(manifest);
    expect(packaged).toEqual([...entries.keys(), CHECKSUMS_FILE].sort());
    for (const [path, hash] of entries) {
      expect(sha(readFileSync(join(extracted, path))), path).toBe(hash);
    }
    expect(readFileSync(join(extracted, CHECKSUMS_FILE), 'utf8')).toBe(manifest);
  });
});
