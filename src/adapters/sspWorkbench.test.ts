import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSspInWorker } from '@/adapters/sspWorkbench';
import { FakeWorker, installWorker } from '@/test/fakeWorker';

afterEach(() => {
  vi.unstubAllGlobals();
});

const DOCUMENT = { documentState: 'export-ready' as const, rootType: 'system-security-plan', source: { 'system-security-plan': {} } };

describe('SSP-Export über den Worker der Informationsverbünde', () => {
  it('überträgt nur Zustand, Root und Quelle und liefert das Exportergebnis', async () => {
    const worker = new FakeWorker((self) => self.emitMessage({ type: 'exported', result: { ok: true, json: '{}' } }));
    installWorker(worker);
    expect(await exportSspInWorker({ ...DOCUMENT, localId: 'nicht übertragen' } as never)).toEqual({ ok: true, json: '{}' });
    expect(worker.postMessage.mock.calls[0][0]).toEqual({ type: 'ssp-export', document: DOCUMENT });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    ['einem Fehler', new FakeWorker((self) => self.emitEvent('error'))],
    ['einem unbekannten Frame', new FakeWorker((self) => self.emitMessage({ type: 'unbekannt' }))],
  ])('lehnt bei %s mit OSCAL_EXPORT_WORKER_FAILURE ab', async (_name, worker) => {
    installWorker(worker);
    expect(await exportSspInWorker(DOCUMENT)).toEqual({ ok: false, code: 'OSCAL_EXPORT_WORKER_FAILURE', path: '/' });
  });
});
