import { useLayoutEffect, useRef } from 'react';
import { useGlobalEventListener } from './useGlobalEventListener';

/** Überschrift des geöffneten Details: Fokusziel beim Öffnen und beim Wechsel. */
export const DETAIL_TITLE_SELECTOR = '[data-control-detail-title]';
/** Bereichsüberschrift der Liste: Rückkehrziel, wenn die Zeile fehlt. */
export const SCOPE_HEADING_SELECTOR = '[data-catalog-scope-heading]';

/** Zeile einer Kontrolle in der mobilen Liste. */
export function controlRowSelector(controlId: string) {
  return `[data-control-row="${CSS.escape(controlId)}"]`;
}

export interface UseDocumentDetailPageOptions {
  /** Das Detail erscheint als Seite im Dokumentfluss (unterhalb `md`). */
  readonly enabled: boolean;
  /** Geöffnete Kontrolle oder `null`, solange die Liste sichtbar ist. */
  readonly controlId: string | null;
  readonly onClose: () => void;
}

/**
 * Scroll- und Fokusvertrag der mobilen Seitenansicht (GSPP-447): Das Detail
 * ersetzt die Liste im Dokumentfluss, damit das Dokument scrollt und mobile
 * Browser ihre Leiste einklappen können.
 *
 * - Solange die Liste sichtbar ist, merkt sich der Hook ihre Scrollposition.
 *   Das Abo endet im Commit, der das Detail zeigt — vor dem Scroll-Ereignis,
 *   mit dem der Browser die kürzere Seite nachführt.
 * - Öffnen und Wechsel der Kontrolle beginnen oben; der Fokus geht auf die
 *   Überschrift des Details.
 * - Schließen (Zurück-Button, Escape, Browser-Zurück) stellt die gemerkte
 *   Position wieder her und fokussiert die Zeile der geschlossenen Kontrolle,
 *   ersatzweise die Bereichsüberschrift. Das geschieht im Layout-Effekt,
 *   bevor die Liste gemalt wird.
 */
export function useDocumentDetailPage({ enabled, controlId, onClose }: UseDocumentDetailPageOptions): void {
  const listScrollYRef = useRef(0);
  const shownControlIdRef = useRef<string | null>(null);
  const listVisible = enabled && controlId === null;

  useLayoutEffect(() => {
    if (!enabled) {
      shownControlIdRef.current = null;
      return;
    }
    if (controlId !== null) {
      shownControlIdRef.current = controlId;
      globalThis.scrollTo(0, 0);
      document.querySelector<HTMLElement>(DETAIL_TITLE_SELECTOR)?.focus({ preventScroll: true });
      return;
    }
    const closedControlId = shownControlIdRef.current;
    if (closedControlId === null) return;
    shownControlIdRef.current = null;
    globalThis.scrollTo(0, listScrollYRef.current);
    const returnTarget = document.querySelector<HTMLElement>(controlRowSelector(closedControlId))
      ?? document.querySelector<HTMLElement>(SCOPE_HEADING_SELECTOR);
    returnTarget?.focus({ preventScroll: true });
  }, [enabled, controlId]);

  useLayoutEffect(() => {
    if (listVisible) listScrollYRef.current = globalThis.scrollY;
  }, [listVisible]);
  useGlobalEventListener('window', 'scroll', () => {
    listScrollYRef.current = globalThis.scrollY;
  }, listVisible);

  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') onClose();
  }, enabled && controlId !== null);
}
