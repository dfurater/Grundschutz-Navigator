import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getChangedFiles,
  validateDocumentationContract,
} from './pr-documentation-contract.mjs';
import { REQUIRED_CHECKS } from './catalog-sync-policy.mjs';
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
import {
  type BranchLineFixture,
  commitOnLine,
  createBranchLineFixture,
  createFixtureRegistry,
  createGitHubStub,
  seedBothLines,
  silentLogger,
} from './branchLineFixtures.js';

const fixtures = createFixtureRegistry();
afterEach(fixtures.cleanup);

async function createFixture(): Promise<BranchLineFixture> {
  const fixture = await createBranchLineFixture(fixtures);
  await seedBothLines(fixture);
  return fixture;
}

/**
 * Der Ausgangspunkt fast jeder Release-Prüfung: ein freigegebener Stand auf
 * `develop` und der daraus vorbereitete Pull Request. Gibt beides zurück, damit
 * die Tests nur noch ihre eigene Abweichung aufbauen müssen.
 */
async function prepareApprovedRelease(fixture: BranchLineFixture, path = 'feature.txt') {
  const releaseSha = await commitOnLine(fixture, 'develop', {
    path,
    contents: 'freigegebene Arbeit\n',
    message: 'feat: freigegebene Arbeit',
  });

  const github = createGitHubStub();
  const result = await runReleasePrepare({
    cwd: fixture.work, git: fixture.git, github, releaseRef: releaseSha, logger: silentLogger,
  });
  const [[call]] = github.createPullRequest.mock.calls as [[{ base: string; head: string; body: string }]];

  return { releaseSha, github, result, call };
}

describe('releaseBranchName', () => {
  it('leitet den kurzlebigen Branchnamen aus dem freigegebenen Stand ab', () => {
    expect(releaseBranchName('a'.repeat(40))).toBe(`release/${'a'.repeat(12)}`);
  });

  it('weist einen unvollständigen SHA ab', () => {
    expect(() => releaseBranchName('abc123')).toThrow(ReleasePrepareError);
  });
});

describe('buildReleasePullRequestBody', () => {
  it('nennt Merge-Commit als Methode und beschreibt die Lieferung, ohne etwas zu fordern', () => {
    const body = buildReleasePullRequestBody({
      releaseSha: 'a'.repeat(40),
      releaseBranch: `release/${'a'.repeat(12)}`,
      sourceSha: 'b'.repeat(40),
      changedPaths: [],
    });

    expect(body).toContain('**Erforderliche Merge-Methode:** Merge-Commit');

    // Der Ausfüllhinweis steht als HTML-Kommentar, ist im PR also unsichtbar.
    expect(body).toMatch(/## Lieferung\n\n<!--\n[\s\S]+?\n-->/);
    expect(body).toContain('### Für Nutzer sichtbar');
    expect(body).toContain('### Infrastruktur');

    // Keine Erfüllungsliste: ausserhalb des Vertragsblocks kein Kästchen.
    const ausserhalbDesVertrags = body.replace(
      /<!-- documentation-contract:start -->[\s\S]*<!-- documentation-contract:end -->/,
      '',
    );
    expect(ausserhalbDesVertrags).not.toMatch(/^- \[[ xX]\]/m);
    expect(body).not.toContain('## Freigabe-Protokoll');
    expect(body).not.toContain('vollständigen Freigabe-Protokoll');
  });

  it('deklariert die im Release bewegten Dokumentationsdateien', () => {
    const body = buildReleasePullRequestBody({
      releaseSha: 'a'.repeat(40),
      releaseBranch: `release/${'a'.repeat(12)}`,
      sourceSha: 'b'.repeat(40),
      changedPaths: ['src/app/Main.tsx', 'docs/ARCHITECTURE.md', 'README.md'],
    });

    expect(body).toContain('- [x] **Dokumentation aktualisiert**');
    expect(body).toContain('`README.md`, `docs/ARCHITECTURE.md`');
  });
});

describe('runReleasePrepare', () => {
  it('stellt einen PR, dessen Head origin/main als Vorfahr hat und develops Baum trägt', async () => {
    const fixture = await createFixture();
    const { releaseSha, github, result, call } = await prepareApprovedRelease(fixture);

    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
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
    const releaseSha = await commitOnLine(fixture, 'develop', {
      path: 'feature.txt',
      contents: 'freigegebene Arbeit\n',
      message: 'feat: freigegebene Arbeit',
    });

    const mainBefore = await fixture.run('rev-parse', 'origin/main');
    const developBefore = await fixture.run('rev-parse', 'origin/develop');

    await runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github: createGitHubStub(), releaseRef: releaseSha, logger: silentLogger,
    });

    await expect(fixture.run('rev-parse', 'origin/main')).resolves.toBe(mainBefore);
    await expect(fixture.run('rev-parse', 'origin/develop')).resolves.toBe(developBefore);
  });
});

describe('Dokumentationsvertrag des erzeugten Release-PRs', () => {
  // Codex-Cross-Review an Pull Request #248: Der erzeugte Body trug keinen
  // maschinenlesbaren Dokumentationsabschnitt.
  // `documentation-contract` ist im main-Ruleset Pflichtcheck und greift bei
  // jeder Änderung unter `src/` — ein Release mit Produktänderung wäre damit
  // nicht mergefähig gewesen. Geprüft wird deshalb nicht der Text des Bodys,
  // sondern der erzeugte Body gegen den tatsächlichen Drei-Punkt-Diff, durch
  // denselben Validator, der am Pull Request läuft.

  /** Der Diff, den der Pflichtcheck am Pull Request sieht — aus der Fixture. */
  async function changedFilesOfReleasePullRequest(
    fixture: BranchLineFixture,
    releaseBranch: string,
  ) {
    return getChangedFiles({
      baseSha: await fixture.run('rev-parse', 'origin/main'),
      headSha: await fixture.run('rev-parse', `origin/${releaseBranch}`),
      execFile: (file: string, args: string[], options: { encoding: string }) =>
        execFileSync(file, ['-C', fixture.work, ...args], options),
    });
  }

  it('besteht den Pflichtcheck für ein Release mit Produktänderung ohne Dokumentation', async () => {
    const fixture = await createFixture();
    const { result, call } = await prepareApprovedRelease(fixture, 'src/feature.ts');
    const changedFiles = await changedFilesOfReleasePullRequest(fixture, result.releaseBranch);

    expect(changedFiles).toContain('src/feature.ts');
    expect(validateDocumentationContract({ changedFiles, pullRequestBody: call.body }))
      .toEqual({ status: 'valid', documentationImpact: 'none' });
  });

  it('deklariert die tatsächlich bewegte Dokumentationsdatei', async () => {
    const fixture = await createFixture();
    await commitOnLine(fixture, 'develop', {
      path: 'src/feature.ts',
      contents: 'export const feature = true;\n',
      message: 'feat: Produktänderung',
    });
    const releaseSha = await commitOnLine(fixture, 'develop', {
      path: 'docs/ARCHITECTURE.md',
      contents: '# Architektur\n',
      message: 'docs: Architektur nachführen',
    });

    const github = createGitHubStub();
    const run = await runReleasePrepare({
      cwd: fixture.work, git: fixture.git, github, releaseRef: releaseSha, logger: silentLogger,
    });
    const [[call]] = github.createPullRequest.mock.calls as [[{ body: string }]];
    const changedFiles = await changedFilesOfReleasePullRequest(fixture, run.releaseBranch);

    expect(validateDocumentationContract({ changedFiles, pullRequestBody: call.body }))
      .toEqual({ status: 'valid', documentationImpact: 'updated' });
    expect(call.body).toContain('`docs/ARCHITECTURE.md`');
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


/**
 * Zerlegt den `jobs:`-Block eines Workflows in seine Jobs. Bewusst ohne
 * YAML-Parser: `yaml` liegt nur transitiv im Baum und wäre als Testabhängigkeit
 * nicht deklariert. Jobnamen sind die Schlüssel auf genau zwei Leerzeichen
 * Einrückung.
 */
function splitWorkflowJobs(workflow: string): Record<string, string> {
  const lines = workflow.split('\n');
  const jobs: Record<string, string> = {};
  let current = '';

  for (const line of lines.slice(lines.indexOf('jobs:') + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs[current] = '';
      continue;
    }
    if (current) jobs[current] += `${line}\n`;
  }

  return jobs;
}

describe('Verankerung der Baumprüfung im Pflichtcheck', () => {
  // Codex-Cross-Review an Pull Request #248: Die erneute Prüfung lief in einem
  // eigenen Job, der in keinem Ruleset als Required Status Check geführt wurde
  // — ihr Fehlschlag verhinderte damit keinen Merge. Ein eigener Jobname ließe
  // sich auch nicht nachträglich erzwingen, ohne die Catalog-Sync-Lane
  // stillzulegen: Deren Pull Requests zweigen von `main` ab und führen diese
  // Workflow-Fassung nicht.
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
  const jobs = splitWorkflowJobs(workflow);

  it('führt die Prüfung in einem Job aus, den die Policy als Pflichtcheck führt', () => {
    const owner = Object.entries(jobs).find(
      ([, body]) => body.includes('node scripts/release-prepare.mjs --verify-pull-request'),
    );

    expect(owner).toBeDefined();
    expect(REQUIRED_CHECKS).toContain(owner?.[0]);
  });

  it('hält den develop-Fetch aus dem Pfad der Catalog-Sync-Lane heraus', () => {
    const [ownerBody] = Object.entries(jobs)
      .filter(([, body]) => body.includes('release-prepare.mjs --verify-pull-request'))
      .map(([, body]) => body);

    expect(ownerBody).toMatch(
      /if: github\.event_name == 'pull_request' && startsWith\(github\.head_ref, 'release\/'\)\n\s+run: git fetch --no-tags origin develop/,
    );
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
    const { releaseSha, result, call } = await prepareApprovedRelease(fixture);

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
    const { result, call } = await prepareApprovedRelease(fixture);

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
