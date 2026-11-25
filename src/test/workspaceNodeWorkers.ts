/** Node replacements for the two worker entries of the workspace store: both run their validation chain in-process. */
export async function inProcessImportGate() {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
}

export async function inProcessBackupParser() {
  const { processWorkspaceBackupBytes, processVerbundBackupBytes, processAnyBackupBytes } = await import('@/adapters/workspaceBackupProcessing');
  return { parseWorkspaceBackup: processWorkspaceBackupBytes, parseVerbundBackup: processVerbundBackupBytes, parseAnyBackup: processAnyBackupBytes };
}

/** Hash und Diff ohne eigenen Worker; die Frist- und Ausfallpfade deckt `reviewTrailWork.test.ts` ab. */
export async function inProcessReviewTrailWork() {
  const { documentSnapshot } = await import('@/domain/reviewTrail');
  const { diffDocuments } = await import('@/domain/documentDiff');
  const { createOscalDiagnostic } = await import('@/domain/oscalDiagnostics');
  const { processContentHash } = await import('@/domain/sspProcessProjection');
  return {
    reviewTrailInWorker: async (request: {
      source: unknown; rootType: Parameters<typeof documentSnapshot>[1]; previous: unknown; baseSequence: number | null; diff: boolean;
      processBinding?: { processUuid: string; decisionParties: readonly unknown[] };
    }) => {
      const snapshot = await documentSnapshot(request.source, request.rootType);
      if (!snapshot) {
        return {
          ok: false as const,
          diagnostic: createOscalDiagnostic({ code: 'REVIEW_TRAIL_WORK_FAILED', stage: 'domain', validator: { name: 'gspp-review-trail', version: '1' }, path: '/' }),
        };
      }
      return {
        ok: true as const,
        value: {
          snapshot,
          // Wie der Worker: der gebundene Prozessstand für eine Prozessfreigabe.
          ...(request.processBinding ? { processHash: await processContentHash(request.source, request.processBinding.processUuid, request.processBinding.decisionParties) } : {}),
          ...(request.diff ? { diff: diffDocuments({ base: request.previous ?? {}, next: request.source, rootType: request.rootType, baseSequence: request.baseSequence }) } : {}),
        },
      };
    },
  };
}

