import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import type { LocalId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { INPUT } from '@/features/workspace/profile/ProfileMarks';
import { buildReviewView, metadataOf, reviewIdentities, type DecisionSubmission } from '@/features/workspace/review/reviewView';
import { DecisionForm } from '@/features/workspace/review/DecisionForm';
import { ReviewPanel } from '@/features/workspace/review/ReviewPanel';
import { useReviewTrail, type ReviewTrailMessage } from '@/features/workspace/review/useReviewTrail';

export interface ReviewApprovalInput extends DecisionSubmission {
  /** Trail-Sequenz, gegen die der Aufrufer gelesen hat. */
  readonly expectedSequence: number;
}

export type ReviewApprovalResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

export interface ReviewTabProps {
  readonly localId: LocalId;
  /** Gespeicherter Stand; ein neuer Wert lädt die Prüfspur nach einem Speichern neu. */
  readonly documentSavedAt?: string;
  /** Ungespeicherte Eingaben der Station; sie blockieren Prüfpunkt und Freigabe. */
  readonly editorDirty?: boolean;
  /** Fehlt bei schreibgeschützten Roots; dann bleibt die Freigabe gesperrt. */
  readonly approval?: {
    readonly onSubmit: (input: ReviewApprovalInput) => Promise<ReviewApprovalResult>;
  };
  /** Übernimmt einen in einem anderen Tab gespeicherten Stand nur ohne offene Eingaben. */
  readonly onDocumentAdopted?: (document: WorkspaceEnvelope) => Promise<'adopted' | 'blocked' | 'failed'>;
}

function approvalBlockedReason(readOnly: boolean, draft: boolean, staleStand: boolean): string | undefined {
  if (readOnly) return 'Dieses Dokument ist in dieser Ansicht schreibgeschützt; eine Freigabe ist nur an der Profil-Station möglich.';
  if (staleStand) return 'Der gespeicherte Stand ist neuer als der Editor; offene Eingaben bleiben erhalten. Bitte die Seite neu laden, um den Konflikt aufzulösen.';
  if (draft) return 'Bitte zuerst speichern; die Freigabe schreibt den gespeicherten Stand.';
  return undefined;
}

const MESSAGES: Readonly<Record<ReviewTrailMessage, string>> = {
  'load-failed': 'Die Prüfspur konnte nicht gelesen werden.',
  'checkpoint-draft': 'Ein Entwurf oder ungespeicherte Eingaben lassen sich nicht als Prüfpunkt binden.',
  'checkpoint-failed': 'Der Prüfpunkt wurde nicht geschrieben.',
  'decision-not-allowed': 'Dieser Zustandswechsel ist aus dem aktuellen Prüfzustand nicht zulässig.',
  'withdrawal-unknown': 'Die Freigabe, die zurückgenommen werden soll, ist nicht mehr vorhanden.',
  conflict: 'Der gespeicherte Stand hat sich geändert; die Prüfspur wurde neu geladen.',
  'work-failed': 'Hash oder Diff konnten nicht berechnet werden; es wurde nichts geschrieben.',
  'decision-failed': 'Die Entscheidung wurde nicht geschrieben.',
};

const APPROVAL_MESSAGES: Readonly<Record<string, string>> = {
  REVIEW_APPROVAL_BLOCKED: 'Bitte zuerst den gespeicherten Stand herstellen; die Freigabe wurde nicht geschrieben.',
  REVIEW_APPROVAL_INVALID: 'Der Freigabeeintrag ist unvollständig; es wurde nichts geschrieben.',
  REVIEW_APPROVAL_SCHEMA: 'Das Dokument besteht die Schemaprüfung nicht; die Freigabe wurde nicht geschrieben.',
  REVIEW_RESPONSIBLE_PARTY_MISSING: 'Rolle oder Partei der Freigabe fehlt; es wurde nichts geschrieben.',
  REVIEW_ROLE_MISSING: 'Die Rolle fehlt im Dokument; es wurde nichts geschrieben.',
  REVIEW_ROLE_AMBIGUOUS: 'Die Rolle ist im Dokument mehrdeutig; es wurde nichts geschrieben.',
  REVIEW_PARTY_MISSING: 'Die Partei fehlt im Dokument; es wurde nichts geschrieben.',
  REVIEW_PARTY_AMBIGUOUS: 'Die Partei ist im Dokument mehrdeutig; es wurde nichts geschrieben.',
  WORKSPACE_SAVE_CONFLICT: 'Der gespeicherte Stand hat sich geändert; die Freigabe wurde nicht geschrieben.',
};

/**
 * Prüfspur mit den bewussten Zustandswechseln eines Dokuments. Prüfpunkte und
 * Workspace-Entscheidungen schreiben nie das Dokument; nur die Freigabe tut das
 * und läuft deshalb über den Editor, der den gespeicherten Stand besitzt.
 */
export function ReviewTab({ localId, documentSavedAt, editorDirty = false, approval, onDocumentAdopted }: Readonly<ReviewTabProps>) {
  const review = useReviewTrail(localId, documentSavedAt);
  const [reason, setReason] = useState('');
  const [approvalMessage, setApprovalMessage] = useState<string>();
  const [approving, setApproving] = useState(false);
  const [formGeneration, setFormGeneration] = useState(0);
  const [adoption, setAdoption] = useState<{ readonly savedAt: string; readonly status: 'pending' | 'adopted' | 'blocked' | 'failed' }>();

  useEffect(() => {
    const loaded = review.view?.document;
    if (!loaded || documentSavedAt === undefined || !onDocumentAdopted || loaded.savedAt === documentSavedAt) return;
    if (adoption?.savedAt === loaded.savedAt) return;
    const loadedSavedAt = loaded.savedAt;
    void Promise.resolve().then(() => setAdoption({ savedAt: loadedSavedAt, status: 'pending' }));
    void onDocumentAdopted(loaded).then((result) => {
      setAdoption({ savedAt: loadedSavedAt, status: result });
      if (result === 'blocked') setApprovalMessage('Der gespeicherte Stand wurde in einem anderen Tab geändert. Deine offenen Eingaben bleiben erhalten; bitte die Seite neu laden, um den Konflikt aufzulösen.');
      if (result === 'failed') setApprovalMessage('Der geänderte Dokumentstand konnte nicht übernommen werden; bitte die Seite neu laden.');
    });
  }, [adoption, documentSavedAt, onDocumentAdopted, review.view]);

  if (review.status === 'failed') return <output className="block text-sm text-[var(--color-text-primary)]">{MESSAGES['load-failed']}</output>;
  if (!review.view) return <output className="block text-sm text-[var(--color-text-secondary)]">Prüfspur wird geladen…</output>;

  const { view } = review;
  const document = view.document;
  const metadata = metadataOf(document.source, document.rootType);
  const { roles, parties } = reviewIdentities(metadata);
  const standMismatch = documentSavedAt !== undefined && document.savedAt !== documentSavedAt;
  const adoptionPending = adoption?.savedAt === document.savedAt && adoption.status === 'pending';
  const adoptionAdopted = adoption?.savedAt === document.savedAt && adoption.status === 'adopted';
  const pendingAdoption = standMismatch && onDocumentAdopted !== undefined && (adoption?.savedAt !== document.savedAt || adoptionPending || adoptionAdopted);
  const refreshing = review.refreshing || pendingAdoption;
  const reviewView = buildReviewView({ trail: view.trail, stand: view.stand, editorDirty, refreshing, metadata });
  const sequence = view.trail.at(-1)?.sequence ?? 0;
  const draft = document.documentState === 'draft' || view.draftSavedAt !== null || editorDirty;
  const checkpointReason = draft
    ? 'Bitte zuerst speichern; ein Entwurf oder ungespeicherter Arbeitsstand lässt sich nicht als Prüfpunkt binden.'
    : undefined;
  const approvalReason = approvalBlockedReason(approval === undefined, draft, standMismatch);
  const canReview = reviewView.derived.state === 'none' || reviewView.derived.state === 'changes-requested';
  const canRequestChanges = reviewView.derived.state === 'reviewed' || reviewView.derived.state === 'approved' || reviewView.derived.state === 'none';
  const withdrawTarget = reviewView.derived.state === 'approved' ? reviewView.derived.actionUuid : undefined;

  // Nur der abgeschickte Wert wird geleert; währenddessen getippter Text bleibt stehen.
  const clearSubmitted = (submitted: string) => (ok: boolean) => {
    if (ok) setReason((current) => (current === submitted ? '' : current));
  };
  const decide = (decision: 'reviewed' | 'changes-requested') => {
    void review.decide({ decision, reason: reason.trim() }).then(clearSubmitted(reason));
  };
  const withdraw = () => {
    if (!withdrawTarget) return;
    const target = view.trail.find((row) => row.kind === 'decision' && row.actionUuid === withdrawTarget);
    if (!target) return;
    void review.decide({ decision: 'withdrawn', withdraws: { sequence: target.sequence, actionUuid: withdrawTarget }, reason: reason.trim() })
      .then(clearSubmitted(reason));
  };
  const submitApproval = (input: DecisionSubmission) => {
    if (!approval || approving) return;
    setApproving(true);
    setApprovalMessage(undefined);
    void approval.onSubmit({ ...input, expectedSequence: sequence }).then(async (result) => {
      if (result.ok) {
        setFormGeneration((generation) => generation + 1);
        setApprovalMessage('Die Freigabe wurde als Aktion in das Dokument geschrieben.');
        await review.reload();
        return;
      }
      setApprovalMessage(APPROVAL_MESSAGES[result.code] ?? 'Die Freigabe wurde nicht geschrieben.');
    }).finally(() => setApproving(false));
  };

  const actions = (
    <div className="space-y-5 border-t border-[var(--color-border-subtle)] pt-4">
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Prüfpunkte und Entscheidungen bleiben im Workspace dieses Browsers. Nur eine Freigabe wird als Aktion in das Dokument geschrieben.
      </p>
      {review.message && <output className="block text-sm text-[var(--color-text-primary)]">{MESSAGES[review.message]}</output>}
      <form className="space-y-3" onSubmit={(event: FormEvent) => event.preventDefault()}>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Entscheidungen</h3>
        <div className="space-y-1">
          <label htmlFor={`${localId}-decision-reason`} className="text-sm font-medium text-[var(--color-text-primary)]">
            Begründung <span className="font-normal text-[var(--color-text-secondary)]">(optional)</span>
          </label>
          <textarea id={`${localId}-decision-reason`} className={INPUT} rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-touch desktop:min-h-0" disabled={review.busy || refreshing || approving || !canReview} onClick={() => decide('reviewed')}>Als geprüft markieren</Button>
          <Button type="button" variant="secondary" className="min-h-touch desktop:min-h-0" disabled={review.busy || refreshing || approving || !canRequestChanges} onClick={() => decide('changes-requested')}>Änderungen anfordern</Button>
          {withdrawTarget && (
            <Button type="button" variant="ghost" className="min-h-touch desktop:min-h-0" disabled={review.busy || refreshing || approving} onClick={withdraw}>Freigabe zurücknehmen</Button>
          )}
        </div>
      </form>
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Prüfpunkt</h3>
        <Button type="button" variant="secondary" className="min-h-touch desktop:min-h-0" disabled={review.busy || refreshing || approving || Boolean(checkpointReason)} onClick={() => { void review.checkpoint(); }}>
          Prüfpunkt setzen
        </Button>
        {checkpointReason && <p className="text-sm text-[var(--color-text-secondary)]">{checkpointReason}</p>}
        <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">Ein Prüfpunkt verändert das Dokument nicht; er bindet den gespeicherten Stand mit Hash und strukturellem Diff.</p>
      </div>
      {approval && (
        <div className="space-y-2">
          {approvalMessage && <output className="block text-sm text-[var(--color-text-primary)]">{approvalMessage}</output>}
          <DecisionForm
            key={formGeneration}
            roles={roles}
            parties={parties}
            disabledReason={approvalReason}
            findingCodes={reviewView.findings.map((finding) => finding.code)}
            busy={approving || review.busy || refreshing}
            onSubmit={submitApproval}
          />
        </div>
      )}
      {!approval && <p className="text-sm text-[var(--color-text-secondary)]">{approvalReason}</p>}
    </div>
  );

  return <ReviewPanel view={reviewView} metadata={metadata} actions={actions} />;
}
