import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

const EMPTY_CHECKED_IDS = new Set<string>();

export interface UseControlSelectionOptions {
  scopeId: string;
}

export interface UseControlSelectionResult {
  checkedIds: Set<string>;
  setCheckedIds: Dispatch<SetStateAction<Set<string>>>;
  setChecked: (controlId: string, checked: boolean) => void;
  clear: () => void;
}

export function useControlSelection({
  scopeId,
}: UseControlSelectionOptions): UseControlSelectionResult {
  const [selectionState, setSelectionState] = useState(() => ({
    scopeId,
    checkedIds: EMPTY_CHECKED_IDS,
  }));
  const checkedIds =
    selectionState.scopeId === scopeId
      ? selectionState.checkedIds
      : EMPTY_CHECKED_IDS;

  const setCheckedIds = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (next) => {
      setSelectionState((current) => {
        const currentCheckedIds =
          current.scopeId === scopeId
            ? current.checkedIds
            : EMPTY_CHECKED_IDS;
        const resolved =
          typeof next === 'function'
            ? next(currentCheckedIds)
            : next;

        return {
          scopeId,
          checkedIds: resolved.size > 0 ? resolved : EMPTY_CHECKED_IDS,
        };
      });
    },
    [scopeId],
  );

  const setChecked = useCallback(
    (controlId: string, checked: boolean) => {
      setCheckedIds((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(controlId);
        } else {
          next.delete(controlId);
        }
        return next;
      });
    },
    [setCheckedIds],
  );

  const clear = useCallback(() => {
    setCheckedIds(EMPTY_CHECKED_IDS);
  }, [setCheckedIds]);

  return {
    checkedIds,
    setCheckedIds,
    setChecked,
    clear,
  };
}
