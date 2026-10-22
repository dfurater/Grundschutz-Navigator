// =============================================================================
// Prüfspur einer Station (GSPP-315)
//
// Lädt Trail und gespeicherten Stand, setzt Prüfpunkte und Workspace-
// Entscheidungen. Die Freigabe selbst schreibt das Dokument und läuft deshalb
// über den Editor, der diesen Hook nach Erfolg neu lädt.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewDecisionKind, ReviewTrailView } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';

export type ReviewTrailMessage =
  | 'load-failed'
  | 'checkpoint-draft'
  | 'checkpoint-failed'
  | 'decision-not-allowed'
  | 'withdrawal-unknown'
  | 'conflict'
  | 'work-failed'
  | 'decision-failed'
  | 'catalog-locked';

export interface ReviewDecisionInput {
  readonly decision: Exclude<ReviewDecisionKind, 'approved'>;
  readonly withdraws?: { readonly sequence: number; readonly actionUuid: string };
  readonly reason?: string;
}

export interface ReviewTrailState {
  readonly status: 'loading' | 'ready' | 'failed';
  readonly view?: ReviewTrailView;
  readonly message?: ReviewTrailMessage;
  readonly busy: boolean;
  /** Wahr, solange ein Reload läuft. */
  readonly refreshing: boolean;
  readonly reload: () => Promise<void>;
  readonly checkpoint: () => Promise<boolean>;
  readonly decide: (input: ReviewDecisionInput) => Promise<boolean>;
}

/** Speichercodes dieses Slices werden zu benannten Meldungen, nie zu rohen Fehlertexten. */
export function reviewTrailMessage(code: string): ReviewTrailMessage {
  switch (code) {
    case 'WORKSPACE_SAVE_CONFLICT': return 'conflict';
    case 'REVIEW_CHECKPOINT_NOT_ALLOWED': return 'checkpoint-draft';
    case 'REVIEW_DECISION_NOT_ALLOWED': return 'decision-not-allowed';
    case 'REVIEW_WITHDRAWAL_TARGET_UNKNOWN': return 'withdrawal-unknown';
    case 'REVIEW_WITHDRAWAL_DUPLICATE': return 'decision-not-allowed';
    case 'REVIEW_TRAIL_WORK_FAILED': return 'work-failed';
    case 'WORKSPACE_DOCUMENT_NOT_FOUND': return 'load-failed';
    default: return code.startsWith('OSCAL_WORKSPACE_CATALOG_PIN_') ? 'catalog-locked' : 'decision-failed';
  }
}

export function useReviewTrail(localId: ReviewTrailView['document']['localId'], documentSavedAt?: string): ReviewTrailState {
  const { documents } = useWorkspace();
  const [status, setStatus] = useState<ReviewTrailState['status']>('loading');
  const [view, setView] = useState<ReviewTrailView>();
  const [message, setMessage] = useState<ReviewTrailMessage>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Der Speicherzugang wechselt mit geladenen Katalogen; die Referenz hält das Laden stabil.
  const documentsRef = useRef(documents);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  const running = useRef(false);
  const request = useRef(0);
  // Dokument und Speicherstand der angezeigten Prüfspur; ein bereits geladener Stand wird nicht erneut gelesen.
  const loadedStand = useRef<string>(undefined);

  const reload = useCallback(async () => {
    const ticket = ++request.current;
    setLoading(true);
    const result = await documentsRef.current.listReviewTrail(localId);
    // Eine Antwort zu einem früheren Dokument- oder Speicherstand darf den aktuellen nie überschreiben.
    if (ticket !== request.current) return;
    if (!result.ok) {
      setStatus('failed');
      setMessage('load-failed');
      setLoading(false);
      return;
    }
    loadedStand.current = `${result.value.document.localId}|${result.value.document.savedAt}`;
    setView(result.value);
    setStatus('ready');
    setLoading(false);
  }, [localId]);

  // Jeder noch nicht geladene Dokumentstand löst einen Lesevorgang aus; ein Checkpoint allein nicht.
  // Der Microtask hält den Effekt frei von synchronen Zustandswechseln.
  useEffect(() => {
    if (documentSavedAt !== undefined && loadedStand.current === `${localId}|${documentSavedAt}`) return;
    void Promise.resolve().then(reload);
  }, [localId, reload, documentSavedAt]);

  const run = useCallback(async (operation: () => Promise<{ readonly ok: boolean; readonly code?: string }>): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await operation();
      if (!result.ok) {
        const next = reviewTrailMessage(result.code ?? 'WORKSPACE_STORAGE_FAILED');
        setMessage(next);
        // Ein Konflikt macht die gebundenen Werte ungültig; erst der neue Stand erlaubt den nächsten Versuch.
        if (next === 'conflict') await reload();
        return false;
      }
      await reload();
      return true;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [reload]);

  const checkpoint = useCallback(async () => {
    const current = view;
    if (!current) return false;
    return run(async () => {
      const result = await documentsRef.current.appendCheckpoint(
        localId,
        current.document.savedAt,
        current.draftSavedAt,
        current.trail.at(-1)?.sequence ?? 0,
      );
      return result.ok ? { ok: true } : { ok: false, code: result.diagnostic.code };
    });
  }, [localId, run, view]);

  const decide = useCallback(async (input: ReviewDecisionInput) => {
    const current = view;
    if (!current) return false;
    return run(async () => {
      const result = await documentsRef.current.appendDecision(localId, current.document.savedAt, current.draftSavedAt, {
        ...input,
        expectedSequence: current.trail.at(-1)?.sequence ?? 0,
      });
      return result.ok ? { ok: true } : { ok: false, code: result.diagnostic.code };
    });
  }, [localId, run, view]);

  return { status, view, message, busy, refreshing: loading, reload, checkpoint, decide };
}
