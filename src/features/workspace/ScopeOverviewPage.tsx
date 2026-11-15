import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { buildScopeUrl, buildVerbundUrl, buildWorkspaceIndexUrl, isLocalIdentity } from '@/app/routes';
import { Button } from '@/components/Button';
import type { WorkspaceScope } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { FOCUS_RING, OriginLabel } from '@/features/workspace/DocumentMarks';
import { relativeTime } from '@/features/workspace/StationCards';
import { NameForm, SaveFailed, SectionHead } from '@/features/workspace/WorkspaceForms';
import { usePendingWrite } from '@/features/workspace/usePendingWrite';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { WorkspaceStatePage } from '@/features/workspace/WorkspaceStatePage';
import { NEW_SCOPE_DRAFT } from '@/state/workspaceRestore';

/** Ansicht „Anwendungsbereich anlegen“ (GSPP-669, Ansicht 7): erst nach bestätigtem Speichern öffnet sich die Übersicht. */
export function ScopeCreateView({ writable, onCancel }: Readonly<{ writable: boolean; onCancel: () => void }>) {
  const { createScope, scopeDrafts, pendingScopeWrite } = useWorkspace();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // Ein Ergebnis aus einer bereits verlassenen Ansicht navigiert nicht mehr.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    heading.current?.focus();
    return () => { mounted.current = false; };
  }, []);
  const busy = usePendingWrite(() => pendingScopeWrite(NEW_SCOPE_DRAFT), (result) => {
    setFailed(!result.ok);
    if (result.ok) void navigate(buildScopeUrl(result.value.scopeId));
  });
  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 desktop:px-7 desktop:py-6">
      <h1 ref={heading} tabIndex={-1} className="type-page-title focus:outline-none">Anwendungsbereich anlegen</h1>
      <WorkspaceNotices />
      <section aria-labelledby="scope-anlegen" className="space-y-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-4">
        <h2 id="scope-anlegen" className="sr-only">Name</h2>
        <NameForm
          label="Name des Anwendungsbereichs"
          submitLabel="Anlegen"
          initial={scopeDrafts.get(NEW_SCOPE_DRAFT)}
          disabled={!writable}
          busy={busy}
          onChange={(name) => scopeDrafts.set(NEW_SCOPE_DRAFT, name)}
          onSubmit={async (name) => {
            const result = await createScope(name);
            if (result.ok && scopeDrafts.get(NEW_SCOPE_DRAFT)?.trim() === name) scopeDrafts.delete(NEW_SCOPE_DRAFT);
            if (!mounted.current) return result.ok;
            setFailed(!result.ok);
            if (result.ok) void navigate(buildScopeUrl(result.value.scopeId));
            return result.ok;
          }}
          onCancel={() => {
            scopeDrafts.delete(NEW_SCOPE_DRAFT);
            onCancel();
          }}
        />
        {failed && <SaveFailed />}
      </section>
    </div>
  );
}

/** Kopf des Anwendungsbereichs (GSPP-669, Ansichten 3 und 8): Name, Umbenennen, Herkunft und Speicherstand. */
function ScopeHeader({ scope, now }: Readonly<{ scope: WorkspaceScope; now: number }>) {
  // Eine offene Umbenennung überdauert Routen- und Bereichswechsel (`scopeDrafts` im Provider).
  const { writable, renameScope, scopeDrafts, pendingScopeWrite } = useWorkspace();
  const [renaming, setRenaming] = useState(() => scopeDrafts.has(scope.scopeId));
  const [failed, setFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  // Ansichtswechsel setzt den Fokus auf die Seitenüberschrift.
  useEffect(() => { heading.current?.focus(); }, [scope.scopeId]);
  useEffect(() => {
    if (renaming || !restoreFocus.current) return;
    restoreFocus.current = false;
    renameButton.current?.focus();
  }, [renaming]);
  const stopRenaming = () => {
    scopeDrafts.delete(scope.scopeId);
    restoreFocus.current = true;
    setFailed(false);
    setRenaming(false);
  };
  // Die abgeschlossene Umbenennung hat den Entwurf entfernt, wenn nicht weitergetippt wurde; dann schließt das Formular.
  const busy = usePendingWrite(() => pendingScopeWrite(scope.scopeId), (result) => {
    setFailed(!result.ok);
    if (result.ok && !scopeDrafts.has(scope.scopeId)) {
      restoreFocus.current = true;
      setRenaming(false);
    }
  });
  return (
    <header className="space-y-3 border-b border-[var(--color-border-default)] pb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Anwendungsbereich</p>
          <h1 ref={heading} tabIndex={-1} className="type-page-title break-words focus:outline-none">{scope.name}</h1>
        </div>
        {!renaming && (
          <Button ref={renameButton} variant="secondary" className="min-h-touch desktop:min-h-0" disabled={!writable} onClick={() => {
            if (!scopeDrafts.has(scope.scopeId)) scopeDrafts.set(scope.scopeId, scope.name);
            setRenaming(true);
          }}>
            Umbenennen
          </Button>
        )}
      </div>
      {renaming && (
        <div className="space-y-2">
          <NameForm
            label="Neuer Name"
            submitLabel="Speichern"
            initial={scopeDrafts.get(scope.scopeId) ?? scope.name}
            disabled={!writable}
            busy={busy}
            onChange={(name) => scopeDrafts.set(scope.scopeId, name)}
            onSubmit={async (name) => {
              // Der Vergleichsstand ist der angezeigte: Hat ein anderer Tab inzwischen geschrieben, scheitert das Speichern als Konflikt.
              const result = await renameScope(scope.scopeId, name, scope.savedAt);
              setFailed(!result.ok);
              // Wurde während des Speicherns weitergetippt, bleibt das Formular mit dieser Eingabe offen.
              if (result.ok && scopeDrafts.get(scope.scopeId)?.trim() === name) stopRenaming();
              return result.ok;
            }}
            onCancel={stopRenaming}
          />
          {failed && <SaveFailed />}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <OriginLabel />
        <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">
          Automatisch gespeichert · {relativeTime(scope.savedAt, now)}
        </span>
      </div>
    </header>
  );
}

/**
 * Übersicht eines Anwendungsbereichs unter `/informationsverbuende/anwendungsbereiche/:scopeId`.
 * Die Route trägt nur die `scopeId`; der Name steht ausschließlich im Seiteninhalt (ADR-11 §3).
 */
export function ScopeOverviewPage() {
  const { scopeId } = useParams();
  const { status, scopes, scopesFailed, verbuende } = useWorkspace();
  const [now] = useState(Date.now);
  if (!isLocalIdentity(scopeId)) return <WorkspaceStatePage state="scope-not-found" />;
  if (status === 'unavailable' || scopesFailed) return <WorkspaceStatePage state="scope-failed" />;
  if (scopes === null || verbuende === null) return <WorkspaceStatePage state="scope-loading" />;
  const scope = scopes.find((entry) => entry.scopeId === scopeId);
  if (!scope) return <WorkspaceStatePage state="scope-not-found" />;
  const members = verbuende.filter((verbund) => verbund.scopeId === scope.scopeId);
  return (
    <>
      <PageTitle title={PAGE_TITLES.scope} />
      {/* Außerhalb des Desktops fehlt der Kopfzeilenpfad; die Zurückzeile führt in den Arbeitsbereich (Bild 6). */}
      <Link
        to={buildWorkspaceIndexUrl()}
        className={`flex min-h-touch items-center gap-1 border-b border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-4 text-sm font-semibold text-[var(--color-text-primary)] desktop:hidden ${FOCUS_RING} focus-visible:ring-inset focus-visible:ring-offset-0`}
      >
        <span aria-hidden="true">‹</span> Arbeitsbereich
      </Link>
      <div className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 desktop:px-7 desktop:py-6">
        <ScopeHeader key={scope.scopeId} scope={scope} now={now} />
        <WorkspaceNotices />
        <section aria-labelledby="scope-verbuende">
          <SectionHead id="scope-verbuende" title="Informationsverbünde" count={members.length} />
          <div className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
            {members.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">Keine Informationsverbünde zugeordnet</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {members.map((verbund) => (
                  <li key={verbund.verbundId} className="px-4 py-2">
                    <Link
                      to={buildVerbundUrl(verbund.verbundId)}
                      className={`flex min-h-touch min-w-0 items-center rounded text-sm font-semibold text-[var(--color-text-primary)] hover:underline desktop:min-h-8 ${FOCUS_RING}`}
                    >
                      <span className="min-w-0 break-words">{verbund.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
