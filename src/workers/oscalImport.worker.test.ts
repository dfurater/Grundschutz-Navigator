import { afterEach, expect, it, vi } from 'vitest';
const process = vi.hoisted(() => vi.fn());
vi.mock('@/domain/oscalClass2Import', () => ({ processClass2OscalBytes: process }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); process.mockReset(); });

async function setup(source: unknown) {
  let receive: (event: { data: unknown }) => void = () => { };
  const postMessage = vi.fn();
  vi.stubGlobal('self', { addEventListener: (_: string, listener: typeof receive) => { receive = listener; }, postMessage });
  process.mockResolvedValue({ ok: true, document: { source, rootType: 'catalog', oscalVersion: '1.1.3' } });
  await import('@/workers/oscalImport.worker');
  const send = (data: unknown) => receive({ data });
  send({ type: 'import', bytes: new ArrayBuffer(0), context: { trustClass: 'class-2-local-user' } });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
  return { send, postMessage };
}
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
