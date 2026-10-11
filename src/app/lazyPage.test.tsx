import { describe, expect, it } from 'vitest';
import { lazyPage } from './lazyPage';

const Content = () => <h1>Seite</h1>;

describe('lazyPage', () => {
  it('liefert die Seitenkomponente aus dem Modul', async () => {
    const page = lazyPage(() => Promise.resolve({ default: Content }));

    await expect(page.load()).resolves.toBe(Content);
  });

  it('gibt einen Ladefehler beim Laden an den Aufrufer weiter', async () => {
    const page = lazyPage(() => Promise.reject(new Error('Chunk fehlt')));

    await expect(page.load()).rejects.toThrow('Chunk fehlt');
  });

  it('erfüllt preload() nach dem Laden ohne Wert', async () => {
    let calls = 0;
    const page = lazyPage(() => {
      calls += 1;
      return Promise.resolve({ default: Content });
    });

    await expect(page.preload()).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it('teilt einen laufenden Ladevorgang zwischen Vorladen und Laden', async () => {
    let calls = 0;
    const page = lazyPage(() => {
      calls += 1;
      return Promise.resolve({ default: Content });
    });

    const [, component] = await Promise.all([page.preload(), page.load()]);

    expect(component).toBe(Content);
    expect(calls).toBe(1);
  });

  it('lädt nach einem Fehlschlag beim nächsten Aufruf erneut', async () => {
    let calls = 0;
    const page = lazyPage(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('Chunk fehlt')) : Promise.resolve({ default: Content });
    });

    await expect(page.load()).rejects.toThrow('Chunk fehlt');
    await expect(page.load()).resolves.toBe(Content);
    expect(calls).toBe(2);
  });

  it('meldet einen Ladefehler beim Vorladen nicht', async () => {
    const page = lazyPage(() => Promise.reject(new Error('Chunk fehlt')));

    await expect(page.preload()).resolves.toBeUndefined();
  });
});
