import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EvidenceResourcePreview } from '@/features/workspace/assessment/EvidenceResourcePreview';
import * as integrity from '@/domain/evidenceIntegrity';
import type { JsonObject } from '@/domain/jsonGuards';
import { createReferenceDocument, resolveCatalogResources } from '@/domain/referenceResolution';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';

const SHA256 = 'd3751d33f9cd5049c4af2b462735457e4d3baf130bcbb87f389e349fbaeb20b9';
const createUrl = vi.fn<(blob: Blob) => string>(() => 'blob:opaque');
const revokeUrl = vi.fn();

function props(mediaType: string | undefined = 'image/png', value = 'aGFsbG8=') {
  const resource: JsonObject = {
    uuid: '11111111-1111-4111-8111-111111111111', title: 'Prüfbeleg',
    base64: { filename: 'privater-beleg.html', 'media-type': mediaType, value },
    rlinks: [{ href: 'https://evidence.example.test/beleg', 'media-type': mediaType, hashes: [{ algorithm: 'SHA-256', value: SHA256 }] }],
  };
  return fromResource(resource);
}
function fromResource(resource: JsonObject) {
  const document = createReferenceDocument({ source: { 'assessment-results': { 'back-matter': { resources: [resource] } } }, context: {}, rootType: 'assessment-results', oscalVersion: '1.2.2' });
  return { resource, resolved: resolveCatalogResources({ document })[0] };
}

beforeEach(() => {
  createUrl.mockReset().mockReturnValue('blob:opaque'); revokeUrl.mockClear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('zeigt nur Metadaten und dekodiert oder prüft ohne Klick nichts, auch unter StrictMode', () => {
  const decode = vi.spyOn(globalThis, 'atob');
  const verify = vi.spyOn(integrity, 'verifyResourceIntegrity');
  const network = stubNoNetwork();
  render(<StrictMode><EvidenceResourcePreview {...props()} /></StrictMode>);
  expect(screen.getByText('Prüfbeleg')).toBeVisible();
  expect(screen.getByText('privater-beleg.html')).toBeVisible();
  expect(screen.getByText(/5 Byte/)).toBeVisible();
  expect(screen.getByText(/declared/)).toBeVisible();
  expect(screen.getByText(/Deklarierte Hashes: 1/)).toBeVisible();
  expect(screen.queryByRole('img')).toBeNull();
  expect(decode).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  expect(createUrl).not.toHaveBeenCalled(); expectNoNetworkCalls(network);
});

it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])('erzeugt %s erst auf Klick und widerruft beim Schließen', mediaType => {
  const decode = vi.spyOn(globalThis, 'atob');
  render(<EvidenceResourcePreview {...props(mediaType)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau öffnen' }));
  expect(screen.getByRole('img', { name: 'Evidenzvorschau' })).toHaveAttribute('src', 'blob:opaque');
  expect(createUrl.mock.calls[0][0]).toHaveProperty('type', mediaType);
  expect(decode).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau schließen' }));
  expect(revokeUrl).toHaveBeenCalledWith('blob:opaque');
  expect(screen.queryByRole('img')).toBeNull();
});

it('rendert text/plain ausschließlich als Textknoten, auch mit aktiven Inhalten', () => {
  const text = '<script>alert(1)</script><img src="https://evil.example.test">';
  const { container } = render(<EvidenceResourcePreview {...props('text/plain', btoa(text))} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau öffnen' }));
  expect(screen.getByText(text)).toBeVisible();
  expect(container.querySelector('script, img, iframe, object, embed')).toBeNull();
});

it.each(['image/svg+xml', 'text/html', 'application/zip', 'application/x-msdownload', 'application/pdf', 'application/octet-stream', 'text/plain; charset=utf-8', ''])('verweigert Vorschau für %s und erlaubt nur bewussten Download', mediaType => {
  const decode = vi.spyOn(globalThis, 'atob');
  const { container } = render(<EvidenceResourcePreview {...props(mediaType, btoa('<svg onload="alert(1)"><script>alert(1)</script></svg>'))} />);
  expect(screen.queryByRole('button', { name: 'Vorschau öffnen' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Herunterladen' })).toBeVisible();
  expect(container.querySelector('img, iframe, object, embed, script')).toBeNull();
  expect(decode).not.toHaveBeenCalled();
});

it('verweigert Vorschau ohne Medienart unabhängig von Dateiname und Bytes', () => {
  const supplied = props();
  delete (supplied.resource.base64 as JsonObject)['media-type'];
  const { container } = render(<EvidenceResourcePreview {...fromResource(supplied.resource)} />);
  expect(screen.queryByRole('button', { name: 'Vorschau öffnen' })).toBeNull();
  expect(container.querySelector('img, iframe, object, embed')).toBeNull();
});

it('dekodiert einen gesperrten Download nur auf Klick und gibt die Objekt-URL frei', () => {
  const decode = vi.spyOn(globalThis, 'atob');
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const network = stubNoNetwork();
  const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level));
  const location = globalThis.location.href;
  render(<EvidenceResourcePreview {...props('text/html')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Herunterladen' }));
  expect(decode).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
  const anchor = click.mock.instances[0] as HTMLAnchorElement;
  expect(anchor.href).toBe('blob:opaque');
  expect(anchor.download).toBe('privater-beleg.html');
  expect(createUrl.mock.calls[0][0]).toHaveProperty('type', 'application/octet-stream');
  expect(revokeUrl).toHaveBeenCalledWith('blob:opaque');
  expect(globalThis.location.href).toBe(location); expectNoNetworkCalls(network);
  for (const log of logs) expect(log).not.toHaveBeenCalled();
});

it('gibt die Vorschau beim Ressourcenwechsel und Unmount frei und verwirft alte Prüfergebnisse', async () => {
  let finish!: (value: readonly integrity.EvidenceHashCheck[]) => void;
  vi.spyOn(integrity, 'verifyResourceIntegrity').mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { rerender, unmount } = render(<EvidenceResourcePreview {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau öffnen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Integrität prüfen' }));
  rerender(<EvidenceResourcePreview {...props('text/html')} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(revokeUrl).toHaveBeenCalledTimes(1);
  finish([{ status: 'verified-match' }]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Integrität prüfen' })).toBeEnabled());
  expect(screen.queryByText('Hash stimmt überein')).toBeNull();
  rerender(<EvidenceResourcePreview {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau öffnen' }));
  unmount(); expect(revokeUrl).toHaveBeenCalledTimes(2);
});

it('zeigt alle drei echten Hash-Ergebnisse nur nach Klick ohne Werte auszugeben', async () => {
  const supplied = props();
  supplied.resource.rlinks = [
    { href: 'https://evidence.example.test/a', hashes: [{ algorithm: 'SHA-256', value: SHA256 }] },
    { href: 'https://evidence.example.test/b', hashes: [{ algorithm: 'SHA-256', value: '0'.repeat(64) }] },
    { href: 'https://evidence.example.test/c' },
  ];
  const verify = vi.spyOn(integrity, 'verifyResourceIntegrity');
  render(<EvidenceResourcePreview {...fromResource(supplied.resource)} />);
  expect(screen.getByText(/missing/)).toBeVisible();
  expect(verify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Integrität prüfen' }));
  expect(await screen.findByText('Hash stimmt überein')).toBeVisible();
  expect(screen.getByText('Hash weicht ab')).toBeVisible();
  expect(screen.getByText('Nicht prüfbar')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Evidenzressource' }).textContent).not.toContain(SHA256);
  expect(screen.getByRole('region', { name: 'Evidenzressource' }).textContent).not.toContain('hallo');
});

it('zeigt nur sichere externe Links und lädt sie nie inline', () => {
  const supplied = props();
  delete supplied.resource.base64;
  supplied.resource.rlinks = [
    { href: 'https://evidence.example.test/a', 'media-type': 'image/png' },
    { href: 'https://evidence.example.test/b', 'media-type': 'text/html' },
    { href: 'javascript:alert(1)' }, { href: 'http://evidence.example.test' },
  ];
  render(<EvidenceResourcePreview {...fromResource(supplied.resource)} />);
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(2);
  expect(links[0]).toHaveTextContent('image/png');
  expect(links[1]).toHaveTextContent('ohne Vorschau');
  for (const link of links) expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('button', { name: 'Herunterladen' })).toBeNull();
});

it('meldet ungültige Nutzlast und technische Fehler ohne Inhaltswerte', async () => {
  const { rerender } = render(<EvidenceResourcePreview {...props('image/png', '%%%')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau öffnen' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Inhalt konnte nicht geöffnet werden');
  rerender(<EvidenceResourcePreview {...props()} />);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('privater-beleg.html'); });
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau öffnen' }));
  expect(screen.getByRole('alert')).not.toHaveTextContent('privater-beleg.html');
  vi.spyOn(integrity, 'verifyResourceIntegrity').mockRejectedValue(new Error('privater-beleg.html'));
  fireEvent.click(screen.getByRole('button', { name: 'Integrität prüfen' }));
  expect(await screen.findByText('Integrität konnte nicht geprüft werden. Erneut versuchen.')).toBeVisible();
});

it('ordnet bei ausgelassenen fehlgeformten Links keine fremden Hash-Ergebnisse zu', async () => {
  const supplied = props();
  supplied.resource.rlinks = [
    { hashes: [{ algorithm: 'SHA-256', value: SHA256 }] },
    { href: 'https://evidence.example.test/b', hashes: [{ algorithm: 'SHA-256', value: '0'.repeat(64) }] },
  ];
  render(<EvidenceResourcePreview {...fromResource(supplied.resource)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Integrität prüfen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Integrität konnte nicht geprüft werden');
  expect(screen.queryByText('Hash stimmt überein')).toBeNull();
});

it('widerruft ein nicht darstellbares Bild und zeigt einen redigierten Fehler', () => {
  render(<EvidenceResourcePreview {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau öffnen' }));
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('alert')).toHaveTextContent('Bildvorschau konnte nicht angezeigt werden.');
  expect(revokeUrl).toHaveBeenCalledWith('blob:opaque');
});

it('zeigt fehlende Metadaten und eine nicht mögliche Hashprüfung ohne Inhalte', async () => {
  render(<EvidenceResourcePreview {...fromResource({ uuid: 'r', base64: {} })} />);
  expect(screen.getByText('nicht verfügbar')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Integrität prüfen' }));
  expect(await screen.findByText('Keine Ressourcenlinks für eine Hashprüfung deklariert.')).toBeVisible();
});
