import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { NotRegularFileError, readRegularFileNoFollow, readRegularFileNoFollowSync } from './regularFileRead.mjs';

const execFileAsync = promisify(execFile);
const BYTES = Buffer.from('{"snapshot":"synthetic"}\n');

// Beide Varianten müssen für jeden Dateityp dasselbe Ergebnis liefern.
const variants = {
  async: (path: string) => readRegularFileNoFollow(path),
  sync: async (path: string) => readRegularFileNoFollowSync(path),
};

async function withFile(kind: string, run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'regular-file-read-'));
  const filePath = join(directory, 'upstream-manifest.json');
  try {
    if (kind === 'regular') await writeFile(filePath, BYTES);
    if (kind === 'symlink') {
      const target = join(directory, 'target.json');
      await writeFile(target, BYTES);
      await symlink(target, filePath);
    }
    if (kind === 'directory') await mkdir(filePath);
    if (kind === 'fifo') await execFileAsync('mkfifo', [filePath]);
    await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe.each(Object.entries(variants))('readRegularFileNoFollow (%s)', (_name, read) => {
  it('reads a regular file', async () => {
    await withFile('regular', async (path) => {
      expect(await read(path)).toEqual(BYTES);
    });
  });

  it('rejects a symlink without following it', async () => {
    await withFile('symlink', async (path) => {
      await expect(read(path)).rejects.toMatchObject({
        name: 'NotRegularFileError',
        symlink: true,
        message: `${path} must be a regular file, not a symlink`,
      });
    });
  });

  it('rejects a directory', async () => {
    await withFile('directory', async (path) => {
      await expect(read(path)).rejects.toBeInstanceOf(NotRegularFileError);
      await expect(read(path)).rejects.toMatchObject({ symlink: false });
    });
  });

  it('passes other errors through unchanged', async () => {
    await withFile('missing', async (path) => {
      await expect(read(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  // Named Pipes unter Windows sind keine POSIX-FIFOs; dort gibt es kein mkfifo.
  it.skipIf(process.platform === 'win32')('rejects a POSIX FIFO without blocking', async () => {
    await withFile('fifo', async (path) => {
      await expect(read(path)).rejects.toMatchObject({ name: 'NotRegularFileError', symlink: false });
    });
  });
});
