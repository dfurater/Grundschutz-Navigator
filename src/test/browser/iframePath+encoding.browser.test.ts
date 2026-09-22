import { expect, test } from 'vitest';

// Das `+` im Dateinamen ist der Prüfgegenstand: Vitest übergibt den absoluten
// Testdateipfad als `iframeId` in der Query des isolierten Test-iframes. Ohne
// URL-Kodierung dekodiert `URLSearchParams` das `+` zu einem Leerzeichen, der
// Ready-Handshake wartet auf die ursprüngliche ID und diese Datei wird nie
// registriert (vitest-dev/vitest#10520).
test('überträgt ein + im Testdateipfad unverändert in die iframeId', () => {
  const iframeId = new URLSearchParams(globalThis.location.search).get('iframeId');

  expect(iframeId).toMatch(/\/src\/test\/browser\/iframePath\+encoding\.browser\.test\.ts$/);
});
