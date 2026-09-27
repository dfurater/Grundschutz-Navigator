import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { ControlSecurityTargets } from '@/features/catalog/ControlSecurityTargets';
import '@/index.css';

const resolved = {} as VocabularyResolution;
const labels = ['Vertraulichkeit', 'Integrität', 'Verfügbarkeit', 'Authentizität'];
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

function renderAtWidth(width: number) {
  host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(ControlSecurityTargets, {
      securityTargets: labels.map((label, index) => ({
        key: String(index),
        label,
        relevance: String(index % 3),
        targetResolution: resolved,
        levelResolution: resolved,
      })),
      isVocabularyActive: () => false,
      onToggleVocabulary: () => {},
      renderVocabularyCard: () => null,
    }));
  });
  return host;
}

test('hält alle Schutzziel-Schaltflächen in einem 288 px breiten Detailinhalt sichtbar', async () => {
  const panel = renderAtWidth(288);
  await document.fonts.ready;
  const groups = [...panel.querySelectorAll<HTMLElement>('[role="group"]')];
  const rightEdge = panel.getBoundingClientRect().right;

  expect(groups).toHaveLength(4);
  for (const group of groups) {
    const relevanceButton = group.querySelector<HTMLButtonElement>('button[aria-label^="Relevanz"]');
    expect(relevanceButton).not.toBeNull();
    expect(relevanceButton!.getBoundingClientRect().right).toBeLessThanOrEqual(rightEdge);
  }
  expect(groups[0].getBoundingClientRect().top).toBeLessThan(groups[1].getBoundingClientRect().top);
});

test('behält ab 384 px zwei Schutzziele je Zeile ohne Überlauf', async () => {
  const panel = renderAtWidth(384);
  await document.fonts.ready;
  const groups = [...panel.querySelectorAll<HTMLElement>('[role="group"]')];

  expect(groups[0].getBoundingClientRect().top).toBe(groups[1].getBoundingClientRect().top);
  expect(groups[2].getBoundingClientRect().top).toBe(groups[3].getBoundingClientRect().top);
  const rightEdge = panel.getBoundingClientRect().right;
  for (const relevanceButton of panel.querySelectorAll<HTMLButtonElement>('button[aria-label^="Relevanz"]')) {
    expect(relevanceButton.getBoundingClientRect().right).toBeLessThanOrEqual(rightEdge);
  }
});
