export {};

declare module 'vitest/internal/browser' {
  interface BrowserCommands {
    installBrowserEgressGuard: () => Promise<void>;
    resetBrowserEgressGuard: () => Promise<void>;
    assertNoBrowserEgress: () => Promise<string | undefined>;
    getBrowserEgressEnforcements: () => Promise<{
      httpAborts: number;
      webSocketCloses: number;
      violations: string[];
    }>;
    dispatchBrowserTouch: (kind: 'start' | 'move' | 'end' | 'reset', x?: number, y?: number) => Promise<void>;
  }
}
