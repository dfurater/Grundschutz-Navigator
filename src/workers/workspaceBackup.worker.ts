import { processWorkspaceBackupBytes, processVerbundBackupBytes } from '@/adapters/workspaceBackupProcessing';

let started = false;
globalThis.addEventListener('message', (event: MessageEvent) => {
  if (started) return;
  started = true;
  const request: unknown = event.data;
  if (!request || typeof request !== 'object' || Object.keys(request).length !== 2
    || !('buffer' in request) || !(request.buffer instanceof ArrayBuffer)
    || !('scope' in request) || !['workspace', 'verbund'].includes(request.scope as string)
    || (event.origin !== '' && event.origin !== globalThis.location.origin)) {
    globalThis.postMessage({ ok: false });
    return;
  }
  const process = request.scope === 'verbund' ? processVerbundBackupBytes : processWorkspaceBackupBytes;
  void process(new Uint8Array(request.buffer)).then(result => globalThis.postMessage(result));
});
