import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';
import { verifyEvidenceHashes, verifyResourceIntegrity } from '@/domain/evidenceIntegrity';
import { createReferenceDocument, resolveCatalogResources } from '@/domain/referenceResolution';

// Synthetischer Inhalt; SHA-256 von "hallo" per `printf hallo | shasum -a 256`.
const CONTENT = new TextEncoder().encode('hallo');
const BASE64 = 'aGFsbG8=';
const SHA256 = 'd3751d33f9cd5049c4af2b462735457e4d3baf130bcbb87f389e349fbaeb20b9';
const TAMPERED = `${SHA256.slice(0, -1)}0`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyEvidenceHashes', () => {
  it('liefert verified-match für einen zugelassenen, übereinstimmenden Hash unabhängig von der Schreibweise', async () => {
    await expect(verifyEvidenceHashes([{ algorithm: 'SHA-256', value: SHA256 }], CONTENT)).resolves.toEqual({
      status: 'verified-match',
    });
    await expect(
      verifyEvidenceHashes([{ algorithm: 'SHA-256', value: SHA256.toUpperCase() }], CONTENT),
    ).resolves.toEqual({ status: 'verified-match' });
  });

  it('liefert verified-mismatch für einen manipulierten Hashwert', async () => {
    await expect(verifyEvidenceHashes([{ algorithm: 'SHA-256', value: TAMPERED }], CONTENT)).resolves.toEqual({
      status: 'verified-mismatch',
    });
  });

  it.each([
    ['no-hash', [], CONTENT],
    ['no-local-content', [{ algorithm: 'SHA-256', value: SHA256 }], undefined],
    ['algorithm-not-allowed', [{ algorithm: 'SHA3-256', value: SHA256 }], CONTENT],
    ['algorithm-not-allowed', [{ algorithm: 'SHA-224', value: SHA256.slice(0, 56) }], CONTENT],
    ['algorithm-not-allowed', [{ algorithm: 'sha256', value: SHA256 }], CONTENT],
    ['malformed-hash', [{ algorithm: 'SHA-256', value: SHA256.slice(0, -2) }], CONTENT],
    ['malformed-hash', [{ algorithm: 'SHA-256', value: `${SHA256.slice(0, -1)}g` }], CONTENT],
  ] as const)('liefert not-verifiable mit Grund %s', async (reason, hashes, content) => {
    await expect(verifyEvidenceHashes(hashes, content)).resolves.toEqual({ status: 'not-verifiable', reason });
  });

  it('wertet eine Abweichung vor einer Übereinstimmung und einen fehlgeformten Wert vor einer Übereinstimmung', async () => {
    const match = { algorithm: 'SHA-256', value: SHA256 };
    await expect(
      verifyEvidenceHashes([match, { algorithm: 'SHA-384', value: 'ab'.repeat(48) }], CONTENT),
    ).resolves.toEqual({ status: 'verified-mismatch' });
    await expect(verifyEvidenceHashes([match, { algorithm: 'SHA-512', value: 'ab'.repeat(63) }], CONTENT)).resolves.toEqual({
      status: 'not-verifiable',
      reason: 'malformed-hash',
    });
    await expect(verifyEvidenceHashes([{ algorithm: 'SHA3-256', value: 'x' }, match], CONTENT)).resolves.toEqual({
      status: 'verified-match',
    });
  });

  it('rechnet lokal über crypto.subtle.digest und schreibt nichts in Konsole oder Netz', async () => {
    const network = stubNoNetwork();
    const digest = vi.spyOn(crypto.subtle, 'digest');
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level),
    );

    const result = await verifyEvidenceHashes([{ algorithm: 'SHA-256', value: TAMPERED }], CONTENT);

    expect(digest).toHaveBeenCalledWith('SHA-256', CONTENT);
    expectNoNetworkCalls(network);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(TAMPERED.slice(0, 16));
  });
});

describe('verifyResourceIntegrity', () => {
  const resource = (extra: Record<string, unknown>) => ({
    uuid: '11111111-1111-4111-8111-111111111111',
    rlinks: [
      { href: 'https://evidence.example.test/a', hashes: [{ algorithm: 'SHA-256', value: SHA256 }] },
      { href: 'https://evidence.example.test/b' },
      { href: 'https://evidence.example.test/c', hashes: [{ algorithm: 'SHA3-256', value: SHA256 }] },
    ],
    ...extra,
  });

  it('prüft jeden rlink gegen die eingebettete base64-Nutzlast derselben Ressource', async () => {
    await expect(verifyResourceIntegrity(resource({ base64: { value: BASE64 } }))).resolves.toEqual([
      { status: 'verified-match' },
      { status: 'not-verifiable', reason: 'no-hash' },
      { status: 'not-verifiable', reason: 'algorithm-not-allowed' },
    ]);
  });

  it.each([
    ['ohne base64', {}],
    ['ohne base64.value', { base64: { filename: 'x.txt' } }],
    ['mit ungültigem base64', { base64: { value: '%%%' } }],
  ])('liefert no-local-content %s', async (_label, extra) => {
    const [first] = await verifyResourceIntegrity(resource(extra));
    expect(first).toEqual({ status: 'not-verifiable', reason: 'no-local-content' });
  });

  it('lässt den nicht zugelassenen Algorithmus in der aufgelösten Ressource unverändert', () => {
    const source = { 'assessment-results': { 'back-matter': { resources: [resource({})] } } };
    const document = createReferenceDocument({
      source,
      context: {},
      rootType: 'assessment-results',
      oscalVersion: '1.2.2',
    });
    const [resolved] = resolveCatalogResources({ document });
    expect(resolved?.rlinks[2]?.hashes).toEqual([{ algorithm: 'SHA3-256', value: SHA256 }]);
  });
});
