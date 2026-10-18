import { afterEach, expect, it, vi } from 'vitest';
const workspace = vi.hoisted(() => vi.fn());
const verbund = vi.hoisted(() => vi.fn());
vi.mock('@/adapters/workspaceBackupProcessing', () => ({ processWorkspaceBackupBytes: workspace, processVerbundBackupBytes: verbund }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); workspace.mockReset(); verbund.mockReset(); });

async function setup(value: unknown, origin = '', scope = 'workspace') {
  let receive: (event: { data: unknown; origin: string }) => void = () => { };
  const postMessage = vi.fn();
  vi.stubGlobal('addEventListener', (_: string, listener: typeof receive) => { receive = listener; });
  vi.stubGlobal('postMessage', postMessage);
  workspace.mockResolvedValue({ ok: true, value });
  verbund.mockResolvedValue({ ok: true, value });
  await import('@/workers/workspaceBackup.worker');
  const send = (data: unknown, messageOrigin = origin) => receive({ data, origin: messageOrigin });
  send({ scope, buffer: new ArrayBuffer(0) });
  return { send, receive, postMessage };
}
it.each([['', 'workspace'], [globalThis.location.origin, 'verbund']])('streams a validated bundle from origin "%s" (%s) one acknowledged fragment at a time', async (origin, scope) => {
  const { send, postMessage } = await setup(Array.from({ length: 600 }, () => null), origin, scope);
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
  expect((scope === 'verbund' ? verbund : workspace)).toHaveBeenCalledOnce();
  expect(postMessage.mock.calls[0][0]).toEqual({ type: 'start' });
  expect(postMessage.mock.calls[1][0]).toMatchObject({ type: 'chunk', sequence: 0 });
  // Fehlschlag, wenn der Worker ein weiteres Fragment ohne Quittung sendet.
  await Promise.resolve();
  expect(postMessage).toHaveBeenCalledTimes(2);
  send({ type: 'ack', sequence: 0 });
  expect(postMessage.mock.lastCall?.[0]).toMatchObject({ type: 'chunk', sequence: 1 });
  send({ type: 'ack', sequence: 1 });
  expect(postMessage.mock.lastCall?.[0]).toMatchObject({ type: 'chunk', sequence: 2 });
  send({ type: 'ack', sequence: 2 });
  expect(postMessage.mock.lastCall?.[0]).toEqual({ type: 'done', sequence: 3 });
});
it('forwards a rejection as a diagnostic frame without starting a transport', async () => {
  const diagnostic = { code: 'WORKSPACE_BACKUP_INVALID' };
  workspace.mockResolvedValueOnce({ ok: false, diagnostic });
  const { postMessage } = await setup(null);
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'rejected', diagnostic }));
});
it('fails before inspecting foreign data and ignores every later message', async () => {
  const { receive, send, postMessage } = await setup({}, 'https://foreign.example');
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failure' });
  const readData = vi.fn(() => ({ scope: 'workspace', buffer: new ArrayBuffer(0) }));
  receive({ origin: 'https://foreign.example', get data() { return readData(); } });
  send({ scope: 'workspace', buffer: new ArrayBuffer(0) }, '');
  expect(readData).not.toHaveBeenCalled();
  expect(workspace).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledOnce();
});
it.each([null, { scope: 'other', buffer: new ArrayBuffer(0) }, { scope: 'workspace', buffer: 'bytes' }, { scope: 'workspace', buffer: new ArrayBuffer(0), extra: true }])('rejects a malformed restore request %#', async request => {
  let receive: (event: { data: unknown; origin: string }) => void = () => { };
  const postMessage = vi.fn();
  vi.stubGlobal('addEventListener', (_: string, listener: typeof receive) => { receive = listener; });
  vi.stubGlobal('postMessage', postMessage);
  await import('@/workers/workspaceBackup.worker');
  receive({ data: request, origin: '' });
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failure' });
  expect(workspace).not.toHaveBeenCalled();
});
it.each([{ type: 'ack', sequence: 1 }, { type: 'ack', sequence: 0, extra: true }, { scope: 'workspace', buffer: new ArrayBuffer(0) }])('ends the stream on a bad acknowledgement or second request %#', async frame => {
  const { send, postMessage } = await setup({});
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
  send(frame);
  expect(postMessage.mock.lastCall?.[0]).toEqual({ type: 'failure' });
  send({ type: 'ack', sequence: 0 });
  expect(postMessage).toHaveBeenCalledTimes(3);
});
it('stays silent when a pending restore settles after a protocol failure', async () => {
  let settle: (result: unknown) => void = () => { };
  workspace.mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
  const { send, postMessage } = await setup({});
  send({ type: 'ack', sequence: 0 });
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failure' });
  settle({ ok: true, value: {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(postMessage).toHaveBeenCalledOnce();
});
it('reports a failure when validation itself throws', async () => {
  workspace.mockRejectedValueOnce(new Error('PRIVATE_SENTINEL'));
  const { postMessage } = await setup({});
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failure' }));
});
