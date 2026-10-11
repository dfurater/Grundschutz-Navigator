import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

/** Abstand der Sektionenliste vom Inhaltsanfang des äußeren Scrollbereichs. */
function sectionsOffset(body: HTMLElement, sections: HTMLElement): number {
  return sections.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
}

interface ScrollAnchor {
  /** Versatz in der Sektionenliste am oberen Rand des aktiven Scrollbereichs. */
  readonly anchor: number;
  /** Höhe des aktiven Scrollbereichs, als der Versatz gelesen wurde. */
  readonly height: number;
}

function readScrollAnchor(scrollSummary: boolean, body: HTMLElement | null, sections: HTMLElement): ScrollAnchor {
  if (scrollSummary && body) return { anchor: body.scrollTop - sectionsOffset(body, sections), height: body.clientHeight };
  return { anchor: sections.scrollTop, height: sections.clientHeight };
}

/** Hält im mobilen Sheet mindestens eine vollständige Filterzeile erreichbar. */
export function useAdaptiveFilterHeader(adaptiveHeader: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollSummary, setScrollSummary] = useState(false);
  // Zuletzt bei unveränderter Höhe gelesene Position. Eine Größenänderung begrenzt
  // `scrollTop` schon vor der Messung; dieser Wert stammt von davor.
  const savedAnchorRef = useRef<ScrollAnchor>({ anchor: 0, height: 0 });
  // Für den neuen Scrollbereich vorgemerkte Position nach einem Moduswechsel.
  const scrollAnchorRef = useRef<number | null>(null);
  const measureRef = useRef<(() => void) | null>(null);
  // An beiden Scrollbereichen; liest nur bei unveränderter Höhe, also nicht die Begrenzung einer Größenänderung.
  const onScroll = useCallback(() => {
    const sections = sectionsRef.current;
    if (!sections) return;
    const read = readScrollAnchor(headingRef.current?.dataset.scrollSummary === 'true', bodyRef.current, sections);
    if (read.height === savedAnchorRef.current.height) savedAnchorRef.current = read;
  }, []);
  useGlobalEventListener('window', 'resize', () => measureRef.current?.(), adaptiveHeader && typeof ResizeObserver === 'undefined');

  useLayoutEffect(() => {
    if (!adaptiveHeader) return;
    const form = formRef.current;
    const heading = headingRef.current;
    const summary = summaryRef.current;
    const sections = sectionsRef.current;
    if (!form || !heading || !summary || !sections) return;
    const isScrollSummary = () => heading.dataset.scrollSummary === 'true';
    savedAnchorRef.current = readScrollAnchor(isScrollSummary(), bodyRef.current, sections);
    const measure = () => {
      const rows = sections.querySelectorAll<HTMLElement>('label, button');
      const rowHeight = Math.max(0, ...[...rows].map((row) => row.getBoundingClientRect().height));
      // Beide Modi werden gegen den festen Kopfbedarf verglichen. Die zusätzliche
      // Unterlinie des kompakten Titelkopfs darf keine Umschalt-Oszillation auslösen.
      const headingHeight = heading.getBoundingClientRect().height - (heading.dataset.scrollSummary === 'true' ? 1 : 0);
      const available = form.clientHeight - headingHeight - summary.getBoundingClientRect().height;
      const current = isScrollSummary();
      const next = available < rowHeight;
      // Der Wechsel verschiebt das Scrollen zwischen äußerem und innerem Bereich;
      // das alte Element verliert dabei seine Position.
      if (next === current) savedAnchorRef.current = readScrollAnchor(current, bodyRef.current, sections);
      else scrollAnchorRef.current = savedAnchorRef.current.anchor;
      setScrollSummary(next);
    };
    measure();
    measureRef.current = measure;
    // Aufklappen mountet Zeilen, während die begrenzte Listenbox gleich hoch bleibt.
    const contentObserver = new MutationObserver(measure);
    contentObserver.observe(sections, { childList: true, subtree: true });
    if (typeof ResizeObserver === 'undefined') return () => { contentObserver.disconnect(); measureRef.current = null; };
    const observer = new ResizeObserver(measure);
    [form, heading, summary, sections].forEach((element) => observer.observe(element));
    return () => { observer.disconnect(); contentObserver.disconnect(); measureRef.current = null; };
  }, [adaptiveHeader]);

  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    scrollAnchorRef.current = null;
    const body = bodyRef.current;
    const sections = sectionsRef.current;
    if (anchor === null || !body || !sections) return;
    if (scrollSummary) body.scrollTop = anchor > 0 ? anchor + sectionsOffset(body, sections) : 0;
    else sections.scrollTop = Math.max(0, anchor);
    savedAnchorRef.current = readScrollAnchor(scrollSummary, body, sections);
  }, [scrollSummary]);

  return { formRef, headingRef, summaryRef, sectionsRef, bodyRef, scrollSummary, onScroll };
}
