import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import type { Control } from '@/domain/models';
import { CatalogMobileList } from '@/features/catalog/CatalogMobileList';
import { useDocumentDetailPage } from '@/hooks/useDocumentDetailPage';
import '@/index.css';

const controls: Control[] = Array.from({ length: 1000 }, (_, index) => ({
  id: `GC.1.${index + 1}`,
  title: `Anforderung ${index + 1} mit einem sehr langen Titel, der weiterhin auf eine Zeile begrenzt bleibt`,
  groupId: 'GC.1', practiceId: 'GC', tags: [], taxonomy: [], threats: [],
  statement: '', statementRaw: '', guidance: '',
  statementProps: { zielobjektKategorien: [] }, links: [], params: {},
  modalverb: index % 2 ? 'MUSS' : undefined,
  securityLevel: index % 3 ? 'normal-SdT' : undefined,
  effortLevel: index % 4 ? '3' : undefined,
}));
const controlsById = new Map(controls.map((control) => [control.id, control]));
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  globalThis.scrollTo(0, 0);
});

async function settle() {
  for (let frame = 0; frame < 4; frame++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function Harness({ ownScroll }: { ownScroll: boolean }) {
  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Control | null>(null);
  useDocumentDetailPage({
    enabled: !ownScroll, controlId: selected?.id ?? null,
    scopeKey: 'test', listReady: true, onClose: () => setSelected(null),
  });
  return createElement('div', { style: ownScroll ? { height: 480, display: 'flex', flexDirection: 'column' } : undefined },
    createElement('div', { hidden: !ownScroll && selected !== null, style: ownScroll ? { minHeight: 0, display: 'flex', flexDirection: 'column', flex: 1 } : undefined },
      createElement('button', { onClick: () => setSelectMode(!selectMode) }, 'Auswahlmodus'),
      createElement(CatalogMobileList, {
        controls, controlsById, allControls: controls, hasOwnScrollArea: ownScroll,
        selectMode, checkedIds, onSelect: setSelected,
        onCheckedChange: (control, checked) => setCheckedIds((current) => {
          const next = new Set(current);
          if (checked) next.add(control.id); else next.delete(control.id);
          return next;
        }),
        onSelectionDone: () => setSelectMode(false),
      })),
    !ownScroll && selected && createElement('div', { 'data-control-detail-page': true },
      createElement('h1', { tabIndex: -1, 'data-control-detail-title': true }, selected.title),
      createElement('button', { onClick: () => setSelected(null) }, 'Zurück')));
}

function rows() {
  return [...host!.querySelectorAll<HTMLElement>('[data-control-row]')];
}

for (const ownScroll of [false, true]) {
  test(`begrenzt 1000 mobile Treffer mit ${ownScroll ? 'Listen' : 'Dokument'}scroll und erhält Fokus und Auswahl`, async () => {
    await page.viewport(ownScroll ? 900 : 390, 800);
    host = document.createElement('div');
    // Dokument-Offset wie durch Kopf und Werkzeugleiste in der App.
    if (!ownScroll) host.style.paddingTop = '140px';
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(createElement(Harness, { ownScroll })));
    await document.fonts.ready;
    await settle();

    expect(rows().length).toBeLessThan(40);
    const first = rows()[0];
    const scroller = first.closest('.catalog-mobile-reference-row')!.parentElement!;
    const scrollPosition = () => ownScroll ? scroller.scrollTop : globalThis.scrollY;
    const scrollTo = async (position: number) => {
      if (ownScroll) scroller.scrollTop = position;
      else globalThis.scrollTo(0, position);
      await settle();
    };
    const origin = scroller.getBoundingClientRect().top + scrollPosition();
    const pitch = rows()[1].getBoundingClientRect().top - first.getBoundingClientRect().top;
    expect(pitch).toBeGreaterThanOrEqual(44);
    for (const row of rows()) {
      expect(Math.abs(row.closest('.catalog-mobile-reference-row')!.getBoundingClientRect().height - pitch)).toBeLessThanOrEqual(1);
    }
    first.focus({ preventScroll: true });
    await settle();
    for (const position of [1234, 40000, 1000000]) {
      await scrollTo(position);
      expect(first).toBe(document.activeElement);
      expect(first.isConnected).toBe(true);
      const visible = rows();
      expect(visible.length).toBeLessThanOrEqual(Math.ceil((ownScroll ? scroller.clientHeight : innerHeight) / pitch) + 22);
      for (const row of visible) {
        const index = controls.findIndex((control) => control.id === row.dataset.controlRow);
        const expectedTop = origin + index * pitch - scrollPosition();
        expect(Math.abs(row.getBoundingClientRect().top - expectedTop)).toBeLessThanOrEqual(1);
      }
    }
    expect(rows().at(-1)!.dataset.controlRow).toBe(controls.at(-1)!.id);
    const last = rows().at(-1)!;
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(ownScroll ? scroller.getBoundingClientRect().bottom + 1 : innerHeight + 1);
    const beforeSelection = scrollPosition();
    (host.querySelector('button')!).click();
    await settle();
    expect(scrollPosition()).toBe(beforeSelection);
    const checkbox = host.querySelector<HTMLInputElement>(`input[aria-label="${controls.at(-1)!.id} auswählen"]`)!;
    checkbox.focus({ preventScroll: true });
    checkbox.click();
    await settle();
    expect(host.querySelector('output')!.textContent).toBe('1 ausgewählt');
    await scrollTo(1234);
    expect(document.activeElement).toBe(checkbox);
    expect(checkbox.checked).toBe(true);
    await scrollTo(1000000);
    if (!ownScroll) {
      const listPosition = scrollPosition();
      last.click();
      await settle();
      expect(document.activeElement).toBe(host.querySelector('h1'));
      expect(scrollPosition()).toBe(0);
      [...host.querySelectorAll('button')].find((button) => button.textContent === 'Zurück')!.click();
      await settle();
      expect(scrollPosition()).toBe(listPosition);
      expect(document.activeElement?.getAttribute('data-control-row')).toBe(controls.at(-1)!.id);
    }
  });
}
