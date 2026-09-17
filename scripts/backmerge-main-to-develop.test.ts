import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKMERGE_BRANCH,
  BackmergeError,
  buildPullRequestBody,
  checkCompletedImportAncestry,
  classifyBackmerge,
  collectManifestBlobsOnSource,
  createGitRunner,
  formatSourceMarker,
  manifestOriginatesFromSource,
  parseSourceMarkers,
  runBackmerge,
  selectBranch,
} from './backmerge-main-to-develop.mjs';
import { CATALOG_IMPORT_BRANCH, TRACKED_MANIFEST_PATH } from './catalog-sync-guard.mjs';
import { validateDocumentationContract } from './pr-documentation-contract.mjs';

const execFileAsync = promisify(execFile);
const REGISTRY_PATH = 'src/domain/sourceRegistry.mjs';

function getAllowedTempRoot() {
  return process.env.RUNNER_TEMP ?? tmpdir();
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

interface Fixture {
  root: string;
  work: string;
  origin: string;
  git: ReturnType<typeof createGitRunner>;
  run: (...args: string[]) => Promise<string>;
  commit: (message: string) => Promise<string>;
  writeManifest: (snapshotCommitSha: string) => Promise<void>;
}

/**
 * Zwei echte Repositories: ein bare `origin` und ein Arbeitsbaum. Die Lane
 * rechnet gegen Remote-Tracking-Refs, pusht und liest `ls-remote`; ein
 * gemocktes git würde genau die Eigenschaften nicht prüfen, auf die es hier
 * ankommt.
 */
async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(getAllowedTempRoot(), 'backmerge-'));
  temporaryRoots.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');

  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main', work]);

  const run = async (...args: string[]) =>
    (await execFileAsync('git', ['-C', work, ...args], { encoding: 'utf8' })).stdout.trim();

  await run('config', 'user.email', 'backmerge-test@example.invalid');
  await run('config', 'user.name', 'Backmerge Test');
  await run('config', 'commit.gpgsign', 'false');
  await run('remote', 'add', 'origin', origin);

  const commit = async (message: string) => {
    await run('add', '--all');
    await run('commit', '--quiet', '--allow-empty', '--message', message);
    return run('rev-parse', 'HEAD');
  };

  const writeManifest = async (snapshotCommitSha: string) => {
    await writeFile(
      join(work, TRACKED_MANIFEST_PATH),
      `${JSON.stringify({ schemaVersion: 2, snapshotCommitSha, files: [] }, null, 2)}\n`,
      'utf8',
    );
  };

  return { root, work, origin, git: createGitRunner({ cwd: work }), run, commit, writeManifest };
}

/** Gemeinsamer Ausgangsstand: `main` und `develop` auf demselben Commit. */
async function seedBothLines(fixture: Fixture, snapshotCommitSha: string) {
  await fixture.writeManifest(snapshotCommitSha);
  await writeFile(join(fixture.work, 'README.md'), '# Fixture\n', 'utf8');
  await fixture.commit('chore: Ausgangsstand');
  await fixture.run('branch', 'develop');
  await fixture.run('push', '--quiet', 'origin', 'main', 'develop');
}

function createGitHubStub(overrides: Record<string, unknown> = {}) {
  return {
    listMergedPullRequests: vi.fn(async () => [] as { number: number; body: string }[]),
    findOpenPullRequest: vi.fn(async () => null as number | null),
    createPullRequest: vi.fn(async () => 'https://example.invalid/pull/1'),
    updatePullRequest: vi.fn(async ({ number }: { number: number }) => number),
    ...overrides,
  };
}

const silentLogger = { log: () => {}, error: () => {} };

describe('classifyBackmerge', () => {
  it('erkennt den reinen Manifest-Sync als M1', () => {
    expect(classifyBackmerge({
      changedPaths: [TRACKED_MANIFEST_PATH],
      snapshotAdvances: true,
    })).toMatchObject({ klasse: 'M1' });
  });

  it('erkennt Manifest und Quellregister gemeinsam als M2', () => {
    expect(classifyBackmerge({
      changedPaths: [TRACKED_MANIFEST_PATH, REGISTRY_PATH, 'docs/ARCHITECTURE.md'],
      snapshotAdvances: true,
    })).toMatchObject({ klasse: 'M2' });
  });

  it('erkennt Inhalt ohne Manifestpfad als M3', () => {
    expect(classifyBackmerge({
      changedPaths: ['src/app/App.tsx', 'docs/ARCHITECTURE.md'],
      snapshotAdvances: false,
    })).toMatchObject({ klasse: 'M3' });
  });

  it('meldet Leerlauf, wenn die Quelle seit der Basis nichts bewegt hat', () => {
    expect(classifyBackmerge({ changedPaths: [], snapshotAdvances: false }))
      .toMatchObject({ klasse: 'idle' });
  });

  it('meldet einen Konflikt, wenn das Manifest ohne Quellregister von anderem Inhalt begleitet wird', () => {
    // Diese Kombination passiert weder den vierten Vertrag (genau eine Datei)
    // noch einen Migrationsvertrag (verlangt das Quellregister im Diff).
    const result = classifyBackmerge({
      changedPaths: [TRACKED_MANIFEST_PATH, 'scripts/fetch-catalog.mjs'],
      snapshotAdvances: true,
    });
    expect(result.klasse).toBe('conflict');
    expect(result.reason).toContain('scripts/fetch-catalog.mjs');
  });

  it('meldet einen Konflikt, wenn sich das Manifest ohne Snapshotwechsel bewegt', () => {
    const result = classifyBackmerge({
      changedPaths: [TRACKED_MANIFEST_PATH],
      snapshotAdvances: false,
    });
    expect(result.klasse).toBe('conflict');
    expect(result.reason).toContain('snapshotCommitSha');
  });
});

describe('Quellmarke', () => {
  it('erzeugt und liest die Marke verlustfrei', () => {
    const sha = 'a'.repeat(40);
    expect(parseSourceMarkers(`Text\n${formatSourceMarker(sha)}\nmehr`)).toEqual([sha]);
  });

  it('liest mehrere Marken und ignoriert Fremdtext', () => {
    const first = 'a'.repeat(40);
    const second = 'b'.repeat(40);
    const body = `${formatSourceMarker(first)}\nirgendetwas\n${formatSourceMarker(second)}`;
    expect(parseSourceMarkers(body)).toEqual([first, second]);
  });

  it('liefert für einen Body ohne Marke eine leere Liste', () => {
    expect(parseSourceMarkers('kein Marker hier')).toEqual([]);
    expect(parseSourceMarkers(undefined as unknown as string)).toEqual([]);
  });

  it('weist eine Marke ohne vollständigen SHA ab', () => {
    expect(() => formatSourceMarker('abc123')).toThrow(BackmergeError);
    expect(parseSourceMarkers('<!-- backmerge-source: abc123 -->')).toEqual([]);
  });
});

describe('selectBranch', () => {
  it('nutzt für M1 den Import-Namensraum und sonst den neutralen Namen', () => {
    expect(selectBranch({ klasse: 'M1', repairRequired: false })).toBe(CATALOG_IMPORT_BRANCH);
    expect(selectBranch({ klasse: 'M2', repairRequired: false })).toBe(BACKMERGE_BRANCH);
    expect(selectBranch({ klasse: 'M3', repairRequired: false })).toBe(BACKMERGE_BRANCH);
  });

  it('verlässt den Squash-fähigen Namensraum, sobald eine Reparatur ansteht', () => {
    expect(selectBranch({ klasse: 'M1', repairRequired: true })).toBe(BACKMERGE_BRANCH);
  });
});

describe('buildPullRequestBody', () => {
  const sourceSha = 'c'.repeat(40);

  it('trägt die Quellmarke und die verlangte Merge-Methode', () => {
    const body = buildPullRequestBody({
      klasse: 'M3',
      reason: 'Inhalt ohne Manifestpfad.',
      sourceSha,
      changedPaths: ['src/app/App.tsx'],
      mergeMethod: 'Merge-Commit',
    });

    expect(parseSourceMarkers(body)).toEqual([sourceSha]);
    expect(body).toContain('**Erforderliche Merge-Methode:** Merge-Commit');
  });

  it('erfüllt den Dokumentationsvertrag mit „Keine Dokumentationsauswirkung"', () => {
    const changedPaths = ['src/app/App.tsx'];
    const body = buildPullRequestBody({
      klasse: 'M3',
      reason: 'Inhalt ohne Manifestpfad.',
      sourceSha,
      changedPaths,
      mergeMethod: 'Merge-Commit',
    });

    expect(validateDocumentationContract({ changedFiles: changedPaths, pullRequestBody: body }))
      .toMatchObject({ documentationImpact: 'none' });
  });

  it('erfüllt den Dokumentationsvertrag mit den übernommenen Dokumentationsdateien', () => {
    const changedPaths = ['src/app/App.tsx', 'docs/ARCHITECTURE.md'];
    const body = buildPullRequestBody({
      klasse: 'M3',
      reason: 'Inhalt ohne Manifestpfad.',
      sourceSha,
      changedPaths,
      mergeMethod: 'Merge-Commit',
    });

    expect(validateDocumentationContract({ changedFiles: changedPaths, pullRequestBody: body }))
      .toMatchObject({ documentationImpact: 'updated' });
  });

  it('nennt jede wiederherzustellende Übernahme mit eigener Marke', () => {
    const repaired = 'd'.repeat(40);
    const body = buildPullRequestBody({
      klasse: 'M3',
      reason: 'Inhalt ohne Manifestpfad.',
      sourceSha,
      changedPaths: ['src/app/App.tsx'],
      repairSources: [{ number: 42, sha: repaired }],
      mergeMethod: 'Merge-Commit',
    });

    expect(body).toContain('Pull Request #42');
    expect(parseSourceMarkers(body)).toEqual([sourceSha, repaired]);
  });
});

describe('M1-Vorbedingung', () => {
  it('erkennt einen aus der Freigabelinie stammenden Manifeststand über mehrere Schritte', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    // main läuft über zwei Sync-Schritte weiter, develop bleibt auf A.
    await fixture.writeManifest('b'.repeat(40));
    await fixture.commit('chore(ci): Sync B');
    await fixture.writeManifest('c'.repeat(40));
    await fixture.commit('chore(ci): Sync C');
    await fixture.run('push', '--quiet', 'origin', 'main');
    await fixture.run('fetch', '--quiet', 'origin');

    await expect(manifestOriginatesFromSource(fixture.git)).resolves.toBe(true);

    // Die Aufzählung deckt jeden je getragenen Stand ab, nicht nur die Spitze.
    const blobs = await collectManifestBlobsOnSource(fixture.git);
    expect(blobs.size).toBe(3);
  });

  it('schlägt an, wenn develops Manifest an keinem erreichbaren Commit vorkommt', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    // develop bewegt das Manifest eigenständig — der Stand stammt nicht aus main.
    await fixture.run('switch', '--quiet', 'develop');
    await fixture.writeManifest('f'.repeat(40));
    await fixture.commit('chore: eigenständiger Manifeststand auf develop');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    await fixture.run('switch', '--quiet', 'main');
    await fixture.writeManifest('b'.repeat(40));
    await fixture.commit('chore(ci): Sync B');
    await fixture.run('push', '--quiet', 'origin', 'main');
    await fixture.run('fetch', '--quiet', 'origin');

    await expect(manifestOriginatesFromSource(fixture.git)).resolves.toBe(false);
  });
});

describe('Ancestry abgeschlossener Übernahmen', () => {
  it('bestätigt eine als Merge-Commit gemergte Übernahme', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'hotfix.txt'), 'Hotfix\n', 'utf8');
    const sourceSha = await fixture.commit('fix: Hotfix auf main');
    await fixture.run('push', '--quiet', 'origin', 'main');

    // Übernahme als Merge-Commit: der Quellstand wird Vorfahr von develop.
    await fixture.run('switch', '--quiet', 'develop');
    await fixture.run('merge', '--quiet', '--no-ff', '-m', 'chore(sync): Übernahme', sourceSha);
    const tipSha = await fixture.run('rev-parse', 'HEAD');
    await fixture.run('push', '--quiet', 'origin', 'develop');
    await execFileAsync('git', ['-C', fixture.origin, 'update-ref', 'refs/pull/7/head', tipSha]);
    await fixture.git(['fetch', '--no-tags', 'origin', '+refs/pull/7/head:refs/backmerge-pr/7']);
    await fixture.run('fetch', '--quiet', 'origin');

    const result = await checkCompletedImportAncestry(fixture.git, {
      pullRequests: [{ number: 7, body: formatSourceMarker(sourceSha) }],
    });
    expect(result).toEqual({ invalid: [], missing: [] });
  });

  it('erkennt einen gesquashten Übernahme-PR an der fehlenden Ancestry', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'hotfix.txt'), 'Hotfix\n', 'utf8');
    const sourceSha = await fixture.commit('fix: Hotfix auf main');
    await fixture.run('push', '--quiet', 'origin', 'main');

    // Der Branch entsteht wie im Lauf, wird danach aber durch einen Merge des
    // neueren develop aktualisiert — und erst dann gesquasht. Die Marke im
    // PR-Body überlebt beides; der zweite Elternteil des Heads täte es nicht.
    await fixture.run('switch', '--quiet', '--create', 'chore/import', 'develop');
    await fixture.run('merge', '--quiet', '--no-ff', '-m', 'chore(sync): Übernahme', sourceSha);
    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'weiter.txt'), 'develop läuft weiter\n', 'utf8');
    await fixture.commit('chore: develop läuft weiter');
    await fixture.run('switch', '--quiet', 'chore/import');
    await fixture.run('merge', '--quiet', '--no-ff', '-m', 'Update branch', 'develop');
    const tipSha = await fixture.run('rev-parse', 'HEAD');
    await fixture.run('push', '--quiet', 'origin', 'chore/import');

    // Squash-Merge: der Inhalt landet vollständig, die Historie nicht.
    await fixture.run('switch', '--quiet', 'develop');
    await fixture.run('merge', '--quiet', '--squash', 'chore/import');
    await fixture.commit('chore(sync): Übernahme (squashed)');
    await fixture.run('push', '--quiet', 'origin', 'develop');
    await execFileAsync('git', ['-C', fixture.origin, 'update-ref', 'refs/pull/7/head', tipSha]);
    await fixture.git(['fetch', '--no-tags', 'origin', '+refs/pull/7/head:refs/backmerge-pr/7']);
    await fixture.run('fetch', '--quiet', 'origin');

    const result = await checkCompletedImportAncestry(fixture.git, {
      pullRequests: [{ number: 7, body: formatSourceMarker(sourceSha) }],
    });
    expect(result.invalid).toEqual([]);
    expect(result.missing).toEqual([{ number: 7, sha: sourceSha }]);
  });

  it('behandelt einen PR ohne Quellmarke als ungültig statt als bestanden', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));
    await fixture.run('fetch', '--quiet', 'origin');

    const result = await checkCompletedImportAncestry(fixture.git, {
      pullRequests: [{ number: 9, body: 'Ein Body ganz ohne Marke.' }],
    });
    expect(result.missing).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]).toMatchObject({ number: 9 });
    expect(result.invalid[0].reason).toContain('keine Quellmarke');
  });

  it('behandelt eine von der PR-Spitze nicht erreichbare Marke als ungültig', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    // Ein Commit, den es gibt, der aber auf keinem Übernahme-Branch liegt.
    await fixture.run('switch', '--quiet', '--create', 'seitenlinie', 'main');
    await writeFile(join(fixture.work, 'fremd.txt'), 'fremd\n', 'utf8');
    const fremderSha = await fixture.commit('chore: fremder Commit');

    const tipSha = await fixture.run('rev-parse', 'develop');
    await execFileAsync('git', ['-C', fixture.origin, 'update-ref', 'refs/pull/8/head', tipSha]);
    await fixture.git(['fetch', '--no-tags', 'origin', '+refs/pull/8/head:refs/backmerge-pr/8']);
    await fixture.run('fetch', '--quiet', 'origin');

    const result = await checkCompletedImportAncestry(fixture.git, {
      pullRequests: [{ number: 8, body: formatSourceMarker(fremderSha) }],
    });
    expect(result.missing).toEqual([]);
    expect(result.invalid[0].reason).toContain('nicht erreichbar');
  });
});

describe('runBackmerge', () => {
  it('endet ohne Pull Request, wenn die Übernahme den develop-Baum nicht ändert', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    // develop läuft eigenständig weiter: Die Bäume von main und develop weichen
    // ab, obwohl es nichts zu übernehmen gibt. Ein Baumvergleich zwischen den
    // Linien würde hier fälschlich einen Pull Request erzeugen.
    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'feature.txt'), 'nur auf develop\n', 'utf8');
    await fixture.commit('feat: Arbeit auf develop');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    const github = createGitHubStub();
    const result = await runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    });

    expect(result).toMatchObject({ created: false, klasse: 'idle' });
    expect(github.createPullRequest).not.toHaveBeenCalled();
    const treesDiffer = await fixture.run('rev-parse', 'origin/main^{tree}')
      !== await fixture.run('rev-parse', 'origin/develop^{tree}');
    expect(treesDiffer).toBe(true);
  });

  it('erzeugt für einen reinen Manifest-Sync genau einen Übernahme-PR', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'main');
    await fixture.writeManifest('b'.repeat(40));
    await fixture.commit('chore(ci): Sync B');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const github = createGitHubStub();
    const result = await runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    });

    expect(result).toMatchObject({ created: true, klasse: 'M1' });
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
    const [[call]] = github.createPullRequest.mock.calls as [[{ head: string; body: string }]];
    expect(call.head).toBe(CATALOG_IMPORT_BRANCH);

    // Genau eine geänderte Datei gegenüber develop — die Bedingung, an der der
    // vierte Guard-Vertrag hängt.
    const changed = await fixture.run(
      'diff', '--name-only', 'origin/develop', `origin/${CATALOG_IMPORT_BRANCH}`,
    );
    expect(changed).toBe(TRACKED_MANIFEST_PATH);
  });

  it('übernimmt bei einem offenen PR und weitergelaufenem main den Sprung statt des Einzelschritts', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'main');
    await fixture.writeManifest('b'.repeat(40));
    await fixture.commit('chore(ci): Sync B');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const github = createGitHubStub();
    await runBackmerge({ cwd: fixture.work, git: fixture.git, github, logger: silentLogger });

    // main läuft auf C weiter, während der PR für B offen bleibt.
    await fixture.run('switch', '--quiet', 'main');
    await fixture.writeManifest('c'.repeat(40));
    await fixture.commit('chore(ci): Sync C');
    await fixture.run('push', '--quiet', 'origin', 'main');

    github.findOpenPullRequest.mockResolvedValue(11);
    await runBackmerge({ cwd: fixture.work, git: fixture.git, github, logger: silentLogger });

    expect(github.updatePullRequest).toHaveBeenCalledTimes(1);
    // Der aktualisierte Branch trägt Cs Manifest, nicht Bs.
    const manifestOnBranch = await fixture.run(
      'show', `origin/${CATALOG_IMPORT_BRANCH}:${TRACKED_MANIFEST_PATH}`,
    );
    expect(JSON.parse(manifestOnBranch).snapshotCommitSha).toBe('c'.repeat(40));
    // Und der Branch bleibt bei genau einem Commit über develop: ein Sprung,
    // keine Kette von Einzelschritten.
    const commitCount = await fixture.run(
      'rev-list', '--count', `origin/develop..origin/${CATALOG_IMPORT_BRANCH}`,
    );
    expect(commitCount).toBe('1');
  });

  it('stellt ohne erfüllte M1-Vorbedingung keinen Pull Request', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'develop');
    await fixture.writeManifest('f'.repeat(40));
    await fixture.commit('chore: eigenständiger Manifeststand auf develop');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    await fixture.run('switch', '--quiet', 'main');
    await fixture.writeManifest('b'.repeat(40));
    await fixture.commit('chore(ci): Sync B');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const github = createGitHubStub();
    await expect(runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    })).rejects.toThrow(/M1-Vorbedingung ist verletzt/);
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('erhält eine unabhängige Änderung auf develop bei der Manifest-Übernahme nicht zurück', async () => {
    // Negativtest zum Erhalt unabhängiger Änderungen: main bewegt das Manifest,
    // develop bewegt unabhängig eine andere Datei. Nach der Übernahme muss
    // develops eigene Änderung erhalten bleiben.
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'lifecycle.txt'), 'preview\n', 'utf8');
    await fixture.commit('chore: develop setzt lifecycle auf preview');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    await fixture.run('switch', '--quiet', 'main');
    await fixture.writeManifest('b'.repeat(40));
    await fixture.commit('chore(ci): Sync B');
    await fixture.run('push', '--quiet', 'origin', 'main');

    await runBackmerge({
      cwd: fixture.work, git: fixture.git, github: createGitHubStub(), logger: silentLogger,
    });

    const onBranch = await fixture.run(
      'show', `origin/${CATALOG_IMPORT_BRANCH}:lifecycle.txt`,
    );
    expect(onBranch).toBe('preview');
  });

  it('meldet die fehlende Ancestry und stellt trotz vollständigen Inhalts einen Reparatur-PR', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'hotfix.txt'), 'Hotfix\n', 'utf8');
    const sourceSha = await fixture.commit('fix: Hotfix auf main');
    await fixture.run('push', '--quiet', 'origin', 'main');

    // Gesquashte Übernahme: Der Inhalt liegt auf develop vollständig vor.
    await fixture.run('switch', '--quiet', 'develop');
    await fixture.run('merge', '--quiet', '--squash', sourceSha);
    await fixture.commit('chore(sync): Übernahme (squashed)');
    await fixture.run('push', '--quiet', 'origin', 'develop');
    await execFileAsync('git', ['-C', fixture.origin, 'update-ref', 'refs/pull/5/head', sourceSha]);

    const github = createGitHubStub({
      listMergedPullRequests: vi.fn(async () => [
        { number: 5, body: formatSourceMarker(sourceSha) },
      ]),
    });

    // Der Lauf endet mit einem Fehler — aber erst, nachdem der Pull Request steht.
    await expect(runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    })).rejects.toThrow(/Ancestry abgeschlossener Übernahmen/);

    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
    const [[call]] = github.createPullRequest.mock.calls as [[{ head: string; body: string }]];
    expect(call.head).toBe(BACKMERGE_BRANCH);
    expect(parseSourceMarkers(call.body)).toContain(sourceSha);

    // Der Reparaturbranch stellt die Ancestry her, ohne den Baum zu verändern.
    const branchTree = await fixture.run('rev-parse', `origin/${BACKMERGE_BRANCH}^{tree}`);
    const developTree = await fixture.run('rev-parse', 'origin/develop^{tree}');
    expect(branchTree).toBe(developTree);
    await expect(fixture.run(
      'merge-base', '--is-ancestor', sourceSha, `origin/${BACKMERGE_BRANCH}`,
    )).resolves.toBe('');
  });

  it('bricht ohne Pull Request ab, wenn ein PR keine überprüfbare Quellmarke trägt', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    const github = createGitHubStub({
      listMergedPullRequests: vi.fn(async () => [{ number: 3, body: 'ohne Marke' }]),
    });

    await expect(runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    })).rejects.toThrow(/keine überprüfbare Quellmarke/);
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('erzeugt für Inhalt ohne Manifestpfad einen M3-Merge-Commit-PR', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'hotfix.txt'), 'Hotfix\n', 'utf8');
    await fixture.commit('fix: Hotfix auf main');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const github = createGitHubStub();
    const result = await runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    });

    expect(result).toMatchObject({ created: true, klasse: 'M3' });
    const [[call]] = github.createPullRequest.mock.calls as [[{ head: string; body: string }]];
    expect(call.head).toBe(BACKMERGE_BRANCH);
    expect(call.body).toContain('**Erforderliche Merge-Methode:** Merge-Commit');

    // Der Branch trägt einen echten Merge-Commit: Die gemeinsame Basis wandert
    // beim Merge mit, ein Squash ließe sie zurückfallen.
    const parents = await fixture.run('rev-list', '--parents', '-n', '1', `origin/${BACKMERGE_BRANCH}`);
    expect(parents.split(' ')).toHaveLength(3);
  });

  it('bricht mit Konfliktbefund ab, wenn die Ausgangszustände auseinandergelaufen sind', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'hotfix.txt'), 'develops Fassung\n', 'utf8');
    await fixture.commit('fix: develops Fassung');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'hotfix.txt'), 'mains Fassung\n', 'utf8');
    await fixture.commit('fix: mains Fassung');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const github = createGitHubStub();
    await expect(runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    })).rejects.toThrow(/auseinandergelaufen/);
    expect(github.createPullRequest).not.toHaveBeenCalled();

    // Nichts wurde überschrieben: develop trägt weiterhin seine Fassung.
    await expect(fixture.run('show', 'origin/develop:hotfix.txt'))
      .resolves.toBe("develops Fassung");
  });

  it('kollidiert nach einem M1-Squash an der veralteten gemeinsamen Basis, ohne etwas zu überschreiben', async () => {
    // Betriebsgrenze M1-Squash vor M2: Der Squash schreibt die gemeinsame Basis
    // nicht fort. Der Manifestpfad dort veraltet, während develop den neuen
    // Inhalt bereits trägt — der nächste Merge rechnet gegen den alten Stand.
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    await fixture.run('switch', '--quiet', 'main');
    await fixture.writeManifest('b'.repeat(40));
    await fixture.commit('chore(ci): Sync B');
    await fixture.run('push', '--quiet', 'origin', 'main');

    await runBackmerge({
      cwd: fixture.work, git: fixture.git, github: createGitHubStub(), logger: silentLogger,
    });

    // Der M1-PR wird gesquasht gemergt.
    await fixture.run('switch', '--quiet', 'develop');
    await fixture.run('merge', '--quiet', '--squash', `origin/${CATALOG_IMPORT_BRANCH}`);
    await fixture.commit('chore(sync): Manifest übernehmen (squashed)');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    // Danach bewegt main Manifest und Quellregister gemeinsam.
    await fixture.run('switch', '--quiet', 'main');
    await fixture.writeManifest('c'.repeat(40));
    await fixture.run('rm', '--quiet', '--cached', '--ignore-unmatch', REGISTRY_PATH);
    await execFileAsync('mkdir', ['-p', join(fixture.work, 'src/domain')]);
    await writeFile(join(fixture.work, REGISTRY_PATH), 'export const SOURCE_REGISTRY = [];\n', 'utf8');
    await fixture.commit('chore(ci): Sync C mit Registeränderung');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const github = createGitHubStub();
    await expect(runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    })).rejects.toThrow(/auseinandergelaufen/);
    expect(github.createPullRequest).not.toHaveBeenCalled();

    // Nichts überschrieben: develop trägt weiterhin Bs Manifest.
    const manifestOnDevelop = await fixture.run('show', `origin/develop:${TRACKED_MANIFEST_PATH}`);
    expect(JSON.parse(manifestOnDevelop).snapshotCommitSha).toBe('b'.repeat(40));
  });

  it('mergt nicht und löscht keine Branches', async () => {
    const fixture = await createFixture();
    await seedBothLines(fixture, 'a'.repeat(40));

    const developBefore = await fixture.run('rev-parse', 'origin/develop');
    const mainBefore = await fixture.run('rev-parse', 'origin/main');

    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'hotfix.txt'), 'Hotfix\n', 'utf8');
    await fixture.commit('fix: Hotfix auf main');
    await fixture.run('push', '--quiet', 'origin', 'main');
    const mainAfterPush = await fixture.run('rev-parse', 'origin/main');

    await runBackmerge({
      cwd: fixture.work, git: fixture.git, github: createGitHubStub(), logger: silentLogger,
    });

    // develop unverändert, main nur durch den Test selbst bewegt.
    await expect(fixture.run('rev-parse', 'origin/develop')).resolves.toBe(developBefore);
    await expect(fixture.run('rev-parse', 'origin/main')).resolves.toBe(mainAfterPush);
    expect(mainBefore).not.toBe(mainAfterPush);
  });
});

describe('runBackmerge, Klasse M2', () => {
  /**
   * Manifest mit vollständigen Dateieinträgen. Der Lifecycle-Vertrag vergleicht
   * Snapshot, Pfadmenge und jeden Content-Pin — ein reduziertes Manifest würde
   * ihn nicht greifen lassen.
   */
  function manifestWithLifecycle(lifecycle: string) {
    return `${JSON.stringify({
      schemaVersion: 2,
      snapshotCommitSha: 'a'.repeat(40),
      files: [{
        artifactKey: 'entry-catalog',
        rootType: 'catalog',
        lifecycle,
        path: 'catalog/entry.json',
        gitBlobSha: '1'.repeat(40),
        contentSha256: '2'.repeat(64),
      }],
    }, null, 2)}\n`;
  }

  async function seedRegistryLine(fixture: Fixture, lifecycle: string) {
    await execFileAsync('mkdir', ['-p', join(fixture.work, 'src/domain')]);
    await writeFile(
      join(fixture.work, REGISTRY_PATH),
      `export const SOURCE_REGISTRY = [{ lifecycle: '${lifecycle}' }];\n`,
      'utf8',
    );
  }

  it('stellt einen M2-PR, wenn der Zielzustand einen Migrationsvertrag erfüllt', async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.work, TRACKED_MANIFEST_PATH), manifestWithLifecycle('preview'), 'utf8');
    await seedRegistryLine(fixture, 'preview');
    await fixture.commit('chore: Ausgangsstand');
    await fixture.run('branch', 'develop');
    await fixture.run('push', '--quiet', 'origin', 'main', 'develop');

    // main promotet den Lifecycle: derselbe Snapshot, unveränderte Pins,
    // Manifest und Quellregister gemeinsam bewegt.
    await writeFile(join(fixture.work, TRACKED_MANIFEST_PATH), manifestWithLifecycle('supported'), 'utf8');
    await seedRegistryLine(fixture, 'supported');
    await fixture.commit('chore: Lifecycle-Promotion');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const github = createGitHubStub();
    const result = await runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    });

    expect(result).toMatchObject({ created: true, klasse: 'M2' });
    const [[call]] = github.createPullRequest.mock.calls as [[{ head: string; body: string }]];
    expect(call.head).toBe(BACKMERGE_BRANCH);
  });

  it('stellt keinen PR, wenn der Zielzustand keinen Migrationsvertrag erfüllt', async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.work, TRACKED_MANIFEST_PATH), manifestWithLifecycle('preview'), 'utf8');
    await seedRegistryLine(fixture, 'preview');
    await fixture.commit('chore: Ausgangsstand');
    await fixture.run('branch', 'develop');
    await fixture.run('push', '--quiet', 'origin', 'main', 'develop');

    // Neue Bytes UND ein bewegter Snapshot: weder Lifecycle-Wechsel noch
    // Preview-Erweiterung, und das Quellregister im Fixture trägt keine
    // ladbare Modulkette für die Versionsmigration.
    await writeFile(join(fixture.work, TRACKED_MANIFEST_PATH), `${JSON.stringify({
      schemaVersion: 2,
      snapshotCommitSha: 'b'.repeat(40),
      files: [{
        artifactKey: 'entry-catalog',
        rootType: 'catalog',
        lifecycle: 'supported',
        path: 'catalog/entry.json',
        gitBlobSha: '9'.repeat(40),
        contentSha256: '8'.repeat(64),
      }],
    }, null, 2)}\n`, 'utf8');
    await seedRegistryLine(fixture, 'supported');
    await fixture.commit('chore: Snapshot und Register gemeinsam bewegt');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const github = createGitHubStub();
    await expect(runBackmerge({
      cwd: fixture.work, git: fixture.git, github, logger: silentLogger,
    })).rejects.toThrow(/keinen der drei Registry-Migrationsverträge/);
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });
});
