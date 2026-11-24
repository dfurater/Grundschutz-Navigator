import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import '@/index.css';

/** Formulardialog: Vom Startfokus auf der Überschrift führt ein echtes Shift+Tab zum letzten Bedienelement, nicht aus dem Dialog. */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  flushSync(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

test('hält Shift+Tab vom Startfokus auf der Überschrift im Formulardialog', async () => {
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(ConfirmDialog, {
    open: true,
    form: true,
    title: 'Freigabe zurücknehmen',
    confirmLabel: 'Freigabe zurücknehmen',
    onConfirm: () => {},
    onCancel: () => {},
  }, createElement('label', null, 'Anlass', createElement('textarea')))));

  const heading = document.querySelector('h2')!;
  expect(document.activeElement).toBe(heading);

  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(document.activeElement?.textContent).toBe('Freigabe zurücknehmen');
  expect(document.activeElement?.tagName).toBe('BUTTON');

  await userEvent.keyboard('{Tab}');
  expect(document.activeElement?.tagName).toBe('TEXTAREA');
});
