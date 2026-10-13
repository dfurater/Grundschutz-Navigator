import type { ReactNode } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { OWN_SCROLL_AREA_QUERY } from '@/hooks/breakpointQueries';
import { useOverlayScrollbars } from '@/hooks/useOverlayScrollbars';

/**
 * Scrollfläche für Seiteninhalte innerhalb von `<main>`. Der globale Footer
 * liegt separat in derselben rechten Layoutspalte der AppShell.
 */
export function PageScroll({ children }: Readonly<{ children: ReactNode }>) {
  const scrollAreaRef = useOverlayScrollbars<HTMLDivElement>(useMediaQuery(OWN_SCROLL_AREA_QUERY));
  return (
    <div ref={scrollAreaRef} className="flex-1 md:overflow-y-auto pb-safe desktop:pb-0">
      {children}
    </div>
  );
}
