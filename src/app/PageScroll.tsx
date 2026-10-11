import type { ReactNode } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { OWN_SCROLL_AREA_QUERY } from '@/hooks/breakpointQueries';
import { useOverlayScrollbars } from '@/hooks/useOverlayScrollbars';

/**
 * Scrollfläche für Seiteninhalte. Der Footer liegt auf allen Routen außerhalb,
 * als direktes Kind von `<main>`.
 */
export function PageScroll({ children }: Readonly<{ children: ReactNode }>) {
  const scrollAreaRef = useOverlayScrollbars<HTMLDivElement>(useMediaQuery(OWN_SCROLL_AREA_QUERY));
  return (
    <div ref={scrollAreaRef} className="flex-1 md:overflow-y-auto pb-safe lg:pb-0">
      {children}
    </div>
  );
}
