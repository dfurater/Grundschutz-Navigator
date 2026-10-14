import { describe, expect, it } from 'vitest';
import {
  PLAYWRIGHT_IMAGE,
  containerScript,
  dockerArgs,
  exitCodeOf,
  parseMode,
  resolvePlaywrightImage,
} from './visual-regression.mjs';

const lockWith = (version?: unknown) => ({
  packages: version === undefined ? {} : { 'node_modules/playwright': { version } },
});

describe('resolvePlaywrightImage', () => {
  it('liefert das Image mit Digest, wenn Lockfile und Pin übereinstimmen', () => {
    expect(resolvePlaywrightImage(lockWith(PLAYWRIGHT_IMAGE.version)))
      .toBe(`mcr.microsoft.com/playwright:v${PLAYWRIGHT_IMAGE.version}-noble@${PLAYWRIGHT_IMAGE.digest}`);
  });

  it.each([
    ['fehlende Version', lockWith()],
    ['ungültige Version', lockWith('latest')],
    ['kein Lockfile-Objekt', null],
  ])('wirft bei %s', (_label, lock) => {
    expect(() => resolvePlaywrightImage(lock)).toThrow('Playwright-Version fehlt');
  });

  it('wirft, wenn das Lockfile eine andere Version als der Pin führt', () => {
    expect(() => resolvePlaywrightImage(lockWith('9.9.9'))).toThrow(/pinnt 1\.\d+\.\d+/);
  });

  it('pinnt die Version aus package-lock.json', async () => {
    const { readFileSync } = await import('node:fs');
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    expect(() => resolvePlaywrightImage(lock)).not.toThrow();
  });
});

describe('Containerlauf', () => {
  it('prüft im Modus check ohne Aktualisierung und ohne beschreibbare Einbindung', () => {
    const args = dockerArgs({ mode: 'check', root: '/repo', image: 'img' });
    expect(args).toContain('/repo:/src:ro');
    expect(args.some((arg) => arg.endsWith(':/out'))).toBe(false);
    const script = containerScript('check');
    expect(script).toContain('GSPP_VISUAL_REGRESSION=1');
    expect(script).not.toContain('--update');
  });

  it('schreibt im Modus update nur das Referenzverzeichnis', () => {
    const args = dockerArgs({ mode: 'update', root: '/repo', image: 'img' });
    expect(args).toContain('/repo/src/test/browser/__screenshots__:/out');
    expect(containerScript('update')).toContain('--update');
  });

  it('lehnt einen unbekannten Modus ab', () => {
    expect(() => containerScript('diff')).toThrow('Unbekannter Modus');
  });

  it.each([
    [{ status: 0 }, 0],
    [{ status: 1 }, 1],
    [{ status: null, signal: 'SIGTERM' }, 1],
    [undefined, 1],
  ])('bildet %o auf Exitstatus %i ab', (result, code) => {
    expect(exitCodeOf(result)).toBe(code);
  });
});

describe('parseMode', () => {
  it.each([[['--check'], 'check'], [['--update'], 'update']])('liest %o', (argv, mode) => {
    expect(parseMode(argv)).toBe(mode);
  });

  it.each([[[]], [['--check', '--update']], [['--diff']]])('lehnt %o ab', (argv) => {
    expect(() => parseMode(argv)).toThrow('Aufruf');
  });
});
