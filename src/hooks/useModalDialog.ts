import { useEffect } from 'react';

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hält Tab und Shift+Tab im Dialog, setzt den Fokus beim Öffnen auf die
 * erste bedienbare Aktion und gibt ihn beim Schließen an das zuvor
 * fokussierte Element zurück, sofern es noch im Dokument hängt.
 */
function trapFocus(el: HTMLElement): () => void {
  const previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const getFocusable = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
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

  el.addEventListener('keydown', handleKeyDown);
  const firstFocusable = getFocusable()[0];
  if (firstFocusable && !el.contains(document.activeElement)) {
    firstFocusable.focus();
  }
  return () => {
    el.removeEventListener('keydown', handleKeyDown);
    if (previouslyFocused?.isConnected) {
      previouslyFocused.focus();
    }
  };
}

// Stapel offener modaler Ebenen (GSPP-503). Eine Ebene ist das direkte Kind
// von `body`, das den Dialog enthält — bei `ModalPortal` dessen Hülle mit
// Abdunklung und Dialog. Nur die oberste Ebene bleibt bedienbar; alle anderen
// Kinder von `body` (App-Wurzel `#root` und tiefere Ebenen) werden `inert`.
// Überlappende Dialoge, etwa ein Sheet und das Detail-Overlay zwischen `md`
// und `lg`, dürfen so in beliebiger Reihenfolge enden. Entfernt wird nur ein
// `inert`, das diese Isolation selbst gesetzt hat.
const layers: HTMLElement[] = [];
const isolatedByModal = new Set<Element>();

function layerOf(el: HTMLElement): HTMLElement {
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
    if (child === top || child.hasAttribute('inert')) continue;
    child.setAttribute('inert', '');
    isolatedByModal.add(child);
  }
}

function isolate(el: HTMLElement): () => void {
  const layer = layerOf(el);
  layers.push(layer);
  syncIsolation();
  return () => {
    const index = layers.lastIndexOf(layer);
    if (index !== -1) layers.splice(index, 1);
    syncIsolation();
  };
}

/** Elternknoten modaler Ebenen: `body`, also neben `#root` (`ModalPortal`). */
export function useModalLayerTarget(): HTMLElement {
  return document.body;
}

/**
 * Modaler Lebenszyklus eines Dialogs (GSPP-503): Fokusfalle und Isolation
 * des Hintergrunds per `inert`. Der Dialog muss außerhalb von `#root`
 * hängen (`ModalPortal`), sonst würde er mit dem Hintergrund inert.
 *
 * Reihenfolge: Die Fokusfalle merkt sich das Rückkehrziel, bevor der
 * Hintergrund inert wird; beim Schließen endet die Isolation, bevor der
 * Fokus zurückkehrt — ein Element in einem inerten Teilbaum nimmt keinen
 * Fokus an.
 */
export function useModalDialog(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const releaseFocus = trapFocus(ref.current);
    const releaseIsolation = isolate(ref.current);
    return () => {
      releaseIsolation();
      releaseFocus();
    };
  }, [active, ref]);
}
