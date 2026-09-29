import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import type { Control, ControlLink } from '@/domain/models';
import { ControlDependencies } from '@/features/catalog/ControlDependencies';
import { ControlHierarchy } from '@/features/catalog/ControlHierarchy';
import { controlIdColumnStyle } from '@/features/catalog/ControlListLink';
import { subSectionStackClass } from '@/features/catalog/ControlVocabularyPrimitives';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  document.documentElement.style.fontSize = '';
  root = undefined;
  host = undefined;
});

async function renderAtWidth(width: number, element: ReactNode) {
  host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(element);
  });
  await document.fonts.ready;
  return host;
}

function makeControl(id: string, title: string): Control {
  return {
    id,
    title,
    tags: [],
    taxonomy: [],
    threats: [],
    statement: '',
    statementRaw: '',
    guidance: '',
    statementProps: { zielobjektKategorien: [] },
    links: [],
    params: {},
  };
}

function link(targetId: string, rel: string): ControlLink {
  return { targetId, href: `#${targetId}`, rel, relStatus: 'custom' };
}

/** Kinder mit sichtbarer Trennlinie oben (1 px). */
function separatedChildren(stack: Element) {
  return [...stack.children].filter((child) => getComputedStyle(child).borderTopWidth === '1px');
}

test.each([
  [1, 0],
  [2, 1],
  [3, 2],
])('zieht bei %i sichtbaren Unterabschnitten %i Trennlinien', async (count, lines) => {
  const sections = Array.from({ length: count }, (_, index) => createElement('div', { key: index }, `Abschnitt ${index}`));
  // Ein leer ausfallender Abschnitt (`null`) erzeugt keine zusätzliche Linie.
  const panel = await renderAtWidth(320, createElement('div', { className: subSectionStackClass }, null, ...sections, null));
  const stack = panel.firstElementChild!;
  const separated = separatedChildren(stack);

  expect(separated).toHaveLength(lines);
  for (const child of separated) {
    const style = getComputedStyle(child);
    expect(style.paddingTop).toBe('12px');
    expect(style.marginTop).toBe('12px');
    expect(style.borderTopStyle).toBe('solid');
    // Linie über die volle Inhaltsbreite des Stapels.
    expect(child.getBoundingClientRect().width).toBe(stack.getBoundingClientRect().width);
  }
  expect(getComputedStyle(stack.children[0]).borderTopWidth).toBe('0px');
});

const children = [
  makeControl('ASST.2.2.1', 'Kurzer Titel'),
  makeControl('GC.9.1.1.1.1', 'Ein deutlich längerer Titel, der auf schmalen Bildschirmen in mehrere Zeilen umbricht'),
];
const outgoing = [makeControl('BER.1', 'Verwandte Anforderung'), makeControl('KONF.11.7.2.1', 'Lange Kennung')];
const incomingOnly = makeControl('BER.1.3', 'Eingehende Anforderung mit einem ebenfalls langen Titel zur Prüfung');
const incomingLinks: IncomingControlLink[] = [{ control: incomingOnly, link: link('ASST.2.2', 'related') }];

function zusammenhaenge() {
  const ids = [...children, ...outgoing, incomingOnly].map((control) => control.id);
  return createElement(
    'div',
    { className: subSectionStackClass, style: controlIdColumnStyle(ids) },
    createElement('div', null, createElement(ControlHierarchy, { childControls: children })),
    createElement('div', null, createElement(ControlDependencies, {
      links: outgoing.map((control) => link(control.id, 'related')),
      controlsById: new Map(outgoing.map((control) => [control.id, control])),
      incomingLinks,
    })),
  );
}

test.each([
  ['Desktop-Panel', 420, 16],
  ['320-px-Fenster', 288, 16],
  ['393-px-Fenster', 361, 16],
  ['402-px-Fenster', 370, 16],
  ['vergrößerte Schrift', 288, 20],
])('richtet Kennungen, Titel und Hinweise in „Zusammenhänge“ bündig aus (%s)', async (_label, width, fontSize) => {
  document.documentElement.style.fontSize = `${fontSize}px`;
  const panel = await renderAtWidth(width, zusammenhaenge());
  const buttons = [...panel.querySelectorAll('button')];
  expect(buttons).toHaveLength(children.length + outgoing.length + 1);

  const idLefts = buttons.map((button) => button.children[0].getBoundingClientRect().left);
  const titleLefts = buttons.map((button) => button.children[1].getBoundingClientRect().left);
  expect(new Set(idLefts).size).toBe(1);
  expect(new Set(titleLefts).size).toBe(1);

  // Zusatztexte beginnen an der Titelkante und bleiben innerhalb des Blocks.
  const notes = [...panel.querySelectorAll('li p')];
  expect(notes).toHaveLength(1);
  expect(notes[0].children[1].getBoundingClientRect().left).toBe(titleLefts[0]);
  expect(notes[0].textContent).toBe('Verweist auf diese Kontrolle · Verwandt');

  // Kein Überlauf, keine abgeschnittene Kennung oder Titelzeile.
  const { right } = panel.getBoundingClientRect();
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  for (const button of buttons) {
    const [id, title] = button.children;
    expect(id.scrollWidth).toBeLessThanOrEqual(Math.ceil(id.getBoundingClientRect().width));
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(right);
  }
});
