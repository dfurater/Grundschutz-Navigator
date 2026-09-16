import { afterEach, describe, expect, it, vi } from 'vitest';

const parseCatalogBuffer = vi.hoisted(() => vi.fn());
vi.mock('@/state/catalogParsing', () => ({ parseCatalogBuffer }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  parseCatalogBuffer.mockReset();
});

/**
 * Der Worker registriert seinen Listener beim Import auf dem globalen
 * Objekt. Der Test fängt `addEventListener`/`postMessage` genau dort ab —
 * dieselben Namen, die der Worker seit der `globalThis`-Umstellung benutzt.
 */
async function setup() {
  let receive: (event: { data: unknown; origin: string }) => void = () => {};
  const postMessage = vi.fn();
  vi.stubGlobal('addEventListener', (_: string, listener: typeof receive) => {
    receive = listener;
  });
  vi.stubGlobal('postMessage', postMessage);
  await import('@/workers/catalogParser.worker');

  return {
    postMessage,
    send(data: unknown, origin = '') {
      receive({ data, origin });
    },
  };
}

const request = {
  type: 'parse-catalog',
  requestId: 'req-1',
  buffer: new ArrayBuffer(0),
  context: { catalogKey: 'itgs' },
};

describe('catalogParser.worker', () => {
  it('parses and answers a request from the empty origin', async () => {
    parseCatalogBuffer.mockReturnValue({ controls: [] });
    const { send, postMessage } = await setup();

    send(request);

    expect(parseCatalogBuffer).toHaveBeenCalledWith(request.buffer, request.context, {
      execution: 'worker',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'parsed',
      requestId: 'req-1',
      result: { controls: [] },
    });
  });

  it('accepts a request from its own origin', async () => {
    parseCatalogBuffer.mockReturnValue({ controls: [] });
    const { send, postMessage } = await setup();

    send(request, globalThis.location.origin);

    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores a request from a foreign origin', async () => {
    const { send, postMessage } = await setup();

    send(request, 'https://foreign.example');

    expect(parseCatalogBuffer).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['a foreign message type', { type: 'something-else', requestId: 'req-1' }],
    ['a message without data', null],
  ])('ignores %s', async (_label, data) => {
    const { send, postMessage } = await setup();

    send(data);

    expect(parseCatalogBuffer).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('reports the error message when parsing throws an Error', async () => {
    parseCatalogBuffer.mockImplementation(() => {
      throw new Error('Katalog ist kein gültiges OSCAL');
    });
    const { send, postMessage } = await setup();

    send(request);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'parse-error',
      requestId: 'req-1',
      message: 'Katalog ist kein gültiges OSCAL',
    });
  });

  it.each([
    ['a non-Error value', 'kaputt'],
    ['an Error without a message', new Error('')],
  ])('falls back to a readable message when parsing throws %s', async (_label, thrown) => {
    parseCatalogBuffer.mockImplementation(() => {
      throw thrown;
    });
    const { send, postMessage } = await setup();

    send(request);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'parse-error',
      requestId: 'req-1',
      message: 'Katalog konnte nicht verarbeitet werden.',
    });
  });
});
