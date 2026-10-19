import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';

/**
 * Benannte Speichermeldungen des Bereichs Informationsverbünde
 * (docs/PERSISTENCE.md §3, §10). Sie tragen nur den Meldungstyp, nie
 * Dokumentwerte oder native Fehlertexte.
 */
export type WorkspaceNotice =
  | 'write-locked'
  | 'quota-warning'
  | 'quota-exceeded'
  | 'conflict'
  | 'storage-failed';

/** Ab diesem Anteil belegten Browser-Speichers erscheint die Quota-Vorwarnung. */
export const QUOTA_WARNING_RATIO = 0.8;

export function noticeForDiagnostic(diagnostic: Pick<OscalDiagnostic, 'code'>): WorkspaceNotice {
  switch (diagnostic.code) {
    case 'WORKSPACE_SCHEMA_NEWER': return 'write-locked';
    case 'WORKSPACE_QUOTA_EXCEEDED': return 'quota-exceeded';
    case 'WORKSPACE_SAVE_CONFLICT': return 'conflict';
    default: return 'storage-failed';
  }
}

export function quotaNearlyExhausted(estimate: StorageEstimate | undefined): boolean {
  const { usage, quota } = estimate ?? {};
  return typeof usage === 'number' && typeof quota === 'number' && quota > 0 && usage / quota >= QUOTA_WARNING_RATIO;
}

export function withNotice(notices: readonly WorkspaceNotice[], notice: WorkspaceNotice): readonly WorkspaceNotice[] {
  return notices.includes(notice) ? notices : [...notices, notice];
}

export function withoutNotice(notices: readonly WorkspaceNotice[], notice: WorkspaceNotice): readonly WorkspaceNotice[] {
  return notices.includes(notice) ? notices.filter((entry) => entry !== notice) : notices;
}
