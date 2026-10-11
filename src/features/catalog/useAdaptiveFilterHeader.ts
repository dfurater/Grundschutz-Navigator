import { useLayoutEffect, useRef, useState } from 'react';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

/** Abstand der Sektionenliste vom Inhaltsanfang des äußeren Scrollbereichs. */
function sectionsOffset(body: HTMLElement, sections: HTMLElement): number {
  return sections.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
}

/** Hält im mobilen Sheet mindestens eine vollständige Filterzeile erreichbar. */
export function useAdaptiveFilterHeader(adaptiveHeader: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollSummary, setScrollSummary] = useState(false);
  // Listenversatz am oberen Rand des alten Scrollbereichs, festgehalten vor einem Moduswechsel.
  const scrollAnchorRef = useRef<number | null>(null);
  const measureRef = useRef<(() => void) | null>(null);
  useGlobalEventListener('window', 'resize', () => measureRef.current?.(), adaptiveHeader && typeof ResizeObserver === 'undefined');

  useLayoutEffect(() => {
    if (!adaptiveHeader) return;
    const form = formRef.current;
    const heading = headingRef.current;
    const summary = summaryRef.current;
    const sections = sectionsRef.current;
    if (!form || !heading || !summary || !sections) return;
    const measure = () => {
      const rows = sections.querySelectorAll<HTMLElement>('label, button');
      const rowHeight = Math.max(0, ...[...rows].map((row) => row.getBoundingClientRect().height));
      // Beide Modi werden gegen den festen Kopfbedarf verglichen. Die zusätzliche
      // Unterlinie des kompakten Titelkopfs darf keine Umschalt-Oszillation auslösen.
      const headingHeight = heading.getBoundingClientRect().height - (heading.dataset.scrollSummary === 'true' ? 1 : 0);
      const available = form.clientHeight - headingHeight - summary.getBoundingClientRect().height;
      const current = heading.dataset.scrollSummary === 'true';
      const next = available < rowHeight;
      // Der Wechsel verschiebt das Scrollen zwischen äußerem und innerem Bereich;
      // das alte Element verliert dabei seine Position.
      const body = bodyRef.current;
      if (next !== current && body) {
        scrollAnchorRef.current = current ? body.scrollTop - sectionsOffset(body, sections) : sections.scrollTop;
      }
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
  }, [scrollSummary]);

  return { formRef, headingRef, summaryRef, sectionsRef, bodyRef, scrollSummary };
}
