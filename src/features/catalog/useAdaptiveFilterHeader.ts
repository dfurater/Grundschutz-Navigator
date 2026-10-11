import { useLayoutEffect, useRef, useState } from 'react';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

/** Hält im mobilen Sheet mindestens eine vollständige Filterzeile erreichbar. */
export function useAdaptiveFilterHeader(adaptiveHeader: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const [scrollSummary, setScrollSummary] = useState(false);
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
      setScrollSummary(available < rowHeight);
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

  return { formRef, headingRef, summaryRef, sectionsRef, scrollSummary };
}
