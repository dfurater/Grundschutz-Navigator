import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CherryPickError,
  formatCherryPickMarker,
  parseCherryPickMarkers,
  verifyCherryPickHead,
} from './cherry-pick-verify.mjs';
import {
  createBranchLineFixture,
  createFixtureRegistry,
  seedCherryPickScenario,
} from './branchLineFixtures.js';

const fixtures = createFixtureRegistry();
afterEach(fixtures.cleanup);

async function createScenario() {
  const fixture = await createBranchLineFixture(fixtures);
  return { fixture, ...await seedCherryPickScenario(fixture) };
}

describe('Cherry-Pick-Marke', () => {
  it('erzeugt und liest Marken in Reihenfolge', () => {
    const [a, b] = ['a'.repeat(40), 'b'.repeat(40)];
    const body = `Text\n${formatCherryPickMarker(a)}\n${formatCherryPickMarker(b)}`;
    expect(parseCherryPickMarkers(body)).toEqual([a, b]);
    expect(parseCherryPickMarkers(undefined)).toEqual([]);
  });

  it.each(['abc123', 'A'.repeat(40)])('weist %j als Marke ab', (sha) => {
    expect(() => formatCherryPickMarker(sha)).toThrow(CherryPickError);
  });
});

describe('verifyCherryPickHead', () => {
  it('besteht für einen konfliktfreien Pick seiner Quelle', async () => {
    const { fixture, source } = await createScenario();
    await fixture.run('switch', '--quiet', '--detach', 'origin/main');
    await fixture.run('cherry-pick', '-x', source);
    const headSha = await fixture.run('rev-parse', 'HEAD');
    await expect(verifyCherryPickHead(fixture.git, { sources: [source], headSha })).resolves.toBeUndefined();
  });

  it('scheitert an einem leeren Commit statt eines Picks', async () => {
    const { fixture, source } = await createScenario();
    await fixture.run('switch', '--quiet', '--detach', 'origin/main');
    const headSha = await fixture.commit('chore: leer');
    await expect(verifyCherryPickHead(fixture.git, { sources: [source], headSha }))
      .rejects.toThrow(/Patch weicht ab/);
  });

  it('scheitert an einem Octopus-Merge über main', async () => {
    const { fixture, source } = await createScenario();
    await fixture.run('switch', '--quiet', '--detach', 'origin/main');
    await fixture.run('cherry-pick', '-x', source);
    const pick = await fixture.run('rev-parse', 'HEAD');
    for (const name of ['eins', 'zwei']) {
      await fixture.run('switch', '--quiet', '--create', name, 'origin/main');
      await writeFile(join(fixture.work, `${name}.txt`), `${name}\n`, 'utf8');
      await fixture.commit(`chore: ${name}`);
    }
    await fixture.run('switch', '--quiet', '--detach', pick);
    await fixture.run('merge', '--quiet', '--no-ff', '-m', 'Octopus', 'eins', 'zwei');
    const headSha = await fixture.run('rev-parse', 'HEAD');
    await expect(verifyCherryPickHead(fixture.git, { sources: [source], headSha }))
      .rejects.toThrow(/kein konfliktfreier Merge seiner zwei Eltern/);
  });
});
