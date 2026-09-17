import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitRunner } from './backmerge-main-to-develop.mjs';
import {
  RELEASE_BASE_REF,
  ReleasePrepareError,
  buildReleasePullRequestBody,
  formatReleaseMarker,
  parseReleaseMarkers,
  releaseBranchName,
  runReleasePrepare,
  verifyReleasePullRequest,
} from './release-prepare.mjs';

const execFileAsync = promisify(execFile);

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
  work: string;
  origin: string;
  git: ReturnType<typeof createGitRunner>;
  run: (...args: string[]) => Promise<string>;
  commit: (message: string) => Promise<string>;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(getAllowedTempRoot(), 'release-prepare-'));
  temporaryRoots.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');

  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main', work]);

  const run = async (...args: string[]) =>
    (await execFileAsync('git', ['-C', work, ...args], { encoding: 'utf8' })).stdout.trim();

  await run('config', 'user.email', 'release-test@example.invalid');
  await run('config', 'user.name', 'Release Test');
  await run('config', 'commit.gpgsign', 'false');
  await run('remote', 'add', 'origin', origin);

  const commit = async (message: string) => {
    await run('add', '--all');
    await run('commit', '--quiet', '--allow-empty', '--message', message);
    return run('rev-parse', 'HEAD');
  };

  await writeFile(join(work, 'README.md'), '# Fixture\n', 'utf8');
  await commit('chore: Ausgangsstand');
  await run('branch', 'develop');
  await run('push', '--quiet', 'origin', 'main', 'develop');

  return { work, origin, git: createGitRunner({ cwd: work }), run, commit };
}

function createGitHubStub(overrides: Record<string, unknown> = {}) {
  return {
    listMergedPullRequests: vi.fn(async () => []),
    findOpenPullRequest: vi.fn(async () => null as number | null),
    createPullRequest: vi.fn(async () => 'https://example.invalid/pull/1'),
    updatePullRequest: vi.fn(async ({ number }: { number: number }) => number),
    ...overrides,
  };
}

const silentLogger = { log: () => {}, error: () => {} };

describe('releaseBranchName', () => {
  it('leitet den kurzlebigen Branchnamen aus dem freigegebenen Stand ab', () => {
    expect(releaseBranchName('a'.repeat(40))).toBe(`release/${'a'.repeat(12)}`);
  });

  it('weist einen unvollständigen SHA ab', () => {
    expect(() => releaseBranchName('abc123')).toThrow(ReleasePrepareError);
  });
});

describe('buildReleasePullRequestBody', () => {
  it('nennt Merge-Commit als erforderliche Merge-Methode und trägt das Freigabe-Protokoll', () => {
    const body = buildReleasePullRequestBody({
      releaseSha: 'a'.repeat(40),
      releaseBranch: `release/${'a'.repeat(12)}`,
      sourceSha: 'b'.repeat(40),
    });

    expect(body).toContain('**Erforderliche Merge-Methode:** Merge-Commit');
    expect(body).toContain('M9-Referenzablauf grün');
    expect(body).toContain('Milestone-Exit erfüllt');
  });
});

describe('runReleasePrepare', () => {
  it('stellt einen PR, dessen Head origin/main als Vorfahr hat und develops Baum trägt', async () => {
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'feature.txt'), 'freigegebene Arbeit\n', 'utf8');
    const releaseSha = await fixture.commit('feat: freigegebene Arbeit');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    const github = createGitHubStub();
    const result = await runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github, releaseRef: releaseSha, logger: silentLogger,
    });

    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
    const [[call]] = github.createPullRequest.mock.calls as [[{ base: string; head: string }]];
    expect(call.base).toBe(RELEASE_BASE_REF);
    expect(call.head).toBe(result.releaseBranch);

    // Bedingung 1: die Strict-Policy ist per Konstruktion erfüllt.
    await expect(fixture.run(
      'merge-base', '--is-ancestor', 'origin/main', `origin/${result.releaseBranch}`,
    )).resolves.toBe('');

    // Bedingung 2: der Baum entspricht exakt dem freigegebenen develop-Stand.
    const headTree = await fixture.run('rev-parse', `origin/${result.releaseBranch}^{tree}`);
    const releaseTree = await fixture.run('rev-parse', `${releaseSha}^{tree}`);
    expect(headTree).toBe(releaseTree);
  });

  it('stoppt ohne PR, wenn main Inhalt trägt, den develop nicht hat', async () => {
    const fixture = await createFixture();

    // Ein Catalog-Sync landet auf main, ohne dass die Übernahme gelaufen ist.
    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'upstream-manifest.json'), '{"snapshotCommitSha":"neu"}\n', 'utf8');
    await fixture.commit('chore(ci): Katalog-Sync auf main');
    await fixture.run('push', '--quiet', 'origin', 'main');

    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'feature.txt'), 'freigegebene Arbeit\n', 'utf8');
    const releaseSha = await fixture.commit('feat: freigegebene Arbeit');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    const github = createGitHubStub();
    await expect(runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github, releaseRef: releaseSha, logger: silentLogger,
    })).rejects.toThrow(/Baum des Vorbereitungsheads entspricht nicht/);
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('nennt bei der Baumabweichung die Inhalts-Übernahme als Ursache', async () => {
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'upstream-manifest.json'), '{"snapshotCommitSha":"neu"}\n', 'utf8');
    await fixture.commit('chore(ci): Katalog-Sync auf main');
    await fixture.run('push', '--quiet', 'origin', 'main');

    const releaseSha = await fixture.run('rev-parse', 'origin/develop');
    await expect(runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github: createGitHubStub(), releaseRef: releaseSha, logger: silentLogger,
    })).rejects.toThrow(/Inhalts-Übernahme `main` → `develop` ist noch nicht vollständig gelaufen/);
  });

  it('ist nach gelaufener Übernahme wieder mergebar', async () => {
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'upstream-manifest.json'), '{"snapshotCommitSha":"neu"}\n', 'utf8');
    await fixture.commit('chore(ci): Katalog-Sync auf main');
    await fixture.run('push', '--quiet', 'origin', 'main');

    // Die Inhalts-Übernahme bringt den Sync nach develop.
    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'upstream-manifest.json'), '{"snapshotCommitSha":"neu"}\n', 'utf8');
    await fixture.commit('chore(sync): Manifest aus main übernehmen');
    const releaseSha = await fixture.run('rev-parse', 'HEAD');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    const github = createGitHubStub();
    const result = await runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github, releaseRef: releaseSha, logger: silentLogger,
    });
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);

    // Der Release-PR trägt den Manifestpfad nicht mehr im Drei-Punkt-Diff
    // gegen main — genau der Zustand, an dem der Guard sonst greifen würde.
    const changed = await fixture.run(
      'diff', '--name-only', `origin/main...origin/${result.releaseBranch}`,
    );
    expect(changed).not.toContain('upstream-manifest.json');
  });

  it('lehnt einen Stand ab, der nicht auf der Integrationslinie liegt', async () => {
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', '--create', 'seitenlinie', 'main');
    await writeFile(join(fixture.work, 'fremd.txt'), 'fremd\n', 'utf8');
    const fremderSha = await fixture.commit('chore: fremder Stand');

    const github = createGitHubStub();
    await expect(runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github, releaseRef: fremderSha, logger: silentLogger,
    })).rejects.toThrow(/liegt nicht auf/);
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  it('mergt nicht und löscht keine Branches', async () => {
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'feature.txt'), 'freigegebene Arbeit\n', 'utf8');
    await fixture.commit('feat: freigegebene Arbeit');
    const releaseSha = await fixture.run('rev-parse', 'HEAD');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    const mainBefore = await fixture.run('rev-parse', 'origin/main');
    const developBefore = await fixture.run('rev-parse', 'origin/develop');

    await runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github: createGitHubStub(), releaseRef: releaseSha, logger: silentLogger,
    });

    await expect(fixture.run('rev-parse', 'origin/main')).resolves.toBe(mainBefore);
    await expect(fixture.run('rev-parse', 'origin/develop')).resolves.toBe(developBefore);
  });
});

describe('Freigabe-SHA als Pflichteingabe', () => {
  // Greptile-Befund an Pull Request #248: Die Eingabe wurde per `rev-parse`
  // aufgelöst, bevor irgendetwas ihre Form prüfte. `develop` war damit eine
  // gültige Eingabe und übernahm den jeweils aktuellen Branch-Head — auch einen
  // Stand, der nach der Freigabeentscheidung hinzukam.
  it.each(['', 'develop', 'origin/develop', 'HEAD', 'abc123', 'A'.repeat(40)])(
    'lehnt die Referenz %j ab, bevor irgendein Branch entsteht',
    async (releaseRef) => {
      const fixture = await createFixture();
      const github = createGitHubStub();

      await expect(runReleasePrepare({
        cwd: fixture.work, git: fixture.git, github, releaseRef, logger: silentLogger,
      })).rejects.toThrow(/40-stelligen Kleinbuchstaben-SHA/);
      expect(github.createPullRequest).not.toHaveBeenCalled();

      // Kein Vorbereitungsbranch ist entstanden.
      const branches = await fixture.run('branch', '--list');
      expect(branches).not.toContain('release/');
    },
  );

  it('akzeptiert den ausdrücklich freigegebenen Commit auch bei weitergelaufenem develop', async () => {
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'freigegeben.txt'), 'freigegeben\n', 'utf8');
    const approvedSha = await fixture.commit('feat: freigegebener Stand');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    // develop läuft nach der Freigabeentscheidung weiter.
    await writeFile(join(fixture.work, 'danach.txt'), 'nach der Freigabe\n', 'utf8');
    const laterSha = await fixture.commit('feat: nach der Freigabe');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    const github = createGitHubStub();
    const result = await runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github, releaseRef: approvedSha, logger: silentLogger,
    });

    expect(result.releaseSha).toBe(approvedSha);
    // Der Vorbereitungsbranch trägt den freigegebenen Baum, nicht den neueren.
    const headTree = await fixture.run('rev-parse', `origin/${result.releaseBranch}^{tree}`);
    expect(headTree).toBe(await fixture.run('rev-parse', `${approvedSha}^{tree}`));
    expect(headTree).not.toBe(await fixture.run('rev-parse', `${laterSha}^{tree}`));
  });
});

describe('verifyReleasePullRequest', () => {
  it('ist für einen PR ausserhalb des Release-Namensraums nicht einschlägig', async () => {
    const fixture = await createFixture();

    await expect(verifyReleasePullRequest({
      baseRef: 'develop',
      branch: 'release/abcdefabcdef',
      headSha: await fixture.run('rev-parse', 'HEAD'),
      body: '',
      git: fixture.git,
    })).resolves.toEqual({ checked: false });

    await expect(verifyReleasePullRequest({
      baseRef: 'main',
      branch: 'chore/catalog-sync-abcdefabcdef',
      headSha: await fixture.run('rev-parse', 'HEAD'),
      body: '',
      git: fixture.git,
    })).resolves.toEqual({ checked: false });
  });

  it('bestätigt einen unveränderten Release-PR gegen seine Freigabemarke', async () => {
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'feature.txt'), 'freigegebene Arbeit\n', 'utf8');
    const releaseSha = await fixture.commit('feat: freigegebene Arbeit');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    const github = createGitHubStub();
    const result = await runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github, releaseRef: releaseSha, logger: silentLogger,
    });
    const [[call]] = github.createPullRequest.mock.calls as [[{ body: string }]];

    // Die Marke steht im erzeugten Body und ist eindeutig.
    expect(parseReleaseMarkers(call.body)).toEqual([releaseSha]);

    await expect(verifyReleasePullRequest({
      baseRef: 'main',
      branch: result.releaseBranch,
      headSha: await fixture.run('rev-parse', `origin/${result.releaseBranch}`),
      body: call.body,
      git: fixture.git,
    })).resolves.toMatchObject({ checked: true, releaseSha });
  });

  it('schlägt an, wenn ein Branch-Update mains neuen Inhalt in den Head trägt', async () => {
    // Greptile-Befund an Pull Request #248: Die Baumgleichheit galt nur im
    // Augenblick der Entstehung. Bewegt sich `main` danach, verlangt die
    // Strict-Policy eine Aktualisierung — und ein konfliktfreier „Update
    // branch" trägt mains neuen Inhalt hinein, ohne erneute Prüfung.
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', 'develop');
    await writeFile(join(fixture.work, 'feature.txt'), 'freigegebene Arbeit\n', 'utf8');
    const releaseSha = await fixture.commit('feat: freigegebene Arbeit');
    await fixture.run('push', '--quiet', 'origin', 'develop');

    const github = createGitHubStub();
    const result = await runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github, releaseRef: releaseSha, logger: silentLogger,
    });
    const [[call]] = github.createPullRequest.mock.calls as [[{ body: string }]];

    // main schreitet fort; der Release-Branch wird konfliktfrei aktualisiert.
    await fixture.run('switch', '--quiet', 'main');
    await writeFile(join(fixture.work, 'nachtrag.txt'), 'nach der Vorbereitung\n', 'utf8');
    await fixture.commit('chore(ci): Katalog-Sync nach der Vorbereitung');
    await fixture.run('push', '--quiet', 'origin', 'main');
    await fixture.run('switch', '--quiet', result.releaseBranch);
    await fixture.run('merge', '--quiet', '--no-ff', '-m', 'Update branch', 'main');
    const updatedHead = await fixture.run('rev-parse', 'HEAD');

    // Die Strict-Policy ist jetzt erfüllt — der Baum aber nicht mehr der
    // freigegebene. Genau diese Lücke schliesst die Marke.
    await expect(fixture.run('merge-base', '--is-ancestor', 'main', updatedHead))
      .resolves.toBe('');
    await expect(verifyReleasePullRequest({
      baseRef: 'main',
      branch: result.releaseBranch,
      headSha: updatedHead,
      body: call.body,
      git: fixture.git,
    })).rejects.toThrow(/entspricht nicht dem Baum des freigegebenen Stands/);
  });

  it('behandelt eine fehlende oder mehrdeutige Marke als Fehler, nicht als Bestehen', async () => {
    const fixture = await createFixture();
    const headSha = await fixture.run('rev-parse', 'HEAD');
    const other = 'e'.repeat(40);

    for (const body of [
      '',
      'Kein Marker hier.',
      `${formatReleaseMarker(headSha)}\n${formatReleaseMarker(other)}`,
    ]) {
      await expect(verifyReleasePullRequest({
        baseRef: 'main',
        branch: 'release/abcdefabcdef',
        headSha,
        body,
        git: fixture.git,
      })).rejects.toThrow(/genau eine Freigabemarke/);
    }
  });

  it('lehnt eine Marke ab, die nicht auf der Integrationslinie liegt', async () => {
    const fixture = await createFixture();

    await fixture.run('switch', '--quiet', '--create', 'seitenlinie', 'main');
    await writeFile(join(fixture.work, 'fremd.txt'), 'fremd\n', 'utf8');
    const fremderSha = await fixture.commit('chore: fremder Stand');

    await expect(verifyReleasePullRequest({
      baseRef: 'main',
      branch: 'release/abcdefabcdef',
      headSha: fremderSha,
      body: formatReleaseMarker(fremderSha),
      git: fixture.git,
    })).rejects.toThrow(/liegt nicht auf/);
  });
});
