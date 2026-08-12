import { afterEach, describe, expect, it, vi } from 'vitest';
import { importClass2OscalDocument } from './oscalImportGate';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importClass2OscalDocument', () => {
  it('redigiert eine unerwartete Worker-Erzeugung ohne Dokumentinhalt', async () => {
    const secret = 'UNERWARTETER-IMPORTFEHLER-SECRET';
    const consoleError = vi.spyOn(console, 'error');
    const consoleLog = vi.spyOn(console, 'log');
    const consoleWarn = vi.spyOn(console, 'warn');
    vi.stubGlobal('Worker', class {
      constructor() {
        throw new Error(secret);
      }
    });

    const result = await importClass2OscalDocument(
      new TextEncoder().encode(`{"catalog":{"remarks":"${secret}"}}`),
      { trustClass: 'class-2-local-user' },
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_IMPORT_WORKER_FAILURE',
        stage: 'domain',
        path: '/',
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(window.location.href).not.toContain(secret);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
