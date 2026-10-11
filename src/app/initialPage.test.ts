import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_PAGE_WAIT_MS, initialRoutePath, preloadInitialPage } from './initialPage';

// Die Datenschutz- und die About-Seite laden nie fertig, die Impressumseite scheitert,
// die Lizenzseite lädt sofort. Jeder Test mit hängendem Chunk hat seine eigene Seite:
// Ein hängender Import bleibt über das Testende hinaus offen, und ein zweiter Test
// soll nicht vom Zustand dieses Imports abhängen.
vi.mock('@/features/pages/DatenschutzPage', () => new Promise(() => {}));
vi.mock('@/features/pages/AboutPage', () => new Promise(() => {}));
vi.mock('@/features/pages/ImpressumPage', () => { throw new Error('Chunk fehlt'); });
vi.mock('@/features/pages/LizenzenPage', () => ({ LizenzenPage: () => null }));

afterEach(() => {
  vi.useRealTimers();
});

async function settledAfter(promise: Promise<void>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

describe('initialRoutePath', () => {
  it.each([
    ['/Grundschutz-Navigator/suche', '/Grundschutz-Navigator', '/suche'],
    ['/Grundschutz-Navigator/', '/Grundschutz-Navigator', '/'],
    ['/Grundschutz-Navigator', '/Grundschutz-Navigator', '/'],
    ['/Grundschutz-Navigator-x/suche', '/Grundschutz-Navigator', '/Grundschutz-Navigator-x/suche'],
    ['/suche', undefined, '/suche'],
    ['/andere/suche', '/Grundschutz-Navigator', '/andere/suche'],
  ])('%s mit Basis %s ergibt %s', (pathname, basename, expected) => {
    expect(initialRoutePath(pathname, basename)).toBe(expected);
  });
});

describe('preloadInitialPage', () => {
  it('erfüllt sich sofort für einen Pfad ohne Chunk', async () => {
    vi.useFakeTimers();

    expect(await settledAfter(preloadInitialPage('/katalog/gspp'), 0)).toBe(true);
  });

  it('erfüllt sich sofort, sobald der Chunk geladen ist', async () => {
    vi.useFakeTimers();

    expect(await settledAfter(preloadInitialPage('/lizenzen'), 0)).toBe(true);
  });

  it('erfüllt sich sofort, wenn das Laden scheitert', async () => {
    vi.useFakeTimers();

    expect(await settledAfter(preloadInitialPage('/impressum'), 0)).toBe(true);
  });

  it('endet bei einem hängenden Chunk genau nach der Obergrenze', async () => {
    vi.useFakeTimers();
    const pending = preloadInitialPage('/datenschutz');

    expect(await settledAfter(pending, INITIAL_PAGE_WAIT_MS - 1)).toBe(false);
    expect(await settledAfter(pending, 1)).toBe(true);
  });

  it('wendet die Basis an, bevor es den Chunk sucht', async () => {
    vi.useFakeTimers();
    const pending = preloadInitialPage('/Basis/about', '/Basis', 50);

    expect(await settledAfter(pending, 49)).toBe(false);
    expect(await settledAfter(pending, 1)).toBe(true);
  });

  it('wartet nicht auf einen Pfad, der nur den Basisnamen als Präfix trägt', async () => {
    vi.useFakeTimers();

    expect(await settledAfter(preloadInitialPage('/Basis-x/datenschutz', '/Basis', 50), 0)).toBe(true);
  });

  it('räumt den Timer auf', async () => {
    vi.useFakeTimers();

    await preloadInitialPage('/lizenzen');

    expect(vi.getTimerCount()).toBe(0);
  });
});
