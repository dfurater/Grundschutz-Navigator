import { processWorkspaceBackupBytes, processVerbundBackupBytes, processAnyBackupBytes } from '@/adapters/workspaceBackupProcessing';
import { encodeOscalSource } from '@/domain/oscalImportTransport';

let started = false;
let failed = false;
let stream: ReturnType<typeof encodeOscalSource> | undefined;
let sequence = 0;
let awaitingAck = false;

function selectProcessor(scope: unknown) {
  switch (scope) {
    case 'workspace': return processWorkspaceBackupBytes;
    case 'verbund': return processVerbundBackupBytes;
    case 'any': return processAnyBackupBytes;
    default: return undefined;
  }
}

function fail(): void {
  failed = true;
  stream = undefined;
  globalThis.postMessage({ type: 'failure' });
}

/** One fragment at a time: the next one leaves only after the acknowledgement of this one. */
function next(): void {
  if (!stream) throw new Error('Missing stream');
  const fragment = stream.next();
  if (fragment.done) {
    stream = undefined;
    globalThis.postMessage({ type: 'done', sequence });
  } else {
    awaitingAck = true;
    globalThis.postMessage({ type: 'chunk', sequence, operations: fragment.value });
  }
}

globalThis.addEventListener('message', (event: MessageEvent) => {
  if (failed) return;
  if (event.origin !== '' && event.origin !== globalThis.location.origin) return fail();
  const request: unknown = event.data;
  if (request && typeof request === 'object' && 'type' in request && request.type === 'ack' && Object.keys(request).length === 2
    && 'sequence' in request && awaitingAck && request.sequence === sequence) {
    awaitingAck = false;
    sequence++;
    try { next(); } catch { fail(); }
    return;
  }
  if (started || !request || typeof request !== 'object' || Object.keys(request).length !== 2
    || !('buffer' in request) || !(request.buffer instanceof ArrayBuffer)
    || !('scope' in request)) return fail();
  const process = selectProcessor(request.scope);
  if (!process) return fail();
  started = true;
  void process(new Uint8Array(request.buffer)).then(result => {
    if (failed) return;
    if (!result.ok) {
      globalThis.postMessage({ type: 'rejected', diagnostic: result.diagnostic });
      return;
    }
    stream = encodeOscalSource(result.value);
    globalThis.postMessage({ type: 'start' });
    next();
  }).catch(fail);
});
