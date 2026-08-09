export function createBlockedLoopbackUrl(testServerUrl: string): string {
  const blockedUrl = new URL('/egress-proof', testServerUrl);
  blockedUrl.hostname = '127.0.0.1';
  blockedUrl.port = '1';
  return blockedUrl.href;
}
