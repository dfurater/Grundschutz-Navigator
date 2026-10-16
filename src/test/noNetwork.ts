import { expect, vi, type Mock } from 'vitest';

export interface NoNetworkStubs {
  readonly fetch: Mock<() => never>;
  readonly XMLHttpRequest: Mock<() => never>;
  readonly sendBeacon: Mock<() => never>;
}

function forbidden(): never {
  throw new Error('network access is forbidden');
}

/**
 * Ersetzt `fetch`, `XMLHttpRequest` und `navigator.sendBeacon` per
 * `vi.stubGlobal` durch werfende Mocks. Die Suite hebt die Stubs mit
 * `vi.unstubAllGlobals()` wieder auf.
 */
export function stubNoNetwork(): NoNetworkStubs {
  const stubs: NoNetworkStubs = {
    fetch: vi.fn(forbidden),
    XMLHttpRequest: vi.fn(forbidden),
    sendBeacon: vi.fn(forbidden),
  };
  vi.stubGlobal('fetch', stubs.fetch);
  vi.stubGlobal('XMLHttpRequest', stubs.XMLHttpRequest);
  vi.stubGlobal('navigator', { sendBeacon: stubs.sendBeacon });
  return stubs;
}

/** Belegt, dass keiner der drei Netzwerkzugänge aufgerufen wurde. */
export function expectNoNetworkCalls(stubs: NoNetworkStubs): void {
  expect(stubs.fetch).not.toHaveBeenCalled();
  expect(stubs.XMLHttpRequest).not.toHaveBeenCalled();
  expect(stubs.sendBeacon).not.toHaveBeenCalled();
}
