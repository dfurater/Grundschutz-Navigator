import { useMemo } from 'react';
import { Link } from 'react-router';
import { buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { ScopeSwitcher, type ScopeSwitcherItem } from '@/components/ScopeSwitcher';
import { useWorkspace } from '@/hooks/useWorkspace';

/**
 * Pfad „Informationsverbünde / ‹Verbundname›“ rechts in der Kopfzeile (GSPP-307,
 * Bild 2); unter `xl` bleibt nur die Verbundwahl, damit die Suche Platz behält. Die Verbundwahl navigiert nur über die `verbundId`; der Name steht
 * ausschließlich im Seiteninhalt (ADR-11 §3).
 */
export function VerbundPath({ verbundId }: Readonly<{ verbundId: string | null }>) {
  const { verbuende } = useWorkspace();
  const items = useMemo<readonly ScopeSwitcherItem[]>(
    () => (verbuende ?? []).map((verbund) => ({ key: verbund.verbundId, title: verbund.name, href: buildVerbundUrl(verbund.verbundId) })),
    [verbuende],
  );
  const known = items.some((item) => item.key === verbundId);
  return (
    <nav aria-label="Pfad" className="flex min-w-0 items-center gap-1 text-sm">
      <Link
        to={buildWorkspaceIndexUrl()}
        className="hidden min-h-11 items-center whitespace-nowrap rounded px-2 xl:flex text-[var(--header-text-muted)] transition-colors hover:text-[var(--header-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)]"
      >
        Informationsverbünde
      </Link>
      {verbundId !== null && known && (
        <>
          <span aria-hidden="true" className="hidden text-[var(--header-text-subtle)] xl:inline">/</span>
          <ScopeSwitcher label="Informationsverbund" items={items} activeKey={verbundId} tone="header" />
        </>
      )}
    </nav>
  );
}
