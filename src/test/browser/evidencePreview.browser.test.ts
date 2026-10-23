import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import axe from 'axe-core';
import html from '../../../index.html?raw';
import { EvidenceResourcePreview } from '@/features/workspace/assessment/EvidenceResourcePreview';
import { createReferenceDocument, resolveCatalogResources } from '@/domain/referenceResolution';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let policy: HTMLMetaElement | undefined;
afterEach(() => { root?.unmount(); host?.remove(); policy?.remove(); });

test.each([320, 1440])('zeigt bei %i px ein Blob-Bild unter der ausgelieferten img-src-CSP', async width => {
  await page.viewport(width, 800);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const csp = parsed.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')!.content;
  policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = csp.split(';').find(directive => directive.trim().startsWith('img-src'))!.trim();
  document.head.append(policy);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const resource = {
    uuid: '11111111-1111-4111-8111-111111111111', title: 'Synthetischer Prüfbeleg',
    base64: { filename: 'ein-langer-synthetischer-dateiname-ohne-personenbezogene-daten.png', 'media-type': 'image/png', value: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=' },
  };
  const documentModel = createReferenceDocument({ source: { 'assessment-results': { 'back-matter': { resources: [resource] } } }, context: {}, rootType: 'assessment-results', oscalVersion: '1.2.2' });
  flushSync(() => root!.render(createElement(EvidenceResourcePreview, { resource, resolved: resolveCatalogResources({ document: documentModel })[0] })));
  expect(host.querySelector('img')).toBeNull();
  await page.getByRole('button', { name: 'Vorschau öffnen' }).click();
  await expect.poll(() => host!.querySelector('img')?.naturalWidth).toBe(1);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  for (const button of host.querySelectorAll('button')) expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect((await axe.run(host)).violations).toEqual([]);
  await page.getByRole('button', { name: 'Vorschau schließen' }).click();
  expect(host.querySelector('img')).toBeNull();
});
