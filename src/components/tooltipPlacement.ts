/** Abstand des Tooltips zum Rand des sichtbaren Bereichs in px. */
const EDGE_GAP = 8;

/** Scrollbares Detail-Panel: Innerhalb davon begrenzt sich ein Tooltip zusätzlich auf dessen sichtbaren Teil. */
const VISIBLE_AREA_SELECTOR = '[data-control-detail-scroll]';

/**
 * Hält einen geöffneten Tooltip im sichtbaren Teil des scrollbaren
 * Detail-Panels und des Viewports. Gemessen wird immer die natürliche Lage:
 * Die eigene Begrenzung wird im selben Durchlauf zurückgenommen, ohne dass
 * dazwischen gemalt wird. Reicht der Platz unter dem Auslöser nicht, klappt
 * der Tooltip über ihn, statt ihn beim Einklemmen am unteren Rand zu
 * verdecken. Liegt der Auslöser ganz außerhalb des sichtbaren Bereichs, bleibt
 * der Tooltip an ihm und scrollt mit ihm hinaus, statt allein am Panelrand zu
 * hängen.
 */
function clampToVisibleArea(tooltip: HTMLElement): void {
  const { style } = tooltip;
  style.transform = '';
  style.maxWidth = '';
  style.maxHeight = '';
  const panel = tooltip.closest(VISIBLE_AREA_SELECTOR)?.getBoundingClientRect();
  const visibleLeft = Math.max(0, panel?.left ?? 0);
  const visibleRight = Math.min(globalThis.innerWidth, panel?.right ?? globalThis.innerWidth);
  const visibleTop = Math.max(0, panel?.top ?? 0);
  const visibleBottom = Math.min(globalThis.innerHeight, panel?.bottom ?? globalThis.innerHeight);
  const trigger = tooltip.parentElement?.getBoundingClientRect();
  if (
    trigger !== undefined
    && (trigger.bottom <= visibleTop || trigger.top >= visibleBottom
      || trigger.right <= visibleLeft || trigger.left >= visibleRight)
  ) {
    return;
  }
  const minLeft = visibleLeft + EDGE_GAP;
  const maxRight = visibleRight - EDGE_GAP;
  const minTop = visibleTop + EDGE_GAP;
  const maxBottom = visibleBottom - EDGE_GAP;
  const availableWidth = Math.max(0, maxRight - minLeft);
  const availableHeight = Math.max(0, maxBottom - minTop);
  let box = tooltip.getBoundingClientRect();
  if (box.width > availableWidth) {
    style.maxWidth = `${availableWidth}px`;
    // Schmaler bricht der Text um: Höhe und Umklappen rechnen mit der neuen Box.
    box = tooltip.getBoundingClientRect();
  }
  const width = Math.min(box.width, availableWidth);
  const height = Math.min(box.height, availableHeight);
  let preferredTop = box.top;
  if (trigger !== undefined && box.bottom > maxBottom) {
    const aboveTop = trigger.top - Math.max(0, box.top - trigger.bottom) - box.height;
    if (aboveTop >= minTop) {
      preferredTop = aboveTop;
    }
  }
  const left = Math.max(minLeft, Math.min(box.left, maxRight - width));
  const top = Math.max(minTop, Math.min(preferredTop, maxBottom - height));
  if (box.height > availableHeight) {
    style.maxHeight = `${availableHeight}px`;
  }
  style.transform = `translate(${left - box.left}px, ${top - box.top}px)`;
}

/**
 * Begrenzt einen geöffneten Tooltip sofort und danach bei jeder Änderung, die
 * seinen Auslöser oder den sichtbaren Bereich verschiebt: Scrollen (auch des
 * Panels, daher Capture-Phase) und Größenänderungen von Fenster und Panel. Das
 * Panel ändert seine Breite auch ohne das Fenster, etwa beim Ziehen am Rand;
 * das Ziehen nimmt den Fokus nicht, ein per Tastatur geöffneter Tooltip bleibt
 * also offen. Gemessen wird direkt am Element statt über React-State: kein
 * Render je Scroll. Liefert das Aufräumen.
 */
export function keepInVisibleArea(tooltip: HTMLElement): () => void {
  const reclamp = () => {
    clampToVisibleArea(tooltip);
  };
  reclamp();
  const panel = tooltip.closest(VISIBLE_AREA_SELECTOR);
  let panelObserver: ResizeObserver | undefined;
  if (panel !== null && typeof ResizeObserver !== 'undefined') {
    panelObserver = new ResizeObserver(reclamp);
    panelObserver.observe(panel);
  }
  // eslint-disable-next-line no-restricted-syntax -- Scroll-/Resize-Listener leben und sterben mit dieser Begrenzung (single owner); `useGlobalEventListener` kennt keine Capture-Phase.
  globalThis.document.addEventListener('scroll', reclamp, { capture: true, passive: true });
  // eslint-disable-next-line no-restricted-syntax -- siehe oben, dieselbe Begrenzung.
  globalThis.addEventListener('resize', reclamp);
  return () => {
    panelObserver?.disconnect();
    // eslint-disable-next-line no-restricted-syntax -- Cleanup der obigen Listener (single owner).
    globalThis.document.removeEventListener('scroll', reclamp, { capture: true });
    // eslint-disable-next-line no-restricted-syntax -- siehe oben, dieselbe Begrenzung.
    globalThis.removeEventListener('resize', reclamp);
  };
}
