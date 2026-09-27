import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { RefObject, UIEvent } from 'react';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

/**
 * Windowing für Listen mit einheitlicher Zeilenhöhe (GSPP-262).
 *
 * Gerendert werden nur die sichtbaren Zeilen plus Überhang; Platzhalter
 * halten Gesamthöhe und Scrollposition wie bei der vollständigen Liste. Die
 * `pinnedIndex`-Zeile bleibt immer gerendert, auch außerhalb des Fensters —
 * sonst verlöre die Roving-Tabindex-Zeile beim Wegscrollen Fokus und DOM-Knoten.
 */

export type RowWindowSlot =
  | { kind: 'row'; index: number }
  | { kind: 'spacer'; key: string; rowCount: number };

export interface RowWindowRange {
  rowCount: number;
  firstVisibleIndex: number;
  visibleRowCount: number;
  overscan: number;
  pinnedIndex: number;
}

export function computeRowSlots({
  rowCount,
  firstVisibleIndex,
  visibleRowCount,
  overscan,
  pinnedIndex,
}: RowWindowRange): RowWindowSlot[] {
  if (rowCount <= 0) return [];

  const first = Math.min(Math.max(firstVisibleIndex, 0), rowCount - 1);
  const start = Math.max(0, first - overscan);
  const end = Math.min(rowCount, first + visibleRowCount + overscan);
  const indices: number[] = [];
  for (let index = start; index < end; index++) indices.push(index);
  if (pinnedIndex >= 0 && pinnedIndex < rowCount && (pinnedIndex < start || pinnedIndex >= end)) {
    indices.push(pinnedIndex);
    indices.sort((a, b) => a - b);
  }

  const slots: RowWindowSlot[] = [];
  let next = 0;
  for (const index of indices) {
    if (index > next) {
      slots.push({ kind: 'spacer', key: `spacer-${next}`, rowCount: index - next });
    }
    slots.push({ kind: 'row', index });
    next = index + 1;
  }
  if (next < rowCount) {
    slots.push({ kind: 'spacer', key: `spacer-${next}`, rowCount: rowCount - next });
  }
  return slots;
}

/**
 * Zeilenabstand statt Zeilenhöhe: Bei `border-collapse` teilen sich
 * Nachbarzeilen ihren Rand. Die erste Zeile nach einem Platzhalter (oder am
 * Tabellenanfang) ist um einen halben Rand niedriger, also auch ihr Abstand zur
 * Folgezeile. Maßgeblich ist deshalb der Abstand zwischen der zweiten und
 * dritten Zeile eines zusammenhängenden Laufs; fehlt ein solcher Lauf, zählt
 * das erste Paar, zuletzt die Einzelhöhe.
 */
export function measureRowPitch(rows: ArrayLike<HTMLElement>, rowIndexAttribute: string): number {
  const indexOf = (i: number) => Number(rows[i].getAttribute(rowIndexAttribute));
  const topOf = (i: number) => rows[i].getBoundingClientRect().top;
  let pairPitch = 0;
  for (let i = 0; i + 1 < rows.length; i++) {
    if (indexOf(i + 1) !== indexOf(i) + 1) continue;
    if (i + 2 < rows.length && indexOf(i + 2) === indexOf(i) + 2) {
      const pitch = topOf(i + 2) - topOf(i + 1);
      if (pitch > 0) return pitch;
    }
    if (pairPitch === 0) pairPitch = Math.max(0, topOf(i + 1) - topOf(i));
  }
  if (pairPitch > 0) return pairPitch;
  return rows.length > 0 ? rows[0].getBoundingClientRect().height : 0;
}

export interface UseRowWindowOptions {
  rowCount: number;
  pinnedIndex: number;
  /** Startwert bis zur ersten Messung einer gerenderten Zeile. */
  estimatedRowHeight: number;
  overscan: number;
  /** Fensterhöhe in Zeilen, solange der Container keine Layouthöhe hat (jsdom, erster Render). */
  fallbackVisibleRowCount: number;
  /** Attribut, das jede gerenderte Zeile mit ihrem Listenindex trägt (z. B. `data-row-index`). */
  rowIndexAttribute: string;
}

export interface UseRowWindowResult {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  rowHeight: number;
  slots: RowWindowSlot[];
}

interface Viewport {
  scrollTop: number;
  height: number;
}

export function useRowWindow({
  rowCount,
  pinnedIndex,
  estimatedRowHeight,
  overscan,
  fallbackVisibleRowCount,
  rowIndexAttribute,
}: UseRowWindowOptions): UseRowWindowResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ scrollTop: 0, height: 0 });
  const [rowHeight, setRowHeight] = useState(estimatedRowHeight);

  const syncViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const next = { scrollTop: element.scrollTop, height: element.clientHeight };
    setViewport((current) =>
      current.scrollTop === next.scrollTop && current.height === next.height ? current : next,
    );
  }, []);

  // Nach jedem Render abgleichen: Schrumpft die Liste (Filter), klemmt der
  // Browser scrollTop, ohne dass React davon zwingend ein Scroll-Event sieht.
  const measure = useCallback(() => {
    syncViewport();
    const rows = scrollRef.current?.querySelectorAll<HTMLElement>(`[${rowIndexAttribute}]`);
    const measured = rows ? measureRowPitch(rows, rowIndexAttribute) : 0;
    if (measured > 0) setRowHeight((current) => (current === measured ? current : measured));
  }, [rowIndexAttribute, syncViewport]);

  useLayoutEffect(() => {
    measure();
  });

  // Der Scrollcontainer existiert erst mit der ersten Zeile (leere Liste
  // rendert einen Hinweis statt der Tabelle); danach neu beobachten.
  const hasRows = rowCount > 0;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [syncViewport, hasRows]);

  useGlobalEventListener(
    'window',
    'resize',
    syncViewport,
    typeof ResizeObserver === 'undefined',
  );

  const visibleRowCount = viewport.height > 0
    ? Math.ceil(viewport.height / rowHeight) + 1
    : fallbackVisibleRowCount;

  const slots = computeRowSlots({
    rowCount,
    firstVisibleIndex: Math.floor(viewport.scrollTop / rowHeight),
    visibleRowCount,
    overscan,
    pinnedIndex,
  });

  return { scrollRef, onScroll: syncViewport, rowHeight, slots };
}
