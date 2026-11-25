import { createElement, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HeaderBar } from '@/components/HeaderBar';
import '@/index.css';

/**
 * Formulardialog (`ConfirmDialog` mit `form`) in Chromium: Vom Startfokus auf
 * der Überschrift bleibt ein echtes Shift+Tab im Dialog, und das Suchkürzel
 * schließt ihn über `onDismiss` und fokussiert die Suche im App-Kopf.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  flushSync(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function FormDialog({ onDismiss }: Readonly<{ onDismiss?: () => void }>) {
  const [open, setOpen] = useState(true);
  return createElement(ConfirmDialog, {
    open,
    form: true,
    title: 'Freigabe zurücknehmen',
    confirmLabel: 'Freigabe zurücknehmen',
    onConfirm: () => {},
    onCancel: () => setOpen(false),
    onDismiss: () => { onDismiss?.(); setOpen(false); },
    children: createElement('label', null, 'Anlass', createElement('textarea')),
  });
}

async function render(onDismiss?: () => void) {
  await page.viewport(1024, 800);
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(MemoryRouter, null,
    createElement(HeaderBar),
    createElement(FormDialog, { onDismiss }),
  )));
  await document.fonts.ready;
}

test('hält Shift+Tab vom Startfokus auf der Überschrift im Formulardialog', async () => {
  await render();
  const heading = document.querySelector('dialog h2')!;
  expect(document.activeElement).toBe(heading);

  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(document.activeElement?.textContent).toBe('Freigabe zurücknehmen');
  expect(document.activeElement?.tagName).toBe('BUTTON');

  await userEvent.keyboard('{Tab}');
  expect(document.activeElement?.tagName).toBe('TEXTAREA');
});

test.each(['{Control>}k{/Control}', '{Meta>}k{/Meta}'])('Suchkürzel %s schließt den Formulardialog bei Fokus auf „Abbrechen“ und fokussiert die Suche', async (shortcut) => {
  let dismissed = 0;
  await render(() => { dismissed += 1; });
  const cancel = [...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Abbrechen') as HTMLButtonElement;
  cancel.focus();

  await userEvent.keyboard(shortcut);

  await expect.poll(() => document.querySelector('dialog')).toBeNull();
  expect(dismissed).toBe(1);
  await expect.poll(() => document.activeElement).toBe(document.querySelector('[data-testid="header-search"]'));
});
