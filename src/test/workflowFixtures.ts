import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Isoliert Jobs im Repository-Workflowformat (zwei Leerzeichen je Job). */
export function jobScopes(
  workflowContent: string,
  { requireJobsBlock = false } = {},
): Map<string, string> {
  const jobsBlock = workflowContent.split('\njobs:\n')[1];
  if (requireJobsBlock && jobsBlock === undefined) {
    throw new TypeError('Workflow enthält keinen jobs-Block');
  }
  const jobs = jobsBlock ?? '';
  const headers = [...jobs.matchAll(/^\x20{2}([\w-]+):\n/gm)];
  return new Map(
    headers.map((header, index) => [
      header[1],
      jobs.slice(header.index, headers[index + 1]?.index ?? jobs.length),
    ]),
  );
}

/** Registriert jedes temporäre Repository vor dem Schreiben für den Suite-Cleanup. */
export function createRepositoryFixture(temporaryDirectories: Set<string>, prefix: string) {
  return async (files: Record<string, string>): Promise<string> => {
    const root = await mkdtemp(resolve(tmpdir(), prefix));
    temporaryDirectories.add(root);
    for (const [path, contents] of Object.entries(files)) {
      const absolute = join(root, path);
      await mkdir(resolve(absolute, '..'), { recursive: true });
      await writeFile(absolute, contents, 'utf8');
    }
    return root;
  };
}
