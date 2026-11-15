import { useEffect, useRef, useState } from 'react';
import type { WorkspaceResult } from '@/domain/workspaceModel';

/**
 * Ein vor dem Aufbau des Formulars gestarteter Schreibvorgang (etwa vor einem Routenwechsel)
 * sperrt das Formular, bis sein Ergebnis da ist; `onResult` erhält dieses Ergebnis.
 * `lookup` liefert den laufenden Vorgang aus dem Provider und wird nur beim Aufbau gelesen.
 */
export function usePendingWrite<T>(lookup: () => Promise<WorkspaceResult<T>> | undefined, onResult: (result: WorkspaceResult<T>) => void): boolean {
  const [pending] = useState(lookup);
  const [busy, setBusy] = useState(pending !== undefined);
  const handle = useRef(onResult);
  useEffect(() => { handle.current = onResult; });
  useEffect(() => {
    if (!pending) return;
    let active = true;
    void pending.then((result) => {
      if (!active) return;
      setBusy(false);
      handle.current(result);
    });
    return () => { active = false; };
  }, [pending]);
  return busy;
}
