import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatCherryPickMarker, parseCherryPickMarkers } from './cherry-pick-verify.mjs';
import {
  CherryPickError,
  cherryPickBranchName,
  parseSourceList,
  runCherryPickPrepare,
  verifyCherryPickPullRequest,
} from './cherry-pick-prepare.mjs';
import { getChangedFiles } from './git-changed-files.mjs';
import { validateDocumentationContract } from './pr-documentation-contract.mjs';
import {
  type BranchLineFixture,
  CHERRY_PICK_PATH,
  commitOnLine,
  createBranchLineFixture,
  createFixtureRegistry,
  createGitHubStub,
  seedCherryPickScenario,
  silentLogger,
} from './branchLineFixtures.js';

const fixtures = createFixtureRegistry();
afterEach(fixtures.cleanup);

async function createScenario() {
  const fixture = await createBranchLineFixture(fixtures);
  const shas = await seedCherryPickScenario(fixture);
  return { fixture, ...shas };
}

async function prepare(fixture: BranchLineFixture, sources: string[]) {
  const github = createGitHubStub();
  const result = await runCherryPickPrepare({
    cwd: fixture.work, git: fixture.git, github, sourceInput: sources.join(' '), issue: 'GSPP-448',
    logger: silentLogger,
  });
  const [[call]] = github.createPullRequest.mock.calls as [[{ head: string; base: string; body: string }]];
  return { result, call, github };
}

function verify(fixture: BranchLineFixture, { headSha, body, branch = 'cherry-pick/gspp-448-abcdefabcdef' }: {
  headSha: string; body: string; branch?: string;
}) {
  return verifyCherryPickPullRequest({ baseRef: 'main', branch, headSha, body, git: fixture.git });
}

/** Ein Pick-Head auf `main`, gebaut ohne den Vorbereitungslauf. */
async function pickOntoMain(fixture: BranchLineFixture, sources: string[]) {
  await fixture.run('switch', '--quiet', '--detach', 'origin/main');
  for (const sha of sources) await fixture.run('cherry-pick', '-x', sha);
  return fixture.run('rev-parse', 'HEAD');
}

const markers = (shas: string[]) => shas.map((sha) => formatCherryPickMarker(sha)).join('\n');

describe('Eingaben', () => {
  it.each(['', 'develop', 'abc123', 'A'.repeat(40)])('lehnt die Quellenliste %j ab', (input) => {
    expect(() => parseSourceList(input)).toThrow(CherryPickError);
  });

  it('liest mehrere SHAs mit Leerraum und Kommas', () => {
    expect(parseSourceList(`${'a'.repeat(40)}, ${'b'.repeat(40)}\n`)).toEqual(['a'.repeat(40), 'b'.repeat(40)]);
  });

  it('leitet den Branch aus Issue und erster Quelle ab', () => {
    expect(cherryPickBranchName('GSPP-448', 'c'.repeat(40))).toBe(`cherry-pick/gspp-448-${'c'.repeat(12)}`);
    expect(() => cherryPickBranchName('gspp-448', 'c'.repeat(40))).toThrow(CherryPickError);
  });
});

describe('runCherryPickPrepare', () => {
  it('stellt nach konfliktfreiem Pick einen Squash-PR nach main mit Marken und gültigem Dokumentationsvertrag', async () => {
    const { fixture, source } = await createScenario();
    const { result, call } = await prepare(fixture, [source]);

    expect(call.base).toBe('main');
    expect(call.head).toBe(`cherry-pick/gspp-448-${source.slice(0, 12)}`);
    expect(call.body).toContain('**Erforderliche Merge-Methode:** Squash');
    expect(call.body).toContain('## Lieferung');
    expect(parseCherryPickMarkers(call.body)).toEqual([source]);

    const headSha = await fixture.run('rev-parse', `origin/${result.branch}`);
    await expect(fixture.run('merge-base', '--is-ancestor', 'origin/main', headSha)).resolves.toBe('');
    expect(await fixture.run('log', '-1', '--format=%B', headSha)).toContain(`(cherry picked from commit ${source})`);

    const changedFiles = getChangedFiles({
      baseSha: await fixture.run('rev-parse', 'origin/main'),
      headSha,
      execFile: (file: string, args: string[], options: { encoding: string }) =>
        execFileSync(file, ['-C', fixture.work, ...args], options),
    });
    expect(changedFiles).toEqual([CHERRY_PICK_PATH]);
    expect(validateDocumentationContract({ changedFiles, pullRequestBody: call.body }))
      .toEqual({ status: 'valid', documentationImpact: 'none' });

    await expect(verify(fixture, { headSha, body: call.body, branch: result.branch }))
      .resolves.toMatchObject({ checked: true, sources: [source] });
  });

  it('bricht bei einem Konflikt ohne Branch und PR ab und nennt den Commit', async () => {
    const { fixture, later } = await createScenario();
    const github = createGitHubStub();

    await expect(runCherryPickPrepare({
      cwd: fixture.work, git: fixture.git, github, sourceInput: later, issue: 'GSPP-448', logger: silentLogger,
    })).rejects.toThrow(new RegExp(`Cherry-Pick von ${later}.*nicht konfliktfrei`));

    expect(github.createPullRequest).not.toHaveBeenCalled();
    expect(await fixture.run('ls-remote', '--heads', 'origin', 'cherry-pick/*')).toBe('');
  });

  it('nimmt Nachbar-Commits in develop-Reihenfolge mit', async () => {
    const { fixture, source, later } = await createScenario();
    const { call } = await prepare(fixture, [source, later]);
    expect(parseCherryPickMarkers(call.body)).toEqual([source, later]);
  });

  it('aktualisiert einen offenen Cherry-Pick-PR statt einen zweiten zu stellen', async () => {
    const { fixture, source } = await createScenario();
    const github = createGitHubStub({ findOpenPullRequest: vi.fn(async () => 41) });
    const result = await runCherryPickPrepare({
      cwd: fixture.work, git: fixture.git, github, sourceInput: source, issue: 'GSPP-448', logger: silentLogger,
    });
    expect(result.pullRequest).toBe(41);
    expect(github.createPullRequest).not.toHaveBeenCalled();
    expect(github.updatePullRequest).toHaveBeenCalledWith(expect.objectContaining({ number: 41, base: 'main' }));
  });

  it('lehnt eine Quelle ab, die nicht auf develop liegt', async () => {
    const { fixture } = await createScenario();
    const foreign = await commitOnLine(fixture, 'main', { path: 'fremd.txt', contents: 'x\n', message: 'chore: fremd' });
    await expect(prepare(fixture, [foreign])).rejects.toThrow(/nicht erreichbar/);
  });
});

describe('verifyCherryPickPullRequest', () => {
  it('ist ausserhalb von Base main und Präfix cherry-pick/ nicht einschlägig', async () => {
    const { fixture } = await createScenario();
    const headSha = await fixture.run('rev-parse', 'HEAD');
    await expect(verifyCherryPickPullRequest({
      baseRef: 'develop', branch: 'cherry-pick/x', headSha, body: '', git: fixture.git,
    })).resolves.toEqual({ checked: false });
    await expect(verifyCherryPickPullRequest({
      baseRef: 'main', branch: 'release/abcdefabcdef', headSha, body: '', git: fixture.git,
    })).resolves.toEqual({ checked: false });
  });

  it('scheitert bei fehlender oder doppelter Marke', async () => {
    const { fixture, source } = await createScenario();
    const headSha = await pickOntoMain(fixture, [source]);
    await expect(verify(fixture, { headSha, body: 'ohne Marke' })).rejects.toThrow(/je Quelle eine Marke/);
    await expect(verify(fixture, { headSha, body: markers([source, source]) })).rejects.toThrow(/mehrfach/);
  });

  it('scheitert bei falscher Reihenfolge der Marken', async () => {
    const { fixture, source, later } = await createScenario();
    const headSha = await pickOntoMain(fixture, [source, later]);
    await expect(verify(fixture, { headSha, body: markers([later, source]) })).rejects.toThrow(/Reihenfolge/);
  });

  it('scheitert bei einer Quelle, die nicht auf develop liegt', async () => {
    const { fixture } = await createScenario();
    const foreign = await commitOnLine(fixture, 'main', { path: 'fremd.txt', contents: 'x\n', message: 'chore: fremd' });
    const headSha = await pickOntoMain(fixture, []);
    await expect(verify(fixture, { headSha, body: markers([foreign]) })).rejects.toThrow(/nicht erreichbar/);
  });

  it('scheitert, wenn ein Commit inhaltlich von seiner Quelle abweicht', async () => {
    const { fixture, source } = await createScenario();
    await pickOntoMain(fixture, [source]);
    await writeFile(join(fixture.work, CHERRY_PICK_PATH), 'eins\nzwei\nDREI\nvier\nfünf und mehr\n', 'utf8');
    await fixture.run('commit', '--quiet', '--all', '--amend', '--no-edit');
    const headSha = await fixture.run('rev-parse', 'HEAD');
    await expect(verify(fixture, { headSha, body: markers([source]) })).rejects.toThrow(/Patch weicht ab/);
  });

  it('scheitert bei gleicher Änderung mit abweichendem Kontext', async () => {
    const { fixture, source } = await createScenario();
    // main ändert eine Kontextzeile; der Pick bleibt konfliktfrei, sein Kontext nicht.
    await commitOnLine(fixture, 'main', {
      path: CHERRY_PICK_PATH, contents: 'EINS\nzwei\ndrei\nvier\nfünf\n', message: 'fix: Kontextzeile auf main',
    });
    const headSha = await pickOntoMain(fixture, [source]);
    await expect(verify(fixture, { headSha, body: markers([source]) })).rejects.toThrow(/Patch weicht ab/);
    // Der Vorbereitungslauf stellt in diesem Fall keinen PR.
    await expect(prepare(fixture, [source])).rejects.toThrow(/Patch weicht ab/);
  });

  it('scheitert an Leerraum innerhalb einer geänderten Zeile', async () => {
    const fixture = await createBranchLineFixture(fixtures);
    await seedCherryPickScenario(fixture);
    const source = await commitOnLine(fixture, 'develop', {
      path: 'wert.ts', contents: 'export const wert = "A B";\n', message: 'feat: Wert',
    });
    await fixture.run('switch', '--quiet', '--detach', 'origin/main');
    await writeFile(join(fixture.work, 'wert.ts'), 'export const wert = "AB";\n', 'utf8');
    const headSha = await fixture.commit('feat: Wert ohne Leerzeichen');
    await expect(verify(fixture, { headSha, body: markers([source]) })).rejects.toThrow(/Patch weicht ab/);
  });

  it('scheitert an einem Merge-Commit als Quelle', async () => {
    const { fixture, source } = await createScenario();
    await fixture.run('switch', '--quiet', 'develop');
    await fixture.run('switch', '--quiet', '--create', 'seitenzweig', `${source}^`);
    await writeFile(join(fixture.work, 'seite.txt'), 'seite\n', 'utf8');
    await fixture.commit('feat: Seitenzweig');
    await fixture.run('switch', '--quiet', 'develop');
    await fixture.run('merge', '--quiet', '--no-ff', '-m', 'Merge Seitenzweig', 'seitenzweig');
    await fixture.run('push', '--quiet', 'origin', 'develop');
    const mergeSha = await fixture.run('rev-parse', 'HEAD');
    await expect(prepare(fixture, [mergeSha])).rejects.toThrow(/Merge- oder Wurzel-Commit/);
  });

  it('scheitert, wenn origin/main kein Vorfahr des Heads ist', async () => {
    const { fixture, source } = await createScenario();
    const headSha = await pickOntoMain(fixture, [source]);
    await commitOnLine(fixture, 'main', { path: 'sync.txt', contents: 'sync\n', message: 'chore(ci): Katalog-Sync' });
    await expect(verify(fixture, { headSha, body: markers([source]) })).rejects.toThrow(/kein Vorfahr des Heads/);
  });

  it('scheitert bei einem zusätzlichen Commit', async () => {
    const { fixture, source } = await createScenario();
    await pickOntoMain(fixture, [source]);
    await writeFile(join(fixture.work, 'extra.txt'), 'extra\n', 'utf8');
    const headSha = await fixture.commit('chore: zusätzlicher Commit');
    await expect(verify(fixture, { headSha, body: markers([source]) })).rejects.toThrow(/2 Commit\(s\)/);
  });

  it('bleibt nach „Update branch" auf vorgerücktem main grün', async () => {
    const { fixture, source } = await createScenario();
    const { result, call } = await prepare(fixture, [source]);

    await commitOnLine(fixture, 'main', { path: 'sync.txt', contents: 'sync\n', message: 'chore(ci): Katalog-Sync' });
    await fixture.run('switch', '--quiet', '--detach', `origin/${result.branch}`);
    await fixture.run('merge', '--quiet', '--no-ff', '-m', 'Update branch', 'origin/main');
    const headSha = await fixture.run('rev-parse', 'HEAD');

    await expect(verify(fixture, { headSha, body: call.body, branch: result.branch }))
      .resolves.toMatchObject({ checked: true });
  });

  it('scheitert an einem Merge-Commit mit eigenem Inhalt', async () => {
    const { fixture, source } = await createScenario();
    const { result, call } = await prepare(fixture, [source]);

    await commitOnLine(fixture, 'main', { path: 'sync.txt', contents: 'sync\n', message: 'chore(ci): Katalog-Sync' });
    await fixture.run('switch', '--quiet', '--detach', `origin/${result.branch}`);
    await fixture.run('merge', '--quiet', '--no-ff', '--no-commit', 'origin/main');
    await writeFile(join(fixture.work, 'eingeschmuggelt.txt'), 'x\n', 'utf8');
    await fixture.run('add', 'eingeschmuggelt.txt');
    await fixture.run('commit', '--quiet', '--no-edit');
    const headSha = await fixture.run('rev-parse', 'HEAD');

    await expect(verify(fixture, { headSha, body: call.body, branch: result.branch }))
      .rejects.toThrow(/kein konfliktfreier Merge/);
  });
});

describe('Verankerung im Pflichtcheck', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

  it('führt die Prüfung im Job catalog-sync-guard aus', () => {
    const job = workflow.slice(workflow.indexOf('  catalog-sync-guard:'));
    expect(job).toContain('node scripts/cherry-pick-prepare.mjs --verify-pull-request');
  });
});
