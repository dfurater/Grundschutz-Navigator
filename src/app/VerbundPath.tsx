import { useMemo } from 'react';
import { Link, useMatch } from 'react-router';
import { SCOPE_ROUTE_PATTERN, buildScopeUrl, buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { ScopeSwitcher, type ScopeSwitcherItem } from '@/components/ScopeSwitcher';
import { useWorkspace } from '@/hooks/useWorkspace';

const PATH_LINK = 'min-h-11 items-center rounded px-2 text-[var(--header-text-muted)] transition-colors hover:text-[var(--header-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)]';
const SEPARATOR = 'hidden text-[var(--header-text-subtle)] xl:inline';

/** Lokaler Verbundpfad. Die Verbundwahl bleibt innerhalb derselben Zuordnung. */
export function VerbundPath({ verbundId }: Readonly<{ verbundId: string | null }>) {
  const { verbuende, scopes } = useWorkspace();
  const routeScopeId = useMatch(SCOPE_ROUTE_PATTERN)?.params.scopeId;
  const member = verbuende?.find(row => row.verbundId === verbundId);
  const scopeId = routeScopeId ?? member?.scopeId;
  const scope = scopes?.find(entry => entry.scopeId === scopeId);
  const items = useMemo<readonly ScopeSwitcherItem[]>(
    () => member ? (verbuende ?? []).filter(row => row.scopeId === member.scopeId)
      .map(row => ({ key: row.verbundId, title: row.name, href: buildVerbundUrl(row.verbundId) })) : [],
    [verbuende, member],
  );
  return (
    <nav aria-label="Pfad" className="flex min-w-0 items-center gap-1 text-sm">
      <Link
        to={buildWorkspaceIndexUrl()}
        className={`hidden whitespace-nowrap xl:flex ${PATH_LINK}`}
      >
        Arbeitsbereich
      </Link>
      {scope && (
        <>
          <span aria-hidden="true" className={SEPARATOR}>/</span>
          {member ? (
            <Link to={buildScopeUrl(scope.scopeId)} className={`hidden min-w-0 xl:flex ${PATH_LINK}`}>
              <span className="line-clamp-2 min-w-0 max-w-64 break-words">{scope.name}</span>
            </Link>
          ) : <span aria-current="page" className="line-clamp-2 max-w-64 break-words px-2 font-semibold text-[var(--header-text)]">{scope.name}</span>}
        </>
      )}
      {member && (
        <>
          <span aria-hidden="true" className={SEPARATOR}>/</span>
          <ScopeSwitcher label="Informationsverbund" items={items} activeKey={member.verbundId} tone="header" />
        </>
      )}
    </nav>
  );
}
