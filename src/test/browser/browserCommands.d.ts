export {};

declare module 'vitest/internal/browser' {
  interface BrowserCommands {
    installBrowserEgressGuard: () => Promise<void>;
    resetBrowserEgressGuard: () => Promise<void>;
    assertNoBrowserEgress: () => Promise<void>;
    getBrowserEgressEnforcements: () => Promise<{
      httpAborts: number;
      webSocketCloses: number;
      violations: string[];
    }>;
  }
}
