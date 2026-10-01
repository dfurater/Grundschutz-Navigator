import { afterEach, expect, it, vi } from 'vitest';
const process = vi.hoisted(() => vi.fn());
vi.mock('@/domain/oscalClass2Import', () => ({ processClass2OscalBytes: process }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); process.mockReset(); });

async function setup(source: unknown, origin = '', start = true) {
  let receive: (event: { data: unknown; origin: string }) => void = () => { };
  const postMessage = vi.fn();
  vi.stubGlobal('addEventListener', (_: string, listener: typeof receive) => { receive = listener; });
  vi.stubGlobal('postMessage', postMessage);
  process.mockResolvedValue({ ok: true, document: { source, rootType: 'catalog', oscalVersion: '1.1.3' } });
  await import('@/workers/oscalImport.worker');
  const send = (data: unknown, messageOrigin = origin) => receive({ data, origin: messageOrigin });
  if (start) {
    send({ type: 'import', bytes: new ArrayBuffer(0), context: { trustClass: 'class-2-local-user' } });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
  }
  return { send, receive, postMessage };
}
it.each(['', globalThis.location.origin])('accepts imports and ACKs from allowed origin %s', async origin => {
  const { send, postMessage } = await setup({}, origin);
  expect(process).toHaveBeenCalledTimes(1);
  send({ type: 'ack', sequence: 0 });
  expect(postMessage.mock.lastCall?.[0]).toEqual({ type: 'done', sequence: 1 });
});
it('fails once before inspecting foreign data and ignores every later origin', async () => {
  const { receive, send, postMessage } = await setup({}, '', false);
  const readData = vi.fn(() => ({ type: 'import', bytes: new ArrayBuffer(0) }));
  receive({ origin: 'https://foreign.example', get data() { return readData(); } });
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failure' });
  expect(readData).not.toHaveBeenCalled();
  expect(process).not.toHaveBeenCalled();
  for (const origin of ['', globalThis.location.origin, 'https://foreign.example']) {
    send({ type: 'import', bytes: new ArrayBuffer(0) }, origin);
  }
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(process).not.toHaveBeenCalled();
});
it('discards an active stream when an ACK has a foreign origin', async () => {
  const { send, postMessage } = await setup({});
  send({ type: 'ack', sequence: 0 }, 'https://foreign.example');
  expect(postMessage.mock.lastCall?.[0]).toEqual({ type: 'failure' });
  send({ type: 'ack', sequence: 0 });
  expect(postMessage).toHaveBeenCalledTimes(3);
});
it.each([
  { disturbance: 'a foreign origin', origin: 'https://foreign.example', ok: true },
  { disturbance: 'a foreign origin', origin: 'https://foreign.example', ok: false },
  { disturbance: 'a second import', origin: '', ok: true },
  { disturbance: 'a second import', origin: '', ok: false },
])('stays silent after $disturbance fails a pending import that settles with ok=$ok', async ({ origin, ok }) => {
  const { send, postMessage } = await setup({}, '', false);
  let settle: (result: unknown) => void = () => { };
  process.mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
  send({ type: 'import', bytes: new ArrayBuffer(0), context: { trustClass: 'class-2-local-user' } });
  send({ type: 'import', bytes: new ArrayBuffer(0) }, origin);
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failure' });
  settle(ok
    ? { ok, document: { source: {}, rootType: 'catalog', oscalVersion: '1.1.3' } }
    : { ok, diagnostic: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failure' });
});
it('keeps exactly one chunk in flight and sends done only after its last ACK', async () => {
  const { send, postMessage } = await setup(Array.from({ length: 600 }, () => null));
  expect(postMessage.mock.calls[0][0].type).toBe('start');
  expect(postMessage.mock.calls[1][0]).toMatchObject({ type: 'chunk', sequence: 0 });
  await Promise.resolve();
  expect(postMessage).toHaveBeenCalledTimes(2);
  send({ type: 'ack', sequence: 0 });
  expect(postMessage.mock.lastCall?.[0]).toMatchObject({ type: 'chunk', sequence: 1 });
  send({ type: 'ack', sequence: 1 });
  expect(postMessage.mock.lastCall?.[0]).toMatchObject({ type: 'chunk', sequence: 2 });
  send({ type: 'ack', sequence: 2 });
  expect(postMessage.mock.lastCall?.[0]).toEqual({ type: 'done', sequence: 3 });
});
it.each([{ type: 'ack', sequence: 1 }, { type: 'ack', sequence: 0, extra: true }, null, { type: 'import' }])('rejects bad ACK or second import %#', async frame => {
  const { send, postMessage } = await setup({}); send(frame);
  expect(postMessage.mock.lastCall?.[0]).toEqual({ type: 'failure' });
});
