import { Link, useParams } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { buildWorkspaceIndexUrl } from '@/app/routes';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { VerbundView } from '@/state/workspaceVerbundView';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';

export type RoutedVerbund =
  | { readonly status: 'ready'; readonly view: VerbundView }
  | { readonly status: 'loading' | 'not-found' | 'failed' };

/**
 * Die Ansicht genau des Verbunds aus der Route. Eine Ansicht zu einem anderen
 * Verbund — etwa während eines Routenwechsels — gilt als ladend, nie als Treffer.
 */
export function useRoutedVerbund(): RoutedVerbund {
  const { verbundId } = useParams();
  const { verbund } = useWorkspace();
  if (!verbund || verbund.verbundId !== verbundId) return { status: 'loading' };
  if (verbund.status === 'ready' && verbund.view) return { status: 'ready', view: verbund.view };
  return { status: verbund.status === 'ready' ? 'loading' : verbund.status };
}

const STATES = {
  loading: { title: PAGE_TITLES.verbund, heading: 'Informationsverbund wird geladen…', text: undefined },
  'not-found': {
    title: PAGE_TITLES.verbundNotFound,
    heading: PAGE_TITLES.verbundNotFound,
    text: 'Unter dieser Adresse ist in diesem Browser kein Informationsverbund gespeichert.',
  },
  'document-not-found': {
    title: PAGE_TITLES.workspaceDocumentNotFound,
    heading: PAGE_TITLES.workspaceDocumentNotFound,
    text: 'Dieser Informationsverbund enthält unter dieser Adresse kein Dokument.',
  },
  failed: {
    title: PAGE_TITLES.verbund,
    heading: 'Informationsverbund nicht lesbar',
    text: 'Der lokale Speicher konnte nicht gelesen werden.',
  },
  'scope-loading': { title: PAGE_TITLES.scope, heading: 'Anwendungsbereich wird geladen…', text: undefined },
  'scope-not-found': {
    title: PAGE_TITLES.scopeNotFound,
    heading: PAGE_TITLES.scopeNotFound,
    text: 'Unter dieser Adresse ist in diesem Browser kein Anwendungsbereich gespeichert.',
  },
  'scope-failed': {
    title: PAGE_TITLES.scope,
    heading: 'Anwendungsbereich nicht lesbar',
    text: 'Der lokale Speicher konnte nicht gelesen werden.',
  },
} as const;

/** Lade-, Nicht-gefunden- und Fehlerzustand im Bereich; fällt nie auf einen anderen Verbund oder Anwendungsbereich zurück. */
export function WorkspaceStatePage({ state }: Readonly<{ state: keyof typeof STATES }>) {
  const { title, heading, text } = STATES[state];
  return (
    <>
      <PageTitle title={title} />
      <div className="space-y-4 p-4" data-workspace-state={state}>
        {text === undefined ? (
          <>
            <h1 className="sr-only">{title}</h1>
            <output className="block text-sm text-[var(--color-text-secondary)]">{heading}</output>
          </>
        ) : (
          <>
            <h1 className="type-page-title">{heading}</h1>
            <WorkspaceNotices />
            <p className="text-sm text-[var(--color-text-secondary)]">
              {text}{' '}
              <Link to={buildWorkspaceIndexUrl()} className={`rounded catalog-prose-link ${FOCUS_RING}`}>
                Zum Arbeitsbereich
              </Link>
            </p>
          </>
        )}
      </div>
    </>
  );
}
