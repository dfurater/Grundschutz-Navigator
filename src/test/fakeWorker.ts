import { vi } from 'vitest';

type WorkerListener = (event: Event) => void;

// Hinzufügen und Entfernen ersetzen die Listenerliste eines Typs, statt sie zu
// verändern. Eine laufende Zustellung iteriert deshalb über einen festen Stand.

/**
 * Testdouble für `Worker`. `onPostMessage` läuft bei jedem `postMessage` mit
 * dem Double und der gesendeten Nachricht; `emitEvent` und `emitMessage`
 * stellen Ereignisse an die registrierten Listener zu.
 */
export class FakeWorker {
  private readonly listeners = new Map<string, WorkerListener[]>();
  private readonly onPostMessage: (worker: FakeWorker, message: unknown) => void;

  constructor(onPostMessage: (worker: FakeWorker, message: unknown) => void = () => {}) {
    this.onPostMessage = onPostMessage;
  }

  readonly terminate = vi.fn();

  readonly addEventListener = vi.fn((type: string, listener: WorkerListener) => {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  });

  readonly removeEventListener = vi.fn((type: string, listener: WorkerListener) => {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  });

  readonly postMessage = vi.fn((message: unknown) => {
    this.onPostMessage(this, message);
  });

  /** Stellt ein Ereignis ohne Nutzlast zu, z. B. `error` oder `messageerror`. */
  emitEvent(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }

  emitMessage(data: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

/** Ersetzt den globalen `Worker`-Konstruktor; jede Erzeugung liefert `worker`. */
export function installWorker(worker: FakeWorker): void {
  vi.stubGlobal('Worker', vi.fn(function createWorker() {
    return worker;
  }));
}
