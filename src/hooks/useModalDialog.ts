import { useLayoutEffect } from 'react';

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
}

/** Hält Tab und Shift+Tab im Dialog, auch über beide Enden hinweg. */
function wrapTabKey(el: HTMLElement) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(el);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

// Stapel offener modaler Ebenen (GSPP-503). Eine Ebene ist das direkte Kind
// von `body`, das den Dialog enthält — bei `ModalPortal` dessen Hülle mit
// Abdunklung und Dialog. Nur die oberste Ebene bleibt bedienbar; alle anderen
// Kinder von `body` (App-Wurzel `#root` und tiefere Ebenen) werden `inert`.
// Entfernt wird nur ein `inert`, das diese Isolation selbst gesetzt hat.
//
// Jede Ebene merkt sich ihr Rückkehrziel. Überlappende Dialoge, etwa ein Sheet
// und das Detail-Overlay zwischen `md` und `lg`, dürfen in beliebiger
// Reihenfolge enden: Schließt eine Ebene unter einer anderen, erbt die Ebene
// darüber deren Rückkehrziel, falls ihr eigenes in der schließenden Ebene lag.
interface ModalLayer {
  readonly element: HTMLElement;
  returnTo: HTMLElement | null;
}

const layers: ModalLayer[] = [];
const isolatedByModal = new Set<Element>();

function layerElementOf(el: HTMLElement): HTMLElement {
  let layer = el;
  while (layer.parentElement && layer.parentElement !== document.body) {
    layer = layer.parentElement;
  }
  return layer;
}

function syncIsolation(): void {
  for (const el of isolatedByModal) el.removeAttribute('inert');
  isolatedByModal.clear();
  const top = layers.at(-1);
  if (!top) return;
  for (const child of Array.from(document.body.children)) {
    if (child === top.element || child.hasAttribute('inert')) continue;
    child.setAttribute('inert', '');
    isolatedByModal.add(child);
  }
}

function openLayer(dialog: HTMLElement): ModalLayer {
  const layer: ModalLayer = {
    element: layerElementOf(dialog),
    returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  };
  layers.push(layer);
  syncIsolation();
  const firstFocusable = getFocusable(dialog)[0];
  if (firstFocusable && !dialog.contains(document.activeElement)) {
    firstFocusable.focus();
  }
  return layer;
}

function closeLayer(layer: ModalLayer): void {
  const index = layers.indexOf(layer);
  if (index === -1) return;
  const above = layers[index + 1];
  if (above && (!above.returnTo || layer.element.contains(above.returnTo))) {
    above.returnTo = layer.returnTo;
  }
  layers.splice(index, 1);
  // Erst die Isolation aufheben, dann den Fokus setzen: Ein Element in einem
  // inerten Teilbaum nimmt keinen Fokus an.
  syncIsolation();
  if (above) return;
  // Zurückgegeben wird nur ein verlorener Fokus (im Dialog oder auf `body`).
  // Hat die neue Ansicht ihn schon gesetzt, etwa die mobile Detailseite nach
  // einem Breitenwechsel, bleibt er dort.
  const active = document.activeElement;
  const focusLost = !active || active === document.body || layer.element.contains(active);
  if (focusLost && layer.returnTo?.isConnected) layer.returnTo.focus();
}

/** Elternknoten modaler Ebenen: `body`, also neben `#root` (`ModalPortal`). */
export function useModalLayerTarget(): HTMLElement {
  return document.body;
}

/**
 * Modaler Lebenszyklus eines Dialogs (GSPP-503): Fokusfalle, Isolation des
 * Hintergrunds per `inert` und Fokus-Rückkehr. Der Dialog muss außerhalb von
 * `#root` hängen (`ModalPortal`), sonst würde er mit dem Hintergrund inert.
 *
 * Läuft als Layout-Effekt: Das Ende der Isolation fällt so in die
 * Mutationsphase, vor die Layout-Effekte einer nachfolgenden Ansicht, die
 * selbst den Fokus setzen (`useDocumentDetailPage`).
 */
export function useModalDialog(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const handleKeyDown = wrapTabKey(dialog);
    dialog.addEventListener('keydown', handleKeyDown);
    const layer = openLayer(dialog);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      closeLayer(layer);
    };
  }, [active, ref]);
}
