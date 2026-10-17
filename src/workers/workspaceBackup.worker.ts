import { processWorkspaceBackupBytes } from '@/adapters/workspaceBackupProcessing';

let started = false;
globalThis.addEventListener('message', (event: MessageEvent) => {
  if (started) return;
  started = true;
  if (!(event.data instanceof ArrayBuffer) || (event.origin !== '' && event.origin !== globalThis.location.origin)) {
    globalThis.postMessage({ ok: false });
    return;
  }
  void processWorkspaceBackupBytes(new Uint8Array(event.data)).then(result => globalThis.postMessage(result));
});
